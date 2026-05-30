import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CLI = resolve("packages/cli/src/cli.ts");

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf8",
  });
}

describe("Node Level 5 product snapshot CLI", () => {
  it("uses snapshot and restore as the product surface", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-product-cli-"));
    try {
      const snapshot = runCli(["snapshot", "node", "--out", dir, "--json"]);
      expect(snapshot.status).toBe(0);
      expect(JSON.parse(snapshot.stdout)).toMatchObject({
        accepted: true,
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
        familyId: "express-fastify-http-app",
        direction: "arm64-to-amd64",
        artifactHashesVerified: true,
        retentionComplete: true,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
