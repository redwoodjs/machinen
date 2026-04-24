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

Key options (all optional — but `image` and `cmd` are paired and required together):

| Option        | Description                                                   |
| ------------- | ------------------------------------------------------------- |
| `image`       | Path to a rootfs tarball to boot from                         |
| `cmd`         | Guest workload argv (required when `image` is set)            |
| `env`         | Env vars exposed to the guest workload                        |
| `snapshot`    | Host file attached as `/dev/vda` — typically a CRIU snapshot  |
| `mount`       | Single host-dir → guest-path mount (guest path under `/mnt/`) |
| `portForward` | Host → guest TCP port forwards via gvproxy                    |
| `binary`      | VMM binary path — auto-resolved if omitted                    |
| `vmmEnv`      | Env for the VMM process itself (host side, rarely needed)     |
| `timeoutMs`   | `wait()` deadline (default 60s, `null` to wait forever)       |

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

### Vsock helpers

Thin clients for the vsock services the guest `/init` + `exec-agent` expose:

- `VsockExec` — run a command inside a running guest
- `VsockFiles` — read/write files inside a running guest
- `VsockSecrets` — hand secrets to the guest at runtime
- `VsockWinsize` — forward terminal resize events

### Multiplexing

`Sandboxes` and `Supervisor` let a single host process manage multiple VMs with
per-sandbox stdio routing. See `src/multiplex.ts` for the surface.

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
