import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CLI = resolve("packages/cli/src/cli.ts");
const TSX_LOADER = resolve("node_modules/tsx/dist/loader.mjs");

function runCli(args: string[], cwd?: string) {
  return spawnSync(process.execPath, ["--import", TSX_LOADER, CLI, ...args], {
    cwd,
    encoding: "utf8",
  });
}

function appDir(marker?: Record<string, unknown>) {
  const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-app-"));
  writeFileSync(
    join(dir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies: { express: "^4.0.0" } }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, "machinen-node-level5-targets.json"),
    `${JSON.stringify({ targets: { api: { runtime: "node", appDir: dir } } }, null, 2)}\n`,
  );
  if (marker) {
    writeFileSync(join(dir, "machinen-node-level5-detector.json"), `${JSON.stringify(marker)}\n`);
  }
  return dir;
}

describe("Node Level 5 product snapshot CLI", () => {
  it("uses snapshot and restore as the product surface", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-"));
    const source = appDir();
    try {
      const snapshot = runCli(["snapshot", "node", "api", "--out", dir, "--json"], source);
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
      rmSync(dir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });

  it("refuses unsupported app shapes before snapshot", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-refused-"));
    const source = appDir({ activeRequests: true });
    try {
      const snapshot = runCli(["snapshot", "node", "api", "--out", dir, "--json"], source);
      expect(snapshot.status).toBe(1);
      expect(JSON.parse(snapshot.stdout)).toMatchObject({
        accepted: false,
        refusal: { code: "node-level5-active-request-refused" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(source, { recursive: true, force: true });
    }
  });
});
