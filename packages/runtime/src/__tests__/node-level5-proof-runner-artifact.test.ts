import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

describe("Node Level 5 proof runner artifact", () => {
  it("emits a checked proof-only composition artifact with shortcut gates closed", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-proof-"));
    try {
      const out = join(dir, "proof.json");
      execFileSync(
        "pnpm",
        ["exec", "tsx", "scripts/node-level5-proof-composition.ts", "verify", "--out", out],
        {
          encoding: "utf8",
        },
      );
      const artifact = JSON.parse(readFileSync(out, "utf8"));
      expect(artifact).toMatchObject({
        kind: "machinen.node-level5-proof-composition",
        productSupport: "not-yet-supported",
        implementationLevel: "not-implemented",
        graduationTargetLevel: "level-5-cross-arch-process-continuation",
        proofRunner: "scripts/node-level5-proof-composition.ts",
        summary: { proofReady: true, missing: 0 },
        gates: {
          sourceIsaEmulationAllowed: false,
          sidecarRuntimeAllowed: false,
          metadataOnlyContinuationAllowed: false,
        },
      });
      expect(
        artifact.evidenceChecks.every((check: { status: string }) => check.status === "passed"),
      ).toBe(true);
      expect(artifact.refusalMatrix).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ unsafeNeighbor: "tls-rseq" }),
          expect.objectContaining({ unsafeNeighbor: "simd-fpu" }),
          expect.objectContaining({ unsafeNeighbor: "active-signals" }),
          expect.objectContaining({ unsafeNeighbor: "active-syscalls" }),
          expect.objectContaining({ unsafeNeighbor: "multithread" }),
          expect.objectContaining({ unsafeNeighbor: "native-addon-abi" }),
          expect.objectContaining({ unsafeNeighbor: "inspector-debug" }),
          expect.objectContaining({ unsafeNeighbor: "unsupported-v8-libuv-state" }),
        ]),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
