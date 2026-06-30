import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signalProcessNative } from "../native/process-signal.ts";

let helperTmp: string | undefined;
let previousHelper: string | undefined;

beforeAll(() => {
  helperTmp = mkdtempSync(join(tmpdir(), "machinen-runtime-helper-test-"));
  execFileSync("zig", ["build", "--prefix", helperTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousHelper = process.env.MACHINEN_RUNTIME_HELPER;
  process.env.MACHINEN_RUNTIME_HELPER = join(helperTmp, "bin", "machinen-runtime-helper");
});

afterAll(() => {
  if (previousHelper === undefined) {
    delete process.env.MACHINEN_RUNTIME_HELPER;
  } else {
    process.env.MACHINEN_RUNTIME_HELPER = previousHelper;
  }
  if (helperTmp) {
    rmSync(helperTmp, { recursive: true, force: true });
  }
});

describe("process-signal native lifecycle command", () => {
  it("reports an already-dead pid without throwing", () => {
    expect(signalProcessNative({ pid: 999_999_999, signal: "SIGKILL" })).toEqual({
      signaled: false,
      alive: false,
    });
  });

  it("signals a live process", async () => {
    const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
    try {
      expect(child.pid).toBeGreaterThan(0);
      const result = signalProcessNative({ pid: child.pid!, signal: "SIGKILL" });
      expect(result.signaled).toBe(true);
      await Promise.race([
        once(child, "exit"),
        new Promise((_, reject) => setTimeout(() => reject(new Error("child did not exit")), 5000)),
      ]);
    } finally {
      if (child.pid) {
        try {
          process.kill(child.pid, "SIGKILL");
        } catch {}
      }
    }
  });
});
