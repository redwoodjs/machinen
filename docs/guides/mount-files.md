# Mount files into a VM

Three options, picked by **how big** and **how dynamic** the data is.

## `--mount` — copy-once, host dir → guest

For small-to-medium inputs the guest only reads at boot:

```bash
npx machinen boot --mount ./fixtures:/mnt/fixtures -- bash -c 'ls /mnt/fixtures'
```

Or:

```ts
await boot({
  image,
  cmd,
  mount: { host: "./fixtures", guest: "/mnt/fixtures" },
});
```

- Guest path **must** live under `/mnt/`.
- Payload rides through the initramfs cpio at boot time. With `rootDisk: true`
  (the default) it briefly counts against the initramfs RAM ceiling at unpack
  — for very large mounts, prefer `--mount-live`.
- Guest writes are **discarded** when the VM exits.

## `--mount-live` — FUSE pass-through, no copy

For large inputs, write-through scratch dirs, or any time you want host
changes to be visible to the guest as they happen:

```bash
npx machinen boot --mount-live ./workspace:/mnt/workspace:rw -- bash
npx machinen boot --mount-live ./readonly-data:/mnt/data:ro -- bash
```

Or:

```ts
await boot({
  image,
  cmd,
  liveMounts: [
    { host: "./workspace", guest: "/mnt/workspace", mode: "rw" },
    { host: "./readonly-data", guest: "/mnt/data", mode: "ro" },
  ],
});
```

- Guest reads stream in on demand via a vsock FUSE relay. Nothing copied at
  boot.
- `rw` (default): guest writes land on the host. `ro`: one-way share, host
  caches.
- Each mount gets its own vsock port. Repeatable.
- **Security:** a `rw` live mount is a persistent channel from a compromised
  guest back to the host filesystem rooted at `host`. Prefer `--mount`
  (copy-once) for inputs you don't need write-through on.

## `vm.writeFile` — drop a single file

Small configs, scripts, env files:

```ts
await vm.writeFile("/etc/myapp/config.json", JSON.stringify(cfg));
await vm.writeFile("/usr/local/bin/run.sh", scriptSource, { mode: 0o755 });
await vm.writeFile("/var/log/audit.log", line, { append: true });
```

Binary-safe (base64 over a single vsock exec frame). For very large blobs,
prefer `--mount` or `VsockFiles.push`.

## Land the guest cmd inside the share

Use `--cwd` / `guestCwd` so the workload starts inside the mount instead of
needing a `cd` in your wrapper script:

```bash
npx machinen boot --mount-live ./workspace:/mnt/workspace --cwd /mnt/workspace -- bash
```
