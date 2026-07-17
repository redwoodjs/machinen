# Mount files into a VM

You'll usually want files from the host inside the guest — config the VM
needs to read, source code you're working on, fixtures for a test, an
output directory to write into. There are three ways to get them across,
and the right one depends on what you're sharing and how much it changes.

A quick decision sketch before the details:

- **One small file?** `vm.writeFile()` from your host code. No mount
  needed.
- **A directory the guest only reads, set in stone at boot time?**
  `--mount`. The data rides into the VM at boot and the guest sees a
  copy.
- **A directory you want the guest and host to share live**, with
  changes flowing in either direction? `--mount-live`. It's a
  FUSE-style filesystem served by the VMM over virtio-fs — no copy,
  just live access to the host directory.

## A workspace you're actively editing — `--mount-live`

This is the most common case for development. You're editing files on
your host, and you want the guest to see the changes as you save them
(no rebuild, no re-bake, no re-boot). You also want anything the guest
writes — build outputs, logs, generated files — to land on the host
filesystem so you can keep working with them.

```bash
npx machinen boot --mount-live ./workspace:/mnt/workspace -- bash
```

In the guest, `/mnt/workspace` is your host's `./workspace` directory.
Reads stream through virtio-fs on demand — nothing was copied at boot,
so the mount is essentially free even if the workspace is huge. Writes
are published back to the host at sync points by default. If the guest
builds a binary into `./workspace/dist/`, you'll see it after the
workload exits or the next host API sync point.

Default mode is read-write. Guest writes are staged in a VM-local overlay;
at sync points Machinen publishes only the paths created, changed, or deleted
in that overlay. Untouched files are not read or rewritten. If you want to
share something the guest mustn't be able to modify — a directory of test
fixtures, say, or a read-only data dump — pass `:ro`:

```bash
npx machinen boot --mount-live ./fixtures:/mnt/fixtures:ro -- ./run-tests.sh
```

Read-only mounts have nothing to write back. For read-write mounts,
Machinen publishes staged changes when the workload exits, and after host API
calls such as `vm.exec()`, `vm.snapshot()`, `vm.fork()`, `vm.kill()`, or
`machinen stop`. A writable live-mount sync applies changed paths and overlay
deletion markers to the host directory. Concurrent host edits to a path also
changed by the guest can therefore be overwritten; unrelated host paths are
left untouched.

You can pass `--mount-live` multiple times for separate shares; each
one gets its own virtio-fs device slot:

```bash
npx machinen boot \
  --mount-live ./src:/mnt/src \
  --mount-live ./fixtures:/mnt/fixtures:ro \
  -- bash
```

Common filesystem operations work through the live mount: read, write,
append, truncate, rename, symlink, hardlink, `chmod +x`, and large file
reads or writes. The same behavior is tested on macOS/HVF and
Linux/KVM, so a workspace should behave the same whether the VM runs on
your laptop or on a Linux builder.

A security note worth being aware of: a `rw` live mount is a
persistent channel from inside the guest back to the host filesystem,
rooted at whatever directory you shared. If you're running untrusted
code in the VM, this matters — a compromised process inside the guest
can write anywhere under `./workspace` while the VM is up. The exposure
is bounded to the share root (containment doesn't let it escape upward),
but inside that root you've effectively given the guest full write
access. For untrusted inputs that don't need write-through, use the
`:ro` mode, or use `--mount` instead.

From Node:

```ts
await boot({
  image,
  cmd,
  liveMounts: [
    { host: "./workspace", guest: "/mnt/workspace", mode: "rw" },
    { host: "./fixtures", guest: "/mnt/fixtures", mode: "ro" },
  ],
});
```

## A directory the guest only needs at boot — `--mount`

If the guest will read the directory once at startup and never look
again — input data for a one-shot job, model weights for a fresh
serving process — `--mount` ships a copy of the directory into the VM
at boot. After that, it's just files inside the rootfs; the host has
no further involvement.

```bash
npx machinen boot --mount ./input-data:/mnt/input -- ./process.sh
```

Two important consequences of "it's a copy":

- **Changes you make on the host after boot don't propagate.** If
  you're editing files mid-run, this isn't the right tool — use
  `--mount-live`.
- **Anything the guest writes to the mount is discarded when the VM
  exits.** The mount is part of the guest's ephemeral filesystem.

This mode trades flexibility for simplicity and isolation: there's no
ongoing connection to the host, so a compromised guest can't reach
back. For inputs you don't need write-through on, this is strictly
safer than `--mount-live`.

There's one performance footnote. The mount payload travels through
the initramfs cpio at boot, which means it briefly counts against the
RAM ceiling at unpack time. For a few hundred MB this is fine. For
mounts measured in gigabytes, prefer `--mount-live` even if you don't
need write-through — it doesn't pay the boot-time copy.

```ts
await boot({
  image,
  cmd,
  mount: { host: "./input-data", guest: "/mnt/input" },
});
```

Guest paths for both `--mount` and `--mount-live` must be safe absolute
paths. Paths such as `/root/.config/tool`, `/workspace`, `/var/cache/tool`,
and `/mnt/workspace` are allowed. Machinen rejects paths that hide runtime or
kernel-managed locations such as `/`, `/dev`, `/proc`, `/sys`, `/run`, `/init`,
`/exec-agent`, and Machinen's own `/sbin/machinen-*` helpers.

From the Node API, you can bypass that guard for a mount only when you really
mean it:

```ts
await boot({
  image,
  cmd,
  mount: { host: "./state", guest: "/run/my-tool", unsafeGuestPath: true },
});
```

## A single file — `vm.writeFile()`

If all you need is to drop one file into the guest — a config, a small
script, a license blob — you don't need a mount at all:

```ts
await vm.writeFile("/etc/myapp/config.json", JSON.stringify(cfg));
await vm.writeFile("/usr/local/bin/run.sh", scriptSource, { mode: 0o755 });
await vm.writeFile("/var/log/audit.log", line, { append: true });
```

The contents ride through a single vsock exec frame and land at the
target path. Parent directories are created automatically. It's
binary-safe (base64 under the hood). Set `mode` to make it executable;
set `append: true` to add to an existing file.

This is the right tool for small-to-medium files — configs, scripts,
seed data measured in kilobytes or low megabytes. For very large blobs,
the mount paths above are more efficient.

## Landing the workload inside the share

A small ergonomic note: you'll often want the guest's entrypoint to
run _inside_ the directory you mounted, instead of starting in `/` and
needing a `cd` in your wrapper script. Pass `--cwd` to set the guest's
working directory:

```bash
npx machinen boot --mount-live ./workspace:/mnt/workspace \
  --cwd /mnt/workspace -- bash
```

Now the shell starts in `/mnt/workspace`. The same flag works for any
guest entrypoint, not just bash.

From Node, the equivalent is `boot({ guestCwd: "/mnt/workspace" })`.
