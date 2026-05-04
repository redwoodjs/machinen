# Networking

The runtime auto-spawns [gvproxy](https://github.com/containers/gvisor-tap-vsock)
as a sidecar to provide the guest with outbound networking and to install
host→guest port forwards. No NAT setup, no `iptables` — gvproxy is a userspace
TCP/IP stack that bridges over vsock.

## Outbound from the guest

Just works once `gvproxy` is in place:

```bash
npx machinen boot -- bash -c 'curl -s ifconfig.me; echo'
```

DNS, TCP, UDP — all via the gvproxy stack. The first boot may print a single
line (`machinen: installing gvproxy v0.8.6 …`) while it fetches the pinned
release into `~/.machinen/gvproxy/`; subsequent boots are silent.

If the install fetch fails (offline, no `gh auth`), networking stays disabled
and `boot()` continues — `curl` will hang/fail but the VM otherwise runs.

## Inbound: forward a host port to the guest

```bash
npx machinen boot -p 3000:3000 -- bash -c 'python3 -m http.server 3000'
```

```ts
await boot({
  image,
  cmd,
  portForward: [
    { hostPort: 3000, guestPort: 3000 },
    { hostPort: 5432, guestPort: 5432, hostAddr: "0.0.0.0" },
  ],
});
```

- `hostAddr` defaults to `127.0.0.1` (localhost-only). Set `0.0.0.0` to expose
  on all interfaces.
- Repeatable — pass `-p` multiple times on the CLI, or multiple entries in the
  array.
- `boot()` throws if a host port is already in use
  (`BOOT_PORT_FORWARD_IN_USE`) or if two forwards collide
  (`BOOT_PORT_FORWARD_CONFLICT`).

## Detached boots + port forwards

Currently mutually exclusive: `--detached` refuses `-p` (and `--mount`,
`--mount-live`) because those keep helpers alive in the JS process that the
detached VMM still needs to call back into. Workaround: keep the booter
process alive (run it under a supervisor like `pm2` / `systemd`) and let it
hold the forward.

## Custom gvproxy

Override the binary via `MACHINEN_GVPROXY=/path/to/gvproxy`. Resolution order
is: `$MACHINEN_GVPROXY` → sibling of the VMM binary → `~/.machinen/gvproxy/`
cache → `gvproxy` on `$PATH` → fetch the pinned release.
