import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function runPingGoal(args: string[] = []) {
  const outDir = mkdtempSync(join(tmpdir(), "machinen-level4-ping-goal-"));
  const out = join(outDir, "summary.json");
  const result = spawnSync(
    "pnpm",
    [
      "exec",
      "tsx",
      "proofs/network-resources/scripts/level4-ping-socket-graduation.ts",
      "--out",
      out,
      ...args,
    ],
    { cwd: join(import.meta.dirname, "../../..", ".."), encoding: "utf8" },
  );
  return { result, out };
}

describe("Goal 003 ping Level 4 socket graduation", () => {
  it("writes a checked proof/refusal summary without claiming product support", () => {
    const { result, out } = runPingGoal();
    expect(result.status).toBe(0);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    expect(summary.pass).toBe(true);
    expect(summary.rowCount).toBe(9);
    expect(summary.publicProductRouteRequired).toBe(true);

    const rowsById = new Map(summary.rows.map((row: { claimId: string }) => [row.claimId, row]));
    const boundary = rowsById.get("ping-level2-semantic-product-boundary") as {
      productSupport: string;
      implementationLevel: string;
      targetNativeReconstruction: boolean;
    };
    expect(boundary.productSupport).toBe("supported");
    expect(boundary.implementationLevel).toBe("level-2-semantic-continuation");
    expect(boundary.targetNativeReconstruction).toBe(false);

    const proof = rowsById.get("ping-level4-socket-reconstruction-proof") as {
      evidenceStatus: string;
      productSupport: string;
      implementationLevel: string;
      graduationTargetLevel: string;
      acceptedResourceKinds: string[];
      stateDecisions: string[];
      descriptor: { sockets: Array<Record<string, unknown>> };
    };
    expect(proof.evidenceStatus).toBe("proof");
    expect(proof.productSupport).toBe("not-yet-supported");
    expect(proof.implementationLevel).toBe("not-implemented");
    expect(proof.graduationTargetLevel).toBe("level-4-kernel-resource-reconstruction");
    expect(proof.acceptedResourceKinds).toEqual(
      expect.arrayContaining(["synthetic-ping-socket", "synthetic-raw-icmp"]),
    );
    expect(proof.stateDecisions).toContain("public-product-verbs-not-used");
    expect(proof.stateDecisions).toContain("product-support-not-claimed");
    expect(proof.descriptor.sockets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "ping-socket",
          family: "inet4",
          socketType: "dgram",
          protocol: "icmp",
          receiveQueue: "empty",
          inFlightPackets: "none",
          activeRecvmsg: false,
        }),
        expect.objectContaining({
          kind: "raw-icmp",
          socketType: "raw",
          protocol: "icmp",
          receiveQueue: "empty",
          inFlightPackets: "none",
          activeRecvmsg: false,
        }),
      ]),
    );
  });

  it("keeps all unsafe neighbors unsupported with migrationCompleted=false", () => {
    const { result, out } = runPingGoal();
    expect(result.status).toBe(0);
    const summary = JSON.parse(readFileSync(out, "utf8"));
    const refusals = summary.rows.filter(
      (row: { evidenceStatus: string }) => row.evidenceStatus === "refusal",
    );
    expect(refusals.map((row: { claimId: string }) => row.claimId)).toEqual(
      expect.arrayContaining([
        "ping-level4-unread-receive-queue-refusal",
        "ping-level4-in-flight-packets-refusal",
        "ping-level4-active-recvmsg-refusal",
        "ping-level4-ambiguous-route-namespace-refusal",
        "ping-level4-missing-credential-capability-refusal",
        "ping-level4-unsupported-raw-socket-options-refusal",
        "ping-level4-verifier-mismatch-refusal",
      ]),
    );
    for (const row of refusals as Array<{
      productSupport: string;
      implementationLevel: string;
      graduationTargetLevel: string;
      migrationCompleted: boolean;
      refusalCodes: string[];
    }>) {
      expect(row.productSupport).toBe("unsupported");
      expect(row.implementationLevel).toBe("level-0-fail-closed-discovery");
      expect(row.graduationTargetLevel).toBe("level-4-kernel-resource-reconstruction");
      expect(row.migrationCompleted).toBe(false);
      expect(row.refusalCodes.length).toBeGreaterThan(0);
    }
  });

  it("fails if the Level 4 proof row claims product support", () => {
    const { result } = runPingGoal(["--inject-product-support"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "proof row claims product support or an implementation level",
    );
  });

  it("fails if a forbidden shortcut is claimed", () => {
    const { result } = runPingGoal(["--inject-forbidden"]);
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "uses source-ISA emulation, sidecar output, metadata-only success, or raw checkpoint replay",
    );
  });
});
