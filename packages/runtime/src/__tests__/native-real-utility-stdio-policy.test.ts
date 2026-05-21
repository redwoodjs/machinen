import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility-stdio-policy.ts");
const TMP: string[] = [];

interface NativeRealUtilityStdioPolicySummary {
  skipped?: boolean;
  reason?: string;
  phase?: string;
  inheritedPolicy?: string;
  withoutPolicyRefusals?: Array<{ code: string }>;
  refusalCodes?: string[];
  stdoutRecipe?: { inherit: string; fd: number };
  stderrRecipe?: { inherit: string; fd: number };
  regularFileRecipe?: { reopen: string; offset: number };
  migratedKernelBuffers?: boolean;
  execution?: string;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility stdio policy proof", () => {
  it("accepts inherited output only under an explicit policy", () => {
    const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-stdio-policy-test-"));
    TMP.push(outDir);

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
      { encoding: "utf8", cwd: REPO_ROOT, env: process.env, maxBuffer: 20 * 1024 * 1024 },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as NativeRealUtilityStdioPolicySummary;
    if (summary.skipped) {
      expect(process.platform !== "linux").toBe(true);
      expect(summary.reason).toBeTruthy();
      return;
    }

    expect(summary.phase).toBe("real-utility-stdio-policy");
    expect(summary.inheritedPolicy).toBe("inherit-output");
    expect(summary.withoutPolicyRefusals?.map((refusal) => refusal.code)).toEqual([
      "inherited-stdio-policy-required",
      "inherited-stdio-policy-required",
    ]);
    expect(summary.stdoutRecipe).toEqual({ inherit: "stdout", fd: 1 });
    expect(summary.stderrRecipe).toEqual({ inherit: "stderr", fd: 2 });
    expect(summary.regularFileRecipe).toMatchObject({ reopen: "/tmp/stdio.txt", offset: 17 });
    expect(summary.refusalCodes).toEqual([
      "stdin-buffer-state-unsupported",
      "non-stdio-kernel-state-unsupported",
    ]);
    expect(summary.migratedKernelBuffers).toBe(false);
    expect(summary.execution).toBe(
      "real-utility-inherited-stdio-policy-proved-with-precise-resource-refusals",
    );
  });
});
