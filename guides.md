# machinen guides

Practical recipes. Each guide assumes you've worked through the
[Quickstart](./README.md#quickstart) and have `@machinen/cli` +
`@machinen/runtime` installed.

- [Create a VM](#create-a-vm)
- [Snapshot, restore, and fork](#snapshot-restore-and-fork)
- [Mount files into a VM](#mount-files-into-a-vm)
- [Networking](#networking)

---

## Create a VM

There are three ways to get a guest workload running, in increasing order of
"baked in":

### 1. Ad-hoc boot — base rootfs + a command

The fastest way to get a shell. Uses the cached Debian base.

```bash
npx machinen boot -- /bin/sh
npx machinen boot -- bash -lc 'apt-get update && apt-get install -y curl && curl ifconfig.me'
```

No `--name` → the VM is anonymous and exits when the command exits.

### 2. Provisioned image — base + your deps + a default cmd

Bake an image once, boot it many times.

```ts
// bake.ts
import { provision } from "@machinen/runtime";
import { readFileSync } from "node:fs";

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update && apt-get install -y nodejs");
    await vm.writeFile("/opt/server.js", readFileSync("./server.js"));
  },
  cmd: ["/usr/bin/node", "/opt/server.js"],
  env: { NODE_ENV: "production" },
  out: "./my-server.tar.gz",
});
```

Then:

```bash
npx machinen boot ./my-server.tar.gz                    # baked cmd runs
npx machinen boot ./my-server.tar.gz -- bash             # override cmd
```

`provision({ cmd, env })` writes `/machinen-config.json` into the rootfs;
caller-supplied `cmd`/`env` on `boot()` always win on conflict.

### 3. Named, reattachable VM

Give the VM a `--name` so other shells (or another process) can find it.

```bash
npx machinen boot --name worker --detached ./my-server.tar.gz
npx machinen ls                                          # see PID + NAME
npx machinen exec --name worker -- ps aux
npx machinen attach --name worker                        # interactive shell
npx machinen stop --name worker
```

`--detached` returns control as soon as the guest produces its first console
byte; the VM keeps running. Without it, the CLI holds stdio until the VM
exits.

From Node, the equivalents are `boot({ name, detached: true })` plus
`attach({ name })` from any process.

---

## Snapshot, restore, and fork

All three use CRIU under the hood. Same arch only — arm64 ↔ arm64. Memory,
file descriptors, and timers come back exactly as they were.

### Snapshot — freeze a VM to disk

```bash
npx machinen boot --name counter -p 3000:3000 --detached ./counter.tar.gz
# ... let the workload accumulate state ...
npx machinen snapshot --name counter --out-dir ./counter.snap
```

The bundle is a directory:

```
counter.snap/
  disk.img        # CRIU image set on an ext4 volume
  meta.json       # source name + timestamp
```

By default the source VM **exits** as part of the snapshot — CRIU kills the
dumped tree on success. Pass `--keep-alive` to leave it running (and close
inherited TCP sockets so two live copies don't race on shared connection
state).

### Restore — thaw a bundle on the same or another machine

```bash
scp -r ./counter.snap host-b:
ssh host-b npx machinen restore ./counter.snap
```

Or from Node:

```ts
import { restore } from "@machinen/runtime";
const vm = await restore({ snapDir: "./counter.snap" });
```

Anonymous restores auto-name as `<sourceName>/<pid>` so lineage shows up in
`machinen ls`.

### Fork — clone a running VM

`fork` is `snapshot --keep-alive` + `restore` in one step. Both VMs keep
running with diverging futures.

```bash
npx machinen fork --name counter --new-name counter-b --detach
npx machinen exec --name counter-b -- curl -s localhost:3000
```

Or:

```ts
const fork = await vm.fork({ name: "counter-b" });
```

**Two fork gotchas worth knowing about:**

1. **TCP sockets reset.** The fork sees `ECONNRESET` on inherited TCP
   connections by default. The source keeps them. Pass `tcpKeep: true` /
   `--tcp-keep` only if you really want both copies racing on the same
   connection state.
2. **Port forwards aren't inherited.** Host ports are global — the source
   already owns the bind. Pass new `portForward` entries explicitly when the
   fork needs network exposure, or reach the fork via `machinen exec`.

### When the snapshot bundle gets huge

The bundle's `disk.img` covers the **scratch disk** allocated at boot time
(default ~8 GiB sparse). If you're snapshotting a workload that wrote a lot,
the resulting `disk.img` reflects that. Keep snapshots tight by snapshotting
warm-but-idle states, or by sizing the scratch disk down via
`boot({ snapshot: "<smaller pre-allocated file>" })`.

---

## Mount files into a VM

Three options, picked by **how big** and **how dynamic** the data is.

### `--mount` — copy-once, host dir → guest

For small-to-medium inputs the guest only reads at boot:

```bash
npx machinen boot --mount ./fixtures:/mnt/fixtures -- bash -c 'ls /mnt/fixtures'
```

Or:

```ts
await boot({
  image,
  cmd,
  mount: { host: "./fixtures", guest: "/mnt/fixtures" },
});
```

- Guest path **must** live under `/mnt/`.
- Payload rides through the initramfs cpio at boot time. With `rootDisk: true`
  (the default) it briefly counts against the initramfs RAM ceiling at unpack
  — for very large mounts, prefer `--mount-live`.
- Guest writes are **discarded** when the VM exits.

### `--mount-live` — FUSE pass-through, no copy

For large inputs, write-through scratch dirs, or any time you want host
changes to be visible to the guest as they happen:

```bash
npx machinen boot --mount-live ./workspace:/mnt/workspace:rw -- bash
npx machinen boot --mount-live ./readonly-data:/mnt/data:ro -- bash
```

Or:

```ts
await boot({
  image,
  cmd,
  liveMounts: [
    { host: "./workspace", guest: "/mnt/workspace", mode: "rw" },
    { host: "./readonly-data", guest: "/mnt/data", mode: "ro" },
  ],
});
```

- Guest reads stream in on demand via a vsock FUSE relay. Nothing copied at
  boot.
- `rw` (default): guest writes land on the host. `ro`: one-way share, host
  caches.
- Each mount gets its own vsock port. Repeatable.
- **Security:** a `rw` live mount is a persistent channel from a compromised
  guest back to the host filesystem rooted at `host`. Prefer `--mount`
  (copy-once) for inputs you don't need write-through on.

### `vm.writeFile` — drop a single file

Small configs, scripts, env files:

```ts
await vm.writeFile("/etc/myapp/config.json", JSON.stringify(cfg));
await vm.writeFile("/usr/local/bin/run.sh", scriptSource, { mode: 0o755 });
await vm.writeFile("/var/log/audit.log", line, { append: true });
```

Binary-safe (base64 over a single vsock exec frame). For very large blobs,
prefer `--mount` or `VsockFiles.push`.

### Land the guest cmd inside the share

Use `--cwd` / `guestCwd` so the workload starts inside the mount instead of
needing a `cd` in your wrapper script:

```bash
npx machinen boot --mount-live ./workspace:/mnt/workspace --cwd /mnt/workspace -- bash
```

---

## Networking

The runtime auto-spawns [gvproxy](https://github.com/containers/gvisor-tap-vsock)
as a sidecar to provide the guest with outbound networking and to install
host→guest port forwards. No NAT setup, no `iptables` — gvproxy is a userspace
TCP/IP stack that bridges over vsock.

### Outbound from the guest

Just works once `gvproxy` is in place:

```bash
npx machinen boot -- bash -c 'curl -s ifconfig.me; echo'
```

DNS, TCP, UDP — all via the gvproxy stack. The first boot may print a single
line (`machinen: installing gvproxy v0.8.6 …`) while it fetches the pinned
release into `~/.machinen/gvproxy/`; subsequent boots are silent.

If the install fetch fails (offline, no `gh auth`), networking stays disabled
and `boot()` continues — `curl` will hang/fail but the VM otherwise runs.

### Inbound: forward a host port to the guest

```bash
npx machinen boot -p 3000:3000 -- bash -c 'python3 -m http.server 3000'
```

```ts
await boot({
  image,
  cmd,
  portForward: [
    { hostPort: 3000, guestPort: 3000 },
    { hostPort: 5432, guestPort: 5432, hostAddr: "0.0.0.0" },
  ],
});
```

- `hostAddr` defaults to `127.0.0.1` (localhost-only). Set `0.0.0.0` to expose
  on all interfaces.
- Repeatable — pass `-p` multiple times on the CLI, or multiple entries in the
  array.
- `boot()` throws if a host port is already in use
  (`BOOT_PORT_FORWARD_IN_USE`) or if two forwards collide
  (`BOOT_PORT_FORWARD_CONFLICT`).

### Detached boots + port forwards

Currently mutually exclusive: `--detached` refuses `-p` (and `--mount`,
`--mount-live`) because those keep helpers alive in the JS process that the
detached VMM still needs to call back into. Workaround: keep the booter
process alive (run it under a supervisor like `pm2` / `systemd`) and let it
hold the forward.

### Custom gvproxy

Override the binary via `MACHINEN_GVPROXY=/path/to/gvproxy`. Resolution order
is: `$MACHINEN_GVPROXY` → sibling of the VMM binary → `~/.machinen/gvproxy/`
cache → `gvproxy` on `$PATH` → fetch the pinned release.
