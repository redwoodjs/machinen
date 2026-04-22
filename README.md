# machinen

Transport a running Linux process between machines. Freeze it on your laptop,
thaw it on a server, resume it next week — heap, sockets, and open files
intact.

A native arm64 microVM runtime under the hood. Node.js is the first-class
target; Python, bash, and anything else that boots in a Linux VM works too.

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

## Transport a Node.js process

```bash
# host A
machinen run ./examples/node-counter &   # HTTP server on :3000, counts requests
curl localhost:3000/hit                   # { count: 1 }
curl localhost:3000/hit                   # { count: 2 }

machinen freeze <id> > counter.tar        # snapshot + rootfs delta

# copy counter.tar to host B, then:
machinen thaw counter.tar
curl localhost:3000/hit                   # { count: 3 }  ← same process
```

Same arch only (arm64 ↔ arm64). The VM's memory, file descriptors, and
timers come back exactly as they were.

## Boot a microVM

```bash
machinen run ./path/to/bundle     # spawn a microVM from a bundle directory
```

On first run, the kernel + rootfs for the current release are fetched into
`~/.machinen/` automatically. To pre-fetch them ahead of time (CI cache warming,
airgapped prep):

```bash
machinen install                  # optional: pre-fetch base assets
machinen install --version <tag>  # pin to a specific release tag
```

A bundle is a directory containing `rootfs/` (overlay on top of the base Debian
rootfs) and `machinen-config.json` (boot config). See
[`.docs/learnings/microvm/rootfs-contract.md`](.docs/learnings/microvm/rootfs-contract.md)
for the contract.

## Drive it from Node

```ts
import { spawn, snapshot, restore } from "@machinen/runtime";

// binary auto-resolves via @machinen/vmm-<arch>-<os> installed alongside.
const vm = await spawn({ bundle: "./examples/node-counter" });
// ... let it run, serve traffic, accumulate state ...

const artifact = await snapshot(vm); // Buffer or writable stream
await fs.writeFile("counter.tar", artifact);

// elsewhere:
const restored = await restore("counter.tar");
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

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, build, and local-run
instructions. Release mechanics are in [`RELEASING.md`](RELEASING.md).
Design notes and learnings live in
[`.docs/learnings/microvm/`](.docs/learnings/microvm/).

## License

[FSL-1.1-MIT](./LICENSE) — Functional Source License. Converts to MIT two
years after each release.
