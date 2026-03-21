import { spawn, execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HELPER_SWIFT = path.join(__dirname, "power-helper.swift");
const HELPER_BIN = path.join(__dirname, "power-helper");

function ensureCompiled() {
  if (!fs.existsSync(HELPER_BIN)) {
    console.log("Compiling power helper...");
    execSync(
      `swiftc -o ${HELPER_BIN} ${HELPER_SWIFT} -framework Cocoa -framework IOKit`,
      { stdio: "inherit" }
    );
  }
}

export function createPowerWatcher({ onSleep, onWake }) {
  ensureCompiled();

  const child = spawn(HELPER_BIN, [], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  const rl = createInterface({ input: child.stdout });

  rl.on("line", async (line) => {
    const event = line.trim();
    if (event === "sleep-delayed" || event === "sleep") {
      const canDelaySleep = event === "sleep-delayed";
      try {
        await onSleep({ canDelaySleep });
      } finally {
        // Release the power assertion so the Mac can sleep
        if (canDelaySleep) {
          child.stdin.write("release\n");
        }
      }
    } else if (event === "wake") {
      await onWake();
    }
  });

  child.on("error", (err) => {
    console.error("Power helper error:", err.message);
  });

  return {
    stop() {
      child.kill();
    },
  };
}

// Run standalone for testing: node src/power.mjs
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log("Watching for sleep/wake events... (close lid to test)");
  createPowerWatcher({
    onSleep: ({ canDelaySleep }) => {
      console.log(`[${new Date().toISOString()}] SLEEP (delay=${canDelaySleep})`);
    },
    onWake: () => {
      console.log(`[${new Date().toISOString()}] WAKE`);
    },
  });
}
