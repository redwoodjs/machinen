# @machinen/cli

Command-line interface for [machinen](https://github.com/redwoodjs/machinen) —
spawn a native arm64 Linux microVM from a bundle directory.

## Install

```bash
npm i -g @machinen/cli
```

The matching VMM binary (`@machinen/vmm-arm64-darwin` or
`@machinen/vmm-arm64-linux`) is pulled in via optional dependencies.

A `libslirp` install is currently required at runtime:

- macOS: `brew install libslirp`
- Debian/Ubuntu: `apt install libslirp0`
- Fedora/RHEL: `dnf install libslirp`
- Alpine: `apk add libslirp`

## Commands

```
machinen run <bundle-dir>       Spawn a microVM from a bundle
machinen install                Pre-fetch the current-tag base assets
  --version <tag>               Pin to a specific release tag
machinen --version | -h         Print version / help
```

### `machinen run <bundle-dir>`

Boots a microVM, packing `<bundle-dir>/rootfs/` into an initramfs and reading
`<bundle-dir>/machinen-config.json` for boot config. `stdin`/`stdout`/`stderr`
are wired through to the host terminal.

### `machinen install [--version <tag>]`

Pre-downloads the kernel, device tree, and Debian base rootfs for the given
release tag (defaults to this CLI's own version) into
`~/.machinen/<tag>/bases/debian-arm64/`.

## Environment

| Variable       | Purpose                                    |
| -------------- | ------------------------------------------ |
| `MACHINEN_VMM` | Override the VMM binary path (development) |

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
```

## License

MIT
