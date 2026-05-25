import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { validateNativeProcessImageBundle } from "../native-process-image.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-process-capture.mjs");
const TMP: string[] = [];

interface NativeProcessCaptureSummary {
  skipped?: boolean;
  hostArch: string;
  targetArch: string;
  pid: number;
  processExe: string;
  mappingCount: number;
  capturedMappingCount: number;
  threadCount: number;
  sourceRegisterArchs: string[];
  tlsSourceRegisters: string[];
  syscallStates: string[];
  simdFpuStates: string[];
  resourceKinds: string[];
  fileResource?: { offset: number; state: string };
  translationThreadStates: string[];
  memoryBytes: number;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native process capture", () => {
  it.skipIf(process.platform !== "linux")(
    "captures a non-cooperative Linux process into a native process image bundle",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-process-capture-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        [VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", maxBuffer: 40 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeProcessCaptureSummary;
      expect(summary.skipped).not.toBe(true);
      expect(summary.hostArch).toMatch(/^(arm64|amd64)$/);
      expect(summary.targetArch).not.toBe(summary.hostArch);
      expect(summary.pid).toBeGreaterThan(0);
      expect(summary.processExe).toContain("machinen-native-capture-target");
      expect(summary.mappingCount).toBeGreaterThan(0);
      expect(summary.capturedMappingCount).toBeGreaterThan(0);
      expect(summary.threadCount).toBeGreaterThanOrEqual(1);
      expect(summary.sourceRegisterArchs.every((arch) => arch === summary.hostArch)).toBe(true);
      expect(summary.tlsSourceRegisters.every((source) => source !== "missing")).toBe(true);
      expect(summary.syscallStates.every((state) => state === "outside-syscall")).toBe(true);
      expect(summary.simdFpuStates.every((state) => state !== "missing")).toBe(true);
      expect(summary.resourceKinds).toEqual(
        expect.arrayContaining(["argv", "env", "cwd", "exe", "auxv", "file"]),
      );
      expect(summary.fileResource).toMatchObject({ offset: 9, state: "recipe" });
      expect(summary.translationThreadStates.every((state) => state === "pending")).toBe(true);
      expect(summary.memoryBytes).toBeGreaterThan(0);

      const bundle = validateNativeProcessImageBundle(join(outDir, "bundle"));
      expect(bundle.manifest.capture.method).toBe("external-ptrace-procfs");
      expect(bundle.translation.threads).toHaveLength(summary.threadCount);
    },
  );
});
