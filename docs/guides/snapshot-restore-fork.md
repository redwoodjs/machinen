# Snapshot, restore, and fork

A snapshot is a complete picture of a running VM frozen to disk: every
page of memory, every open file descriptor, every TCP listener, the
program counter of every thread. Restoring it doesn't _start_ the
process — it _resumes_ it, like waking a laptop from sleep.

Two patterns get a lot of mileage out of that:

- **Move a long-running process to another machine.** Snapshot it on
  host A, copy the bundle, restore on host B. The process never noticed.
- **Clone a warmed-up process.** Snapshot it without killing it,
  immediately restore the bundle into a sibling VM. Now you have two
  copies of the same process running side by side.

This guide covers both. There's a constraint worth getting out of the
way first: same arch only. arm64 to arm64 works (laptop to Graviton).
arm64 to x86 does not — the snapshot includes machine-code register
state, and that doesn't translate.

## Vmstate restore contract

The default snapshot engine is `vmstate`: a whole-VM checkpoint made of
`state.vmstate`, `rootdisk.img`, and `meta.json`. Its restore contract is:

- **Timers:** guest `CLOCK_MONOTONIC` must not rewind and should not include
  host downtime while the VM was stopped. Pending `nanosleep` and `timerfd`
  deadlines should resume with their remaining guest time, not fire
  immediately because the host slept.
- **Entropy:** restore mixes fresh host randomness into the guest CSPRNG before
  `restore()` returns and writes `/run/machinen-vmstate-reseed` as a
  non-secret diagnostic marker. Two restores or forks from the same bundle
  must not generate the same `/dev/urandom` or `getrandom(2)` stream.
- **Sockets:** listeners can be restored, but host port forwards are never
  inherited. Re-declare forwards with `-p` / `portForward`. Established
  host-side TCP streams from the source VM must fail cleanly in the restored
  VM rather than silently sharing the source's live connection. In-guest Unix
  sockets are VM-internal state and should continue to work.

The focused smoke repros live under `scripts/smoke/vmstate/` and can be run
with `pnpm smoke-vmstate` or by area (`pnpm smoke-vmstate-timers`,
`pnpm smoke-vmstate-entropy`, `pnpm smoke-vmstate-sockets`).

## Moving a process between machines

Boot the workload, let it accumulate whatever in-memory state matters,
then snapshot:

```bash
npx machinen boot --name counter -p 3000:3000 --detached ./counter.tar.gz
# ... requests come in, the process builds up state ...
npx machinen snapshot counter ./counter.snap
```

`./counter.snap` is a directory holding `state.vmstate` (CPU, RAM, and
device state), `rootdisk.img` (the exact root block-device bytes), and
`meta.json` (restore invariants and source metadata). It's a self-contained
bundle — copy the whole directory and you've copied the snapshot.

Vmstate snapshots are non-destructive checkpoints: the source VM resumes after
the bundle is written. For a true _handoff_ where the process should only run
in one place at a time, stop the source after the snapshot succeeds:

```bash
npx machinen stop counter
```

If you opt into the legacy CRIU engine with `MACHINEN_SNAPSHOT_ENGINE=criu`,
`machinen snapshot` is destructive unless you pass `--keep-alive`, and the
bundle stores CRIU images under `img/` instead.

To move it:

```bash
scp -r ./counter.snap host-b:
ssh host-b npx machinen restore ./counter.snap -p 3000:3000
```

`restore` takes the bundle directory and boots a VM that resumes from
that frozen state. The first request to host B picks up exactly where
the last request to host A left off — same heap, same connection
state, same counter value.

Port forwards aren't carried in the snapshot, so re-declare them on
restore — that's why `-p 3000:3000` reappears here.

From Node, the same flow:

```ts
import { boot, restore } from "@machinen/runtime";

const vm = await boot({ image: "./counter.tar.gz", name: "counter" });
// ... let it run ...
await vm.snapshot({ outDir: "./counter.snap" });

// possibly on another host:
const restored = await restore({ snapDir: "./counter.snap" });
```

Restored VMs without an explicit name get an auto-name shaped like
`<sourceName>/<pid>` so lineage shows up in `machinen ls`. You can pass
`--name` (CLI) or `name` (API) to override.

