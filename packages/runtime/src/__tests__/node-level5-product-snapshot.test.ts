import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createNodeLevel5ProductSnapshot,
  detectNodeLevel5ProductSnapshotApp,
  isNodeLevel5ProductSnapshotBundle,
  restoreNodeLevel5ProductSnapshot,
} from "../node-level5-product-snapshot.ts";

function appDir(marker?: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-app-"));
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies: { express: "^4.0.0" } }, null, 2)}\n`,
  );
  if (marker) {
    writeFileSync(join(dir, "machinen-node-level5-detector.json"), `${JSON.stringify(marker)}\n`);
  }
  return dir;
}

describe("Node Level 5 product snapshot facade", () => {
  it("detects, creates, and restores a product-shaped Node snapshot", () => {
    const outDir = mkdtempSync(join(tmpdir(), "machinen-node-product-snapshot-"));
    const source = appDir();
    try {
      expect(detectNodeLevel5ProductSnapshotApp({ appDir: source })).toMatchObject({
        accepted: true,
        familyId: "express-fastify-http-app",
        detectedFramework: "express",
      });
      const summary = createNodeLevel5ProductSnapshot({
        outDir,
        target: { target: "api", targetKind: "name", runtime: "node", appDir: source },
      });
      expect(summary.accepted).toBe(true);
      expect(summary.manifest).toMatchObject({
        nodeProductSupportClaimed: 80,
        broadNodeProductSupportClaimed: 20,
        arbitraryProcessCrossArchRestoreClaimed: 0,
        translatedContinuationRequired: true,
        rawCpuRestoreSupported: false,
        detectorReportPath: "node-level5-detector-report.json",
      });
      expect(isNodeLevel5ProductSnapshotBundle(outDir)).toBe(true);
      expect(restoreNodeLevel5ProductSnapshot({ snapshotDir: outDir })).toMatchObject({
        accepted: true,
        targetIdentityVerified: true,
        detectorReportVerified: true,
        familyId: "express-fastify-http-app",
        direction: "arm64-to-amd64",
        artifactHashesVerified: true,
        retentionComplete: true,
        rawCpuRestoreUsed: false,
        sourceIsaEmulationUsed: false,
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });

  it("detects selected safe idle timer apps without accepting unsafe timers", () => {
    const source = appDir({ safeIdleTimer: true });
    const unsafe = appDir({ timersIntervals: true });
    try {
      expect(detectNodeLevel5ProductSnapshotApp({ appDir: source })).toMatchObject({
        accepted: true,
        detectedFeatures: ["safe-idle-timer"],
      });
      expect(detectNodeLevel5ProductSnapshotApp({ appDir: unsafe })).toMatchObject({
        accepted: false,
        refusal: { code: "node-level5-timer-background-task-refused" },
      });
    } finally {
      rmSync(source, { recursive: true, force: true });
      rmSync(unsafe, { recursive: true, force: true });
    }
  });

  it("refuses websocket live state before snapshot", () => {
    const outDir = mkdtempSync(join(tmpdir(), "machinen-node-product-websocket-refusal-"));
    const source = appDir({ websockets: true });
    try {
      expect(
        createNodeLevel5ProductSnapshot({
          outDir,
          target: { target: "api", targetKind: "name", runtime: "node", appDir: source },
        }),
      ).toMatchObject({
        accepted: false,
        refusal: { code: "node-level5-websocket-live-state-refused" },
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });

  it("refuses active unsupported Node state before snapshot", () => {
    const outDir = mkdtempSync(join(tmpdir(), "machinen-node-product-refusal-"));
    const source = appDir({ workerThreads: true });
    try {
      expect(
        createNodeLevel5ProductSnapshot({
          outDir,
          target: { target: "api", targetKind: "name", runtime: "node", appDir: source },
        }),
      ).toMatchObject({
        accepted: false,
        refusal: { code: "node-level5-worker-thread-refused" },
      });
    } finally {
      rmSync(outDir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });
});
