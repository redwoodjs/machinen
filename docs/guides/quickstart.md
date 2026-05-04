# Quickstart

Bake an image, boot it, accumulate some state, then move the running process
to another host.

## 1. Bake

A tiny HTTP server that counts hits in memory:

```js
// counter.js
import { createServer } from "node:http";
let count = 0;
createServer((_, res) => {
  res.end(JSON.stringify({ count: ++count }) + "\n");
}).listen(3000);
```

Bake it into a rootfs tarball with `provision()`:

```ts
// bake.ts
import { readFileSync } from "node:fs";
import { provision } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update && apt-get install -y nodejs");
    await vm.writeFile("/opt/counter.js", readFileSync("./counter.js"));
  },
  cmd: ["/usr/bin/node", "/opt/counter.js"],
  out: "./counter.tar.gz",
});
```

```bash
node bake.ts
```

## 2. Boot

```bash
npx machinen boot --name counter -p 3000:3000 --detached ./counter.tar.gz
curl localhost:3000                        # { count: 1 }
curl localhost:3000                        # { count: 2 }
```

The process is now sitting on host A with `count = 2` in its heap.

## 3. Handoff

Freeze it, copy the bundle to host B, thaw it:

```bash
npx machinen snapshot --name counter --out-dir ./counter.snap
scp -r ./counter.snap host-b:
ssh host-b npx machinen restore ./counter.snap &
curl host-b:3000                           # { count: 3 }  ← same process
```

Same arch only (arm64 ↔ arm64). Memory, file descriptors, and timers come
back exactly as they were.

## Next steps

- [Create a VM](./create-a-vm.md) — the three ways to get a workload running
- [Snapshot, restore, and fork](./snapshot-restore-fork.md) — clone a running
  process, branching futures from one heap
- [Mount files into a VM](./mount-files.md) — `--mount`, `--mount-live`, `vm.writeFile`
- [Networking](./networking.md) — port forwards and outbound traffic via gvproxy
