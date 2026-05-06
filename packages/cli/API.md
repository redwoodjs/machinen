# `machinen` — command reference

The full surface of the CLI. For a tour of what you'd actually do with
it, the [README](./README.md) has the use-case framing; for end-to-end
recipes, see the [guides](../../docs/).

## Synopsis

```
machinen boot     [<image>] [opts] -- <cmd>     Boot a microVM
machinen restore  <snap-dir> [--name <name>] [--eager]
                                                Restore a VM from a snapshot bundle
machinen ls       (alias: ps)                    List running VMs
machinen exec     <target> [--tty] -- <cmd>     Run a command in a running VM
machinen snapshot <target> --out-dir <d> [--keep-alive]
                                                CRIU-snapshot a running VM
machinen fork     <target> [opts]               Clone a running VM into a sibling
machinen attach   <target> [--shell <c>] [--tail [N]]
                                                Interactive PTY shell into a VM
machinen repl     <target>                       Per-line exec REPL (no persistent state)
machinen stop     <target> [--force|-9]         Stop a running VM
machinen gc       [--dry-run|-n]                Drop dead registry entries + clean artifacts
machinen install  [--version <tag>]             Pre-fetch base assets for a release
machinen completion <bash|zsh|fish>             Emit shell completion
machinen --version | -h                          Print version / help
```

`<target>` is exactly one of `--name <name>` or `--pid <pid>`.

## `machinen boot`

Boots a microVM. Kernel and device tree come from the on-disk release
cache (populated by `machinen install`, or auto-fetched on first use).

- With no positional argument: boots the default Debian base rootfs.
  Requires `-- <cmd>` to tell the guest what to run.
- With `<image>`: boots from a rootfs tarball, typically produced by
  `provision()` from `@machinen/runtime`. If the image carries a
  baked-in default cmd (set via `provision({ cmd })`), `-- <cmd>` is
  optional; pass it to override.

| Flag                                            | What it does                                                                                                                               |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--name <name>`                                 | Register the VM under a human-friendly name (path-shaped allowed: `a/b/c`)                                                                 |
| `--mount <host-dir>:<guest-path>`               | Copy-once host directory into the guest (`/mnt/...`)                                                                                       |
| `--mount-live <host-dir>:<guest-path>[:rw\|ro]` | Live-share via FUSE — guest reads stream in on demand. `rw` (default) or `ro`                                                              |
| `--env KEY=VALUE`                               | Set an env var inside the guest (repeatable)                                                                                               |
| `--cwd <abs-path>`                              | Start the guest cmd in this directory (must be absolute)                                                                                   |
| `-p <hostPort>:<guestPort>`                     | Forward a host TCP port to the guest (repeatable)                                                                                          |
| `--detached`                                    | Detach the VMM from the CLI on first-guest-byte readiness; reattach with `attach`. Mutually exclusive with `--mount`, `--mount-live`, `-p` |
| `--memory <mib>`                                | Guest RAM ceiling, decimal MiB. Debug knob — defaults to `min(host_ram_mib/2, 16384)`, floor 512. See #263                                 |
| `--snapshot <path>`                             | Attach `<path>` as `/dev/vda` — scratch disk for a future `vm.snapshot()`                                                                  |

## `machinen restore`

```
machinen restore <snap-dir> [--name <name>] [--eager]
```

Restores a VM from a snapshot bundle (a directory holding `disk.img` +
`meta.json` produced by `machinen snapshot`). Anonymous restores
auto-name as `<source-name>/<pid>` so lineage shows up in `machinen ls`.
Resolves base assets the same way `boot` does.

| Flag            | What it does                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--name <name>` | Override the auto-name                                                                                                                                                                                             |
| `--eager`       | Pre-load all guest pages at restore time. Default is lazy via userfaultfd — pages are served on first-touch from the bundle. Eager pays the cost up front in exchange for no first-touch latency. See #263 phase C |

## `machinen ls` / `ps`

Lists running VMs as `PID  NAME  UP  FORKED-FROM`. `ps` is an alias.

## `machinen exec`

```
machinen exec <target> [--tty|--pty] -- <cmd>
```

Runs `<cmd>` inside a running VM via vsock. Without `--tty`, stdio is
line-buffered pipes (good for one-shot commands and piping). Pass
`--tty` for a real PTY session — needed for an interactive shell, vim,
htop, or anything that wants job control.