## Cloning a running process

The same machinery, used differently. If you snapshot _without_ killing
the source and immediately restore, you get two VMs running the same
process from the same instant. They share a heap up to that moment;
from then on they diverge.

That's what `fork` does:

```bash
npx machinen fork counter --new-name counter-b --detach
```

The source `counter` is unaffected — briefly frozen during the dump,
then resumes. `counter-b` is a fresh sibling with a copy of the same
heap. Both keep running independently.

```ts
const fork = await vm.fork({ name: "counter-b" });
```

There are two pieces of inherited state where the defaults are
deliberately _unsafe_ if you don't think about them:

**TCP connections.** The source had open sockets to clients; both VMs
can't safely hold the same host-side connection. Under vmstate, restored
copies should see old established TCP streams close or error within a bounded
time; the source keeps its live stream. Open fresh connections after restore.
`--tcp-keep` is a CRIU-only experiment for cases where you deliberately want
to preserve inherited TCP repair state.

**Host port forwards.** A port like `:3000` is global on the host —
only one process can bind it. The source already does. So `fork`
doesn't inherit port forwards by default; the new VM has no exposed
ports. Either reach the fork via `machinen exec` (vsock, doesn't go
through host networking), or pass new forwards explicitly — both the
CLI and Node API accept them:

```bash
npx machinen fork counter --new-name counter-b -p 3001:3000
```

```ts
await vm.fork({
  name: "counter-b",
  portForward: [{ hostPort: 3001, guestPort: 3000 }],
});
```

If you pick a host port the source is already forwarding, the bind
probe fires `BOOT_PORT_FORWARD_IN_USE` with the holding VM's name —
not advice to `kill` it — so you know to pick a different host port.

### Boot-shaped flags work on the fork too

`fork` is `snapshot --keep-alive` + `restore` rolled into one call, so
anything you can pass at `boot` time also works on a fork — and lands
on the _forked sibling_, not the source. That covers `--mount`,
`--mount-live`, `--env`, `--cwd`, and `--memory`.

The source's own `--mount` payload was baked into its rootdisk before
the snapshot, so the fork inherits it via the disk image without you
re-passing anything. Use these flags when you want the fork to differ
from the source — e.g. layer in an additional input dir, set an env
var that wasn't there before, or hand the fork more RAM:

```bash
npx machinen fork worker --new-name worker-eval \
  --mount ./eval-fixtures:/mnt/in \
  --env RUN_MODE=eval \
  --memory 8192
```

Live mounts (`--mount-live`) on a fork establish a _fresh_ virtio-fs
window on the sibling. The bundle records each live mount's guest path,
host path, and mode, so restore can reconnect the same window or accept a
per-guest override.

## When you need the source to survive the snapshot

With the default vmstate engine, the source always survives the snapshot.
`--keep-alive` is mainly for the CRIU engine, where a plain snapshot powers the
source off after the dump:

```bash
MACHINEN_SNAPSHOT_ENGINE=criu npx machinen snapshot counter ./counter.snap --keep-alive
```

Same as fork's snapshot half: the source survives. Do not rely on established
host-side TCP streams in the restored VM; open fresh connections or fresh port
forwards after restore.

## Snapshot bundles are bigger than they look

Vmstate bundles include `rootdisk.img` plus one or more `.vmstate` checkpoint
files. The rootdisk is sparse, and incremental checkpoints after the first can
store RAM and rootdisk deltas, but a workload that dirties a lot of memory or
disk can still produce a large bundle. CRIU bundles are different: they store
process images under `img/` alongside `meta.json`.

For now, two practical workarounds:

- For transport, tar with `-S` so sparseness is preserved (a 2 GiB
  sparse image is typically well under 100 MiB on the wire):

  ```bash
  tar -czSf counter.snap.tar.gz counter.snap/
  ```

  Use `rsync -aS` instead of `scp -r` if you're going host-to-host —
  `scp` doesn't preserve sparseness.

- If you know the workload only writes a few hundred MB, pre-size the
  scratch disk down via `boot({ snapshot: "<smaller pre-allocated
file>" })` so the bundle starts smaller.

A `--compact` flag that trims unused blocks at snapshot time is on
the roadmap.
