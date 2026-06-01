import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  createNodeLevel5FrameworkIntrospectionCorpusReport,
  evaluateNodeLevel5FrameworkCapabilityReadiness,
  writeNodeLevel5FrameworkProductEvidenceReport,
  type NodeLevel5FrameworkIntrospectionCorpusRow,
} from "@machinen/runtime";
import { describe, expect, it } from "vitest";

const CLI = resolve("packages/cli/src/cli.ts");

function runCli(args: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-cli-test-"));
  const stdoutPath = join(dir, "stdout.txt");
  const fd = openSync(stdoutPath, "w");
  try {
    const result = spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
      encoding: "utf8",
      stdio: ["ignore", fd, "pipe"],
    });
    closeSync(fd);
    return { ...result, stdout: readFileSync(stdoutPath, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Node Level 5 product commands", () => {
  it("writes and verifies a Node 80 artifact bundle", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-cli-"));
    try {
      const write = runCli([
        "node-level5",
        "artifacts",
        "write",
        "--out",
        dir,
        "--family",
        "express-fastify-http-app",
        "--direction",
        "arm64-to-amd64",
        "--json",
      ]);
      expect(write.status).toBe(0);
      const written = JSON.parse(write.stdout);
      expect(written.bundle.familyId).toBe("express-fastify-http-app");

      const verify = runCli([
        "node-level5",
        "artifacts",
        "verify",
        "--root",
        written.bundle.artifactRoot,
        "--family",
        "express-fastify-http-app",
        "--direction",
        "arm64-to-amd64",
        "--json",
      ]);
      expect(verify.status).toBe(0);
      expect(JSON.parse(verify.stdout)).toMatchObject({
        accepted: true,
        targetNativeNodeVerified: true,
        rawCpuRestoreUsed: false,
        sourceIsaEmulationUsed: false,
        artifactHashesVerified: true,
        retentionComplete: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses retained artifact evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-cli-retained-"));
    try {
      const write = runCli([
        "node-level5",
        "artifacts",
        "write",
        "--out",
        dir,
        "--family",
        "express-fastify-http-app",
        "--direction",
        "arm64-to-amd64",
        "--json",
      ]);
      const artifactRoot = JSON.parse(write.stdout).bundle.artifactRoot;
      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--root",
        artifactRoot,
        "--family",
        "express-fastify-http-app",
        "--direction",
        "arm64-to-amd64",
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        retainedArtifact: { accepted: true, artifactHashesVerified: true },
      });

      const targetLog = join(artifactRoot, "target.log");
      writeFileSync(targetLog, `${readFileSync(targetLog, "utf8")}\n`);
      const tampered = runCli([
        "node-level5",
        "artifacts",
        "verify",
        "--root",
        artifactRoot,
        "--family",
        "express-fastify-http-app",
        "--direction",
        "arm64-to-amd64",
        "--json",
      ]);
      expect(tampered.status).toBe(1);
      expect(JSON.parse(tampered.stdout).message).toContain("hash mismatch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses retained real-app corpus evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-cli-corpus-"));
    try {
      const rows = [
        {
          framework: "express",
          direction: "arm64-to-amd64",
          routePath: "/express/health",
          expectedStatus: 200,
          actualStatus: 200,
          expectedBody: "express-ok",
          actualBody: "express-ok",
          expectedHeaders: { "x-machinen-fixture": "express" },
          actualHeaders: { "x-machinen-fixture": "express" },
          snapshotAccepted: true,
          restoreAccepted: true,
          behavioralVerifierPassed: true,
          targetNativeNodeVerified: true,
        },
      ];
      const report = {
        kind: "machinen.node-level5-real-app-corpus-report",
        version: 1,
        accepted: true,
        rowCount: rows.length,
        rowsSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        rows,
        harnessProof: true,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-real-app-corpus-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-real-app-corpus",
        "--corpus-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        realAppCorpus: { accepted: true, rowCount: 1, rowsSha256Verified: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses retained generic VM corpus evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-cli-generic-vm-corpus-"));
    try {
      const rows = [
        {
          kind: "positive",
          id: "express-cjs-arm64-to-amd64",
          framework: "express",
          moduleSystem: "cjs",
          direction: "arm64-to-amd64",
          productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
          wholeVmSnapshot: true,
          nodeDetectedInsideVm: true,
          hostPidProductTargetingUsed: false,
          nodeOnlyProductSelectorUsed: false,
          snapshotAccepted: true,
          restoreAccepted: true,
          behaviorVerified: true,
          targetNativeNodeVerified: true,
          rawCpuRestoreUsed: false,
          sourceIsaEmulationUsed: false,
          metadataOnlySuccessAccepted: false,
        },
        {
          kind: "refusal",
          id: "express-worker-refusal-arm64-to-amd64",
          framework: "express",
          marker: "workerThreads",
          direction: "arm64-to-amd64",
          productCommandPath: "machinen snapshot <vm-name> --out <dir>",
          expectedRefusalCode: "node-level5-worker-thread-refused",
          actualRefusalCode: "node-level5-worker-thread-refused",
          snapshotAccepted: false,
          restoreAttempted: false,
          refusedBeforeSnapshot: true,
          rawCpuRestoreUsed: false,
          sourceIsaEmulationUsed: false,
          metadataOnlySuccessAccepted: false,
        },
      ];
      const report = {
        kind: "machinen.node-level5-generic-vm-corpus-report",
        version: 1,
        accepted: true,
        rowCount: rows.length,
        positiveRowCount: 1,
        refusalRowCount: 1,
        rowsSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        rows,
        claimChangeAllowed: false,
        candidateNodeProductSupportClaimed: 85,
        candidateBroadNodeProductSupportClaimed: 25,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-generic-vm-corpus-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-generic-vm-corpus",
        "--generic-vm-corpus-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        genericVmCorpus: { accepted: true, rowCount: 2, rowsSha256Verified: true },
      });

      const readiness = runCli([
        "node-level5",
        "85-readiness",
        "--generic-vm-corpus-report",
        reportPath,
        "--json",
      ]);
      expect(readiness.status).toBe(1);
      expect(JSON.parse(readiness.stdout)).toMatchObject({
        accepted: false,
        candidateEvidenceAccepted: false,
        claimChangeAllowed: false,
        candidateNodeProductSupportClaimed: 85,
        currentNodeProductSupportClaimed: 80,
        blockedGates: expect.arrayContaining([
          expect.objectContaining({ id: "generic-vm-positive-row-count" }),
          expect.objectContaining({ id: "generic-vm-refusal-row-count" }),
          expect.objectContaining({ id: "claim-change-unlocked" }),
        ]),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses generic VM retained evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node85-cli-retained-evidence-"));
    try {
      const retainedFiles = [
        "snapshot.json",
        "restore.log",
        "snap/portable-node.json",
        "snap/portable-node-app.tar.gz",
        "snap/portable-clean-service.json",
        "snap/clean-service-node-primary.tar.gz",
      ].map((path) => ({
        path,
        sha256: createHash("sha256").update(path).digest("hex"),
        required: true,
      }));
      const report = {
        kind: "machinen.node-level5-generic-vm-retained-evidence-report",
        version: 1,
        accepted: true,
        productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
        vmDetectedNodeWorkload: true,
        restoreProbePassed: true,
        retainedFiles,
        retainedFileCount: retainedFiles.length,
        retainedFilesSha256: createHash("sha256")
          .update(JSON.stringify(retainedFiles))
          .digest("hex"),
        claimChangeAllowed: false,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-generic-vm-retained-evidence-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-generic-vm-retained-evidence",
        "--generic-vm-retained-evidence-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        genericVmRetainedEvidence: { accepted: true, retainedFileCount: 6 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses generic VM row artifacts for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node85-cli-row-artifacts-"));
    try {
      const rowArtifactFiles = Array.from({ length: 28 }, (_, index) => {
        const rowKind = index < 8 ? "positive" : "refusal";
        const rowId = `${rowKind}-${index}`;
        return {
          rowId,
          rowKind,
          path: `generic-vm-row-artifacts/${rowId}.json`,
          sha256: createHash("sha256").update(rowId).digest("hex"),
          required: true,
        };
      });
      const report = {
        kind: "machinen.node-level5-generic-vm-row-artifacts-report",
        version: 1,
        accepted: true,
        rowCount: 28,
        positiveRowCount: 8,
        refusalRowCount: 20,
        rowArtifactFiles,
        rowArtifactFileCount: rowArtifactFiles.length,
        rowArtifactFilesSha256: createHash("sha256")
          .update(JSON.stringify(rowArtifactFiles))
          .digest("hex"),
        claimChangeAllowed: false,
        candidateNodeProductSupportClaimed: 85,
        candidateBroadNodeProductSupportClaimed: 25,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-generic-vm-row-artifacts-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-generic-vm-row-artifacts",
        "--generic-vm-row-artifacts-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        genericVmRowArtifacts: { accepted: true, rowArtifactFileCount: 28 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps the 85 claim-ready gate locked after evidence passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node85-cli-claim-ready-"));
    try {
      const readiness = {
        kind: "machinen.node-level5-product-support-85-readiness",
        version: 1,
        accepted: false,
        candidateEvidenceAccepted: true,
        claimChangeAllowed: false,
        currentNodeProductSupportClaimed: 80,
        currentBroadNodeProductSupportClaimed: 20,
        currentArbitraryProcessCrossArchRestoreClaimed: 0,
        candidateNodeProductSupportClaimed: 85,
        candidateBroadNodeProductSupportClaimed: 25,
        candidateArbitraryProcessCrossArchRestoreClaimed: 0,
        gates: [{ id: "claim-change-unlocked", status: "blocked", message: "locked" }],
        blockedGates: [{ id: "claim-change-unlocked", status: "blocked", message: "locked" }],
      };
      const readinessPath = join(dir, "readiness.json");
      writeFileSync(readinessPath, `${JSON.stringify(readiness, null, 2)}\n`);

      const claimReady = runCli([
        "node-level5",
        "85-claim-ready",
        "--readiness-report",
        readinessPath,
        "--json",
      ]);
      expect(claimReady.status).toBe(0);
      expect(JSON.parse(claimReady.stdout)).toMatchObject({
        accepted: true,
        claimReadyEvidenceAccepted: true,
        claimChangeAllowed: true,
        candidateBroadNodeProductSupportClaimed: 25,
        currentBroadNodeProductSupportClaimed: 25,
        matrixCounts: { total: 114, supported: 68, refused: 42, notProven: 4 },
        blockedGates: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses generic VM refusal artifacts for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node85-cli-refusal-artifacts-"));
    try {
      const markers = [
        "activeRequests",
        "workerThreads",
        "nativeAddons",
        "tlsActiveState",
        "childProcesses",
      ];
      const refusalArtifactFiles = Array.from({ length: 20 }, (_, index) => {
        const marker = markers[index % markers.length]!;
        const rowId = `refusal-${index}`;
        return {
          rowId,
          framework: index % 2 === 0 ? "express" : "fastify",
          marker,
          direction: index % 2 === 0 ? "arm64-to-amd64" : "amd64-to-arm64",
          expectedRefusalCode: "node-level5-worker-thread-refused",
          path: `generic-vm-refusal-artifacts/${rowId}.json`,
          sha256: createHash("sha256").update(rowId).digest("hex"),
          required: true,
        };
      });
      const report = {
        kind: "machinen.node-level5-generic-vm-refusal-artifacts-report",
        version: 1,
        accepted: true,
        refusalRowCount: 20,
        refusalArtifactFiles,
        refusalArtifactFileCount: refusalArtifactFiles.length,
        refusalArtifactFilesSha256: createHash("sha256")
          .update(JSON.stringify(refusalArtifactFiles))
          .digest("hex"),
        markersCovered: [...markers].sort(),
        claimChangeAllowed: false,
        candidateNodeProductSupportClaimed: 85,
        candidateBroadNodeProductSupportClaimed: 25,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-generic-vm-refusal-artifacts-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-generic-vm-refusal-artifacts",
        "--generic-vm-refusal-artifacts-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        genericVmRefusalArtifacts: { accepted: true, refusalArtifactFileCount: 20 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses retained real-app refusal corpus evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-cli-refusal-corpus-"));
    try {
      const rows = [
        {
          framework: "express",
          direction: "arm64-to-amd64",
          marker: "workerThreads",
          expectedRefusalCode: "node-level5-worker-thread-refused",
          actualRefusalCode: "node-level5-worker-thread-refused",
          snapshotAccepted: false,
          snapshotManifestWritten: false,
          refusedBeforeSnapshot: true,
          productCommandPath: "machinen snapshot <vm-name> --out <dir>",
          rawCpuRestoreUsed: false,
          sourceIsaEmulationUsed: false,
          metadataOnlySuccessAccepted: false,
        },
      ];
      const report = {
        kind: "machinen.node-level5-real-app-refusal-corpus-report",
        version: 1,
        accepted: true,
        rowCount: rows.length,
        rowsSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        rows,
        harnessProof: true,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-real-app-refusal-corpus-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-refusal-corpus",
        "--refusal-corpus-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        realAppRefusalCorpus: { accepted: true, rowCount: 1, rowsSha256Verified: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses retained third-party app corpus evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-cli-third-party-corpus-"));
    try {
      const rows = [
        {
          appName: "express-official-hello-world",
          source: "express-official-hello-world",
          framework: "express",
          direction: "arm64-to-amd64",
          routePath: "/",
          expectedStatus: 200,
          actualStatus: 200,
          expectedBody: "hello",
          actualBody: "hello",
          expectedHeaders: { "x-machinen-third-party-app": "express-official-hello-world" },
          actualHeaders: { "x-machinen-third-party-app": "express-official-hello-world" },
          snapshotAccepted: true,
          restoreAccepted: true,
          behavioralVerifierPassed: true,
          targetNativeNodeVerified: true,
          declaredSubset: true,
          unsupportedStateDetected: false,
        },
      ];
      const report = {
        kind: "machinen.node-level5-third-party-app-corpus-report",
        version: 1,
        accepted: true,
        rowCount: rows.length,
        rowsSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        rows,
        harnessProof: true,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-third-party-app-corpus-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-third-party-app-corpus",
        "--third-party-app-corpus-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        thirdPartyAppCorpus: { accepted: true, rowCount: 1, rowsSha256Verified: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints the app-based support matrix", () => {
    const supportMatrix = runCli(["node-level5", "support-matrix", "--json"]);

    expect(supportMatrix.status).toBe(0);
    expect(JSON.parse(supportMatrix.stdout)).toMatchObject({
      accepted: true,
      kind: "machinen.node-level5-app-support-matrix",
      rowCount: 114,
      rows: expect.arrayContaining([
        expect.objectContaining({
          id: "express-installed-hello-world",
          status: "supported",
          features: expect.objectContaining({ route: "simple-route", response: "text" }),
        }),
        expect.objectContaining({ id: "fastify-websockets", status: "refused" }),
        expect.objectContaining({ id: "express-db-connections", status: "refused" }),
        expect.objectContaining({ id: "express-installed-json-response", status: "supported" }),
        expect.objectContaining({ id: "express-generic-vm-cjs", status: "supported" }),
        expect.objectContaining({ id: "fastify-generic-vm-esm", status: "supported" }),
        expect.objectContaining({ id: "express-generic-vm-active-requests", status: "refused" }),
        expect.objectContaining({ id: "fastify-installed-idle-timer", status: "supported" }),
        expect.objectContaining({
          id: "express-installed-safe-outbound-reconnect",
          status: "supported",
        }),
        expect.objectContaining({ id: "express-installed-post-json-body", status: "supported" }),
        expect.objectContaining({ id: "express-installed-redirect", status: "supported" }),
        expect.objectContaining({ id: "express-installed-error-handler", status: "supported" }),
        expect.objectContaining({
          id: "express-installed-static-cache-header",
          status: "supported",
        }),
        expect.objectContaining({ id: "fastify-installed-configured-prefix", status: "supported" }),
        expect.objectContaining({ id: "express-installed-health-check", status: "supported" }),
        expect.objectContaining({
          id: "express-external-network-not-proven",
          status: "not-proven",
        }),
      ]),
      boundaries: expect.arrayContaining([
        expect.objectContaining({ id: "arbitrary-node-process", status: "not-claimed" }),
      ]),
    });
  });

  it("keeps framework readiness locked at the 90 / 30 / 0 candidate", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node90-framework-readiness-"));
    try {
      const rows = frameworkIntrospectionRows("framework-readiness");
      const report = {
        kind: "machinen.node-level5-framework-introspection-corpus-report",
        version: 1,
        accepted: true,
        rowCount: rows.length,
        rowsSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        rows,
        claimChangeAllowed: false,
        currentNodeProductSupportClaimed: 85,
        currentBroadNodeProductSupportClaimed: 25,
        currentArbitraryProcessCrossArchRestoreClaimed: 0,
        candidateNodeProductSupportClaimed: 90,
        candidateBroadNodeProductSupportClaimed: 30,
        candidateArbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-framework-introspection-corpus-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const readiness = runCli([
        "node-level5",
        "framework-readiness",
        "--framework-introspection-corpus-report",
        reportPath,
        "--json",
      ]);
      expect(readiness.status).toBe(1);
      expect(JSON.parse(readiness.stdout)).toMatchObject({
        accepted: false,
        candidateEvidenceAccepted: true,
        claimChangeAllowed: false,
        currentBroadNodeProductSupportClaimed: 25,
        candidateBroadNodeProductSupportClaimed: 30,
        blockedGates: [expect.objectContaining({ id: "claim-change-unlocked" })],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses framework introspection corpus evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node90-framework-introspection-"));
    try {
      const rows = frameworkIntrospectionRows("framework-introspection");
      const report = {
        kind: "machinen.node-level5-framework-introspection-corpus-report",
        version: 1,
        accepted: true,
        rowCount: rows.length,
        rowsSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        rows,
        claimChangeAllowed: false,
        currentNodeProductSupportClaimed: 85,
        currentBroadNodeProductSupportClaimed: 25,
        currentArbitraryProcessCrossArchRestoreClaimed: 0,
        candidateNodeProductSupportClaimed: 90,
        candidateBroadNodeProductSupportClaimed: 30,
        candidateArbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-framework-introspection-corpus-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-framework-introspection-corpus",
        "--framework-introspection-corpus-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        frameworkIntrospectionCorpus: { accepted: true, rowCount: 16 },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints framework capability claim-ready when product evidence passes", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node90-framework-claim-ready-"));
    try {
      const readinessReport = evaluateNodeLevel5FrameworkCapabilityReadiness({
        frameworkIntrospectionCorpusReport: createNodeLevel5FrameworkIntrospectionCorpusReport(
          frameworkIntrospectionRows("framework-claim-ready"),
        ),
      });
      const readinessPath = join(dir, "readiness.json");
      writeFileSync(readinessPath, `${JSON.stringify(readinessReport, null, 2)}\n`);
      const productEvidencePath = join(dir, "product-evidence.json");
      writeNodeLevel5FrameworkProductEvidenceReport({ outDir: dir, path: productEvidencePath });

      const claimReady = runCli([
        "node-level5",
        "framework-claim-ready",
        "--readiness-report",
        readinessPath,
        "--framework-product-evidence-report",
        productEvidencePath,
        "--json",
      ]);

      expect(claimReady.status).toBe(0);
      expect(JSON.parse(claimReady.stdout)).toMatchObject({
        accepted: true,
        claimReadyEvidenceAccepted: true,
        claimChangeAllowed: true,
        currentNodeProductSupportClaimed: 85,
        currentBroadNodeProductSupportClaimed: 25,
        candidateNodeProductSupportClaimed: 90,
        candidateBroadNodeProductSupportClaimed: 30,
        candidateArbitraryProcessCrossArchRestoreClaimed: 0,
        blockedGates: [],
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints arbitrary process seed matrix without raising the process claim", () => {
    const seed = runCli(["node-level5", "arbitrary-process-seed", "--json"]);

    expect(seed.status).toBe(0);
    expect(JSON.parse(seed.stdout)).toMatchObject({
      accepted: true,
      kind: "machinen.arbitrary-process-level5-seed-matrix",
      rowCount: 13,
      seedCandidateRows: 6,
      refusedRows: 6,
      notProvenRows: 1,
      currentArbitraryProcessCrossArchRestoreClaimed: 0,
      candidateArbitraryProcessCrossArchRestoreClaimed: 1,
      claimChangeAllowed: false,
      arbitraryProcessClaimed: false,
      rows: expect.arrayContaining([
        expect.objectContaining({ id: "tiny-native-idle-counter", status: "seed-candidate" }),
        expect.objectContaining({ id: "native-threads-refused", status: "refused" }),
        expect.objectContaining({ id: "arbitrary-linux-process", status: "not-proven" }),
      ]),
    });
  });

  it("prints framework capability candidates without arbitrary claims", () => {
    const capabilities = runCli(["node-level5", "framework-capabilities", "--json"]);

    expect(capabilities.status).toBe(0);
    expect(JSON.parse(capabilities.stdout)).toMatchObject({
      accepted: true,
      kind: "machinen.node-level5-framework-capability-matrix",
      rowCount: 24,
      currentNodeProductSupportClaimed: 100,
      currentBroadNodeProductSupportClaimed: 100,
      candidateNodeProductSupportClaimed: 90,
      candidateBroadNodeProductSupportClaimed: 30,
      claimChangeAllowed: true,
      arbitraryExpressClaimed: false,
      arbitraryFastifyClaimed: false,
      arbitraryNodeClaimed: false,
      rows: expect.arrayContaining([
        expect.objectContaining({
          id: "express-framework-introspection",
          status: "supported-selected-rows",
        }),
        expect.objectContaining({ id: "fastify-arbitrary-framework-app", status: "not-proven" }),
      ]),
    });
  });

  it("uses retained installed third-party app corpus evidence for release gates", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node80-cli-installed-third-party-corpus-"));
    try {
      const rows = [
        {
          appName: "express-installed-hello-world",
          source: "express-installed-hello-world",
          framework: "express",
          direction: "arm64-to-amd64",
          installedPackage: "express",
          installedPackageVersion: "5.2.1",
          routePath: "/",
          expectedStatus: 200,
          actualStatus: 200,
          expectedBody: "hello",
          actualBody: "hello",
          expectedHeaders: {
            "x-machinen-installed-third-party-app": "express-installed-hello-world",
          },
          actualHeaders: {
            "x-machinen-installed-third-party-app": "express-installed-hello-world",
          },
          snapshotAccepted: true,
          restoreAccepted: true,
          behavioralVerifierPassed: true,
          targetNativeNodeVerified: true,
          declaredSubset: true,
          unsupportedStateDetected: false,
        },
      ];
      const report = {
        kind: "machinen.node-level5-installed-third-party-app-corpus-report",
        version: 1,
        accepted: true,
        rowCount: rows.length,
        rowsSha256: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
        rows,
        harnessProof: true,
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      };
      const reportPath = join(dir, "node-level5-installed-third-party-app-corpus-report.json");
      writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

      const releaseGate = runCli([
        "node-level5",
        "release-gate",
        "--include-installed-third-party-app-corpus",
        "--installed-third-party-app-corpus-report",
        reportPath,
        "--json",
      ]);
      expect(releaseGate.status).toBe(0);
      expect(JSON.parse(releaseGate.stdout)).toMatchObject({
        accepted: true,
        installedThirdPartyAppCorpus: { accepted: true, rowCount: 1, rowsSha256Verified: true },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("prints claims and refuses unknown ABI", () => {
    const claims = runCli(["node-level5", "claims", "--json"]);
    expect(claims.status).toBe(0);
    expect(JSON.parse(claims.stdout).claimRegistry).toMatchObject({
      nodeProductSupportClaimed: 100,
      broadNodeProductSupportClaimed: 100,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });

    const abi = runCli([
      "node-level5",
      "abi-check",
      "--node",
      "23.x",
      "--v8",
      "unknown",
      "--libuv",
      "unknown",
      "--json",
    ]);
    expect(abi.status).toBe(1);
    expect(JSON.parse(abi.stdout)).toMatchObject({
      accepted: false,
      refusal: { code: "node-level5-unknown-abi-refused" },
    });
  });
});

function frameworkIntrospectionRows(prefix: string): NodeLevel5FrameworkIntrospectionCorpusRow[] {
  const frameworks = ["express", "fastify"] as const;
  const capabilities = [
    "route-graph",
    "middleware-hook-graph",
    "plugin-graph",
    "idle-lifecycle-state",
  ] as const;
  const directions = ["arm64-to-amd64", "amd64-to-arm64"] as const;
  return frameworks.flatMap((framework) =>
    capabilities.flatMap((capability) =>
      directions.map((direction) => ({
        id: `${prefix}-${framework}-${capability}-${direction}`,
        framework,
        capability,
        direction,
        productCommandPath: "machinen snapshot <vm-name> --out <dir>; machinen restore <dir>",
        vmDetectedNodeWorkload: true,
        frameworkMetadataCapturedInsideVm: true,
        retainedFrameworkGraphArtifact: true,
        targetNativeRestoreProbePassed: true,
        arbitraryFrameworkClaimed: false,
        arbitraryNodeClaimed: false,
        arbitraryProcessCrossArchRestoreClaimed: 0,
      })),
    ),
  );
}
