# Machinen

**Your computer is already a cloud. Machinen makes it feel like one.**

You already have machines: one on your lap, one on your desk, maybe one humming in a closet. Machinen gives you small, named Linux VMs on the hardware you control. They run in the background, keep terminal sessions alive, and let you reconnect from another shell later.

No tiny rented slice. No hyperscaler-shaped workflow. Just cloud-shaped computers that belong to you.

## The loop

```bash
npx machinen bake claude
npx machinen boot --name agent --detach \
  --mount-live "$PWD:/mnt/workspace:rw" \
  ~/.machinen/recipes/claude.tar.gz
npx machinen attach agent

# from another terminal, another SSH session, or after your client drops:
npx machinen attach agent
```

`attach` opens a real PTY with job control, tab completion, full-screen TUIs, and Ctrl-C going to the guest. By default it creates or reconnects a persistent session named `default`; if your host terminal or SSH connection disappears, the shell keeps running inside the VM.

```bash
npx machinen attach --session editor agent
npx machinen sessions agent
npx machinen session-kill agent editor
npx machinen stop agent
```

## Install

```bash
npm i @machinen/cli @machinen/runtime
```

Then run `npx machinen ...` or `npx mn ...`.

## What it is

Machinen is a native microVM runtime: arm64 on Apple Silicon/Linux and amd64 on Linux/KVM. Node.js is the first-class target; Python, bash, agent CLIs, and anything else that boots in a Linux VM works too.

When you need the power tools, you can snapshot, fork, and hand off a running VM between hosts.

## Links

- Repository: https://github.com/redwoodjs/machinen
- README: https://github.com/redwoodjs/machinen/blob/main/README.md
- CLI reference: https://github.com/redwoodjs/machinen/blob/main/packages/cli/API.md
- Runtime reference: https://github.com/redwoodjs/machinen/blob/main/packages/runtime/API.md
