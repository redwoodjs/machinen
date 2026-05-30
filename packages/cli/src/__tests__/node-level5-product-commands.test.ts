import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CLI = resolve("packages/cli/src/cli.ts");

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf8",
  });
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
