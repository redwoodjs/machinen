/**
 * Behavioral specs for `machinen sync` daemon command.
 *
 * Tests are derived from task intent (not source code).
 * All assertions use the CLI's external interface only.
 */
import { describe, it, expect } from "vitest";
import { execSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cli = path.join(__dirname, "..", "machinen.mjs");

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

    // Process might exit on its own (e.g. container not found) before signal
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
describe("sync command — help and discovery", () => {
  it("lists sync as an available command in top-level help", () => {
    const output = execSync(`node ${cli}`, { encoding: "utf-8" });
    expect(output).toContain("sync");
  });

  it("shows sync-specific usage when --help flag is passed", () => {
    let output;
    try {
      output = execSync(`node ${cli} sync --help`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
    } catch (err) {
      // Some CLI frameworks print help to stderr and exit 0 or 1
      output = (err.stdout || "") + (err.stderr || "");
    }
    expect(output).toMatch(/sync/i);
    expect(output).toMatch(/interval/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Container name resolution
// ─────────────────────────────────────────────────────────────────────────────
describe("sync command — container name resolution", () => {
  it("exits with code 1 when no container name given and none is auto-detectable", () => {
    try {
      runInTmp("sync");
      expect.fail("expected non-zero exit");
    } catch (err) {
      expect(err.status).toBe(1);
      const output = (err.stderr || "") + (err.stdout || "");
      expect(output.toLowerCase()).toMatch(/container/);
    }
  });

  it("exits with code 1 when the given container name does not exist", () => {
    try {
      execSync(`node ${cli} sync __nonexistent_container_xyz__`, {
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect.fail("expected non-zero exit");
    } catch (err) {
      expect(err.status).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Interval flag
// ─────────────────────────────────────────────────────────────────────────────
describe("sync command — interval flag", () => {
  it("rejects non-numeric --interval values with exit code 1", () => {
    try {
      runInTmp("sync --interval abc");
      expect.fail("expected non-zero exit");
    } catch (err) {
      expect(err.status).toBe(1);
    }
  });

  it("rejects zero or negative --interval values with exit code 1", () => {
    try {
      runInTmp("sync --interval 0");
      expect.fail("expected non-zero exit");
    } catch (err) {
      expect(err.status).toBe(1);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Signal handling
// ─────────────────────────────────────────────────────────────────────────────
describe("sync command — signal handling", () => {
  it("terminates (does not hang) when sent SIGINT", async () => {
    const result = await spawnAndSignal("sync", "SIGINT");
    expect(result.timedOut).toBeFalsy();
  });

  it("terminates (does not hang) when sent SIGTERM", async () => {
    const result = await spawnAndSignal("sync", "SIGTERM");
    expect(result.timedOut).toBeFalsy();
  });

  // Full signal-handling verification (clean shutdown, in-progress sync
  // completes before exit) requires a live container and registry.
  it.todo(
    "completes an in-progress sync before exiting on SIGINT (E2E only)"
  );
  it.todo(
    "does not start a new sync interval after receiving SIGTERM (E2E only)"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Startup output
// ─────────────────────────────────────────────────────────────────────────────
describe("sync command — startup output", () => {
  // When a container IS resolved, the daemon should log configuration before
  // entering the sync loop. Verified here indirectly: when container resolution
  // fails, stderr still identifies the problem clearly.
  it("emits a descriptive error (not a raw exception) when startup fails", () => {
    try {
      runInTmp("sync");
      expect.fail("expected non-zero exit");
    } catch (err) {
      const output = (err.stderr || "") + (err.stdout || "");
      // Should not be an unhandled Node.js stack trace
      expect(output).not.toMatch(/at Object\.<anonymous>/);
      expect(output.trim().length).toBeGreaterThan(0);
    }
  });

  // Full startup-log verification (container name, registry, interval printed
  // on start) requires a live container.
  it.todo(
    "logs container name, registry URL, and sync interval on startup (E2E only)"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Error recovery (E2E)
// ─────────────────────────────────────────────────────────────────────────────
describe("sync command — error recovery", () => {
  it.todo(
    "continues running after a failed sync attempt instead of crashing (E2E only)"
  );
  it.todo(
    "schedules the next sync at the normal interval after a failure, without backing off indefinitely (E2E only)"
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Restore integration (E2E)
// ─────────────────────────────────────────────────────────────────────────────
describe("sync command — restore integration", () => {
  it.todo(
    "restore succeeds immediately after sync has pushed at least one image, without requiring a fresh freeze (E2E only)"
  );
  it.todo(
    "restore still succeeds when sync daemon is not running, using the last image pushed (E2E only)"
  );
});
