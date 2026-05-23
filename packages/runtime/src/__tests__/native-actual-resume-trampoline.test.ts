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
      "-O2",
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

function runHelper(helper: string, codeFile: string, codeSize: number, extraArgs: string[] = []) {
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
      ...extraArgs,
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

      const arg0Code = join(outDir, "arg0.bin");
      // mov rax, rdi; ret
      writeFileSync(arg0Code, Buffer.from([0x48, 0x89, 0xf8, 0xc3]));
      expect(runHelper(helper, arg0Code, 4, ["--argument0", "0x600000000000"])).toMatchObject({
        status: "returned",
        returnValue: "0x600000000000",
        argument0: "0x600000000000",
      });

      const stateMemory = join(outDir, "state-memory.bin");
      const memory = Buffer.alloc(4096);
      memory[0] = 0x4d;
      writeFileSync(stateMemory, memory);
      const stateEntry = Buffer.from([
        0x48, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0x48, 0x89, 0x47, 0x08, 0x48, 0xb8, 0, 0, 0, 0, 0, 0, 0,
        0, 0x48, 0x89, 0x47, 0x10, 0x48, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0x48, 0x89, 0x47, 0x20, 0x48,
        0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0x48, 0x89, 0x47, 0x28, 0x48, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0,
        0x48, 0x89, 0x47, 0x30, 0xb8, 0x4d, 0, 0, 0, 0xc3,
      ]);
      stateEntry.writeBigUInt64LE(0x5354415445434f4en, 2);
      stateEntry.writeBigUInt64LE(0x7fn, 16);
      stateEntry.writeBigUInt64LE(0x4652414d45504153n, 30);
      stateEntry.writeBigUInt64LE(0x524553554d455041n, 44);
      stateEntry.writeBigUInt64LE(0x1fn, 58);
      const returnLanding = Buffer.from([
        0x48, 0xba, 0, 0, 0, 0, 0, 0, 0, 0, 0x48, 0x89, 0x57, 0x18, 0xb8, 0x4d, 0, 0, 0, 0xc3,
      ]);
      returnLanding.writeBigUInt64LE(0x52455455524e4a50n, 2);
      const translatedReturnAddress = `0x${(0x710000001000n + BigInt(stateEntry.length)).toString(16)}`;
      const stateCode = Buffer.concat([stateEntry, returnLanding]);
      const stateCodePath = join(outDir, "state.bin");
      writeFileSync(stateCodePath, stateCode);
      expect(
        runHelper(helper, stateCodePath, stateCode.length, [
          "--argument0",
          "0x600000000000",
          "--state-report-address",
          "0x600000000000",
          "--translated-return-address",
          translatedReturnAddress,
          "--resume-mode",
          "translated-frame",
          "--translated-frame-pointer",
          "0x52000000ff80",
          "--translated-frame-cfa",
          "0x52000000fff0",
          "--translated-frame-return-address-slot",
          "0x52000000fff0",
          "--translated-frame-return-address",
          translatedReturnAddress,
          "--translated-frame-unwind-id",
          "target:realspin-final-jump",
          "--translated-frame-callee-rbx",
          "0x1111111122222222",
          "--translated-frame-callee-r12",
          "0x1234567890abcdef",
          "--translated-frame-callee-r13",
          "0x1313131313131313",
          "--translated-frame-callee-r14",
          "0x1414141414141414",
          "--translated-frame-callee-r15",
          "0x1515151515151515",
          "--translated-frame-slot",
          "0:0x4652414d45504153:non-pointer-data",
          "--translated-frame-slot",
          "8:0x535441434b534c54:non-pointer-data",
          "--materialize-memory",
          `${stateMemory}:0:0x600000000000:4096:rw-p`,
        ]),
      ).toMatchObject({
        status: "returned",
        returnValue: "0x4d",
        returnChain: {
          status: "passed",
          translatedReturnAddress,
          returnMarker: "0x52455455524e4a50",
        },
        frameRestoration: {
          status: "passed",
          framePointer: "0x52000000ff80",
          returnAddress: translatedReturnAddress,
          calleeSavedMask: "0x1f",
          calleeSaved: [
            { register: "rbx", status: "passed", value: "0x1111111122222222" },
            { register: "r12", status: "passed", value: "0x1234567890abcdef" },
            { register: "r13", status: "passed", value: "0x1313131313131313" },
            { register: "r14", status: "passed", value: "0x1414141414141414" },
            { register: "r15", status: "passed", value: "0x1515151515151515" },
          ],
          slots: [
            { offset: 0, classification: "non-pointer-data", status: "passed" },
            { offset: 8, classification: "non-pointer-data", status: "passed" },
          ],
        },
        resumePath: {
          status: "passed",
          mode: "translated-frame",
        },
        stateConsumption: {
          status: "passed",
          memoryByte: "0x4d",
          resourceMask: "0x7f",
          resourceStatuses: [
            { kind: "inherit-stdio", status: "passed" },
            { kind: "close-fd", status: "passed" },
            { kind: "reopen-file", status: "passed" },
            { kind: "synthetic-empty-pipe", status: "passed" },
            { kind: "synthetic-empty-eventfd", status: "passed" },
            { kind: "synthetic-timerfd", status: "passed" },
          ],
        },
      });

      const faultCode = join(outDir, "fault.bin");
      writeFileSync(faultCode, Buffer.from([0x48, 0x8b, 0x00]));
      expect(runHelper(helper, faultCode, 3)).toMatchObject({
        status: "faulted",
        targetArch: "amd64",
        entry: "0x710000001000",
        signal: "SIGSEGV",
        targetInstructionPointer: "0x710000001000",
        targetInstructionBytes: "488b00",
        registers: {
          rax: "0x0",
          rsp: "0x52000000fff8",
        },
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      });
    },
  );
});
