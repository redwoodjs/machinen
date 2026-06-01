import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runMatrix(args: string[] = []) {
  const outDir = mkdtempSync(join(tmpdir(), "machinen-level4-graduation-"));
  const out = join(outDir, "summary.json");
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "proofs/network-resources/scripts/level4-graduation-matrix.ts",
      "--out",
      out,
      ...args,
    ],
    { cwd: join(import.meta.dirname, "../../..", ".."), encoding: "utf8" },
  );
  return { result, out };
}

describe("Level 4/5 graduation matrix", () => {
  it("writes checked rows for every Goal 002 phase", () => {
    const { result, out } = runMatrix();
    expect(result.status).toBe(0);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    expect(summary.pass).toBe(true);
    expect(summary.rowCount).toBe(15);
    expect(summary.level4Inventory).toEqual(
      expect.arrayContaining([
        "sockets",
        "epoll",
        "eventfd",
        "timerfd",
        "signalfd",
        "pipes",
        "ptys",
        "credentials",
        "namespaces",
        "queues",
        "readiness",
        "partial-transfer-state",
      ]),
    );
    expect(summary.rows.map((row: { claimId: string }) => row.claimId)).toEqual(
      expect.arrayContaining([
        "ping-level4-socket-reconstruction",
        "ping-level4-socket-refusals",
        "pipe-level4-reconstruction",
        "eventfd-level4-reconstruction",
        "timerfd-level4-reconstruction",
        "tcp-listener-level4-reconstruction",
        "node-event-loop-level4-resource-map",
        "node-selected-level5-native-proof-composition",
      ]),
    );
    expect(summary.nativeGauntletAudit.nativeRows).toBeGreaterThanOrEqual(11);
  });

  it("keeps proof/refusal evidence separate from product support and actual level", () => {
    const { result, out } = runMatrix();
    expect(result.status).toBe(0);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    const rowsById = new Map(summary.rows.map((row: { claimId: string }) => [row.claimId, row]));

    for (const claimId of [
      "ping-level4-socket-reconstruction",
      "pipe-level4-reconstruction",
      "eventfd-level4-reconstruction",
      "timerfd-level4-reconstruction",
      "tcp-listener-level4-reconstruction",
      "node-event-loop-level4-resource-map",
      "node-selected-level5-native-proof-composition",
    ]) {
      const row = rowsById.get(claimId) as {
        productSupport: string;
        implementationLevel: string;
        graduationTargetLevel: string;
        migrationCompleted: boolean;
        targetNativeReconstruction: boolean;
        stateDecisions: string[];
        acceptedResourceKinds: string[];
      };
      expect(row.productSupport).toBe("not-yet-supported");
      expect(row.implementationLevel).toBe("not-implemented");
      expect(row.graduationTargetLevel).toMatch(/^level-[45]-/);
      expect(row.migrationCompleted).toBe(true);
      expect(row.targetNativeReconstruction).toBe(true);
      expect(row.stateDecisions).toContain("product-support-not-claimed");
      expect(row.acceptedResourceKinds.length).toBeGreaterThan(0);
    }

    expect(
      (rowsById.get("ping-level4-socket-reconstruction") as { stateDecisions: string[] })
        .stateDecisions,
    ).toContain("first-graduation-candidate-not-graduated");

    for (const claimId of [
      "ping-level4-socket-refusals",
      "pipe-level4-refusals",
      "eventfd-level4-refusals",
      "timerfd-level4-refusals",
      "tcp-listener-level4-refusals",
      "node-event-loop-level4-refusals",
      "node-selected-level5-refusals",
    ]) {
      const row = rowsById.get(claimId) as {
        productSupport: string;
        migrationCompleted: boolean;
        evidenceStatus: string;
      };
      expect(row.evidenceStatus).toBe("refusal");
      expect(row.productSupport).toBe("unsupported");
      expect(row.migrationCompleted).toBe(false);
    }
  });

  it("audits native/process Level 5 proof and refusal rows without product support", () => {
    const { result, out } = runMatrix();
    expect(result.status).toBe(0);
    const summary = JSON.parse(readFileSync(out, "utf8"));

    expect(summary.nativeGauntletAudit.proofRows).toEqual(
      expect.arrayContaining([
        "native-register-translation",
        "native-stack-return-chain-translation",
        "native-private-memory-materialization",
        "native-executable-target-module-materialization",
        "native-target-restore-loader",
      ]),
    );
    expect(summary.nativeGauntletAudit.refusalRows).toEqual(
      expect.arrayContaining([
        "native-tls-simd-fpu-policy",
        "native-signal-policy",
        "native-active-syscall-policy",
        "native-thread-policy",
        "native-mapping-refusals",
        "native-resource-refusals",
      ]),
    );
  });

  it("fails if a positive row claims a forbidden shortcut", () => {
    const { result } = runMatrix(["--inject-forbidden"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "uses source-ISA emulation, sidecar, metadata-only, or raw replay",
    );
  });
});
