import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const MATRIX = join(REPO_ROOT, "scripts/runtime-support-matrix.mjs");
const SCRIPT_ENV = { ...process.env, FORCE_COLOR: "1" };
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "runtime-support-matrix-"));
  tempDirs.push(dir);
  return dir;
}

function baseManifest() {
  return {
    kind: "machinen.runtime-support-manifest",
    name: "test-runtime-fixture",
    supportClaimed: false,
    runtime: { name: "test", version: "1", buildId: "test-build" },
    requiredCapabilities: [],
    positiveProofProfiles: {},
    expectedGates: ["runtime-identity", "capability-coverage"],
    refusalCases: [
      { code: "runtime-native-extension-opaque" },
      { code: "runtime-opaque-vm-frame" },
      { code: "runtime-source-owned-executable-code" },
      { code: "runtime-active-socket-without-transport" },
      { code: "runtime-worker-sync-model-missing" },
      { code: "runtime-app-hook-required" },
    ],
    provenanceFailures: [{ code: "runtime-wrong-arch", migrationCompleted: false }],
  };
}

describe("runtime support matrix", () => {
  it("emits stable planning-only runtime and harness output", () => {
    const result = spawnSync("node", [MATRIX, "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: SCRIPT_ENV,
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      kind: "machinen.runtime-support-matrix",
      state: "completed",
      pass: true,
      runtimeCounts: { total: 5, planningOnly: 5, supportedSubsets: 0, failed: 0 },
    });
    expect(
      summary.manifests.map((entry: { runtime: { name: string } }) => entry.runtime.name),
    ).toEqual(["go", "jvm", "node", "python", "ruby"]);
    expect(
      summary.manifests.find(
        (entry: { runtime: { name: string } }) => entry.runtime.name === "node",
      ),
    ).toMatchObject({
      supportClaimed: false,
      refusalProofs: expect.arrayContaining([
        expect.objectContaining({
          code: "runtime-native-extension-opaque",
          migrationCompleted: false,
          sourceIsaEmulationUsed: false,
          sidecarRuntimeUsed: false,
        }),
        expect.objectContaining({ code: "runtime-source-text-replay" }),
      ]),
      provenance: {
        targetRuntime: expect.objectContaining({
          architecture: "amd64",
          buildId: "node-fixture-build",
        }),
      },
    });
    expect(summary.appHarnesses).toEqual([
      expect.objectContaining({
        harness: "planning-only-refusal-harness",
        expectedResult: "refusal",
        pass: true,
      }),
    ]);
  });

  it("blocks ungraduated capabilities", () => {
    const dir = tempDir();
    const manifest = { ...baseManifest(), requiredCapabilities: ["runtime:fictional-capability"] };
    const manifestFile = join(dir, "manifest.json");
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    const result = spawnSync(
      "node",
      [MATRIX, "--manifest", manifestFile, "--harness-dir", dir, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({ state: "failed", pass: false });
    expect(summary.manifests[0].errors).toContain(
      "required capability runtime:fictional-capability is not graduated",
    );
  });

  it("blocks positive runtime claims without proof-backed capabilities", () => {
    const dir = tempDir();
    const manifest = {
      ...baseManifest(),
      supportClaimed: true,
      requiredCapabilities: ["fd:tcp-listener"],
      positiveProofProfiles: {},
    };
    const manifestFile = join(dir, "manifest.json");
    writeFileSync(manifestFile, JSON.stringify(manifest, null, 2));

    const result = spawnSync(
      "node",
      [MATRIX, "--manifest", manifestFile, "--harness-dir", dir, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary.manifests[0].errors).toContain(
      "positive claim for fd:tcp-listener has no proof profile",
    );
  });

  it("rejects app harness success paths that need hooks or unproven runtime support", () => {
    const dir = tempDir();
    const harness = {
      kind: "machinen.application-harness",
      name: "bad-harness",
      runtimeManifest: "test-runtime-fixture",
      requiredCapabilities: ["fd:regular-file"],
      expectedResult: "success",
      correctnessHooks: ["post-migration-fixup"],
      successProhibitions: [
        "source-isa-execution",
        "sidecar-runtime-success",
        "source-text-replay",
      ],
    };
    const manifestFile = join(dir, "manifest.json");
    const harnessFile = join(dir, "harness.json");
    writeFileSync(manifestFile, JSON.stringify(baseManifest(), null, 2));
    writeFileSync(harnessFile, JSON.stringify(harness, null, 2));

    const result = spawnSync(
      "node",
      [MATRIX, "--manifest", manifestFile, "--harness", harnessFile, "--json"],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: SCRIPT_ENV,
        timeout: 30_000,
      },
    );

    expect(result.status).toBe(1);
    const summary = JSON.parse(result.stdout);
    expect(summary.appHarnesses[0].errors).toEqual(
      expect.arrayContaining([
        "harness must prohibit app-hook-required",
        "correctness hooks are forbidden",
        "positive harness requires a passing runtime positive support manifest",
      ]),
    );
  });
});
