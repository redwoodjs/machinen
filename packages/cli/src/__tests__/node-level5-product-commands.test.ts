import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
      nodeProductSupportClaimed: 80,
      broadNodeProductSupportClaimed: 20,
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
