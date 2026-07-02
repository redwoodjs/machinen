# pi

Run the [`pi`](https://pi.dev) coding agent inside a Machinen VM.

The VM gets a live mount of:

- this directory at `/mnt/workspace`
- your host `~/.pi/agent` state at `/root/.pi/agent`

## Prereq

Log in to pi on the host once:

```sh
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
/login
```

## Run

If you're running from a source checkout, build the local VM bits once from the
repo root:

```sh
pnpm install
bash scripts/machinen-dev.sh
```

Then run the example:

```sh
cd examples/pi
pnpm bake
pnpm start
```

`pnpm bake` uses `../../release-assets` by default. `pnpm start` opens pi in the
VM with this directory as its workspace. Quit pi to stop the VM.

To test against another project, run from that project instead and point at this
example's image:

```js
// boot-pi.mjs
import { homedir } from "node:os";
import { resolve } from "node:path";
import { boot } from "@machinen/runtime";

const vm = await boot({
  image: "/path/to/machinen/examples/pi/artifacts/rootfs.tar.gz",
  liveMounts: [
    { host: process.cwd(), guest: "/mnt/workspace", mode: "rw" },
    { host: resolve(homedir(), ".pi/agent"), guest: "/root/.pi/agent", mode: "rw" },
  ],
  guestCwd: "/mnt/workspace",
  cmd: ["/usr/bin/env", "pi"],
  env: { HOME: "/root" },
  stdio: "inherit",
  timeoutMs: null,
});

const { code } = await vm.wait();
process.exitCode = code ?? 0;
```
