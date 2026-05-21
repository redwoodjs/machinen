import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-mapping-materializer.ts");
const TMP: string[] = [];

interface NativeMappingMaterializerSummary {
  skipped?: boolean;
  reason?: string;
  planSteps?: Array<{
    mapping: string;
    action: string;
    sourceBytes?: unknown;
    targetFile?: unknown;
  }>;
  refusalCodes?: string[];
  materializerEvent?: {
    status: string;
    textPerms: string;
    dataPerms: string;
    heapPerms: string;
    stackPerms: string;
    recreatePerms: string;
    dataWord0: string;
    heapWord0: string;
  };
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native mapping materializer proof", () => {
  it(
    "applies target-file, copied-byte, recreated, and refused mapping plans",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-mapping-materializer-test-"));
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
      const summary = JSON.parse(result.stdout) as NativeMappingMaterializerSummary;
      if (summary.skipped) {
        expect(process.platform).not.toBe("linux");
        expect(summary.reason).toBeTruthy();
        return;
      }

      expect(summary.planSteps).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ mapping: "mapping:text", action: "map-target-file" }),
          expect.objectContaining({ mapping: "mapping:data", action: "copy-captured-bytes" }),
          expect.objectContaining({ mapping: "mapping:heap", action: "copy-captured-bytes" }),
          expect.objectContaining({ mapping: "mapping:stack", action: "recreate" }),
          expect.objectContaining({ mapping: "mapping:vdso", action: "recreate" }),
          expect.objectContaining({ mapping: "mapping:guard", action: "recreate" }),
          expect.objectContaining({ mapping: "mapping:unreadable", action: "refuse" }),
        ]),
      );
      expect(summary.refusalCodes).toContain("mapping-unreadable");
      expect(summary.materializerEvent).toMatchObject({
        status: "materialized",
        dataWord0: "0x444154414d41504e",
        heapWord0: "0x484541504d41504e",
      });
      expect(summary.materializerEvent?.textPerms).toMatch(/^r-x/);
      expect(summary.materializerEvent?.dataPerms).toMatch(/^rw-/);
      expect(summary.materializerEvent?.heapPerms).toMatch(/^rw-/);
      expect(summary.materializerEvent?.stackPerms).toMatch(/^rw-/);
      expect(summary.materializerEvent?.recreatePerms).toMatch(/^---/);
      expect(summary.execution).toBe(
        "native-mapping-plan-materialized-with-target-file-and-captured-bytes",
      );
    },
  );
});
