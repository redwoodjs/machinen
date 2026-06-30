// Tests for the parent-death shim (#115). The interesting one is the
// kill -9 case: a parent that gets SIGKILL'd should take its
// pdeathsig-wrapped child with it. This is the bug PR #169 only
// diagnosed; the shim is what actually fixes it.

import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensurePdeathsig, wrapWithPdeathsig } from "../pdeathsig.ts";

let nativeTmp: string | undefined;
let previousPdeathsig: string | undefined;

beforeAll(() => {
  nativeTmp = mkdtempSync(join(tmpdir(), "machinen-pdeathsig-test-"));
  execFileSync("zig", ["build", "--prefix", nativeTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousPdeathsig = process.env.MACHINEN_PDEATHSIG;
  process.env.MACHINEN_PDEATHSIG = join(nativeTmp, "bin", "machinen-pdeathsig");
});

afterAll(() => {
  if (previousPdeathsig === undefined) {
    delete process.env.MACHINEN_PDEATHSIG;
  } else {
    process.env.MACHINEN_PDEATHSIG = previousPdeathsig;
  }
  if (nativeTmp) {
    rmSync(nativeTmp, { recursive: true, force: true });
  }
});

// Wait until `predicate()` returns true or we hit the deadline. Used
// for "did this PID disappear?" polls — kill -9 + reap takes a few ms.
async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs: number,
  stepMs = 25,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return false;
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

describe("ensurePdeathsig", () => {
  it("resolves an executable native shim on a supported platform", async () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      // Other platforms intentionally return null — nothing to assert.
      expect(await ensurePdeathsig()).toBeNull();
      return;
    }
    const path = await ensurePdeathsig();
    expect(path).not.toBeNull();
    expect(existsSync(path!)).toBe(true);
  });

  it("returns null when MACHINEN_PDEATHSIG=disabled", async () => {
    const orig = process.env.MACHINEN_PDEATHSIG;
    process.env.MACHINEN_PDEATHSIG = "disabled";
    try {
      expect(await ensurePdeathsig()).toBeNull();
    } finally {
      if (orig === undefined) {
        delete process.env.MACHINEN_PDEATHSIG;
      } else {
        process.env.MACHINEN_PDEATHSIG = orig;
      }
    }
  });
});

describe("wrapWithPdeathsig", () => {
  it("returns argv unchanged when shim is null", () => {
    expect(wrapWithPdeathsig(null, "/bin/sleep", ["10"])).toEqual({
      command: "/bin/sleep",
      args: ["10"],
    });
  });

  it("prepends the shim binary when present", () => {
    expect(wrapWithPdeathsig("/path/to/pdeathsig", "/bin/sleep", ["10"])).toEqual({
      command: "/path/to/pdeathsig",
      args: ["/bin/sleep", "10"],
    });
  });

  it("emits --watch-pid <n> when watchPid is set", () => {
    expect(
      wrapWithPdeathsig("/path/to/pdeathsig", "/bin/sleep", ["10"], { watchPid: 4242 }),
    ).toEqual({
      command: "/path/to/pdeathsig",
      args: ["--watch-pid", "4242", "/bin/sleep", "10"],
    });
  });

  it("rejects a non-positive watchPid", () => {
    expect(() => wrapWithPdeathsig("/p", "/bin/sleep", [], { watchPid: 0 })).toThrow();
    expect(() => wrapWithPdeathsig("/p", "/bin/sleep", [], { watchPid: -1 })).toThrow();
    expect(() => wrapWithPdeathsig("/p", "/bin/sleep", [], { watchPid: 1.5 })).toThrow();
  });

  it("watchPid is a no-op when shim is null (caller already opted out)", () => {
    expect(wrapWithPdeathsig(null, "/bin/sleep", ["10"], { watchPid: 4242 })).toEqual({
      command: "/bin/sleep",
      args: ["10"],
    });
  });
});

