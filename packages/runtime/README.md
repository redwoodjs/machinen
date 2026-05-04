# @machinen/runtime

TypeScript API for booting and driving microVMs built by the
[machinen](https://github.com/redwoodjs/machinen) VMM.

## Install

```bash
npm i @machinen/runtime
```

You'll also need the VMM binary. Either install `@machinen/cli` (which bundles
the right `@machinen/vmm-arm64-*` for your host as an optional dep), or pick
the platform-matched VMM package directly:

```bash
npm i @machinen/vmm-arm64-darwin    # or @machinen/vmm-arm64-linux
```

## Basic usage

```ts
import { boot } from "@machinen/runtime";

const vm = await boot({
  image: "./rootfs-debian-arm64.tar.gz",
  cmd: ["/bin/sh"],
});

await vm.exec("echo hello from inside");

const { code } = await vm.wait();
process.exit(code ?? 0);
```

## The three lifecycle functions

### `provision(options): Promise<ProvisionResult>`

Bake a rootfs tarball: boot a base, run `install` steps inside, archive the
result. Output is a tarball you can pass to `boot({ image })` later.

```ts
import { provision } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update && apt-get install -y nodejs");
    await vm.writeFile("/opt/server.js", readFileSync("./server.js"));
  },
  cmd: ["/usr/bin/node", "/opt/server.js"],
  out: "./my-server.tar.gz",
});
```

