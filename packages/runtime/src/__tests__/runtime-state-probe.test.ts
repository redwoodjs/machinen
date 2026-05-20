import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/runtime-state-probe.mjs");
const TMP: string[] = [];

interface RuntimeResult {
  runtime: string;
  available: boolean;
  bundleDir?: string;
  refusal?: { code: string; message: string };
  semanticState: {
    counter: number;
    values: number[];
    checksumHex: string;
    objectCount: number;
    identityAssertions: Array<{ same: boolean }>;
    nativeHandleRefusals: string[];
  };
  serializerEvidence: {
    v8Serialize: { supported: boolean; preservesIdentity?: boolean; preservesMap?: boolean };
    structuredClone: { supported: boolean; preservesIdentity?: boolean; preservesMap?: boolean };
    json: { preservesIdentity: boolean; preservesMap: boolean };
  };
  restoreEvent: {
    mode: string;
    runtime: string;
    counter: number;
    checksum_hex: string;
    identity_preserved: boolean;
    references_restored: boolean;
    v8_deserialize_ok: boolean;
  };
}

interface RuntimeSummary {
  hostArch: string;
  node: RuntimeResult;
  bun:
    | RuntimeResult
    | { runtime: "bun"; available: false; refusal: { code: string; message: string } };
  plan: { claudeCodeTarget: string; piTarget: string; node: string; bun: string };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runtime state probes", () => {
  it(
    "restores Node semantic JS state and reports Bun evidence or refusal",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "runtime-state-probe-test-"));
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
      const summary = JSON.parse(result.stdout) as RuntimeSummary;
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.node.available).toBe(true);
      expect(summary.node.semanticState).toMatchObject({
        counter: 4210,
        values: [4, 2, 1, 8, 16],
        objectCount: 4,
      });
      expect(
        summary.node.semanticState.identityAssertions.every((assertion) => assertion.same),
      ).toBe(true);
      expect(summary.node.semanticState.nativeHandleRefusals).toEqual([
        "fd-kind-unsupported",
        "runtime-heap-unsupported",
      ]);
      expect(summary.node.serializerEvidence.v8Serialize).toMatchObject({
        supported: true,
        preservesIdentity: true,
        preservesMap: true,
      });
      expect(summary.node.serializerEvidence.structuredClone).toMatchObject({
        supported: true,
        preservesIdentity: true,
        preservesMap: true,
      });
      expect(summary.node.serializerEvidence.json).toMatchObject({
        preservesIdentity: false,
        preservesMap: false,
      });
      expect(summary.node.restoreEvent).toMatchObject({
        mode: "restore",
        runtime: "node",
        counter: 4210,
        checksum_hex: summary.node.semanticState.checksumHex,
        identity_preserved: true,
        references_restored: true,
        v8_deserialize_ok: true,
      });

      const bundle = validatePortableSnapshotBundle(summary.node.bundleDir!);
      expect(bundle.manifest.features).toContain("runtime-state-probe");
      expect(bundle.objects.objects.map((object) => object.id)).toEqual([
        "js-root-state",
        "js-object-graph",
        "js-runtime-handles",
      ]);
      expect(bundle.resources.resources.map((resource) => resource.id)).toContain(
        "node:timer-queue",
      );

      if (summary.bun.available) {
        expect(summary.bun.restoreEvent).toMatchObject({
          mode: "restore",
          runtime: "bun",
          identity_preserved: true,
          references_restored: true,
        });
      } else {
        expect(summary.bun.refusal).toMatchObject({ code: "runtime-adapter-missing" });
      }
      expect(summary.plan.claudeCodeTarget).toContain("runtime adapter");
      expect(summary.plan.piTarget).toContain("semantic JS roots");
    },
  );
});
