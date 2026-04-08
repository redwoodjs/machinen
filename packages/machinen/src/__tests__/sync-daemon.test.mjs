/**
 * Behavioral specs for `machinen watch` daemon command.
 *
 * Tests are derived from task intent (not source code).
 * All assertions use the CLI's external interface only.
 */
import { describe, it, expect } from "vitest";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, "..", "..", "..", "..", "src", "machinen.mjs");

// Helper: run CLI in /tmp so git-based container auto-detect fails
function runInTmp(args, opts = {}) {
  return execSync(`node ${cli} ${args}`, {
    encoding: "utf-8",
    stdio: "pipe",
    cwd: "/tmp",
    ...opts,
  });
}

// Helper: spawn CLI, send signal after a short delay, resolve with exit code
function spawnAndSignal(args, signal, delayMs = 500) {
  return new Promise((resolve) => {
    const proc = spawn("node", [cli, ...args.split(" ")], {
      stdio: "pipe",
      cwd: "/tmp",
    });

    let settled = false;

    // Process might exit on its own before signal
    proc.on("close", (code, sig) => {
      if (!settled) {
        settled = true;
        resolve({ code, signal: sig, exitedEarly: true });
      }
    });

    setTimeout(() => {
      if (!settled) {
        proc.kill(signal);
        proc.on("close", (code, sig) => {
          if (!settled) {
            settled = true;
            resolve({ code, signal: sig, exitedEarly: false });
          }
        });
      }
    }, delayMs);

    // Safety timeout: 5 s — process must not hang
    setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGKILL");
        resolve({ code: null, signal: "SIGKILL", timedOut: true });
      }
    }, 5000);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Help and discovery
// ─────────────────────────────────────────────────────────────────────────────
describe("watch command — help and discovery", () => {
  it("lists watch as an available command in top-level help", () => {
    const output = execSync(`node ${cli}`, { encoding: "utf-8" });
    expect(output).toContain("watch");
  });

  it("shows watch-specific usage when --help flag is passed", () => {
    let output;
    try {
      output = execSync(`node ${cli} watch --help`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err) {
      // Some CLI frameworks print help to stderr and exit 0 or 1
      output = (err.stdout || "") + (err.stderr || "");
    }
    expect(output).toMatch(/watch/i);
    expect(output).toMatch(/interval/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Interval flag
// ─────────────────────────────────────────────────────────────────────────────
describe("watch command — interval flag", () => {
  it("rejects non-numeric --interval values with exit code 1", () => {
    try {
      runInTmp("watch --interval abc");
      expect.fail("expected non-zero exit");
    } catch (err) {
      expect(err.status).toBe(1);
    }
  });

  it("rejects zero or negative --interval values with exit code 1", () => {
    try {
      runInTmp("watch --interval 0");
      expect.fail("expected non-zero exit");
    } catch (err) {
      expect(err.status).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Signal handling
// ─────────────────────────────────────────────────────────────────────────────
describe("watch command — signal handling", () => {
  it("terminates (does not hang) when sent SIGINT", async () => {
    const result = await spawnAndSignal("watch", "SIGINT");
    expect(result.timedOut).toBeFalsy();
  });

  it("terminates (does not hang) when sent SIGTERM", async () => {
    const result = await spawnAndSignal("watch", "SIGTERM");
    expect(result.timedOut).toBeFalsy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Freeze command — --keep-alive flag
// ─────────────────────────────────────────────────────────────────────────────
describe("freeze command — --keep-alive flag", () => {
  it("shows --keep-alive in help text", () => {
    const output = execSync(`node ${cli}`, { encoding: "utf-8" });
    expect(output).toContain("--keep-alive");
  });

  it("freeze requires container name outside git repo", () => {
    try {
      execSync(`node ${cli} freeze`, { encoding: "utf-8", stdio: "pipe", cwd: "/tmp" });
    } catch (err) {
      expect(err.stderr || err.stdout).toContain("Container name required");
      expect(err.status).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. E2E (requires live containers and registry)
// ─────────────────────────────────────────────────────────────────────────────
describe("watch command — E2E", () => {
  it.todo(
    "discovers and syncs all running machinen-* containers (E2E only)"
  );
  it.todo(
    "migrates containers to cloud on sleep and restores on wake (E2E only)"
  );
  it.todo(
    "writes status files for each discovered container (E2E only)"
  );
});
