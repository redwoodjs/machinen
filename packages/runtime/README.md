# @machinen/runtime

TypeScript API for booting and driving microVMs built by the
[machinen](https://github.com/redwoodjs/machinen) VMM.

## Install

```bash
npm i @machinen/runtime
```

You'll also need the VMM binary. If you're using `@machinen/cli`, install that
instead — it bundles the right `@machinen/vmm-arm64-*` package for your host.
Otherwise, install the platform-matched VMM package directly:

```bash
npm i @machinen/vmm-arm64-darwin    # or @machinen/vmm-arm64-linux
```

## Basic usage

```ts
import { boot } from "@machinen/runtime";

// binary is resolved automatically: MACHINEN_VMM env override, else
// require.resolve("@machinen/vmm-<arch>-<os>"). Install one of the
// vmm packages alongside this one.
const vm = await boot({
  image: "./rootfs-debian-arm64.tar.gz",
  cmd: ["/bin/sh"],
});

await vm.exec("echo hello from inside");

const { code } = await vm.wait();
process.exit(code ?? 0);
```

## Surface

### `boot(options): Promise<VmHandle>`

Boots the VMM as a child process and returns a handle with `stdin`/`stdout`/
`stderr` streams, `exec()`, `wait()`, `kill()`, `snapshot()`, and
`output()`/`errorOutput()` buffers.

Key options (all optional):

| Option        | Description                                                     |
| ------------- | --------------------------------------------------------------- |
| `image`       | Path to a rootfs tarball to boot from                           |
| `cmd`         | Guest workload argv; falls back to the image's baked-in default |
| `env`         | Env vars exposed to the guest workload                          |
| `snapshot`    | Host file attached as `/dev/vda` — typically a CRIU snapshot    |
| `mount`       | Single host-dir → guest-path mount (guest path under `/mnt/`)   |
| `portForward` | Host → guest TCP port forwards via gvproxy                      |
| `binary`      | VMM binary path — auto-resolved if omitted                      |
| `vmmEnv`      | Env for the VMM process itself (host side, rarely needed)       |
| `timeoutMs`   | `wait()` deadline (default 60s, `null` to wait forever)         |
| `onLog`       | Stream every byte of guest output (console + every exec)        |

Images produced by `provision({ cmd, env })` carry a baked-in default cmd (and
env) in `/machinen-config.json`, so callers can `boot({ image })` with no
further args. User-supplied `cmd`/`env` on `boot()` override the image defaults.

### Streaming logs

Every long-running API — `boot`, `provision`, `vm.snapshot`, `attach` —
accepts an `onLog` callback that fires for every byte of guest output as
it arrives. Each event is tagged so callers can tell kernel console
bytes from exec bytes:

```ts
import { provision, type LogEvent } from "@machinen/runtime";

await provision({
  base: "./rootfs-debian-arm64.tar.gz",
  install: async (vm) => {
    await vm.exec("apt-get update");
    await vm.exec("apt-get install -y tree");
  },
  out: "./warm.tar.gz",
  onLog: (evt: LogEvent) => {
    // evt.source: "guest-console" | "exec-stdout" | "exec-stderr"
    // evt.cmd:    the command string, when source is exec-*
    // evt.chunk:  raw bytes as they arrive
    process.stderr.write(evt.chunk);
  },
});
```

For a single exec with narrower output-only tees, `vm.exec` / `vm.execRaw`
still take `{ onStdout, onStderr }`. Both layers coexist: `onLog` on
`boot()` fires for every exec made through the handle; per-call
`onStdout` / `onStderr` fires on top when set.

### Binary resolution

When `binary` is omitted, `boot()` calls `resolveVmmBinary()`:

1. `MACHINEN_VMM` env var — absolute or cwd-relative path (dev override)
2. `require.resolve("@machinen/vmm-<arch>-<os>")` → `binary` export

Throws `BootError` with an install hint if neither is available.

### `vm.snapshot(outPath, options?): Promise<SnapshotResult>`

Freezes a running VM with CRIU and writes the image to `outPath`. The caller
brings the VM to a warm state via `vm.exec()`, then snapshots it:

```ts
const vm = await boot({ image, cmd, snapshot: "./scratch.img" });
await vm.exec("prep stuff");
const snap = await vm.snapshot("./warm.img");
```

The VM exits as part of the snapshot. Restore for a sub-second cold start with
`boot({ snapshot: snap.snapshotPath })`. Requires `snapshot` at boot (CRIU's
target) and a guest-side dump helper at `/sbin/machinen-dump` (override via
`opts.dumpCmd`).

### Networking (gvproxy)

`boot()` starts [gvproxy](https://github.com/containers/gvisor-tap-vsock) to
provide the guest with outbound networking. It's resolved in this order:

1. `$MACHINEN_GVPROXY` override.
2. Sibling of the VMM binary — our `@machinen/vmm-*` npm packages bundle it.
3. `~/.machinen/gvproxy/<version>/gvproxy` — auto-installed on first use.
4. `gvproxy` on `$PATH`.

If none of the above hit, `boot()` fetches the pinned release from
`containers/gvisor-tap-vsock` into the cache dir. You'll see a single stderr
line (`machinen: installing gvproxy v0.8.6 …`) the first time; subsequent
boots are silent. If the fetch fails (offline), networking stays disabled
and `boot()` continues.

### Host-side artifact cache

Every call to `boot()` or `provision()` also starts a small HTTP
server on the host that caches large downloads outside the guest —
today that's Node.js tarballs that `fnm` would otherwise pull from
`nodejs.org/dist/`. The cache lives on disk at `~/.machinen/cache/`
(overridable with `MACHINEN_CACHE_DIR`).

The guest is auto-pointed at the cache: the runtime injects
`FNM_NODE_DIST_MIRROR=http://192.168.127.254:<port>/node-dist` into
the guest env, so `fnm install 22` inside a fresh VM pulls through
the cache. First install populates it; subsequent installs are
served entirely from local disk and work with no upstream reachable.

Users who want to disable or redirect this can set their own
`FNM_NODE_DIST_MIRROR` in `boot({ env })` — the runtime only fills
the key when the caller hasn't. The cache itself is started by
`spawnArtifactCache()`, which is also exported if you want to drive
it directly for bespoke flows.

### Vsock helpers

Thin clients for the vsock services the guest `/init` + `exec-agent` expose:

- `VsockExec` — run a command inside a running guest
- `VsockFiles` — read/write files inside a running guest
- `VsockSecrets` — hand secrets to the guest at runtime
- `VsockWinsize` — forward terminal resize events

### Multiplexing

`Sandboxes` and `Supervisor` let a single host process manage multiple VMs with
per-sandbox stdio routing. See `src/multiplex.ts` for the surface.

## Debugging

Set `DEBUG=machinen:*` to stream internal diagnostics to stderr. Uses the
[`debug`](https://github.com/debug-js/debug) package, so it's zero-overhead
when unset and supports the usual comma-separated namespace patterns.

| Namespace              | Covers                                                          |
| ---------------------- | --------------------------------------------------------------- |
| `machinen:boot`        | `boot()` lifecycle — VMM spawn, vsock bridge, registry          |
| `machinen:provision`   | `provision()` steps — install hook, tar-to-disk, repack         |
| `machinen:exec`        | vsock exec — connect retries, frames, exit codes                |
| `machinen:snapshot`    | CRIU dump trigger, wait, console-log inspection                 |
| `machinen:attach`      | attach lookup, VM resolution                                    |
| `machinen:registry`    | `~/.machinen/vms/` reads, writes, stale-entry pruning           |
| `machinen:gvproxy`     | sidecar spawn, port-forward setup                               |
| `machinen:cache`       | artifact-cache hits, misses, upstream fetches                   |
| `machinen:mkinitramfs` | rootfs/bundle pack steps                                        |
| `machinen:cli`         | `@machinen/cli` argv parsing and command dispatch               |
| `machinen:vmm`         | tee VMM stderr to host stderr (replaces `MACHINEN_BUILD_DEBUG`) |

```sh
DEBUG=machinen:* machinen boot ./rootfs.tar.gz -- /bin/sh
DEBUG=machinen:exec,machinen:registry node script.js
DEBUG=machinen:cache* pnpm smoke-tests
```

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
