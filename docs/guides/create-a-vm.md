# Create a VM

There are three ways to get a guest workload running, in increasing order of
"baked in":

## 1. Ad-hoc boot — base rootfs + a command

The fastest way to get a shell. Uses the cached Debian base.

```bash
npx machinen boot -- /bin/sh
npx machinen boot -- bash -lc 'apt-get update && apt-get install -y curl && curl ifconfig.me'
```

No `--name` → the VM is anonymous and exits when the command exits.

## 2. Provisioned image — base + your deps + a default cmd

Bake an image once, boot it many times.

```ts
// bake.ts
import { provision } from "@machinen/runtime";
import { readFileSync } from "node:fs";

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update && apt-get install -y nodejs");
    await vm.writeFile("/opt/server.js", readFileSync("./server.js"));
  },
  cmd: ["/usr/bin/node", "/opt/server.js"],
  env: { NODE_ENV: "production" },
  out: "./my-server.tar.gz",
});
```

Then:

```bash
npx machinen boot ./my-server.tar.gz                    # baked cmd runs
npx machinen boot ./my-server.tar.gz -- bash             # override cmd
```

`provision({ cmd, env })` writes `/machinen-config.json` into the rootfs;
caller-supplied `cmd`/`env` on `boot()` always win on conflict.

## 3. Named, reattachable VM

Give the VM a `--name` so other shells (or another process) can find it.

```bash
npx machinen boot --name worker --detached ./my-server.tar.gz
npx machinen ls                                          # see PID + NAME
npx machinen exec --name worker -- ps aux
npx machinen attach --name worker                        # interactive shell
npx machinen stop --name worker
```

`--detached` returns control as soon as the guest produces its first console
byte; the VM keeps running. Without it, the CLI holds stdio until the VM
exits.

From Node, the equivalents are `boot({ name, detached: true })` plus
`attach({ name })` from any process.
