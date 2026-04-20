#!/usr/bin/env node
// Tiny interactive demo: launches N `cat` children as fake sandboxes
// and hands the terminal to the Supervisor. Real use should register
// actual `spawn(...)` handles, not /bin/cat.
//
//   pnpm --filter @machinen/runtime exec tsx src/bin/supervise.ts 3
//
// Then try `/ls`, `/attach 0`, type a bit, `Ctrl-] Ctrl-]` to detach.

import { Sandboxes, Supervisor, spawn } from "../index.ts";

async function main() {
  const count = Number.parseInt(process.argv[2] ?? "2", 10) || 2;
  const sandboxes = new Sandboxes();
  const kids = [] as Awaited<ReturnType<typeof spawn>>[];
  for (let i = 0; i < count; i++) {
    const vm = await spawn({ binary: "/bin/cat", timeoutMs: null });
    sandboxes.add(String(i), vm);
    kids.push(vm);
  }

  process.stdin.resume();
  if (process.stdin.isTTY) process.stdin.setRawMode?.(true);

  const sup = new Supervisor({ sandboxes });
  await sup.run();

  if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
  for (const k of kids) await k.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