```bash
machinen exec --name worker -- ps aux
machinen exec --name worker --tty -- bash -i
```

## `machinen snapshot`

```
machinen snapshot <target> --out-dir <dir> [--keep-alive]
```

CRIU-snapshots a running VM into `<dir>` (`disk.img` + `meta.json`).
The default freezes-and-exits the source. `--keep-alive` leaves it
running and closes inherited TCP sockets so two live copies don't race
on shared connection state.

## `machinen fork`

```
machinen fork <target> [--new-name <n>] [--out-dir <d>] [--tcp-keep] [--detach]
```

Snapshots the source live (it keeps running) and restores into a
sibling VM, dropping the caller into the fork's interactive console.
Pass `--detach` to hand the fork off and return immediately
(CI / scripted use).

| Flag             | What it does                                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--new-name <n>` | Name for the fork (defaults to `<source>/<fork-pid>`)                                                                                                                            |
| `--out-dir <d>`  | Keep the snapshot bundle here. Without this, the bundle is temp-dir'd                                                                                                            |
| `--tcp-keep`     | Inherit TCP socket state in the fork (rarely correct — both copies race)                                                                                                         |
| `--detach`       | Don't attach the caller's stdio to the fork — return as soon as it's up                                                                                                          |
| `--eager`        | Pre-load all guest pages at restore time. Same semantics as `machinen restore --eager` — flips the lazy default. Useful for fork workloads that touch most of memory immediately |

## `machinen attach`

```
machinen attach <target> [--shell <cmd>] [--tail [N]]
```

Drops into an interactive PTY shell in the running VM (default `bash
-i`, override with `--shell`). `cd`, env vars, history, job control,
and full-screen TUIs all work. Exit the shell (Ctrl-D) to detach.

`--tail` dumps the boot-console snapshot before opening the shell.
With no value it prints the whole snapshot (capped at ~1 MiB);
`--tail N` prints the last N lines. Only works for VMs booted with
`--detached`.

## `machinen repl`

```
machinen repl <target>
```

Per-line exec REPL: every line is a fresh one-shot `exec`, so `cd`,
env vars, and shell history do **not** carry over. Useful for piping a
script of one-liners (`cat cmds.txt | machinen repl --name foo`). For
an actual interactive shell, use `machinen attach`.

## `machinen stop`

```
machinen stop <target> [--force|-9]
```

SIGTERM the VMM, escalate to SIGKILL after 2s, then `gc` its entry.
`--force` sends SIGKILL immediately. Also signals the sibling
`gvproxy` so host ports don't leak. Pid-validates first to refuse
killing a recycled pid.

## `machinen gc`

```
machinen gc [--dry-run|-n]
```

Drops registry entries whose VMM is dead (or whose pid was recycled to
some other process) and removes their per-boot artifacts. Backstop for
`--detached` boots, where the in-process exit hook can't run because
the parent is gone.

## `machinen install [--version <tag>]`

Pre-downloads the kernel, device tree, and Debian base rootfs for the
given release tag (defaults to this CLI's own version) into
`~/.machinen/<tag>/bases/debian-arm64/`.

## `machinen completion <shell>`

Prints a shell completion script for `bash`, `zsh`, or `fish`. Source
it from your shell rc (`eval "$(machinen completion bash)"`) to
tab-complete VM names against the live `machinen ls` output.

## Environment

| Variable                | Purpose                                                                 |
| ----------------------- | ----------------------------------------------------------------------- |
| `MACHINEN_VMM`          | Override the VMM binary path (development)                              |
| `MACHINEN_ASSETS_DIR`   | Use base assets from this directory instead of the on-disk cache.       |
|                         | Expected filenames: `Image-arm64`, `virt-arm64.dtb`,                    |
|                         | `rootfs-debian-arm64.tar.gz` — what `./scripts/build-base-assets.sh`    |
|                         | produces.                                                               |
| `MACHINEN_REGISTRY_DIR` | Override the running-VM registry location (default `~/.machinen/vms/`). |

## Cache layout

```
~/.machinen/
  <release-tag>/
    bases/
      debian-arm64/
        Image           # arm64 Linux kernel
        virt.dtb        # device tree
        rootfs.tar.gz   # Debian base rootfs
  current -> <release-tag>   # symlink to the most recent install
  vms/<id>/meta.json         # one entry per running VM (name, pid, socket)
```
