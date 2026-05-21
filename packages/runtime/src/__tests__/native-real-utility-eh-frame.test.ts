import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility-eh-frame.ts");
const TMP: string[] = [];

interface NativeRealUtilityEhFrameSummary {
  skipped?: boolean;
  reason?: string;
  hostArch?: string;
  targetArch?: string;
  sourceBundleDir?: string;
  strippedDebugInfo?: boolean;
  capturedSourcePc?: string;
  rule?: { metadata: string; cfa: { register: string }; returnAddress: { location: string } };
  discoveredFrame?: { metadata: string; returnAddressSlot?: string; returnAddress: string };
  returnAddressSlot?: string;
  returnAddress?: string;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility .eh_frame proof", () => {
  it(
    "discovers an arm64 source frame from stripped .eh_frame metadata",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-eh-frame-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        {
          encoding: "utf8",
          cwd: REPO_ROOT,
          env: process.env,
          maxBuffer: 20 * 1024 * 1024,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeRealUtilityEhFrameSummary;
      if (summary.skipped) {
        expect(process.platform !== "linux" || process.arch !== "arm64").toBe(true);
        expect(summary.reason).toBeTruthy();
        return;
      }

      expect(summary.hostArch).toBe("arm64");
      expect(summary.targetArch).toBe("amd64");
      expect(summary.strippedDebugInfo).toBe(true);
      expect(summary.capturedSourcePc).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.rule).toMatchObject({
        metadata: "eh-frame",
        cfa: { register: "x29" },
        returnAddress: { location: "cfa-relative" },
      });
      expect(summary.discoveredFrame).toMatchObject({ metadata: "eh-frame" });
      expect(summary.returnAddressSlot).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.returnAddress).toMatch(/^0x[0-9a-f]+$/);
      expect(summary.execution).toBe("captured-arm64-source-frame-discovered-from-real-eh-frame");
      validateNativeProcessImageBundle(summary.sourceBundleDir!);
    },
  );
});
