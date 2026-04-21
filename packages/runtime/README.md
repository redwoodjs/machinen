# @machinen/runtime

TypeScript API for spawning and driving microVMs built by the
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
import { spawn } from "@machinen/runtime";

// binary is resolved automatically: MACHINEN_VMM env override, else
// require.resolve("@machinen/vmm-<arch>-<os>"). Install one of the
// vmm packages alongside this one.
const vm = await spawn({
  bundle: "./path/to/bundle", // dir with rootfs/ + machinen-config.json
});

vm.stdout.pipe(process.stdout);
vm.stdin.write("echo hello from inside\n");

const { code } = await vm.wait();
process.exit(code ?? 0);
```

## Surface

### `spawn(options): Promise<VmHandle>`

Boots the VMM as a child process and returns a handle with `stdin`/`stdout`/
`stderr` streams, `wait()`, `kill()`, and `output()`/`errorOutput()` buffers.

Key options (all optional):

| Option      | Description                                                       |
| ----------- | ----------------------------------------------------------------- |
| `binary`    | VMM binary path — auto-resolved if omitted (see resolution rules) |
| `bundle`    | Bundle directory to pack into an initramfs                        |
| `disk`      | Host file to attach as `/dev/vda` in the guest                    |
| `env`       | Extra env passed to the VMM process                               |
| `timeoutMs` | `wait()` deadline (default 60s, `null` to wait forever)           |

### Binary resolution

When `binary` is omitted, `spawn()` calls `resolveVmmBinary()`:

1. `MACHINEN_VMM` env var — absolute or cwd-relative path (dev override)
2. `require.resolve("@machinen/vmm-<arch>-<os>")` → `binary` export

Throws `SpawnError` with an install hint if neither is available.

### `buildSnapshot(options): Promise<SnapshotResult>`

Builds an ext4 disk image by booting the VMM in warmup mode. The guest writes
CRIU images into the disk during warmup; later `spawn({ disk })` calls restore
from that image for sub-second cold starts.

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
