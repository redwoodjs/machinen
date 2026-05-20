import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/sidecar-metadata-extract.mjs");
const TMP: string[] = [];

interface SidecarSummary {
  skipped?: boolean;
  hostArch: string;
  sidecarPath: string;
  strippedTargetHasDwarf: boolean;
  bundleDir: string;
  sidecar: {
    builds: Array<{
      arch: string;
      binaryStripped: boolean;
      symbolNames: string[];
      typeNames: string[];
      pointerFields: Array<{ field: string; offset: number }>;
      continuations: string[];
      resourceRefusals: Array<{ code: string }>;
    }>;
  };
  mismatchRefusal: {
    accepted: boolean;
    refusal: { code: string; message: string; detail: Record<string, string> };
  };
  semanticState: {
    global: { label: string; counter: number };
    heap: { nodeCount: number; values: number[]; tags: number[]; colors: number[] };
  };
  restoreEvent: {
    fixture: string;
    global: { label: string; counter: number };
    heap: { values: number[]; tags: number[]; colors: number[] };
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("sidecar metadata extraction", () => {
  it.skipIf(process.platform !== "linux")(
    "restores a stripped controlled binary using .machinen-meta.json",
    { timeout: 180_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "sidecar-metadata-extract-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 30 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as SidecarSummary;
      expect(summary.skipped).not.toBe(true);
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(existsSync(summary.sidecarPath)).toBe(true);
      expect(summary.strippedTargetHasDwarf).toBe(false);

      const build = summary.sidecar.builds.find((candidate) => candidate.arch === summary.hostArch);
      expect(build).toBeDefined();
      expect(build?.binaryStripped).toBe(true);
      expect(build?.symbolNames).toContain("machinen_controlled_dwarf_global_state");
      expect(build?.symbolNames).toContain("machinen_controlled_dwarf_heap_state");
      expect(build?.typeNames).toContain("struct ControlledDwarfNode");
      expect(build?.pointerFields.map((field) => field.field)).toEqual(["head", "next"]);
      expect(build?.continuations).toContain("controlled-dwarf-observation");
      expect(build?.resourceRefusals.map((rule) => rule.code)).toContain("fd-kind-unsupported");

      expect(summary.mismatchRefusal).toMatchObject({
        accepted: false,
        refusal: { code: "target-build-mismatch" },
      });
      expect(summary.semanticState.global).toMatchObject({
        label: "dwarf-global-layout-v2",
        counter: 7000,
      });
      expect(summary.semanticState.heap).toMatchObject({
        nodeCount: 3,
        values: [111, 222, 333],
        tags: [101, 102, 103],
        colors: [3, 5, 7],
      });
      expect(summary.restoreEvent).toMatchObject({
        fixture: "dwarf-restore",
        global: { label: "dwarf-global-layout-v2", counter: 7000 },
      });
      expect(summary.restoreEvent.heap.values).toEqual([111, 222, 333]);

      const bundle = validatePortableSnapshotBundle(summary.bundleDir);
      expect(bundle.manifest.features).toContain("sidecar-metadata-extraction");
      expect(bundle.objects.objects.map((object) => object.id)).toEqual([
        "controlled-sidecar-global-state",
        "controlled-sidecar-heap-state",
        "controlled-sidecar-node-0",
        "controlled-sidecar-node-1",
        "controlled-sidecar-node-2",
      ]);
      expect(bundle.relocations.relocations).toHaveLength(3);
    },
  );
});
