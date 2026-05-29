# Level 4 ping portable machine workload

Goal 011 makes ping the first product-supported Level 4 portable machine snapshot workload.

The product claim is no longer a ping-specific Level 2 semantic continuation. Product support is now:

- profile: `ping-level4-socket-reconstruction-v1`
- product support: supported
- implementation level: `level-4-kernel-resource-reconstruction`
- surface: `machinen snapshot` / `machinen restore`

## Snapshot/restore flow

```sh
MACHINEN_SNAPSHOT_ENGINE=portable machinen snapshot <vm> ./ping.portable
machinen restore ./ping.portable \
  --target-arch amd64 \
  --json

machinen exec <restored-name> -- cat /tmp/machinen-restored-ping.log
```

The portable snapshot engine recognizes the supported ping machine subset in two ways:

1. auto-inspect exactly one running loopback `ping` process and match its socket through `/proc/net/icmp` or `/proc/net/raw`;
2. or read an explicit guest descriptor at `/run/machinen/portable-ping-socket.json` or `/tmp/machinen-portable-ping-socket.json`.

The auto-inspector requires a ping/raw ICMP socket, empty queues, loopback destination, no active receive wait, and a target architecture (default: the opposite guest architecture; override with `MACHINEN_PORTABLE_TARGET_ARCH=arm64|amd64`). Restore then boots a target VM, starts target-native `/usr/bin/ping`, and writes live replies to `/tmp/machinen-restored-ping.log`.

For a Mac/arm64 source to Proxmox/amd64 target proof, copy the generated bundle to the Proxmox host and run:

```sh
cd /root/machinen
node packages/cli/dist/cli.js restore /root/machinen-ping-test/ping.portable \
  --target-arch amd64 --json
node packages/cli/dist/cli.js exec <restored-name> -- \
  'cat /tmp/machinen-restored-ping.log'
```

## Retired Level 2 product claim

`ping-sequence-counter-semantic-continuation-v1` is no longer product support. The semantic helper can remain as regression evidence, but product discovery must not advertise it as `implemented-product-support`.

## Refusals

Unsupported neighboring states remain refused with `migrationCompleted=false`, including unread receive queues, in-flight packets, active `recvmsg`, ambiguous route/namespace, missing credential/capability mapping, unsupported raw socket options, and target verifier mismatch.

End-to-end smoke:

```sh
pnpm build
pnpm run smoke-portable-ping-machine
```

Checked summaries:

- `docs/snapshot/checked-summaries/level4-graduation/goal-011.json`
- `docs/snapshot/checked-summaries/level4-graduation/goal-012.json`
- `docs/snapshot/checked-summaries/level4-graduation/goal-013.json`
