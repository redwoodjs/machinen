import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/dwarf-symbol-extract.mjs");
const TMP: string[] = [];

interface DwarfSummary {
  skipped?: boolean;
  hostArch: string;
  bundleDir: string;
  dwarf: {
    layouts: {
      global: { fields: Array<{ name: string; offset: number; pointer: boolean }> };
      heap: { fields: Array<{ name: string; offset: number; pointer: boolean }> };
      node: { fields: Array<{ name: string; offset: number; pointer: boolean }> };
    };
    layoutMapping: {
      heap: { fields: Array<{ name: string; sourceOffset: number; targetOffset: number }> };
      node: { fields: Array<{ name: string; sourceOffset: number; targetOffset: number }> };
    };
    stackProbe: { variables: Array<{ name: string; location: string }> };
  };
  semanticState: {
    global: { label: string; counter: number; flags: number; generation: number };
    heap: {
      nodeCount: number;
      values: number[];
      tags: number[];
      colors: number[];
      nodes: Array<{ id: string; value: number; sourceAddress: string }>;
    };
  };
  restoreEvent: {
    fixture: string;
    arch: string;
    global: { label: string; counter: number; flags: number; generation: number };
    heap: { node_count: number; values: number[]; tags: number[]; colors: number[] };
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("DWARF metadata extraction", () => {
  it.skipIf(process.platform !== "linux")(
    "uses DWARF layouts to extract global and heap state",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "dwarf-symbol-extract-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as DwarfSummary;
      expect(summary.skipped).not.toBe(true);
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.semanticState.global).toMatchObject({
        label: "dwarf-global-layout-v2",
        counter: 7000,
        flags: 0x5a5a,
        generation: 7,
      });
      expect(summary.semanticState.heap).toMatchObject({
        nodeCount: 3,
        values: [111, 222, 333],
        tags: [101, 102, 103],
        colors: [3, 5, 7],
      });
      expect(summary.restoreEvent).toMatchObject({
        fixture: "dwarf-restore",
        global: {
          label: summary.semanticState.global.label,
          counter: summary.semanticState.global.counter,
          flags: summary.semanticState.global.flags,
          generation: summary.semanticState.global.generation,
        },
      });
      expect(summary.restoreEvent.heap.values).toEqual([111, 222, 333]);

      expect(
        summary.dwarf.layouts.heap.fields.find((field) => field.name === "head"),
      ).toMatchObject({
        pointer: true,
      });
      expect(
        summary.dwarf.layouts.node.fields.find((field) => field.name === "next"),
      ).toMatchObject({
        pointer: true,
      });
      expect(summary.dwarf.layoutMapping.node.fields.map((field) => field.name)).toEqual([
        "tag",
        "color",
        "value",
        "next",
      ]);
      expect(
        summary.dwarf.stackProbe.variables.some((variable) => variable.name === "live_local"),
      ).toBe(true);

      const bundle = validatePortableSnapshotBundle(summary.bundleDir);
      expect(bundle.manifest.features).toContain("dwarf-metadata-extraction");
      expect(bundle.objects.objects.map((object) => object.id)).toEqual([
        "controlled-dwarf-global-state",
        "controlled-dwarf-heap-state",
        "controlled-dwarf-node-0",
        "controlled-dwarf-node-1",
        "controlled-dwarf-node-2",
      ]);
      expect(bundle.relocations.relocations).toHaveLength(3);
    },
  );
});
