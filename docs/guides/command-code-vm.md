# Try Command Code in an isolated VM

This runs [Command Code](https://commandcode.ai) inside a small Linux VM on your
computer. The goal is an isolated sandbox: let an agent explore, edit, install
packages, and run commands in a VM instead of directly on your host.

The VM owns Node, npm, the `command-code` install, and the rest of its Linux
userspace. The host shares only two folders:

- your project at `/mnt/workspace`
- your normal Command Code state at `/root/.commandcode`

Command Code stores CLI state under `$HOME/.commandcode`. The boot script below
mounts your host `~/.commandcode` there directly, so login/config live outside
the VM while Command Code still runs inside the VM.

Because the workspace mount is live, edits from the VM appear on the host right
away. Install and run any project software you are comfortable running on the
host; the VM can be strictly the isolated place where the agent edits files.

## 1. Bake the image

Install Machinen in the project first so TypeScript can resolve the runtime
types:

```bash
npm i @machinen/runtime
```

Create `bake.ts`:

```ts
import { provision } from "@machinen/runtime";

async function main() {
  try {
    await provision({
      install: async (vm) => {
        await vm.exec(`
          fnm install 24
          fnm default 24
          npm install -g command-code@latest
        `);
      },
      out: "./command-code-vm.tar.gz",
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

main();
```

Run the bake script:

```bash
npx tsx bake.ts
```

Machinen's base rootfs already includes `fnm` and PATH defaults for its Node
installs. The script uses it to install Node 24, then uses npm to install
`command-code@latest`.

## 2. Run on your workspace

This uses your existing host Command Code state. Log in on the host first so
`$HOME/.commandcode` already exists.

Create `boot.mjs` in the project you want Command Code to work on:

```js
import { homedir } from "node:os";
import { resolve } from "node:path";
import { boot } from "@machinen/runtime";

// "yolo mode" runs the agent inside the VM sandbox, not directly on your host.
// This is foreground mode: Command Code is the VM workload, not a detached VM.
const vm = await boot({
  image: "./command-code-vm.tar.gz",
  liveMounts: [
    { host: process.cwd(), guest: "/mnt/workspace", mode: "rw" },
    { host: resolve(homedir(), ".commandcode"), guest: "/root/.commandcode", mode: "rw" },
  ],
  guestCwd: "/mnt/workspace",
  cmd: ["/usr/bin/env", "cmd"],
  stdio: "inherit",
  timeoutMs: null, // Command Code is interactive; wait until the user quits.
});

// Keep this script alive until the foreground VM workload exits.
const { code } = await vm.wait();
process.exitCode = code ?? 0;
```

Run it:

```bash
node boot.mjs
```

`guestCwd: "/mnt/workspace"` sets the guest working directory before Command
Code starts. This script is not detached: quitting Command Code stops the VM and
lets `vm.wait()` return.

Your project stays on the host. Command Code auth/config/state stays in
`$HOME/.commandcode`. Everything else belongs to the VM image or the running VM.

That's it!

## Run the code in the same VM

The recipe above uses Command Code as the VM's foreground command. Say you want
to modify code and run it in the same VM instead. Make the app or website the
foreground command, give the VM a name, and forward the dev-server port back to
localhost:

```diff
 const vm = await boot({
+  name: "command-code-vm",
   image: "./command-code-vm.tar.gz",
   liveMounts: [
     { host: process.cwd(), guest: "/mnt/workspace", mode: "rw" },
     { host: resolve(homedir(), ".commandcode"), guest: "/root/.commandcode", mode: "rw" },
   ],
   guestCwd: "/mnt/workspace",
-  cmd: ["/usr/bin/env", "cmd"],
+  cmd: ["/usr/bin/env", "npm", "run", "dev", "--", "--host", "0.0.0.0"],
+  portForward: [{ hostPort: 3000, guestPort: 3000 }],
   stdio: "inherit",
   timeoutMs: null,
 });
```

Open `http://localhost:3000` on the host. In another terminal, attach to the
same VM and run Command Code from the mounted workspace:

```bash
npx machinen attach command-code-vm
```

`attach` opens a separate persistent PTY session in the VM; it does not take over
the dev-server process. For many projects, it is simpler to keep running the app
on the host and use the VM only for isolated agent edits.
