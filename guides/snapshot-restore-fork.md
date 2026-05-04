# Snapshot, restore, and fork

All three use CRIU under the hood. Same arch only — arm64 ↔ arm64. Memory,
file descriptors, and timers come back exactly as they were.

## Snapshot — freeze a VM to disk

```bash
npx machinen boot --name counter -p 3000:3000 --detached ./counter.tar.gz
# ... let the workload accumulate state ...
npx machinen snapshot --name counter --out-dir ./counter.snap
```

The bundle is a directory:

```
counter.snap/
  disk.img        # CRIU image set on an ext4 volume
  meta.json       # source name + timestamp
```

By default the source VM **exits** as part of the snapshot — CRIU kills the
dumped tree on success. Pass `--keep-alive` to leave it running (and close
inherited TCP sockets so two live copies don't race on shared connection
state).

## Restore — thaw a bundle on the same or another machine

```bash
scp -r ./counter.snap host-b:
ssh host-b npx machinen restore ./counter.snap
```

Or from Node:

```ts
import { restore } from "@machinen/runtime";
const vm = await restore({ snapDir: "./counter.snap" });
```

Anonymous restores auto-name as `<sourceName>/<pid>` so lineage shows up in
`machinen ls`.

## Fork — clone a running VM

`fork` is `snapshot --keep-alive` + `restore` in one step. Both VMs keep
running with diverging futures.

```bash
npx machinen fork --name counter --new-name counter-b --detach
npx machinen exec --name counter-b -- curl -s localhost:3000
```

Or:

```ts
const fork = await vm.fork({ name: "counter-b" });
```

**Two fork gotchas worth knowing about:**

1. **TCP sockets reset.** The fork sees `ECONNRESET` on inherited TCP
   connections by default. The source keeps them. Pass `tcpKeep: true` /
   `--tcp-keep` only if you really want both copies racing on the same
   connection state.
2. **Port forwards aren't inherited.** Host ports are global — the source
   already owns the bind. Pass new `portForward` entries explicitly when the
   fork needs network exposure, or reach the fork via `machinen exec`.

## When the snapshot bundle gets huge

The bundle's `disk.img` covers the **scratch disk** allocated at boot time
(default ~8 GiB sparse). If you're snapshotting a workload that wrote a lot,
the resulting `disk.img` reflects that. Keep snapshots tight by snapshotting
warm-but-idle states, or by sizing the scratch disk down via
`boot({ snapshot: "<smaller pre-allocated file>" })`.
