import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(new URL("../../../../", import.meta.url).pathname);
const MATRIX = join(REPO_ROOT, "scripts/product-portable-claim-matrix.mjs");

describe("Goal 47 proof-vs-product claim matrix", () => {
  it("keeps proof-only claims separate from implemented product support", () => {
    const dir = mkdtempSync(join(tmpdir(), "product-claim-matrix-"));
    const summary = join(dir, "summary.json");
    const result = spawnSync("node", [MATRIX, "--summary", summary, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    const parsed = JSON.parse(readFileSync(summary, "utf8"));
    expect(parsed.passed).toBe(true);
    expect(parsed.implementedSubset).toBe("node-http-clean-root-v1");
    expect(parsed.totals.implementedProduct).toBe(8);
    expect(parsed.totals.proofOnly).toBeGreaterThan(0);
    expect(parsed.totals.explicitRefusal).toBeGreaterThan(0);
  });
});
