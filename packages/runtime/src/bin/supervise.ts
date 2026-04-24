#!/usr/bin/env node
// Tiny interactive demo: launches N shell children, each under its
// own pty, and hands the terminal to the Supervisor. Real use should
// register actual microVM `boot(...)` handles, but this lets you
// feel the terminal layer without booting a kernel.
//
//   pnpm --filter @machinen/runtime exec tsx src/bin/supervise.ts 3
//
// Then try `/ls`, `/attach 0`, run `ls --color=auto`, resize the
// terminal window, `Ctrl-] Ctrl-]` to detach.

import { Sandboxes, Supervisor, bootPty } from "../index.ts";

async function main() {
  const count = Number.parseInt(process.argv[2] ?? "2", 10) || 2;
  const sandboxes = new Sandboxes();
  const kids = [] as ReturnType<typeof bootPty>[];
  for (let i = 0; i < count; i++) {
    const shell = process.env.SHELL || "/bin/bash";
    const vm = bootPty({
      binary: shell,
      args: ["-i"],
      env: { PS1: `sandbox-${i}> ` },
    });
    sandboxes.add(String(i), vm as unknown as Parameters<Sandboxes["add"]>[1]);
    kids.push(vm);
  }

  // Supervisor picks up rawTtyOnAttach and forwardResize automatically
  // when process.stdin / process.stdout are real TTYs.
  process.stdin.resume();
  const sup = new Supervisor({ sandboxes });
  await sup.run();

  for (const k of kids) {
    await k.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
