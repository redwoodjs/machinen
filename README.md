<p align="center">
  <img src="./docs/logo.svg" alt="machinen" />
</p>

<h1 align="center">M A C H I N E N</h1>

**Your computer is already a cloud. Machinen makes it feel like one.**

You already have machines: one on your lap, one on your desk, maybe one
humming in a closet. Machinen gives you small, named Linux VMs on the
hardware you control. They run in the background, keep terminal sessions
alive, and let you reconnect from another shell later.

No tiny rented slice. No hyperscaler-shaped workflow. Just cloud-shaped
computers that belong to you.

Under the hood, Machinen is a native microVM runtime: arm64 on Apple
Silicon/Linux and amd64 on Linux/KVM. Node.js is the first-class target;
Python, bash, and anything else that boots in a Linux VM works too. When
you need the weird stuff, you can snapshot, fork, and hand off a running
VM between hosts.

## The loop

Start a little Linux machine, detach from it, and come back later:

```bash
npx machinen boot --name work --detach -- sleep infinity
npx machinen attach work

# from another terminal, another SSH session, or after your client drops:
npx machinen attach work
```

`attach` opens a real PTY with job control, tab completion, full-screen
TUIs, and Ctrl-C going to the guest. By default it creates or reconnects
a persistent session named `default`; if your host terminal or SSH
connection disappears, the shell keeps running inside the VM.

```bash
npx machinen attach --session editor work   # another persistent terminal
npx machinen sessions work                  # list live sessions
npx machinen session-kill work editor       # reset one session
npx machinen stop work                      # shut down the VM
```

## Install

```bash
npm i @machinen/cli @machinen/runtime
```

Then run the CLI with `npx machinen …` (or the shorter `npx mn …` — both
names install). Prefer it on your PATH? `npm i -g @machinen/cli` is fine
too.

The right native package is pulled automatically via optional dependencies:
`@machinen/native-arm64-darwin` on Apple Silicon Macs,
`@machinen/native-arm64-linux` on arm64 Linux, and
`@machinen/native-x64-linux` on amd64 Linux. No system dependencies.

First run fetches the matching kernel + rootfs from a GitHub release on the
companion repo over plain HTTPS — no auth required.

## Quickstart: an agent VM on your own machine

Bake a Claude Code or Pi agent image, boot it on your current project, and
reattach whenever you want.

### 1. Bake

```bash
npx machinen bake claude
# or:
npx machinen bake pi
```

This writes `~/.machinen/recipes/claude.tar.gz` or
`~/.machinen/recipes/pi.tar.gz`: a small Debian image with Node 22, common
developer tools, and the agent CLI installed.

### 2. Boot

```bash
npx machinen boot \
  --name agent \
  --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ~/.machinen/recipes/claude.tar.gz
```

The VM is now running in the background on your machine. Your project is live
mounted at `/mnt/workspace`, so edits made by the agent are edits to your host
checkout.

### 3. Attach

```bash
npx machinen attach agent
claude
```

For Pi, use the Pi recipe and run `pi` inside the VM:

```bash
npx machinen boot --name agent --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ~/.machinen/recipes/pi.tar.gz
npx machinen attach agent
pi -p "inspect this repository and suggest a first task"
```

If your terminal or SSH connection drops, the VM and persistent PTY session keep
running. Reconnect with the same `npx machinen attach agent` command. Log in to
the agent inside the VM, then snapshot it if you want that warm auth state to
survive stopping the VM.

## Fork

`fork` is snapshot + restore without killing the source. The original keeps
running; you get a sibling VM with the same heap, same open files, and a
copy-on-write disk. Both processes diverge from the same instant.

For example, branch the agent VM from the quickstart:

```bash
npx machinen fork agent --new-name agent-b --detach \
  --mount-live "$PWD:/mnt/workspace:rw"

npx machinen attach agent
npx machinen attach agent-b
```

Both VMs branched from the same warm state and now run independently. Use it to
clone an agent with caches loaded, a test fixture in exactly the right state, a
service that has warmed up, or a long-running compute job branched into N
parallel explorations.

The fork doesn't inherit the source's `-p` host forwards — host ports are
global, only one process can bind each one. You can always reach a fork over
vsock:

```bash
npx machinen exec agent-b -- ps aux
```

For services, pass non-conflicting host forwards to the fork:

```bash
npx machinen fork worker --new-name worker-b -p 3001:3000 --detach
curl localhost:3001                                            # the fork
curl localhost:3000                                            # still the source
```

Pass `-p` multiple times for multiple ports. If you pick a host port the
source is already forwarding, `fork` errors with `BOOT_PORT_FORWARD_IN_USE`
and names the VM that's holding it.

From Node, same shape:

```ts
const fork = await vm.fork({ name: "sibling" });
```

## From Node

Same primitives, driven from TypeScript:

```ts
import { readFileSync } from "node:fs";
import { boot, provision, restore } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update && apt-get install -y nodejs");
    await vm.writeFile("/opt/counter.mjs", readFileSync("./counter.mjs"));
  },
  cmd: ["/usr/bin/node", "/opt/counter.mjs"],
  out: "./counter.tar.gz",
});

const vm = await boot({ image: "./counter.tar.gz", name: "counter", detached: true });
// ... let it run, serve traffic, accumulate state ...

await vm.snapshot({ outDir: "./counter.snap" });

// elsewhere (possibly on another host):
const restored = await restore({ snapDir: "./counter.snap" });
```

## Documentation

- [Quickstart](./docs/quickstart.md) — bake an agent VM and reconnect to it later
- [Create a VM](./docs/guides/create-a-vm.md) — boot, detach, attach,
  and manage named VMs
- [Hand off a running VM](./docs/guides/handoff.md) — snapshot → transfer → restore
- [Guides](./docs/) — recipes for agent VMs, snapshots and forks, mounts,
  and networking
- [`@machinen/cli` reference](./packages/cli/API.md) — command and flag reference
- [`@machinen/runtime` reference](./packages/runtime/API.md) — every
  exported function, type, and error class (typedoc-generated)

## Other ways to boot

```bash
npx machinen boot -- /bin/sh                    # ad-hoc: boot base + run a cmd
npx machinen boot ./my-image.tar.gz             # boot a provisioned rootfs tarball
npx machinen install                            # pre-fetch base assets (CI / airgap)
npx machinen install --version <tag>            # pin to a specific release tag
```

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for setup, build, and local-run
instructions. Release mechanics are in [`RELEASING.md`](RELEASING.md).

## License

[FSL-1.1-MIT](./LICENSE) — Functional Source License. Converts to MIT two
years after each release.
