import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/real-target-feasibility.mjs");
const TMP: string[] = [];

interface RealTargetSummary {
  hostArch: string;
  bundleDir: string;
  target: {
    target: { id: string; name: string; kind: string };
    semanticMetadata: {
      commandSurface: string[];
      imports: { builtin: string[]; workspace: string[]; relative: string[]; external: string[] };
      resources: { refused: Array<{ code: string; kind: string }> };
    };
    restore: { liveProcessSupported: boolean; refusal: { code: string; message: string } };
  };
  restoreEvent: {
    accepted: boolean;
    semanticMetadataRestored: boolean;
    liveProcessRestored: boolean;
    commandCount: number;
    refusal: { code: string; message: string };
  };
  mismatchRefusal: { accepted: boolean; refusal: { code: string } };
  plan: { chosenTarget: string; fullLiveRestoreRequires: string[] };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("real target feasibility", () => {
  it(
    "restores Machinen CLI semantic metadata and refuses live runtime restore",
    {
      timeout: 120_000,
    },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "real-target-feasibility-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        {
          encoding: "utf8",
          maxBuffer: 20 * 1024 * 1024,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as RealTargetSummary;
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.target.target).toMatchObject({
        id: "machinen-cli-node",
        name: "@machinen/cli",
        kind: "real-node-cli",
      });
      expect(summary.target.semanticMetadata.commandSurface).toContain(
        "machinen boot [opts] -- <cmd>",
      );
      expect(summary.target.semanticMetadata.commandSurface).toContain(
        "machinen completion <bash|zsh|fish>",
      );
      expect(summary.target.semanticMetadata.imports.workspace).toContain("@machinen/runtime");
      expect(
        summary.target.semanticMetadata.resources.refused.map((resource) => resource.code),
      ).toEqual([
        "fd-kind-unsupported",
        "resource-unsupported",
        "runtime-heap-unsupported",
        "resource-unsupported",
      ]);
      expect(summary.restoreEvent).toMatchObject({
        accepted: true,
        semanticMetadataRestored: true,
        liveProcessRestored: false,
        commandCount: summary.target.semanticMetadata.commandSurface.length,
        refusal: { code: "runtime-heap-unsupported" },
      });
      expect(summary.mismatchRefusal).toMatchObject({
        accepted: false,
        refusal: { code: "target-build-mismatch" },
      });
      expect(summary.plan.chosenTarget).toBe("Machinen Node CLI");
      expect(summary.plan.fullLiveRestoreRequires).toContain(
        "semantic JS roots with reference ids",
      );

      const bundle = validatePortableSnapshotBundle(summary.bundleDir);
      expect(bundle.manifest.features).toContain("real-target-feasibility");
      expect(bundle.objects.objects.map((object) => object.id)).toEqual([
        "machinen-cli-command-surface",
        "machinen-cli-module-graph",
        "machinen-cli-runtime-handles",
      ]);
      expect(bundle.resources.resources.map((resource) => resource.id)).toContain(
        "refused-2-timer",
      );
    },
  );
});
