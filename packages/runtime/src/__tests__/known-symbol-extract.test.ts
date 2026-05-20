import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/known-symbol-extract.mjs");
const TMP: string[] = [];

interface KnownSymbolSummary {
  skipped?: boolean;
  hostArch: string;
  bundleDir: string;
  semanticState: {
    nodeCount: number;
    values: number[];
    nodes: Array<{ id: string; value: number; sourceAddress: string }>;
  };
  restoreEvent: {
    fixture: string;
    arch: string;
    node_count: number;
    values: number[];
  };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("known-symbol extraction", () => {
  it.skipIf(process.platform !== "linux")(
    "extracts a heap graph from raw memory and emits a portable bundle",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "known-symbol-extract-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as KnownSymbolSummary;
      expect(summary.skipped).not.toBe(true);
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.semanticState).toMatchObject({ nodeCount: 3, values: [11, 22, 33] });
      expect(summary.semanticState.nodes.map((node) => node.id)).toEqual([
        "controlled-node-0",
        "controlled-node-1",
        "controlled-node-2",
      ]);
      expect(summary.restoreEvent).toMatchObject({
        fixture: "known-symbol-restore",
        values: [11, 22, 33],
      });

      const bundle = validatePortableSnapshotBundle(summary.bundleDir);
      expect(bundle.manifest.features).toContain("known-symbol-extraction");
      expect(bundle.objects.objects.map((object) => object.id)).toEqual([
        "controlled-heap-state",
        "controlled-node-0",
        "controlled-node-1",
        "controlled-node-2",
      ]);
      expect(bundle.relocations.relocations).toHaveLength(3);
    },
  );
});
