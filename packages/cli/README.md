# @machinen/cli

The shell interface to machinen. Use this when you want to boot,
snapshot, restore, fork, and otherwise drive microVMs from a terminal
or a script — without writing any TypeScript.

## What you can do with it

- **Boot a Linux workload in a microVM.** Run a one-shot command, or
  start a long-running service and detach so your shell can exit.
- **Hand a running process off to another machine.** Snapshot it on
  host A, copy the bundle, restore on host B. The process resumes
  exactly where it left off — same heap, same connections, same
  counters in memory.
- **Clone a warmed-up VM into a sibling.** `fork` snapshots and
  restores in one step; both copies run independently from a shared
  heap. Useful for branching test fixtures, parallel exploration, or
  duplicating a process with caches loaded.
- **Reach into a running VM.** `attach` for an interactive shell with
  job control; `exec` for one-off commands; `repl` for piping a script
  of one-liners.
- **Manage VM lifecycles.** `list` (alias `ls`) to see what's
  running, `stop` to shut one down cleanly, `gc` to clean up after
  detached boots that crashed.
- **Drive it from an agent.** `--json` on every data-returning
  command (`list`, `gc`, `install`, `snapshot`, `stop`,
  `boot --detach`, `fork --detach`, `feedback`). `mn agent-context`
  emits a versioned JSON description of the whole CLI surface for
  introspection. `mn feedback "<text>"` records friction notes
  locally (and POSTs upstream when `MACHINEN_FEEDBACK_ENDPOINT` is
  set).

For end-to-end recipes (provisioning images, mounts, networking,
snapshot patterns), see the [guides](../../docs/). For the full
command-by-command reference, see [API.md](./API.md).

## Install

```bash
npm i @machinen/cli           # then run via `npx machinen …` or `npx mn …`
npm i -g @machinen/cli        # or globally if you prefer it on PATH
```

Both `machinen` and the shorter alias `mn` are installed.

The matching VMM binary (`@machinen/vmm-arm64-darwin` or
`@machinen/vmm-arm64-linux`) is pulled in via optional dependencies.
Each VMM package also ships a sibling `gvproxy` binary that the
runtime auto-spawns to provide guest networking — no system packages
required.

First boot fetches the kernel + base rootfs from a private GitHub
release, so make sure you've authenticated [GitHub
CLI](https://cli.github.com/):

```bash
gh auth login
```

## At a glance

```bash
npx machinen boot ./image.tar.gz                 # boot a provisioned image
npx machinen boot --name worker --detached ./image.tar.gz
                                                  # ... and reach it from another shell:
npx machinen ls
npx machinen exec --name worker -- ps aux
npx machinen attach --name worker
npx machinen snapshot --name worker --out-dir ./warm
npx machinen restore ./warm
npx machinen fork --name worker --new-name worker-b --detach
npx machinen stop --name worker
```

The `<name>` arg in any of those can be swapped for `--pid <pid>` if
you'd rather identify the VM by host pid.

## Reference

The full command surface — every flag, every error mode, the cache
layout, the env vars — is in [API.md](./API.md).

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
