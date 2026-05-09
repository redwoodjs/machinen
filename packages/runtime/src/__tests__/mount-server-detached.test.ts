// Tests for spawnDetachedMountServer (#150 phase 3). The interesting
// invariants:
//
//   1. The spawned helper actually serves FUSE traffic (we don't need
//      a kernel — a raw client socket can speak the protocol).
//   2. The helper dies when the VMM pid we passed via --watch-pid
//      dies, even though its actual parent (this test process) is
//      still running. This is the whole reason the helper exists.
//   3. handle.bytesServedOnPagesImg() reads back what the helper
//      wrote to its stats file.
//   4. handle.stop() SIGTERMs the helper and cleans up the UDS +
//      stats file.

import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnDetachedMountServer } from "../mount-server-detached.ts";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "msd-"));
});

afterEach(() => {
  try {
    rmSync(tmp, { recursive: true, force: true });
  } catch {}
});

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

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

describe("spawnDetachedMountServer", () => {
  it("rejects an invalid vmmPid", async () => {
    await expect(
      spawnDetachedMountServer({
        udsPath: join(tmp, "x.sock"),
        rootAbs: tmp,
        mode: "ro",
        vmmPid: 0,
        statsPath: join(tmp, "stats.json"),
      }),
    ).rejects.toThrow(/invalid vmmPid/);
  });

  it("starts a helper that binds the UDS and writes an initial stats file", async () => {
    const root = join(tmp, "root");
    writeFileSync(join(tmp, "marker"), "hello");
    // The "VMM" — a long-running process the helper will watch.
    const fakeVmm = nodeSpawn("/bin/sleep", ["30"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      fakeVmm.once("spawn", () => resolve());
      fakeVmm.once("error", reject);
    });

    let handle: Awaited<ReturnType<typeof spawnDetachedMountServer>> | null = null;
    try {
      handle = await spawnDetachedMountServer({
        udsPath: join(tmp, "live.sock"),
        rootAbs: root,
        mode: "rw",
        vmmPid: fakeVmm.pid!,
        statsPath: join(tmp, "stats.json"),
      });

      expect(existsSync(join(tmp, "live.sock"))).toBe(true);
      expect(existsSync(join(tmp, "stats.json"))).toBe(true);
      expect(handle.bytesServedOnPagesImg()).toBe(0);
      expect(handle.pid).toBeGreaterThan(0);
      expect(typeof handle.exe).toBe("string");
      expect(pidAlive(handle.pid)).toBe(true);
    } finally {
      try {
        await handle?.stop();
      } catch {}
      try {
        fakeVmm.kill("SIGKILL");
      } catch {}
    }
  }, 15000);

  it("helper dies when the watched VMM pid dies", async () => {
    const fakeVmm = nodeSpawn("/bin/sleep", ["30"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      fakeVmm.once("spawn", () => resolve());
      fakeVmm.once("error", reject);
    });

    const handle = await spawnDetachedMountServer({
      udsPath: join(tmp, "live.sock"),
      rootAbs: tmp,
      mode: "ro",
      vmmPid: fakeVmm.pid!,
      statsPath: join(tmp, "stats.json"),
    });
    expect(pidAlive(handle.pid)).toBe(true);

    // Kill the watched VMM. The pdeathsig --watch-pid shim should
    // SIGTERM the helper, which exits cleanly.
    fakeVmm.kill("SIGKILL");

    const gone = await waitFor(() => !pidAlive(handle.pid), 7000);
    if (!gone) {
      try {
        process.kill(handle.pid, "SIGKILL");
      } catch {}
    }
    expect(gone).toBe(true);
  }, 15000);

  it("handle.stop() SIGTERMs the helper and removes the UDS + stats file", async () => {
    const fakeVmm = nodeSpawn("/bin/sleep", ["30"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      fakeVmm.once("spawn", () => resolve());
      fakeVmm.once("error", reject);
    });

    const handle = await spawnDetachedMountServer({
      udsPath: join(tmp, "live.sock"),
      rootAbs: tmp,
      mode: "ro",
      vmmPid: fakeVmm.pid!,
      statsPath: join(tmp, "stats.json"),
    });
    expect(existsSync(join(tmp, "live.sock"))).toBe(true);

    await handle.stop();

    expect(pidAlive(handle.pid)).toBe(false);
    expect(existsSync(join(tmp, "live.sock"))).toBe(false);
    expect(existsSync(join(tmp, "stats.json"))).toBe(false);

    fakeVmm.kill("SIGKILL");
  }, 15000);

  it("stop() is idempotent", async () => {
    const fakeVmm = nodeSpawn("/bin/sleep", ["30"], { stdio: "ignore" });
    await new Promise<void>((resolve, reject) => {
      fakeVmm.once("spawn", () => resolve());
      fakeVmm.once("error", reject);
    });

    const handle = await spawnDetachedMountServer({
      udsPath: join(tmp, "live.sock"),
      rootAbs: tmp,
      mode: "ro",
      vmmPid: fakeVmm.pid!,
      statsPath: join(tmp, "stats.json"),
    });
    await handle.stop();
    await expect(handle.stop()).resolves.toBeUndefined();

    fakeVmm.kill("SIGKILL");
  }, 15000);
});
