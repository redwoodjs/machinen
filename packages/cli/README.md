# @machinen/cli

The shell interface to machinen. Use this when you want to boot,
snapshot, restore, fork, and otherwise drive microVMs from a terminal
or a script — without writing any TypeScript.

## What you can do with it

- **Boot a Linux workload in a microVM.** Run a one-shot command, or
  start a long-running service and detach so your shell can exit.
- **Hand a running process off to another machine.** Snapshot it on
  host A, copy the bundle, restore on host B. The process resumes
  from the saved VM state — same heap and counters in memory, with
  host port forwards declared again on the target.
- **Clone a warmed-up VM into a sibling.** `fork` snapshots and
  restores in one step; both copies run independently from a shared
  heap. Useful for branching test fixtures, parallel exploration, or
  duplicating a process with caches loaded.
- **Reach into a running VM.** `attach` for an interactive shell with
  job control; `attach --session <name>` when that shell or TUI should
  survive host disconnects; `exec` for one-off commands; `repl` for
  piping a script of one-liners.
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
command reference, see [API.md](./API.md).

## Install

```bash
npm i @machinen/cli           # then run via `npx machinen …` or `npx mn …`
npm i -g @machinen/cli        # or globally if you prefer it on PATH
```

Both `machinen` and the shorter alias `mn` are installed.

The matching native package (`@machinen/native-arm64-darwin`,
`@machinen/native-arm64-linux`, or `@machinen/native-x64-linux`) is pulled in
via optional dependencies. It ships the VMM plus sibling host tools such as
`gvproxy`, `mke2fs`, and `mksquashfs`, so no system packages are required.

First boot fetches the matching kernel + base rootfs from the public
companion GitHub release over HTTPS; no GitHub authentication is needed.

## At a glance

```bash
npx machinen boot ./image.tar.gz                 # boot a provisioned image
npx machinen boot --name worker --detach ./image.tar.gz
                                                  # ... and reach it from another shell:
npx machinen ls
npx machinen exec worker -- ps aux
npx machinen attach worker
npx machinen attach --session pi worker       # reconnectable shell/TUI, no tmux needed
npx machinen sessions worker
npx machinen snapshot worker ./warm
npx machinen restore ./warm
npx machinen fork worker --new-name worker-b --detach
npx machinen stop worker
```

After the subcommand, the first positional is the target VM. Pass a
name for a registered VM, or a host pid (digits-only) to identify it
by process.

## Reference

The command reference — main flags, cache layout, and env vars — is in
[API.md](./API.md).

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
