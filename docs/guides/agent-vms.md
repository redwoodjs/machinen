# Agent VM recipes

An agent VM is a small Linux machine you own: boot it on your laptop or
workstation, mount a project at `/mnt/workspace`, run an agent inside it, and
reattach later. The terminal session lives in the VM, not in your host shell.

Machinen ships two starter recipes:

```bash
npx machinen bake claude   # Claude Code image
npx machinen bake pi       # Pi coding agent image
```

Both recipes install:

- Debian base userland
- Node.js 22 via `fnm`
- common shell/dev tools (`git`, `curl`, `jq`, `ripgrep`, `vim-tiny`, etc.)
- the selected agent CLI
- a default command of `sleep infinity`, so the VM stays alive until stopped

The default output is `~/.machinen/recipes/<recipe>.tar.gz`.

## Claude Code VM

```bash
npx machinen bake claude

npx machinen boot \
  --name claude-agent \
  --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ~/.machinen/recipes/claude.tar.gz

npx machinen attach claude-agent
claude
```

Log in to Claude Code inside the VM on first run. Auth and shell state live in
the running VM; snapshot it if you want that warm state to survive stopping the
VM. The image also includes a convenience function named `claude-yolo` that
expands to:

```bash
claude --dangerously-skip-permissions
```

Use that only when you trust the VM and the mounted workspace. The default
`claude` command keeps Claude Code's normal permission behavior.

## Pi VM

```bash
npx machinen bake pi

npx machinen boot \
  --name pi-agent \
  --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ~/.machinen/recipes/pi.tar.gz

npx machinen attach pi-agent
pi -p "summarize this repository"
```

To reuse an existing host Pi login, mount the host auth directory at
`/mnt/pi-agent`:

```bash
npx machinen boot \
  --name pi-agent \
  --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  --mount-live "$HOME/.pi/agent:/mnt/pi-agent:rw" \
  ~/.machinen/recipes/pi.tar.gz
```

The Pi recipe links `/mnt/pi-agent` to `/root/.pi/agent` when present.
Machinen mount guest paths intentionally live under `/mnt/...`, so the recipe
performs the `/root/.pi/agent` link inside the VM. If you log in inside the VM
instead, snapshot the VM to keep that warm auth state after stop.

## Long-lived sessions

Attach creates a persistent PTY session by default:

```bash
npx machinen attach claude-agent
```

If the client connection drops, the session stays in the VM and a later attach
reconnects to it. Use named sessions for separate terminals:

```bash
npx machinen attach --session agent claude-agent
npx machinen attach --session shell claude-agent
npx machinen sessions claude-agent
npx machinen session-kill claude-agent agent
```

## Custom recipe with `provision()`

`machinen bake` is just a packaged recipe. For your own agent image, use the
runtime API directly:

```ts
// bake-custom-agent.ts
import { provision } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec("export DEBIAN_FRONTEND=noninteractive; apt-get update");
    await vm.exec(
      "export DEBIAN_FRONTEND=noninteractive; " +
        "apt-get install -y --no-install-recommends ca-certificates curl git jq ripgrep",
    );

    await vm.exec(
      "curl -fsSL https://fnm.vercel.app/install | " +
        "bash -s -- --install-dir /opt/fnm --skip-shell",
    );
    await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm install 22");
    await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm default 22");
    await vm.exec("ln -sf /opt/fnm/aliases/default/bin/* /usr/local/bin/");

    await vm.exec("npm install -g @anthropic-ai/claude-code");
    await vm.writeFile(
      "/etc/profile.d/workspace.sh",
      "[ -d /mnt/workspace ] && cd /mnt/workspace\n",
      { mode: 0o644 },
    );
    await vm.exec(
      "touch /root/.bashrc && " +
        "printf '\n[ -f /etc/profile.d/workspace.sh ] && . /etc/profile.d/workspace.sh\n' >> /root/.bashrc",
    );
  },
  cmd: ["/bin/sleep", "infinity"],
  out: "./custom-agent.tar.gz",
});
```

Boot it the same way:

```bash
node bake-custom-agent.ts
npx machinen boot --name custom-agent --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ./custom-agent.tar.gz
npx machinen attach custom-agent
```

## Snapshot a warm agent VM

A baked image is a clean starting point. A snapshot is a warm running machine:
logged in, caches hot, terminals still alive.

```bash
npx machinen snapshot claude-agent ./claude-agent.snap
npx machinen restore ./claude-agent.snap --name claude-agent-restored \
  --mount-live "$PWD:/mnt/workspace:rw"
```

Use snapshots when you want to preserve VM state. Use `machinen bake --force`
when you want a fresh image with updated packages.
