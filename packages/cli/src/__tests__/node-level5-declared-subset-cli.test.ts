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

describe("Node Level 5 declared subset CLI", () => {
  it("captures and restores through guarded experimental commands", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-cli-"));
    try {
      const capture = runCli([
        "capture",
        "node-level5",
        "--experimental-node-level5",
        "--out",
        dir,
        "--source-arch",
        "arm64",
        "--target-arch",
        "amd64",
        "--json",
      ]);
      expect(capture.status).toBe(0);
      const captureSummary = JSON.parse(capture.stdout);
      expect(captureSummary).toMatchObject({
        accepted: true,
        targetStarted: false,
        productSupportClaimed: false,
        manifest: {
          kind: "machinen.node-level5-declared-subset-manifest",
          translatedContinuationRequired: true,
          rawCpuRestoreSupported: false,
        },
      });

      const restore = runCli([
        "restore",
        "node-level5",
        "--experimental-node-level5",
        captureSummary.manifestPath,
        "--json",
      ]);
      expect(restore.status).toBe(0);
      expect(JSON.parse(restore.stdout)).toMatchObject({
        kind: "machinen.node-level5-declared-subset-restore-summary",
        accepted: true,
        targetStarted: false,
        translatedContinuationRequired: true,
        productSupportClaimed: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses missing experimental flag and raw CPU restore before target start", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-node-level5-cli-refuse-"));
    try {
      const capture = runCli(["capture", "node-level5", "--out", dir, "--json"]);
      expect(capture.status).toBe(1);
      expect(JSON.parse(capture.stdout)).toMatchObject({
        accepted: false,
        targetStarted: false,
        refusal: { code: "node-level5-declared-subset-experimental-flag-required" },
      });

      const accepted = runCli([
        "capture",
        "node-level5",
        "--experimental-node-level5",
        "--out",
        dir,
        "--json",
      ]);
      const manifestPath = JSON.parse(accepted.stdout).manifestPath as string;
      const restore = runCli([
        "restore",
        "node-level5",
        "--experimental-node-level5",
        "--raw-cpu-restore",
        manifestPath,
        "--json",
      ]);
      expect(restore.status).toBe(1);
      expect(JSON.parse(restore.stdout)).toMatchObject({
        accepted: false,
        targetStarted: false,
        refusal: { code: "node-level5-declared-subset-raw-cpu-restore-refused" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