| Option                  | Description                                                              |
| ----------------------- | ------------------------------------------------------------------------ |
| `install`               | Async hook run inside the guest — your apt/curl/copy steps               |
| `out`                   | Output tarball path (overwritten)                                        |
| `base`                  | Base rootfs (defaults to the cached release rootfs via `resolveBaseRootfs()`) |
| `cmd`                   | Default cmd baked into `/machinen-config.json`                           |
| `env`                   | Default guest env baked alongside `cmd`                                  |
| `cwd`                   | Working directory for the build (defaults to `process.cwd()`)            |
| `scratchDiskSizeBytes`  | Sparse scratch disk used to ferry the tarball out (default 1 GiB)        |
| `timeoutMs`             | Wall-clock ceiling for the whole build (default 10 min)                  |
| `binary` / `kernel` / `dtb` | Same as `boot()`                                                     |
| `vmmEnv`                | Host-side env for the VMM process                                        |
| `onLog`                 | Streaming log callback (see [Streaming logs](#streaming-logs))           |

### `boot(options): Promise<VmHandle>`

Boots the VMM as a child process and returns a [`VmHandle`](#vmhandle).

| Option              | Description                                                                       |
| ------------------- | --------------------------------------------------------------------------------- |
| `image`             | Rootfs tarball to boot from. Paired with `cmd` (both or neither).                 |
| `cmd`               | Guest workload argv. Falls back to the image's baked-in default.                  |
| `env`               | Env vars exposed to the guest workload.                                           |
| `guestCwd`          | Absolute path to `chdir()` to before running `cmd`.                               |
| `name`              | Register VM under this name; lookup key for `attach({ name })`. Path-shaped OK.   |
| `mount`             | `{ host, guest }` — single host dir copied into the guest under `/mnt/…`.          |
| `liveMounts`        | Array of `{ host, guest, mode? }` — FUSE live-share, no boot-time copy.           |
| `portForward`       | Array of `{ hostPort, guestPort, hostAddr? }` — host→guest TCP forwards.          |
| `snapshot`          | `string` (file → `/dev/vda`, used to restore) / `false` (no scratch) / unset (auto). |
| `rootDisk`          | `true` (default) materialize ext4 from `image` / `string` (pre-built img) / `false`. |
| `rootDiskSizeBytes` | Target rootdisk size (default `max(2 GiB, treeBytes × 2.5)`).                     |
| `detached`          | Detach the VMM so this process can exit. Mutually exclusive with `mount`/`liveMounts`/`portForward`. |
| `forkedFrom`        | Lineage tag — set by `restore()`; visible in `machinen ls`.                       |
| `kernel` / `dtb`    | Override paths for the kernel Image and device tree.                              |
| `binary`            | VMM binary path; auto-resolved if omitted (see [Binary resolution](#binary-resolution)). |
| `args`              | Extra argv for the VMM process.                                                   |
| `cwd`               | Working directory for the VMM (fixture lookup).                                   |
| `pdeathsig`         | Default `true` — VMM dies when this process exits. `fork()` flips it false.       |
| `timeoutMs`         | `wait()` deadline (default 60 s, `null` to wait forever).                         |
| `vmmEnv`            | Host-side env for the VMM (dev/test flags only).                                  |
| `onLog`             | Streaming log callback (kernel console + every exec).                             |

Images produced by `provision({ cmd, env })` carry baked defaults in
`/machinen-config.json`, so callers can `boot({ image })` with no further args.
User-supplied `cmd`/`env` on `boot()` override the image defaults.

### `restore(options): Promise<VmHandle>`

Restore a VM from a snapshot bundle produced by `vm.snapshot({ outDir })`.

```ts
const vm = await restore({ snapDir: "./counter.snap" });
```

| Option        | Description                                                                  |
| ------------- | ---------------------------------------------------------------------------- |
| `snapDir`     | Bundle directory holding `disk.img` + `meta.json`.                           |
| `image`       | Base rootfs path. Required so the initramfs can carry `/sbin/machinen-restore` + `criu`. |
| `name`        | Explicit name. Default auto-names as `<sourceName>/<pid>`.                    |
| (everything else from `BootOptions`) | Forwarded to the underlying `boot()` (kernel/dtb/onLog/timeoutMs/…). |

### `attach(options): Promise<VmHandle>`

Reconnect to a VM registered by an earlier `boot({ name })` — possibly from a
different process. Returns a handle that can `exec()`, `snapshot()`, `kill()`,
`fork()` via the registry-recorded vsock bridge.

```ts
const vm = await attach({ name: "counter" });
await vm.exec("ls /opt");
```

| Option   | Description                                              |
| -------- | -------------------------------------------------------- |
| `name`   | Lookup by `boot({ name })` value. Mutually exclusive with `pid`. |
| `pid`    | Lookup by VMM pid. Kernel-unique while alive.            |
| `onLog`  | Streaming log callback (only `exec-*` sources fire on attach). |

Throws `RegistryError(REGISTRY_VM_NOT_FOUND)` if no live entry matches. Attached
handles have inert `stdin`/`stdout`/`stderr` (those belong to the original
booter); `output()`/`errorOutput()` resolve to the empty string.

## `VmHandle`

Returned by `boot`, `restore`, `attach`, and `vm.fork`.

| Member              | Description                                                              |
| ------------------- | ------------------------------------------------------------------------ |
| `pid`               | Host VMM pid.                                                            |
| `name?`             | Registered name, if any.                                                 |
| `stdin`/`stdout`/`stderr` | VMM child streams (inert on attach handles).                       |
| `wait()`            | Resolves when the VM exits (or rejects on `timeoutMs`).                  |
| `kill()`            | SIGKILL the VMM; resolves once gone.                                     |
| `detach()`          | Drop the host handle without killing the VM.                             |
| `output()` / `errorOutput()` | UTF-8 stdout/stderr buffers (last ~1 MiB).                      |
| `exec(cmd, opts?)`  | Vsock exec; **throws** on non-zero exit.                                 |
| `execRaw(cmd, opts?)` | Vsock exec; returns the exit code instead of throwing.                 |
| `execPty(cmd, opts)` | PTY-mode exec; bidirectional bytes, `.resize(cols, rows)` for SIGWINCH. |
| `writeFile(path, contents, opts?)` | Write a file inside the guest (binary-safe via base64).   |
| `snapshot(opts)`    | CRIU-freeze to a bundle directory (see below).                           |
| `fork(opts?)`       | Snapshot live + restore into a sibling. Source keeps running.            |

### `vm.snapshot(opts): Promise<SnapshotResult>`

```ts
await vm.snapshot({ outDir: "./warm" });
```

The bundle is a directory:

```
warm/
  disk.img        # CRIU images on an ext4 volume
  meta.json       # source name + timestamp
```

| Option         | Description                                                                |
| -------------- | -------------------------------------------------------------------------- |
| `outDir`       | Bundle directory (must be empty/absent).                                   |
| `dumpCmd`      | Guest command to trigger the dump. Default `/sbin/machinen-dump`.          |
| `leaveRunning` | Pass `--leave-running` to CRIU — source survives the dump (used by `fork`). |
| `tcpClose`     | Omit `--tcp-established` — restored sockets come back CLOSED.              |
| `timeoutMs`    | Wall-clock ceiling for dump + shutdown (default 90 s).                     |
| `onLog`        | Streaming log callback for the dump phase.                                 |

Requires `boot({ snapshot: '<scratch>' })` (or the auto-allocated default) so
there's a `/dev/vdb` for CRIU to write into. Throws `SnapshotError` —
`SNAPSHOT_NO_DISK`, `SNAPSHOT_TIMEOUT`, `SNAPSHOT_DUMP_FAILED`.

### `vm.fork(opts?): Promise<VmHandle>`

Snapshot the source live (`leaveRunning: true`) and restore into a sibling.
Both copies keep running with diverging futures.

```ts
const fork = await vm.fork({ name: "counter-b" });
```

| Option        | Description                                                                |
| ------------- | -------------------------------------------------------------------------- |
| `name`        | Fork name. Default `<sourceName>/<fork.pid>`.                              |
| `outDir`      | Persist the bundle here. If omitted, it's tempdir'd and removed on fork exit. |
| `tcpKeep`     | Default `false` — fork sees ECONNRESET on inherited sockets. `true` clones live TCP state (rarely correct). |
| `portForward` | Forwards for the fork. **Not** inherited from the source.                  |
| `image` / `kernel` / `dtb` | Overrides for the fork's restore boot.                        |
| `timeoutMs`   | Dump-phase ceiling (default 90 s).                                         |
| `onLog`       | Streaming log callback for the snapshot half.                              |

## Streaming logs

Every long-running API — `boot`, `provision`, `vm.snapshot`, `vm.fork`,
`attach` — accepts `onLog`. Each event is tagged so callers can tell kernel
console bytes from exec bytes:

```ts
import { provision, type LogEvent } from "@machinen/runtime";

await provision({
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

For per-exec output-only tees, `vm.exec` / `vm.execRaw` still take
`{ onStdout, onStderr }`. Both layers coexist: `boot({ onLog })` fires for
every exec made through the handle; per-call `onStdout` / `onStderr` fires on
top when set.

## Errors

All thrown errors are subclasses of `MachinenError` with a stable `code`:

```ts
import { isMachinenError, formatMachinenError, BootError } from "@machinen/runtime";

try {
  await boot({ image: "./missing.tar.gz", cmd: ["/bin/sh"] });
} catch (err) {
  if (isMachinenError(err)) {
    console.error(formatMachinenError(err)); // "(BOOT_IMAGE_NOT_FOUND): …"
    if (err instanceof BootError && err.code === "BOOT_IMAGE_NOT_FOUND") {
      // recover
    }
  }
}
```

Exported error classes: `BootError`, `ExecError`, `SnapshotError`,
`ProvisionError`, `RegistryError`, `FilesError`, `MountError`, `SecretsError`,
`WinsizeError`, `SandboxError`, `CacheError`, `GvproxyError`,
`MkinitramfsError`, `ParseError`. Helpers: `isMachinenError`,
`formatMachinenError`. Code union: `ErrorCode`.

## Registry & lifecycle

The registry at `~/.machinen/vms/<id>/meta.json` records every live VM so
`attach` can find it cross-process.

| Symbol          | Description                                                                   |
| --------------- | ----------------------------------------------------------------------------- |
| `list()`        | Snapshot of live registry entries (`RegistryEntry[]`).                        |
| `registryRoot`  | Path to the registry root (overridden by `MACHINEN_REGISTRY_DIR`).            |
| `validatePid(pid, opts)` | `"alive" | "dead" | "recycled"` — basename-checks vmmExe to refuse recycled pids. |
| `runGc(opts?)`  | Drop entries whose VMM is gone; clean their per-boot artifacts.               |

Detached-boot helpers (for `boot({ detached: true })` console capture):

```ts
import { bootSnapshotPath, detachedLogRoot, writeBootSnapshot } from "@machinen/runtime";
```

## PTY boot

For workloads that need a real PTY from the start (interactive shells,
pseudo-terminal-aware programs that read from `/dev/tty` at boot):

```ts
import { bootPty } from "@machinen/runtime";

const vm = await bootPty({ image, cmd, cols: 120, rows: 30 });
```

Returns a `PtyVmHandle` — same surface as `VmHandle` plus `.resize(cols, rows)`.

## Vsock helpers

Thin clients for the vsock services the guest `/init` + `exec-agent` expose.
Most users won't reach for these — `vm.exec`/`vm.writeFile` cover the common
cases — but they're exported for advanced workflows:

- `VsockExec` — run a command inside a running guest
- `VsockFiles` — push/pull files inside a running guest
- `VsockSecrets` — hand secrets to the guest at runtime
- `VsockWinsize` — forward terminal resize events

## Multiplexing

`Sandboxes` and `Supervisor` let a single host process manage multiple VMs
with per-sandbox stdio routing. See `src/multiplex.ts`.

## Networking (gvproxy)

`boot()` starts [gvproxy](https://github.com/containers/gvisor-tap-vsock) to
provide the guest with outbound networking. Resolution order:

1. `$MACHINEN_GVPROXY` override.
2. Sibling of the VMM binary — `@machinen/vmm-*` packages bundle it.
3. `~/.machinen/gvproxy/<version>/gvproxy` — auto-installed on first use.
4. `gvproxy` on `$PATH`.

If none hit, `boot()` fetches the pinned release from
`containers/gvisor-tap-vsock` into the cache. You'll see a single stderr line
(`machinen: installing gvproxy v0.8.6 …`) the first time; subsequent boots are
silent. If the fetch fails (offline), networking stays disabled and `boot()`
continues.

## Binary resolution

When `binary` is omitted, `boot()` calls `resolveVmmBinary()`:

1. `MACHINEN_VMM` env var — absolute or cwd-relative path (dev override).
2. `require.resolve("@machinen/vmm-<arch>-<os>")` → `binary` export.

Throws `BootError` with an install hint if neither is available.

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
| `machinen:mkinitramfs` | rootfs/bundle pack steps                                        |
| `machinen:cli`         | `@machinen/cli` argv parsing and command dispatch               |
| `machinen:vmm`         | tee VMM stderr to host stderr (replaces `MACHINEN_BUILD_DEBUG`) |

```sh
DEBUG=machinen:* npx machinen boot ./rootfs.tar.gz -- /bin/sh
DEBUG=machinen:exec,machinen:registry node script.js
DEBUG=machinen:gvproxy* pnpm smoke-tests
```

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
