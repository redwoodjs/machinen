# machinen

Native arm64 microVM runtime for AI agents. Spawn a Linux VM from a bundle
directory in under a second, drive it from Node, throw it away when you're done.

## Install

```bash
npm i -g @machinen/cli
```

The right VMM binary is pulled automatically via optional dependencies
(`@machinen/vmm-arm64-darwin` on Apple Silicon Macs, `@machinen/vmm-arm64-linux`
on arm64 Linux).

One system dep is not yet statically linked:

- macOS: `brew install libslirp`
- Debian/Ubuntu: `apt install libslirp0`
- Fedora/RHEL: `dnf install libslirp`
- Alpine: `apk add libslirp`

## Run a bundle

```bash
machinen install                # pre-fetch kernel + rootfs for the current release
machinen run path/to/bundle     # boot a microVM from a bundle directory
```

A bundle is a directory containing `rootfs/` (overlay on top of the base Debian
rootfs) and `machinen-config.json` (boot config). See
[`.docs/learnings/microvm/rootfs-contract.md`](.docs/learnings/microvm/rootfs-contract.md)
for the contract.

## Drive it from Node

```ts
import { spawn } from "@machinen/runtime";

const vm = await spawn({ binary: process.env.MACHINEN_VMM!, bundle: "./my-bundle" });
vm.stdout.pipe(process.stdout);
vm.stdin.write("echo hello from inside\n");
await vm.wait();
```

See [`packages/runtime/README.md`](packages/runtime/README.md) for the full surface.

## Monorepo layout

| Package                                                   | Published? | What it is                          |
| --------------------------------------------------------- | ---------- | ----------------------------------- |
| [`@machinen/cli`](packages/cli)                           | ✓          | The `machinen` CLI                  |
| [`@machinen/runtime`](packages/runtime)                   | ✓          | TypeScript API for driving microVMs |
| [`@machinen/vmm-arm64-darwin`](packages/vmm-arm64-darwin) | ✓          | Native VMM binary for Apple Silicon |
| [`@machinen/vmm-arm64-linux`](packages/vmm-arm64-linux)   | ✓          | Native VMM binary for arm64 Linux   |
| [`@machinen/microvm`](packages/microvm)                   | ✓          | Zig VMM source                      |

## Development

```bash
pnpm install
pnpm -r build       # TypeScript + Zig
pnpm test           # vitest
npx agent-ci run --all -q -p   # local CI
```

Contributor notes live in [`.docs/learnings/microvm/`](.docs/learnings/microvm/)
and [`RELEASING.md`](RELEASING.md).

## License

MIT
