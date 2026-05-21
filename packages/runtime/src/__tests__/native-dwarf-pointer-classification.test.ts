import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-dwarf-pointer-classification.ts");
const TMP: string[] = [];

interface NativeDwarfPointerClassificationSummary {
  skipped?: boolean;
  reason?: string;
  phase?: string;
  hostArch?: string;
  pointerFields?: string[];
  scalarFields?: string[];
  scalarLookalikes?: string[];
  scalarLookalikesPreserved?: boolean;
  execution?: string;
  memoryRelocations?: number;
  preservedWords?: number;
  resumeEvent?: {
    status: string;
    returnedToTranslatedAddress: boolean;
    graphChecksum: string;
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native DWARF pointer classification", () => {
  it.skipIf(process.platform !== "linux")(
    "classifies pointer fields from debug metadata or skips honestly",
    { timeout: 180_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-dwarf-pointer-classification-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeDwarfPointerClassificationSummary;
      if (summary.skipped) {
        expect(summary.reason).toMatch(/arm64 source bundle|unsupported host architecture/);
        return;
      }

      if (summary.phase === "capture-source") {
        expect(summary.hostArch).toBe("arm64");
        expect(summary.pointerFields).toContain("NativeDebugPointerRoot.head");
        expect(summary.pointerFields).toContain("NativeDebugPointerNode.next");
        expect(summary.scalarFields).toContain("NativeDebugPointerRoot.scalar_lookalike");
        expect(summary.scalarLookalikes).toHaveLength(2);
        expect(summary.execution).toBe(
          "captured-arm64-source-pointers-classified-from-dwarf-metadata",
        );
        return;
      }

      expect(summary).toMatchObject({
        phase: "dwarf-pointer-final-jump",
        hostArch: "amd64",
        scalarLookalikesPreserved: true,
        execution: "captured-arm64-debug-metadata-pointers-walked-after-native-amd64-ret",
      });
      expect(summary.pointerFields).toContain("NativeDebugPointerRoot.head");
      expect(summary.memoryRelocations).toBeGreaterThanOrEqual(3);
      expect(summary.preservedWords).toBeGreaterThanOrEqual(4);
      expect(summary.resumeEvent).toMatchObject({
        status: "jumped",
        returnedToTranslatedAddress: true,
        graphChecksum: "0x8e",
      });
    },
  );
});
