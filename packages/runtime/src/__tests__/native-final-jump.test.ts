import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-final-jump.ts");
const TMP: string[] = [];

interface NativeFinalJumpSummary {
  skipped?: boolean;
  reason?: string;
  bundleDir: string;
  codeLocations: number;
  registerThreads: number;
  stackRelocations: number;
  memoryRelocations: number;
  translatedEntry: string;
  translatedArgument: string;
  execution: string;
  resumeEvent: {
    status: string;
    targetArch: string;
    entry: string;
    argument: string;
    returnValue: string;
    storedMarker: string;
    observedRsp: string;
    usedTargetStack: boolean;
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native final jump", () => {
  it(
    "jumps into translated target-native amd64 code when the host can execute it",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-final-jump-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeFinalJumpSummary;
      if (summary.skipped) {
        expect(process.platform === "linux" && process.arch === "x64").toBe(false);
        expect(summary.reason).toContain("Linux/amd64");
        return;
      }

      expect(summary.codeLocations).toBe(1);
      expect(summary.registerThreads).toBe(1);
      expect(summary.stackRelocations).toBe(2);
      expect(summary.memoryRelocations).toBe(1);
      expect(summary.translatedEntry).toBe("0x14000080");
      expect(summary.translatedArgument).toBe("0x15000000");
      expect(summary.execution).toBe("jumped-target-native-amd64-code");
      expect(summary.resumeEvent).toMatchObject({
        status: "jumped",
        targetArch: "amd64",
        entry: "0x14000080",
        argument: "0x15000000",
        returnValue: "0x4d",
        storedMarker: "0x4e454e494843414d",
        usedTargetStack: true,
      });

      const bundle = validateNativeProcessImageBundle(join(outDir, "bundle"));
      expect(bundle.manifest.target.arch).toBe("amd64");
      expect(bundle.translation.threads[0]?.targetRegisters).toMatchObject({
        arch: "amd64",
        rip: "0x14000080",
        rdi: "0x15000000",
      });
    },
  );
});