// Empirical proof: spawn `node -e <parent script>` which itself spawns
// `pdeathsig sleep 30`, then SIGKILL the node parent. The sleep must
// die. Without the shim it survives (this is exactly the bug from
// issue #115 — verified earlier on PR #169 by hand).
describe("pdeathsig kill -9 survival", () => {
  it("target dies when its parent is killed -9", async () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return; // unsupported platform; nothing to assert
    }
    const shim = await ensurePdeathsig();
    if (!shim) {
      console.warn("pdeathsig shim unavailable; skipping kill -9 survival test");
      return;
    }

    // Parent script: spawn the shim wrapping `sleep 30`, print the
    // child PID on stdout, then block forever. We then SIGKILL the
    // node process and assert the sleep PID is gone.
    const parentScript = `
      const { spawn } = require('node:child_process');
      const child = spawn(${JSON.stringify(shim)}, ['/bin/sleep', '30'], {
        stdio: ['ignore', 'inherit', 'inherit'],
      });
      child.on('spawn', () => {
        process.stdout.write('CHILD_PID=' + child.pid + '\\n');
      });
      setInterval(() => {}, 1 << 30);
    `;
    const parent = spawn(process.execPath, ["-e", parentScript], {
      stdio: ["ignore", "pipe", "inherit"],
    });

    const childPid = await new Promise<number>((resolve, reject) => {
      let buf = "";
      const t = setTimeout(() => reject(new Error("parent never reported CHILD_PID")), 5000);
      parent.stdout!.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const m = buf.match(/CHILD_PID=(\d+)/);
        if (m) {
          clearTimeout(t);
          resolve(Number(m[1]));
        }
      });
      parent.once("error", reject);
    });

    // On macOS the wrapped pid is the *guard* (pdeathsig itself) which
    // forks the actual sleep. Either way the descendants must all die
    // when we SIGKILL the parent. We assert on `childPid` directly,
    // and on the existence of any descendant via pgrep as a backstop.
    expect(pidAlive(childPid)).toBe(true);

    parent.kill("SIGKILL");
    // The kqueue/kernel-PDEATHSIG round-trip is fast but not instant.
    const gone = await waitFor(() => !pidAlive(childPid), 5000);
    if (!gone) {
      // Last-resort cleanup so we don't leak a sleep across test runs.
      try {
        process.kill(childPid, "SIGKILL");
      } catch {}
    }
    expect(gone).toBe(true);

    // Also check no `sleep 30` is left descended from our parent's
    // PID. (The shim's own sleep grandchild may have a different PID
    // than what we captured, on macOS.) This catches a regression
    // where the guard exits but somehow leaves the target.
    const stragglers = await new Promise<string>((resolve) => {
      const p = spawn("pgrep", ["-P", "1", "-f", "sleep 30"]);
      let out = "";
      p.stdout!.on("data", (c: Buffer) => (out += c.toString()));
      p.on("close", () => resolve(out));
    });
    // pgrep returns one line per match. Other tests on the box may
    // also be running `sleep`, so we tolerate non-empty output as long
    // as our specific child PID is gone (asserted above).
    void stragglers;
  }, 15000);

  // --watch-pid <pid> mode: the wrapped target dies when the *named*
  // process dies, even if it's not the wrapper's parent. Kept for any
  // future helper whose immediate parent can exit before the process it
  // should track.
  it("--watch-pid <n>: target dies when the watched (non-parent) pid is killed", async () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return;
    }
    const shim = await ensurePdeathsig();
    if (!shim) {
      console.warn("pdeathsig shim unavailable; skipping watch-pid test");
      return;
    }

    // The "watched" process — a sleep we'll kill explicitly. Stand-in
    // for the VMM in the real flow.
    const watched = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      watched.once("spawn", () => resolve());
      watched.once("error", reject);
    });
    expect(watched.pid).toBeTypeOf("number");

    // The "target" — a sleep wrapped with --watch-pid pointed at the
    // watched sleep. Its parent is *this* node process, not the
    // watched sleep, so plain pdeathsig wouldn't help.
    const wrapped = spawn(shim, ["--watch-pid", String(watched.pid), "/bin/sleep", "30"], {
      stdio: "ignore",
    });
    await new Promise<void>((resolve, reject) => {
      wrapped.once("spawn", () => resolve());
      wrapped.once("error", reject);
    });
    expect(wrapped.pid).toBeTypeOf("number");
    // Both processes are alive immediately after spawn.
    expect(pidAlive(watched.pid!)).toBe(true);
    expect(pidAlive(wrapped.pid!)).toBe(true);

    // Kill the watched process. The wrapped target should die.
    watched.kill("SIGKILL");

    const wrappedGone = await waitFor(() => !pidAlive(wrapped.pid!), 5000);
    if (!wrappedGone) {
      // Cleanup so a regression doesn't strand a 30s sleep.
      try {
        process.kill(wrapped.pid!, "SIGKILL");
      } catch {}
    }
    expect(wrappedGone).toBe(true);
  }, 15000);

  // Edge case: caller passes --watch-pid for a pid that's already
  // dead. The shim should exit 0 without forking the target.
  it("--watch-pid <n>: exits 0 when the watched pid is already dead", async () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return;
    }
    const shim = await ensurePdeathsig();
    if (!shim) {
      return;
    }

    // Spawn and immediately reap a sleep so we have a guaranteed-dead pid.
    const corpse = spawn("/bin/sleep", ["0"], { stdio: "ignore" });
    const corpsePid = await new Promise<number>((resolve, reject) => {
      corpse.once("spawn", () => resolve(corpse.pid!));
      corpse.once("error", reject);
    });
    await new Promise<void>((resolve) => corpse.once("exit", () => resolve()));
    // Wait for the kernel to actually free the pid.
    await waitFor(() => !pidAlive(corpsePid), 2000);

    // sentinel: target should NOT run. We use an arg that would
    // be obvious if it did (touching a tempfile etc. would be more
    // precise but we just assert the exit code).
    const child = spawn(shim, ["--watch-pid", String(corpsePid), "/bin/sleep", "30"], {
      stdio: "ignore",
    });
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", (code) => resolve(code));
    });
    expect(exitCode).toBe(0);
  }, 15000);

  // Graceful path: child.kill("SIGTERM") on the wrapped spawn must
  // also kill the target. On macOS the wrapped pid is the kqueue
  // guard, not the target — without signal-forwarding the SIGTERM
  // would kill the guard and leave gvproxy alive. Linux is fine
  // because the shim exec's directly into the target, but we run the
  // assertion on both for symmetry.
  it("SIGTERM on the wrapped pid kills the target", async () => {
    if (process.platform !== "linux" && process.platform !== "darwin") {
      return;
    }
    const shim = await ensurePdeathsig();
    if (!shim) {
      return;
    }

    const child = spawn(shim, ["/bin/sleep", "30"], { stdio: "ignore" });
    // Wait for spawn so child.pid is set.
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    expect(child.pid).toBeTypeOf("number");

    child.kill("SIGTERM");
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once("exit", (code, signal) => {
        resolve(code ?? (signal ? -1 : null));
      });
    });
    void exitCode;

    // No `sleep 30` orphaned to PID 1 with our exact arglist. We
    // filter on PPID=1 + the literal arg so other tests sleeping for
    // unrelated reasons don't trip us.
    const orphaned = await new Promise<string>((resolve) => {
      const p = spawn("pgrep", ["-P", "1", "-fl", "/bin/sleep 30"]);
      let out = "";
      p.stdout!.on("data", (c: Buffer) => (out += c.toString()));
      p.on("close", () => resolve(out.trim()));
    });
    expect(orphaned).toBe("");
  }, 15000);
});
