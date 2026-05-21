import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SOURCE = join(REPO_ROOT, "packages/microvm/assets/native-actual-resume-trampoline.c");
const PREFIX = "MACHINEN_ACTUAL_RESUME_TRAMPOLINE ";

function compileHelper(outDir: string) {
  const helper = join(outDir, "machinen-native-actual-resume-trampoline");
  const result = spawnSync(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-fno-pie",
      "-no-pie",
      SOURCE,
      "-o",
      helper,
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  return helper;
}

function runHelper(helper: string, codeFile: string, codeSize: number) {
  const result = spawnSync(
    helper,
    [
      "--code-file",
      codeFile,
      "--file-offset",
      "0",
      "--code-size",
      String(codeSize),
      "--target-address",
      "0x710000001000",
      "--stack-target-start",
      "0x520000000000",
      "--stack-size",
      String(64 * 1024),
      "--stack-pointer",
      "0x520000010000",
    ],
    { encoding: "utf8" },
  );
  expect(result.status, result.stderr).toBe(0);
  const line = result.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(PREFIX));
  expect(line).toBeTruthy();
  return JSON.parse(line!.slice(PREFIX.length));
}

describe("native actual resume trampoline", () => {
  it.skipIf(process.platform !== "linux" || process.arch !== "x64")(
    "reports returned and faulted target-native attempts",
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-actual-resume-trampoline-test-"));
      const helper = compileHelper(outDir);

      const returnCode = join(outDir, "return.bin");
      writeFileSync(returnCode, Buffer.from([0xc3]));
      expect(runHelper(helper, returnCode, 1)).toMatchObject({
        status: "returned",
        targetArch: "amd64",
        entry: "0x710000001000",
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      });

      const faultCode = join(outDir, "fault.bin");
      writeFileSync(faultCode, Buffer.from([0x48, 0x8b, 0x00]));
      expect(runHelper(helper, faultCode, 3)).toMatchObject({
        status: "faulted",
        targetArch: "amd64",
        entry: "0x710000001000",
        signal: "SIGSEGV",
        targetInstructionPointer: "0x710000001000",
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      });
    },
  );
});
