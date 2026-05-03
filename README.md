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
on arm64 Linux). No system dependencies.

First run fetches the kernel + rootfs from a private GitHub release, so you'll
need [GitHub CLI](https://cli.github.com/) authenticated:

```bash
gh auth login
```

## Transport a Node.js process

```bash
# host A — boot an image with node + your server baked in (see provision below)
machinen boot --name counter -p 3000:3000 ./counter.tar.gz &  # HTTP on :3000
curl localhost:3000/hit                              # { count: 1 }
curl localhost:3000/hit                              # { count: 2 }

machinen snapshot --name counter --out-dir ./counter.snap   # CRIU-freeze the VM

# copy ./counter.snap (a directory: disk.img + meta.json) to host B, then:
machinen restore ./counter.snap
curl localhost:3000/hit                              # { count: 3 }  ← same process
```

Same arch only (arm64 ↔ arm64). The VM's memory, file descriptors, and
timers come back exactly as they were.

## Boot a microVM

```bash
machinen boot -- /bin/sh                    # ad-hoc: boot base + run a cmd
machinen boot ./my-image.tar.gz             # boot a provisioned rootfs tarball
```

On first run, the kernel + rootfs for the current release are fetched into
`~/.machinen/` automatically. To pre-fetch them ahead of time (CI cache warming,
airgapped prep):

```bash
machinen install                  # optional: pre-fetch base assets
machinen install --version <tag>  # pin to a specific release tag
```

## Drive it from Node

```ts
import { boot, provision, restore } from "@machinen/runtime";

// Bake an image once: base Debian + your deps + a default cmd.
await provision({
  base: "./rootfs-debian-arm64.tar.gz",
  install: async (vm) => {
    await vm.exec("apt-get install -y nodejs");
  },
  cmd: ["/usr/bin/node", "/opt/server.js"],
  out: "./my-server.tar.gz",
});

// Boot it. The image's baked-in cmd runs by default.
const vm = await boot({ image: "./my-server.tar.gz", name: "counter" });
// ... let it run, serve traffic, accumulate state ...

await vm.snapshot({ outDir: "./counter.snap" }); // CRIU-freeze to disk

// elsewhere (possibly on another host):
const restored = await restore({ snapDir: "./counter.snap" });
```

See [`packages/runtime/README.md`](packages/runtime/README.md) for the full surface.

## Fast installs inside the guest

A host-side HTTP cache fronts `nodejs.org/dist/`, so `fnm install` inside a
fresh VM pulls through it instead of the internet. First install populates
`~/.machinen/cache/`; subsequent installs are served entirely from disk, so a
warm laptop boots Node-capable VMs with no upstream reachable. Transparent —
the runtime starts the cache and points the guest's `FNM_NODE_DIST_MIRROR` at
it automatically.

## Monorepo layout

| Package                                                               | Published? | What it is                          |
| --------------------------------------------------------------------- | ---------- | ----------------------------------- |
| [`@machinen/cli`](packages/cli)                                       | ✓          | The `machinen` CLI                  |
| [`@machinen/runtime`](packages/runtime)                               | ✓          | TypeScript API for driving microVMs |
| [`@machinen/vmm-arm64-darwin`](packages/vmm-arm64-darwin)             | ✓          | Native VMM binary for Apple Silicon |
| [`@machinen/vmm-arm64-linux`](packages/vmm-arm64-linux)               | ✓          | Native VMM binary for arm64 Linux   |
| [`@machinen/e2fsprogs-arm64-darwin`](packages/e2fsprogs-arm64-darwin) | ✓          | Bundled `mke2fs` for Apple Silicon  |
| [`@machinen/e2fsprogs-arm64-linux`](packages/e2fsprogs-arm64-linux)   | ✓          | Bundled `mke2fs` for arm64 Linux    |
| [`@machinen/microvm`](packages/microvm)                               | ✓          | Zig VMM source                      |

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, build, and local-run
instructions. Release mechanics are in [`RELEASING.md`](RELEASING.md).
Design notes and learnings live in
[`.docs/learnings/microvm/`](.docs/learnings/microvm/).

## License

[FSL-1.1-MIT](./LICENSE) — Functional Source License. Converts to MIT two
years after each release.
