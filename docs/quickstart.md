# Quickstart

Your computer is already a cloud. In this quickstart, you will turn the
current project directory into a long-lived Linux VM that can run an agent
terminal in the background, keep its session alive, and let you reconnect
later.

Pick an agent recipe:

- `claude` — installs Claude Code.
- `pi` — installs the Pi coding agent.

## 1. Bake an agent image

Bake a reusable rootfs image. This boots a Debian base VM, installs Node 22,
common developer tools, and the selected agent CLI, then writes a tarball to
`~/.machinen/recipes/`.

```bash
npx machinen bake claude
# or:
npx machinen bake pi
```

Want a different location?

```bash
npx machinen bake claude --out ./claude-agent.tar.gz
```

If the output image already exists, `bake` reuses it. Pass `--force` to rebuild.

## 2. Boot it on your project

From the project you want the agent to work on:

```bash
npx machinen boot \
  --name agent \
  --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ~/.machinen/recipes/claude.tar.gz
```

For Pi, swap the image path:

```bash
npx machinen boot \
  --name agent \
  --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ~/.machinen/recipes/pi.tar.gz
```

What those flags mean:

- `--name agent` registers the VM so you can reach it later.
- `--detach` lets the boot command return while the VM keeps running.
- `--mount-live "$PWD:/mnt/workspace:rw"` gives the VM live read/write access
  to your current project at `/mnt/workspace`.

The baked image defaults to `sleep infinity`, so the VM stays up until you stop
it.

## 3. Attach, log in, and work

Open a reconnectable terminal in the VM:

```bash
npx machinen attach agent
```

The shell starts in `/mnt/workspace` when that mount exists.

For Claude Code:

```bash
claude
```

For Pi:

```bash
pi -p "inspect this repository and suggest a first task"
```

The first run may ask you to log in inside the VM. That is intentional: the VM
is the owned machine that runs the agent. Auth and shell state live in the
running VM; snapshot it if you want that warm state to survive stopping the VM.

If you already have Pi auth on the host and want to reuse it, mount it through a
valid `/mnt/...` guest path:

```bash
npx machinen boot \
  --name pi-agent \
  --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  --mount-live "$HOME/.pi/agent:/mnt/pi-agent:rw" \
  ~/.machinen/recipes/pi.tar.gz
```

The Pi recipe links `/mnt/pi-agent` to `/root/.pi/agent` when that mount is
present.

## Reconnect later

If your host terminal, SSH connection, or editor pane goes away, the VM and the
agent session keep running. Reconnect with the same command:

```bash
npx machinen attach agent
```

Use named sessions when you want more than one persistent terminal inside the
same VM:

```bash
npx machinen attach --session claude agent
npx machinen attach --session shell agent
npx machinen sessions agent
```

To stop the VM:

```bash
npx machinen stop agent
```

## Save or branch it

Once the VM is warm — tools installed, auth complete, caches loaded — you can
snapshot or fork it.

```bash
npx machinen snapshot agent ./agent.snap
npx machinen restore ./agent.snap --name agent-restored \
  --mount-live "$PWD:/mnt/workspace:rw"
```

Or branch a second copy locally:

```bash
npx machinen fork agent --new-name agent-b --detach \
  --mount-live "$PWD:/mnt/workspace:rw"
```

Snapshot/restore is whole-VM state. It works between matching guest
architectures, for example arm64 to arm64 or amd64 to amd64. Cross-ISA vmstate
restore is not supported.

## Where to go next

- [Agent VM recipes](./guides/agent-vms.md) shows how to customize the baked
  image.
- [Create a VM](./guides/create-a-vm.md) covers the lower-level boot patterns.
- [Snapshot, restore, and fork](./guides/snapshot-restore-fork.md) covers the
  cloning and handoff primitives.
- [Mount files into a VM](./guides/mount-files.md) explains `--mount-live` and
  read-only mounts.
- [Networking](./guides/networking.md) covers port forwards and outbound access.
