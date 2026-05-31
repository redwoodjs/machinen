import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CLI = resolve("packages/cli/src/cli.ts");
const TSX_LOADER = resolve("node_modules/tsx/dist/loader.mjs");

function runCli(args: string[], cwd?: string, env?: Record<string, string>) {
  return spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, ...args], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function appDir(marker?: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-app-"));
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies: { express: "^4.0.0" } }, null, 2)}\n`,
  );
  if (marker) {
    writeFileSync(join(dir, "machinen-node-level5-detector.json"), `${JSON.stringify(marker)}\n`);
  }
  return dir;
}

function spawnNodeTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    stdio: "ignore",
  });
}

function stopNodeTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

const hostPidHarnessEnv = { MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT: "1" };

describe("Node Level 5 product snapshot CLI", () => {
  it("keeps the public snapshot surface generic and VM-detection based", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-public-"));
    const snapshot = runCli(["snapshot", "api", "--out", dir, "--dry-run", "--json"]);
    expect(snapshot.status).toBe(1);
    expect(JSON.parse(snapshot.stderr)).toMatchObject({ error: { code: "VM_NOT_FOUND" } });
    expect(snapshot.stderr).not.toContain("snapshot node");
    rmSync(dir, { recursive: true, force: true });
  });

  it("uses snapshot and restore as the harness product surface", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-"));
    const source = appDir();
    let child: ChildProcess | undefined;
    try {
      child = spawnNodeTarget(source);
      const snapshot = runCli(
        ["snapshot", "node", String(child.pid), "--out", dir, "--json"],
        source,
        hostPidHarnessEnv,
      );
      expect(snapshot.status).toBe(0);
      expect(JSON.parse(snapshot.stdout)).toMatchObject({
        accepted: true,
        detectorReport: { accepted: true, familyId: "express-fastify-http-app" },
        manifest: {
          nodeProductSupportClaimed: 80,
          broadNodeProductSupportClaimed: 20,
          arbitraryProcessCrossArchRestoreClaimed: 0,
        },
      });

      const restore = runCli(["restore", dir, "--json"]);
      expect(restore.status).toBe(0);
      expect(JSON.parse(restore.stdout)).toMatchObject({
        accepted: true,
        detectorReportVerified: true,
        familyId: "express-fastify-http-app",
        direction: "arm64-to-amd64",
        artifactHashesVerified: true,
        retentionComplete: true,
      });
    } finally {
      if (child) {
        stopNodeTarget(child);
      }
      rmSync(dir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });

  it("allows the release corpus runner to choose the retained direction without a product flag", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-direction-"));
    const source = appDir();
    let child: ChildProcess | undefined;
    try {
      child = spawnNodeTarget(source);
      const snapshot = runCli(
        ["snapshot", "node", String(child.pid), "--out", dir, "--json"],
        source,
        {
          ...hostPidHarnessEnv,
          MACHINEN_NODE_LEVEL5_PRODUCT_SNAPSHOT_DIRECTION: "amd64-to-arm64",
        },
      );
      expect(snapshot.status).toBe(0);
      expect(JSON.parse(snapshot.stdout)).toMatchObject({
        accepted: true,
        manifest: { direction: "amd64-to-arm64" },
      });
    } finally {
      if (child) {
        stopNodeTarget(child);
      }
      rmSync(dir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });

  it("refuses unsupported app shapes before snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-refused-"));
    const source = appDir({ activeRequests: true });
    let child: ChildProcess | undefined;
    try {
      child = spawnNodeTarget(source);
      const snapshot = runCli(
        ["snapshot", "node", String(child.pid), "--out", dir, "--json"],
        source,
        hostPidHarnessEnv,
      );
      expect(snapshot.status).toBe(1);
      expect(JSON.parse(snapshot.stdout)).toMatchObject({
        accepted: false,
        refusal: { code: "node-level5-active-request-refused" },
      });
    } finally {
      if (child) {
        stopNodeTarget(child);
      }
      rmSync(dir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });
});
