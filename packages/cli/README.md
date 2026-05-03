# @machinen/cli

Command-line interface for [machinen](https://github.com/redwoodjs/machinen) —
boot and drive native arm64 Linux microVMs from the shell.

## Install

```bash
npm i -g @machinen/cli
```

The matching VMM binary (`@machinen/vmm-arm64-darwin` or
`@machinen/vmm-arm64-linux`) is pulled in via optional dependencies. Each VMM
package also ships a sibling `gvproxy` binary that the runtime auto-spawns to
provide guest networking — no system packages required.

## Commands

```
machinen boot [<image>] [opts] -- <cmd>   Boot a microVM and run <cmd>
machinen boot <image>                      Boot an image that has a baked-in cmd
machinen boot --snapshot <path>            Restore a VM from a CRIU snapshot
machinen restore <snapshot>                Alias for boot --snapshot
machinen ls                                List running VMs
machinen exec <name-or-id> -- <cmd>        Run a command in a running VM
machinen snapshot <name-or-id> <out>       CRIU-snapshot a running VM to <out>
machinen attach <name-or-id>               Interactive PTY shell into a running VM
machinen repl <name-or-id>                 Per-line exec REPL (no persistent state)
machinen install [--version <tag>]         Pre-fetch base assets for a release
machinen completion <bash|zsh|fish>        Emit shell completion
machinen --version | -h                    Print version / help
```

### `machinen boot`

Boots a microVM. Kernel and device tree come from the on-disk release cache
(populated by `machinen install`, or auto-fetched on first use).

- With no positional argument: boots the default Debian base rootfs. Requires
  `-- <cmd>` to tell the guest what to run.
- With `<image>`: boots from a rootfs tarball, typically produced by
  `provision()` from `@machinen/runtime`. If the image carries a baked-in
  default cmd (set via `provision({ cmd })`), `-- <cmd>` is optional; pass it
  to override.
- With `--snapshot <path>`: restores a CRIU-frozen VM in under a second.

Options:

| Flag                             | What it does                                       |
| -------------------------------- | -------------------------------------------------- |
| `--name <name>`                  | Register the VM under a human-friendly name        |
| `--mount <host-dir>:<guest-dir>` | Expose a host directory under `/mnt/` in the guest |
| `--env KEY=VALUE`                | Set an env var inside the guest (repeatable)       |
| `-p <hostPort>:<guestPort>`      | Forward a host TCP port to the guest (repeatable)  |
| `--snapshot <path>`              | Restore from a snapshot instead of booting fresh   |

### `machinen ls` / `exec` / `snapshot` / `attach` / `repl`

Once a VM is running (booted with `--name`), other shells can find it with
`ls`, run commands against it with `exec`, freeze it to disk with `snapshot`,
or drop into an interactive PTY shell with `attach` (default `bash -i`,
override with `--shell <cmd>`). For piping a script of one-liners through
fresh one-shot execs, use `repl`. All target VMs by name or id.

### `machinen install [--version <tag>]`

Pre-downloads the kernel, device tree, and Debian base rootfs for the given
release tag (defaults to this CLI's own version) into
`~/.machinen/<tag>/bases/debian-arm64/`.

### `machinen completion <shell>`

Prints a shell completion script for `bash`, `zsh`, or `fish`. Source it from
your shell rc (`eval "$(machinen completion bash)"`) to tab-complete VM names
against the live `machinen ls` output.

## Environment

| Variable                | Purpose                                                         |
| ----------------------- | --------------------------------------------------------------- |
| `MACHINEN_VMM`          | Override the VMM binary path (development)                      |
| `MACHINEN_ASSETS_DIR`   | Use base assets (kernel, dtb, rootfs tarball) from this dir     |
|                         | instead of the on-disk cache / GH Releases. Expected filenames: |
|                         | `Image-arm64`, `virt-arm64.dtb`, `rootfs-debian-arm64.tar.gz` — |
|                         | what `./scripts/build-base-assets.sh` produces.                 |
| `MACHINEN_REGISTRY_DIR` | Override the running-VM registry location (default              |
|                         | `~/.machinen/vms/`).                                            |

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

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
