#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const [script, ...args] = process.argv.slice(2);

if (!script) {
  console.error("usage: node scripts/archived-smoke.mjs <script> [args...]");
  process.exit(2);
}

console.error(`archived smoke: ${script}`);
console.error(
  "This script was removed from the active smoke surface because it is stale or proof-only. " +
    "It must not be used as product snapshot/restore evidence without a fresh audit.",
);
console.error(
  "Set MACHINEN_RUN_ARCHIVED_SMOKE=1 to run the old script intentionally for archaeology/debugging.",
);

if (process.env.MACHINEN_RUN_ARCHIVED_SMOKE !== "1") {
  process.exit(1);
}

const result = spawnSync("bash", [script, ...args], { stdio: "inherit" });
process.exit(result.status ?? 1);
