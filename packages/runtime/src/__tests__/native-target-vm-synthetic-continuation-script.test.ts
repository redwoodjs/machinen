import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseTargetNativeConsumptionEvents,
  targetNativeConsumptionFields,
  targetNativeConsumptionPassed,
} from "../target-native-consumption-results.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCRIPT = join(REPO_ROOT, "scripts/native-target-vm-synthetic-continuation.ts");

describe("native target VM synthetic continuation script", () => {
  it("parses native restore consumption events into target result fields", () => {
    const events = parseTargetNativeConsumptionEvents({
      nativeStackWindowMaterialization: { status: "passed" },
      nativePrivateMemoryRestore: { status: "passed" },
      nativeExecutableMapping: { status: "passed" },
      nativeProcessContextRestore: { status: "passed" },
      nativeSignalRestore: { status: "passed" },
      nativeActiveSyscallRestore: { status: "passed" },
      nativeThreadRestore: { status: "passed" },
    });

    expect(targetNativeConsumptionFields(events)).toEqual({
      targetStackWindowMaterializationResult: "passed",
      targetPrivateMemoryRestoreResult: "passed",
      targetExecutableMappingResult: "passed",
      targetProcessContextRestoreResult: "passed",
      targetSignalRestoreResult: "passed",
      targetActiveSyscallRestoreResult: "passed",
      targetThreadRestoreResult: "passed",
    });
    expect(targetNativeConsumptionPassed(events)).toBe(true);
  });

  it("fails native consumption gating when stack or memory consumption fails", () => {
    const events = parseTargetNativeConsumptionEvents({
      nativeStackWindowMaterialization: { status: "failed" },
      nativePrivateMemoryRestore: { status: "passed" },
    });

    expect(targetNativeConsumptionFields(events)).toMatchObject({
      targetStackWindowMaterializationResult: "failed",
      targetPrivateMemoryRestoreResult: "passed",
    });
    expect(targetNativeConsumptionPassed(events)).toBe(false);
  });

  it("fails native consumption gating when any native restore consumption event fails", () => {
    const events = parseTargetNativeConsumptionEvents({
      nativeSignalRestore: { status: "failed" },
    });

    expect(targetNativeConsumptionFields(events)).toMatchObject({
      targetSignalRestoreResult: "failed",
    });
    expect(targetNativeConsumptionPassed(events)).toBe(false);
  });

  it("skips clearly when no target code file is provided", () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, "verify", "--json"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: process.env,
      maxBuffer: 5 * 1024 * 1024,
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as { skipped?: boolean; reason?: string };
    expect(summary.skipped).toBe(true);
    expect(summary.reason).toMatch(/Linux\/amd64 host|--code-file/);
  });
});
