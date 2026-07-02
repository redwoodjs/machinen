# Run pi in a VM

[`pi`](https://pi.dev) is a good real-world VM workload for machinen: it is a
terminal coding agent, it needs a real PTY for interactive use, it keeps session
state on disk, and it talks to external model APIs. This guide covers two useful
shapes:

1. a named VM you can attach to and detach from while `pi` keeps running; and
2. a warm `pi` VM you snapshot once and restore into several parallel siblings.

## Prerequisites

Authenticate `pi` on the host once:

```bash
npm install -g --ignore-scripts @earendil-works/pi-coding-agent
pi
/login
```

That creates `~/.pi/agent`, which holds the agent's local config and auth state.
Do **not** bake that directory into a reusable image. Mount it at runtime or copy
it into a per-user VM instead.

## Bake a pi image

Install Node and `pi` into a rootfs tarball. Keep credentials out of this bake
step.

```ts
// bake-pi.ts
import { provision } from "@machinen/runtime";

await provision({
  install: async (vm) => {
    await vm.exec("apt-get update");
    await vm.exec("apt-get install -y --no-install-recommends curl ca-certificates unzip xz-utils");
    await vm.exec(
      "curl -fsSL https://fnm.vercel.app/install | bash -s -- --install-dir /opt/fnm --skip-shell",
    );
    await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm install 22");
    await vm.exec("FNM_DIR=/opt/fnm /opt/fnm/fnm default 22");
    await vm.exec("ln -sf /opt/fnm/aliases/default/bin/* /usr/local/bin/");
    await vm.exec("npm install -g --ignore-scripts @earendil-works/pi-coding-agent");
  },
  cmd: ["/bin/sleep", "infinity"],
  out: "./pi.tar.gz",
});
```

Run it with:

```bash
node --import tsx bake-pi.ts
```

## Interactive pi VM

Boot a named VM, mount the host's `~/.pi/agent` into the guest, and attach to a
persistent terminal session:

```ts
// boot-pi.ts
import { homedir } from "node:os";
import { resolve } from "node:path";
import { boot } from "@machinen/runtime";

await boot({
  image: "./pi.tar.gz",
  name: "pi",
  detached: true,
  mount: { host: resolve(homedir(), ".pi/agent"), guest: "/root/.pi/agent" },
});
```

```bash
node --import tsx boot-pi.ts
npx machinen attach pi
```

Inside the attached shell:

```bash
HOME=/root pi
```

Detach by closing the host terminal or disconnecting SSH. The shell and `pi`
process stay inside the VM. Reattach later with:

```bash
npx machinen attach pi
```

Stop it when done:

```bash
npx machinen stop pi
```

## Fork a warm pi VM

For non-interactive prompts, snapshot a booted VM after `pi` and its auth state
are present, then restore siblings from that snapshot. Each sibling starts from
the same warm filesystem and session state but diverges independently.

```ts
// fork-pi.ts
import { homedir } from "node:os";
import { resolve } from "node:path";
import { rmSync } from "node:fs";
import { boot, restore } from "@machinen/runtime";

rmSync("./pi.snap", { recursive: true, force: true });

const source = await boot({
  image: "./pi.tar.gz",
  mount: { host: resolve(homedir(), ".pi/agent"), guest: "/root/.pi/agent" },
});

await source.snapshot({ outDir: "./pi.snap" });
await source.kill();

const prompts = [
  "Write fizzbuzz in Rust. Code only.",
  "Write fizzbuzz in Python. Code only.",
  "Write fizzbuzz in Go. Code only.",
];

const results = await Promise.all(
  prompts.map(async (prompt, i) => {
    const vm = await restore({
      snapDir: "./pi.snap",
      image: "./pi.tar.gz",
      name: `pi-${i}`,
    });
    try {
      return await vm.exec(`HOME=/root pi -p ${JSON.stringify(prompt)}`, {
        execTimeoutMs: 180_000,
      });
    } finally {
      await vm.kill();
    }
  }),
);

for (const result of results) {
  console.log(result.stdout);
}
```

There are complete runnable examples in [`examples/pi`](../../examples/pi/README.md)
for interactive and one-shot `pi` testing, and
[`examples/fork-pi`](../../examples/fork-pi/README.md) for the parallel fork
demo.

## What this validates

- PTY-backed interactive attach works for a real terminal agent.
- `pi` auth/config can be supplied at runtime instead of baked into the image.
- A named VM can keep a coding-agent session alive across host disconnects.
- Snapshot/restore can clone a warmed coding-agent environment for parallel
  prompt runs.
