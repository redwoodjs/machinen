import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

type ClaimProgressDetailRow = Record<string, unknown>;

type ClaimProgressTrack = {
  id: string;
  status: string;
  currentClaim: Record<string, unknown>;
  nextClaim: Record<string, unknown> | null;
  evidence: string[];
  refusals: string[];
  evidenceRows: ClaimProgressDetailRow[];
  refusalRows: ClaimProgressDetailRow[];
  nextSteps: ClaimProgressDetailRow[];
};

type ClaimProgressProofGroup = {
  id: string;
  claim: string;
  trackId: string;
  proofDirectory: string;
  proofs: ClaimProgressDetailRow[];
};

type ClaimProgressDashboard = {
  kind: "machinen.claim-progress-dashboard";
  version: 15;
  tracks: ClaimProgressTrack[];
  proofGroups: ClaimProgressProofGroup[];
};

describe("claim progress dashboard", () => {
  it("keeps the automatic dashboard JSON aligned with the dashboard HTML", () => {
    const dashboard = JSON.parse(
      readFileSync(resolve("docs/snapshot/claim-progress.json"), "utf8"),
    ) as ClaimProgressDashboard;
    const html = readFileSync(resolve("docs/snapshot/claim-progress.html"), "utf8");

    expect(dashboard).toMatchObject({
      kind: "machinen.claim-progress-dashboard",
      version: 15,
    });
    expect(dashboard.tracks.map((track) => track.id)).toEqual([
      "node-service",
      "postgres",
      "bun",
      "generic-linux-service",
      "arbitrary-process",
      "whole-linux-vm-workload",
    ]);
    expect(dashboard.tracks.find((track) => track.id === "node-service")).toMatchObject({
      status: "claimed",
      currentClaim: {
        productSupport: 100,
        broadSupport: 100,
        arbitraryProcessCrossArchRestore: 0,
      },
    });
    const arbitraryProcess = dashboard.tracks.find((track) => track.id === "arbitrary-process");
    expect(arbitraryProcess).toMatchObject({
      status: "seed-candidate",
      currentClaim: { arbitraryProcessCrossArchRestore: 0 },
      nextClaim: { arbitraryProcessCrossArchRestore: 1, claimChangeAllowed: true },
    });
    expect(arbitraryProcess?.evidenceRows.map((row) => row.id)).toContain(
      "native-ping-socket-resource",
    );
    expect(dashboard.tracks.every((track) => track.evidenceRows.length > 0)).toBe(true);
    expect(dashboard.tracks.every((track) => track.refusalRows.length > 0)).toBe(true);
    expect(dashboard.tracks.find((track) => track.id === "postgres")).toMatchObject({
      status: "claimed",
      currentClaim: {
        productSupport: 100,
        broadSupport: 100,
        arbitraryProcessCrossArchRestore: 0,
      },
      nextClaim: null,
    });
    expect(dashboard.proofGroups.map((group) => group.id)).toEqual([
      "node-service-100-100-0",
      "postgres-20-0-0",
      "postgres-clean-logical-20-claim-ready",
      "postgres-40-0-0",
      "postgres-60-0-0",
      "postgres-80-0-0",
      "postgres-100-0-0",
      "postgres-100-20-0",
      "postgres-100-40-0",
      "postgres-100-60-0",
      "postgres-100-80-0",
      "postgres-100-100-0",
      "bun-not-started",
      "generic-linux-service-not-started",
      "level4-ping-resource-continuation",
      "arbitrary-process-0-seed-1-locked",
      "whole-linux-vm-workload-not-started",
    ]);
    expect(dashboard.proofGroups.every((group) => group.proofDirectory)).toBe(true);
    const proofIds = dashboard.proofGroups.flatMap((group) =>
      group.proofs.map((proof) => proof.id),
    );
    expect(proofIds).toContain("regular-file-fd-proof");
    expect(proofIds).toContain("arbitrary-process-claim-ready-gate");
    expect(proofIds).toContain("simple-pipe-fd-proof");
    expect(proofIds).toContain("idle-epoll-tcp-proof");
    expect(proofIds).toContain("postgres-retained-verifier-artifacts");
    expect(proofIds).toContain("postgres-40-schema-shape-rows");
    expect(proofIds).toContain("postgres-100-product-contract");
    expect(proofIds).toContain("postgres-broad-100-product-contract");
    const embeddedJson =
      /<script id="embedded-claim-progress" type="application\/json">\n([\s\S]*?)\n    <\/script>/u.exec(
        html,
      )?.[1];
    expect(embeddedJson).toBeDefined();
    expect(JSON.parse(embeddedJson ?? "{}")).toEqual(dashboard);
    expect(html).toContain("claim-progress.json");
    expect(html).toContain("Proof impact matrix");
    expect(html).toContain("Product support impact (%)");
    expect(html).toContain("Broad service/workload impact (%)");
    expect(html).toContain("Arbitrary Linux process restore impact (%)");
    expect(html).toContain("What to do next");
    expect(html).toContain("derivedNextActionsForTrack");
    expect(html).toContain("bestNextClaimLift");
    expect(html).not.toContain(
      "Turn the existing clean logical track into a percent-style claim ladder with retained verifier artifacts.",
    );
    expect(html).toContain("Track overview");
    expect(html).toContain("Claim matrix");
    expect(html).toContain("Proofs by claim");
    expect(html).toContain("Proof directory");
    expect(html).toContain("grouped track details");
    expect(html).toContain("Evidence rows");
    expect(html).toContain("Refusal boundaries");
    expect(html).toContain("Next steps");
    expect(html).not.toContain("Load JSON file");
    expect(html).not.toContain("Refresh JSON");
  });
});
