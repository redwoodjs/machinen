# Run pi in a VM

This runs [`pi`](https://pi.dev) inside a small Linux VM on your computer. The VM
owns Node, npm, the `pi` install, and the rest of its Linux userspace. The host
shares only two folders:

- your project at `/mnt/workspace`
- your normal pi state at `/root/.pi/agent`

Pi stores CLI state under `$HOME/.pi/agent`. The boot script below mounts your
host `~/.pi/agent` there, so login/config live outside the VM while pi still runs
inside the VM.

Because the workspace mount is live, edits from the VM appear on the host right
away. The VM is the isolated place where the agent edits files.

The signed recipe provides the automatic version of this setup:

```bash
npx @machinen/cli run machinen.dev/run/pi
```

Its first approval shows the workspace, host `~/.pi/agent`, and any external
roots needed by symlinks in that state. Later runs reuse the same approval while
the recipe digest and resolved host access remain unchanged. Continue below when
you want to bake and boot the image yourself instead.

## 1. Bake the image

Install Machinen in the project first so TypeScript can resolve the runtime
types:

```bash
npm i @machinen/runtime
```

Create `bake.ts`:

```ts
import { provision } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec(`
      fnm install 24
      fnm default 24
      npm install -g --ignore-scripts @earendil-works/pi-coding-agent
    `);
  },
  out: "./pi-vm.tar.gz",
});
```

Run the bake script:

```bash
npx tsx bake.ts
```

Machinen's base rootfs already includes `fnm` and PATH defaults for its Node
installs. The script uses it to install Node 24, then uses npm to install pi.

## 2. Run pi on your workspace

Log in on the host first so `$HOME/.pi/agent` already exists:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
/login
```

Create `boot.mjs` in the project you want pi to work on:

```js
import { homedir } from "node:os";
import { resolve } from "node:path";
import { boot } from "@machinen/runtime";

const vm = await boot({
  image: "./pi-vm.tar.gz",
  liveMounts: [
    { host: process.cwd(), guest: "/mnt/workspace", mode: "rw" },
    { host: resolve(homedir(), ".pi/agent"), guest: "/root/.pi/agent", mode: "rw" },
  ],
  guestCwd: "/mnt/workspace",
  cmd: ["/bin/bash", "-lc", "exec pi"],
  env: { HOME: "/root" },
  stdio: "inherit",
  timeoutMs: null, // pi is interactive; wait until the user quits.
});

const { code } = await vm.wait();
process.exitCode = code ?? 0;
```

Run it:

```bash
node boot.mjs
```

Your project stays on the host. Pi auth/config/state stays in
`$HOME/.pi/agent`. Everything else belongs to the VM image or the running VM.

That's it.

## Keep the VM running and attach later

The recipe above uses pi as the VM's foreground command. If you want the VM to
keep running after your host terminal goes away, boot a named detached VM
instead:

```diff
 const vm = await boot({
+  name: "pi-vm",
   image: "./pi-vm.tar.gz",
   liveMounts: [
     { host: process.cwd(), guest: "/mnt/workspace", mode: "rw" },
     { host: resolve(homedir(), ".pi/agent"), guest: "/root/.pi/agent", mode: "rw" },
   ],
   guestCwd: "/mnt/workspace",
-  cmd: ["/usr/bin/env", "pi"],
+  cmd: ["/bin/sleep", "infinity"],
   env: { HOME: "/root" },
-  stdio: "inherit",
-  timeoutMs: null, // pi is interactive; wait until the user quits.
+  detached: true,
 });
```

Then attach from any terminal:

```bash
npx machinen attach pi-vm
```

Inside the attached shell:

```bash
cd /mnt/workspace
pi
```

There is a complete runnable example in
[`examples/pi`](../../examples/pi/README.md). The older
[`examples/fork-pi`](../../examples/fork-pi/README.md) example shows a parallel
snapshot/restore demo.
