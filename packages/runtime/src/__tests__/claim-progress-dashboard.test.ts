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
  version: 59;
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
      version: 59,
    });
    expect(dashboard.tracks.map((track) => track.id)).toEqual([
      "node-service",
      "postgres",
      "bun",
      "generic-linux-service",
      "native-process-substrate",
      "arbitrary-process",
      "whole-linux-vm-workload",
    ]);
    expect(dashboard.tracks.find((track) => track.id === "node-service")).toMatchObject({
      status: "seed-candidate",
      currentClaim: {
        productSupport: 0,
        broadSupport: 0,
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
      status: "seed-candidate",
      currentClaim: {
        productSupport: 0,
        broadSupport: 0,
        arbitraryProcessCrossArchRestore: 0,
      },
      nextClaim: { productSupport: 20, broadSupport: 20, claimChangeAllowed: false },
    });
    expect(dashboard.proofGroups.map((group) => group.id)).toEqual([
      "node-service-100-100-0",
      "node-claim-evidence-index",
      "node-real-cross-arch-e2e-gate",
      "postgres-20-0-0",
      "postgres-real-cross-arch-e2e-gate",
      "bun-not-started",
      "generic-linux-service-not-started",
      "level4-ping-resource-continuation",
      "native-process-substrate-not-started",
      "arbitrary-process-0-seed-1-locked",
      "whole-linux-vm-workload-not-started",
    ]);
    expect(dashboard.proofGroups.every((group) => group.proofDirectory)).toBe(true);
    const proofIds = dashboard.proofGroups.flatMap((group) =>
      group.proofs.map((proof) => proof.id),
    );
    expect(proofIds).toContain("node-numbered-proof-corpus-index");
    expect(proofIds).toContain("node-row-coverage-manifest");
    expect(proofIds).toContain("node-e2e-artifact-audit");
    expect(proofIds).toContain("regular-file-fd-proof");
    expect(proofIds).toContain("arbitrary-process-claim-ready-gate");
    expect(proofIds).toContain("simple-pipe-fd-proof");
    expect(proofIds).toContain("idle-epoll-tcp-proof");
    expect(proofIds).toContain("postgres-retained-verifier-artifacts");
    expect(proofIds).toContain("postgres-e2e-amd64-to-arm64");
    expect(proofIds).toContain("postgres-e2e-arm64-to-amd64");
    const embeddedJson =
      /<script id="embedded-claim-progress" type="application\/json">\n([\s\S]*?)\n    <\/script>/u.exec(
        html,
      )?.[1];
    expect(embeddedJson).toBeDefined();
    expect(JSON.parse(embeddedJson ?? "{}")).toEqual(dashboard);
    expect(html).toContain("claim-progress.json");
    expect(html).toContain("Proof index");
    expect(html).not.toContain("Proof impact matrix");
    expect(html).not.toContain("Product support impact (%)");
    expect(html).toContain("Supported bundles");
    expect(html).toContain("56 / 136 covered");
    expect(html).toContain("missing 80");
    expect(html).toContain("missingSupportedRowsCount");
    expect(html).toContain("missingSupportedDirectionBundles");
    expect(html).toContain("nodejs/001");
    expect(html).toContain("nodejs/132");
    expect(html).not.toContain("nodejs/001m");
    expect(html).not.toContain("node/001m");
    expect(html).toContain(".missing");
    expect(html).toContain(".verified");
    expect(html).toContain("ID (proof #)");
    expect(html).toContain("Type");
    expect(html).toContain("Subcategory");
    expect(html).not.toContain("other types");
    expect(html).toContain("The table uses a small basic type set");
    expect(html).toContain(
      "End-to-end or workload smoke evidence with source/target behavior checks",
    );
    expect(html).toContain("command");
    expect(html).toContain("coverage");
    expect(html).toContain("claim");
    expect(html).toContain("boundary");
    expect(html).toContain("resource");
    expect(html).toContain("capability");
    expect(html).toContain("substrate");
    expect(html).toContain("product");
    expect(html).toContain("dependency install");
    expect(html).toContain("database smoke");
    expect(html).toContain("language process");
    expect(html).toContain("kernel feature");
    expect(html).toContain("virtualization");
    expect(html).toContain("row coverage");
    expect(html).toContain("e2e");
    expect(html).toContain("Proof name");
    expect(html).toContain("express-official-hello-world");
    expect(html).toContain("fastify-generic-vm-esm");
    expect(html).not.toContain("Broad service/workload impact (%)");
    expect(html).not.toContain("Arbitrary Linux process restore impact (%)");
    expect(html).not.toContain("What to do next");
    expect(html).not.toContain("next-actions");
    expect(html).toContain("derivedNextActionsForTrack");
    expect(html).not.toContain("bestNextClaimLift");
    expect(html).not.toContain("summary metrics");
    expect(html).not.toContain("Current public claim");
    expect(html).not.toContain("Best next claim lift");
    expect(html).not.toContain("Public claim still 0%");
    expect(html).not.toContain(
      "Turn the existing clean logical track into a percent-style claim ladder with retained verifier artifacts.",
    );
    expect(html.indexOf("Track overview")).toBeLessThan(html.indexOf("Proof index"));
    expect(html).toContain("Legend");
    expect(html).toContain("Plain-English labels for the claim columns");
    expect(html).toContain("Progression");
    expect(html).toContain("0 · not-started");
    expect(html).toContain("2 · partial-proof");
    expect(html).toContain("Candidate increase");
    expect(html).toContain("none: gate locked");
    expect(html).toContain("nodejs");
    expect(html).toContain("postgresql");
    expect(html).toContain("PostgreSQL portable restore");
    expect(html).toContain("psql query workload");
    expect(html).toContain("postgresql-psql-query-workload-e2e");
    expect(html).toContain("schema/data query");
    expect(html).toContain("postgresql-schema-data-query-e2e");
    expect(html).toContain("role/permission");
    expect(html).toContain("postgresql-role-permission-e2e");
    expect(html).toContain("unix command");
    expect(html).toContain("postgresql-unix-pg-isready-command");
    expect(html).toContain("postgresql-unix-psql-command");
    expect(html).toContain("postgresql-unix-createdb-dropdb-command");
    expect(html).toContain("ping");
    expect(html).toContain("arbitrary binaries");
    expect(html).toContain("bun-product-command-detection");
    expect(html).toContain("bun-http-service-e2e-arm64-to-amd64");
    expect(html).toContain("bun-http-service-e2e-amd64-to-arm64");
    expect(html).toContain("bun-dependency-install-e2e");
    expect(html).toContain("bun-unix-version-command");
    expect(html).toContain("bun-unix-run-command");
    expect(html).toContain("bun-unix-test-command");
    expect(html).toContain("bun-refusal-audit");
    expect(html).toContain("vm-sqlite-database-smoke");
    expect(html).toContain("vm-postgresql-database-smoke");
    expect(html).toContain("vm-simple-c-process-smoke");
    expect(html).toContain("vm-simple-java-process-smoke");
    expect(html).toContain("vm-ebpf-capability-smoke");
    expect(html).toContain("vm-seccomp-capability-smoke");
    expect(html).toContain("vm-nested-virtualization-smoke");
    expect(html).toContain("native substrate");
    expect(html).toContain("native-cpu-register-inventory");
    expect(html).toContain("native-memory-map-inventory");
    expect(html).toContain("native-writable-memory-materialization");
    expect(html).toContain("native-stack-reconstruction-seed");
    expect(html).toContain("native-page-protection-verifier");
    expect(html).toContain("native-dirty-memory-consistency");
    expect(html).toContain("native-futex-thread-refusal-proof");
    expect(html).toContain("native-jit-code-page-refusal-proof");
    expect(html).toContain("proof IDs are path-like");
    expect(html).not.toContain("Claim matrix");
    expect(html).not.toContain("Proofs by claim");
    expect(html).not.toContain("claim-matrix");
    expect(html).not.toContain("proof-groups");
    expect(html).not.toContain("Deep-dive track details");
    expect(html).not.toContain("grouped track details");
    expect(html).not.toContain("track-groups");
    expect(html).not.toContain("Load JSON file");
    expect(html).not.toContain("Refresh JSON");
  });
});
