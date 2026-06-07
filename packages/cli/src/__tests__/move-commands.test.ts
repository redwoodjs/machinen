import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const CLI = resolve("packages/cli/src/cli.ts");

function runCli(args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", CLI, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("move commands", () => {
  it("can prepare a redacted GitHub issue report for refused saves", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-move-issue-cli-"));
    try {
      const out = join(dir, "move.json");
      const result = runCli(["move", "save", "999999999", out, "--issue", "--dry-run", "--json"]);
      expect(result.status).toBe(1);
      expect(JSON.parse(result.stdout)).toMatchObject({
        decision: "refused",
        descriptor: null,
        issue: {
          attempted: false,
          dryRun: true,
          repo: "redwoodjs/machinen",
          url: null,
          error: null,
        },
      });
      expect(existsSync(out)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("scans without an experimental guard", () => {
    const result = runCli(["move", "scan", "--json"]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: "machinen.move.scan-report",
      version: 1,
    });
  });

  it("loads a positional descriptor and refuses invalid descriptors", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-move-cli-"));
    try {
      const descriptorPath = join(dir, "move.json");
      writeFileSync(
        descriptorPath,
        JSON.stringify({
          kind: "machinen.move.descriptor",
          version: 1,
          pid: 123,
          shapeId: "shape-controlled-pty-empty-queue",
          architectureNeutral: true,
          claimGuard: {
            arbitraryProcessRestoreClaimed: false,
            rawVmReplayUsed: false,
            sourceIsaEmulationUsed: false,
            metadataOnlySuccess: false,
            rawHeapStackRegisterRestore: false,
            kernelSocketIdentityPreserved: false,
          },
          memory: {
            mode: "semantic-resource-descriptor-only",
            rawHeapCaptured: false,
            rawStackCaptured: false,
            rawRegistersCaptured: false,
            rawHeapStackRegistersCaptured: false,
          },
          materializer: {
            strategy: "target-native-reconstruction",
            rawProcessMemoryMaterialization: false,
            sourceIsaEmulationRequired: false,
            kernelSocketIdentityPreserved: false,
          },
          resources: {},
        }) + "\n",
      );
      const loaded = runCli(["move", "load", descriptorPath, "--json"]);
      expect(loaded.status).toBe(0);
      expect(JSON.parse(loaded.stdout)).toMatchObject({
        decision: "accepted",
        inputDescriptorUnchanged: true,
      });

      const invalidPath = join(dir, "invalid.json");
      writeFileSync(invalidPath, '{"kind":"nope"}\n');
      const refused = runCli(["move", "load", invalidPath, "--json"]);
      expect(refused.status).toBe(1);
      expect(JSON.parse(refused.stdout)).toMatchObject({
        decision: "refused",
        code: "move-load-invalid-descriptor",
        descriptor: null,
      });
      expect(readFileSync(descriptorPath, "utf8")).toContain("shape-controlled-pty-empty-queue");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
