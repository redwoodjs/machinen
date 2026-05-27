import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SOURCE = join(
  REPO_ROOT,
  "packages/microvm/test-fixtures/proof-assets/native-actual-resume-trampoline.c",
);
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
  const result = spawnSync(helper, helperArgs(codeFile, codeSize, extraArgs), { encoding: "utf8" });
  expect(result.status, result.stderr).toBe(0);
  const line = result.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(PREFIX));
  expect(line).toBeTruthy();
  return JSON.parse(line!.slice(PREFIX.length));
}

function helperArgs(codeFile: string, codeSize: number, extraArgs: string[] = []) {
  return [
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
  ];
}

function loadU64FromAbsoluteCode(address: bigint): Buffer {
  const code = Buffer.alloc(11);
  code[0] = 0x48;
  code[1] = 0xa1;
  code.writeBigUInt64LE(address, 2);
  code[10] = 0xc3;
  return code;
}

function nativePrivateMemorySteps(sourceFile: string, targetStart = "0x600000000000") {
  return [
    "--native-private-memory-step",
    `action=mmap-private-writable;mapping=mapping:heap;targetStart=${targetStart};sizeBytes=4096;permissions=rw-p`,
    "--native-private-memory-step",
    `action=copy-captured-bytes;mapping=mapping:heap;targetStart=${targetStart};sizeBytes=4096;sourceFile=${sourceFile};sourceOffset=0`,
    "--native-private-memory-step",
    `action=mprotect-final;mapping=mapping:heap;targetStart=${targetStart};sizeBytes=4096;permissions=rw-p`,
  ];
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

      const nativeMemory = join(outDir, "native-memory.bin");
      writeFileSync(nativeMemory, Buffer.alloc(4096, 0x7a));
      expect(
        runHelper(helper, returnCode, 1, [
          ...nativePrivateMemorySteps(nativeMemory),
          "--native-stack-window-write",
          "0x52000000ff00:0x1234567890abcdef:efcdab9078563412:pointer",
          "--native-stack-window-guard",
          "0x520000010000:4096:above",
          "--native-return-chain-write",
          "0x52000000ff08:0x710000001000:0010007100000000:return-address",
          "--native-executable-mapping",
          `action=map-target-executable;mapping=mapping:text;targetStart=0x710000001000;sizeBytes=1;path=${returnCode};fileOffset=0;read=true;write=false;execute=true;private=true;shared=false;buildId=target-build-id`,
          "--native-process-context-step",
          "action=record-argv;argc=3;argvBytes=20;argvSha256=c51ef4330601806e14623cb20abcdb53d8fd4363310f6e6c57146d262734041c",
          "--native-process-context-step",
          "action=clear-env;envCount=1;envSha256=38369cdbb29e38c19ae06a7b57898df7a3cc0b4c36279752e4079283a41b2f02",
          "--native-process-context-step",
          "action=set-env;keyHex=4d414348494e454e5f434f4e544558545f544f4b454e;valueHex=70726f636573732d636f6e74657874;valueSha256=d2803ac6ecf49827830a750f65c5341de2b630d9820017baf1c41d86daa5c94f",
          "--native-process-context-step",
          "action=verify-env;envCount=1;envSha256=38369cdbb29e38c19ae06a7b57898df7a3cc0b4c36279752e4079283a41b2f02",
          "--native-process-context-step",
          "action=chdir;cwdHex=2f;cwdSha256=8a5edab282632443219e051e4ade2d1d5bbc671c781051bf1437897cbdfea0f1",
          "--native-process-context-step",
          "action=record-auxv;auxvBytes=16;auxvSha256=e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
          "--native-signal-restore-step",
          "action=save-loader-signal-mask;threadId=thread:1",
          "--native-signal-restore-step",
          "action=sigprocmask-set-blocked;threadId=thread:1;targetBlockedMasks=0x0",
          "--native-signal-restore-step",
          "action=verify-blocked-signal-mask;threadId=thread:1;targetBlockedMasks=0x0",
          "--native-signal-restore-step",
          "action=restore-loader-signal-mask;threadId=thread:1",
          "--native-active-syscall-step",
          "action=rearm-sleep-timer;threadId=thread:1;seconds=0;nanoseconds=1000000;resumeMode=defer-target-resume;syscallName=clock_nanosleep",
          "--native-active-syscall-step",
          "action=rearm-ppoll-timeout;threadId=thread:1;seconds=0;nanoseconds=1000000;resumeMode=defer-target-resume;nfds=1;resources=synthetic-empty-eventfd",
          "--native-active-syscall-step",
          "action=restore-fd-read-block;threadId=thread:1;fd=32;countBytes=1;resource=synthetic-empty-pipe-read-end;resumeMode=defer-target-resume",
          "--native-active-syscall-step",
          "action=restore-fd-read-block;threadId=thread:1;fd=34;countBytes=8;resource=synthetic-empty-eventfd;resumeMode=defer-target-resume",
          "--native-active-syscall-step",
          "action=restore-fd-read-block;threadId=thread:1;fd=36;countBytes=8;resource=synthetic-timerfd;seconds=1;nanoseconds=0;resumeMode=defer-target-resume",
          "--native-thread-spawn-step",
          "action=spawn-target-thread;threadId=thread:2;stackBase=0x530000000000;stackLimit=0x530000010000;rip=0x710000001000;rsp=0x530000010000",
        ]),
      ).toMatchObject({
        status: "returned",
        nativeStackWindowMaterialization: { status: "passed", writeCount: 1, guardCount: 1 },
        nativeReturnChainMaterialization: { status: "passed", writeCount: 1 },
        nativePrivateMemoryRestore: { status: "passed", stepCount: 3 },
        nativeExecutableMapping: { status: "passed", mappingCount: 1 },
        nativeProcessContextRestore: {
          status: "passed",
          stepCount: 6,
          metadataCount: 2,
          envSetCount: 1,
          envCleared: true,
          envVerified: true,
          cwdApplied: true,
        },
        nativeSignalRestore: {
          status: "passed",
          stepCount: 4,
          saved: true,
          applied: true,
          verified: true,
          restored: true,
        },
        nativeActiveSyscallRestore: {
          status: "passed",
          stepCount: 5,
          armedCount: 2,
          consumedCount: 5,
        },
        nativeThreadRestore: { status: "passed", stepCount: 1, spawnedCount: 1 },
      });

      const fd3ClosedCode = join(outDir, "fd3-closed.bin");
      writeFileSync(
        fd3ClosedCode,
        Buffer.from([
          0xb8, 0x48, 0, 0, 0, 0xbf, 0x03, 0, 0, 0, 0xbe, 0x01, 0, 0, 0, 0x31, 0xd2, 0x0f, 0x05,
          0x83, 0xf8, 0xf7, 0x75, 0x06, 0xb8, 0x4d, 0, 0, 0, 0xc3, 0xb8, 0x2a, 0, 0, 0, 0xc3,
        ]),
      );
      expect(
        runHelper(helper, fd3ClosedCode, 36, [
          "--native-active-syscall-step",
          "action=rearm-sleep-timer;threadId=thread:1;seconds=0;nanoseconds=1000000;resumeMode=defer-target-resume;syscallName=clock_nanosleep",
        ]),
      ).toMatchObject({
        status: "returned",
        returnValue: "0x4d",
        nativeActiveSyscallRestore: { status: "passed", stepCount: 1, armedCount: 1 },
      });

      const nativeMemoryReader = join(outDir, "native-memory-reader.bin");
      writeFileSync(nativeMemoryReader, loadU64FromAbsoluteCode(0x600000000000n));
      expect(
        runHelper(helper, nativeMemoryReader, 11, nativePrivateMemorySteps(nativeMemory)),
      ).toMatchObject({
        status: "returned",
        returnValue: "0x7a7a7a7a7a7a7a7a",
        nativePrivateMemoryRestore: { status: "passed", stepCount: 3 },
      });
      expect(
        runHelper(helper, returnCode, 1, [
          ...nativePrivateMemorySteps(nativeMemory),
          "--state-report-address",
          "0x600000000000",
          "--target-fs-base",
          "0x600000000300",
        ]),
      ).toMatchObject({
        status: "returned",
        nativePrivateMemoryRestore: { status: "passed", stepCount: 3 },
      });

      const arg0Code = join(outDir, "arg0.bin");
      // mov rax, rdi; ret
      writeFileSync(arg0Code, Buffer.from([0x48, 0x89, 0xf8, 0xc3]));
      expect(runHelper(helper, arg0Code, 4, ["--argument0", "0x600000000000"])).toMatchObject({
        status: "returned",
        returnValue: "0x600000000000",
        argument0: "0x600000000000",
      });

      const badExecutableMapping = spawnSync(
        helper,
        helperArgs(returnCode, 1, [
          "--native-executable-mapping",
          "action=map-target-executable;mapping=mapping:text;targetStart=0x710000002000;sizeBytes=1;path=/tmp/mismatch;fileOffset=0;read=true;write=false;execute=true;private=true;shared=false;buildId=target-build-id",
        ]),
        { encoding: "utf8" },
      );
      expect(badExecutableMapping.status).toBe(2);
      expect(badExecutableMapping.stderr).toContain(
        "native executable mapping does not match target code",
      );

      const badActiveSyscall = spawnSync(
        helper,
        helperArgs(returnCode, 1, [
          "--native-active-syscall-step",
          "action=rearm-sleep-timer;threadId=thread:1;seconds=0;nanoseconds=0;resumeMode=defer-target-resume;syscallName=clock_nanosleep",
        ]),
        { encoding: "utf8" },
      );
      expect(badActiveSyscall.status).toBe(2);
      expect(badActiveSyscall.stderr).toContain("native active-syscall duration must be non-zero");

      const badThreadSpawn = spawnSync(
        helper,
        helperArgs(returnCode, 1, [
          "--native-thread-spawn-step",
          "action=spawn-target-thread;threadId=thread:2;stackBase=0x530000010000;stackLimit=0x530000000000;rip=0x710000001000;rsp=0x530000010000",
        ]),
        { encoding: "utf8" },
      );
      expect(badThreadSpawn.status).toBe(2);
      expect(badThreadSpawn.stderr).toContain("native thread spawn range is invalid");

      const stateMemory = join(outDir, "state-memory.bin");
      const memory = Buffer.alloc(4096);
      memory[0] = 0x4d;
      writeFileSync(stateMemory, memory);
      const stateEntryBytes: number[] = [];
      const immediates: Array<{ offset: number; value: bigint }> = [];
      const reportAddress = 0x600000000000n;
      const push = (...bytes: number[]) => stateEntryBytes.push(...bytes);
      const pushU64Immediate = (value: bigint) => {
        immediates.push({ offset: stateEntryBytes.length, value });
        push(0, 0, 0, 0, 0, 0, 0, 0);
      };
      const movRaxImmediate = (value: bigint) => {
        push(0x48, 0xb8);
        pushU64Immediate(value);
      };
      const movRbxImmediate = (value: bigint) => {
        push(0x48, 0xbb);
        pushU64Immediate(value);
      };
      const storeRaxAbsolute = (reportOffset: number) => {
        push(0x48, 0xa3);
        pushU64Immediate(reportAddress + BigInt(reportOffset));
      };
      const storeImmediate = (reportOffset: number, value: bigint) => {
        movRaxImmediate(value);
        storeRegister(0x48, 0x43, 0x83, reportOffset);
      };
      function storeRegister(
        prefix: number,
        modrm8: number,
        modrm32: number,
        reportOffset: number,
      ) {
        if (reportOffset <= 127) {
          push(prefix, 0x89, modrm8, reportOffset);
          return;
        }
        push(prefix, 0x89, modrm32);
        push(reportOffset, reportOffset >> 8, reportOffset >> 16, reportOffset >> 24);
      }
      storeRaxAbsolute(136);
      push(0x9c, 0x58);
      storeRaxAbsolute(216);
      movRaxImmediate(reportAddress);
      storeRegister(0x48, 0x78, 0xb8, 200);
      storeRegister(0x48, 0x70, 0xb0, 144);
      storeRegister(0x48, 0x50, 0x90, 152);
      storeRegister(0x48, 0x48, 0x88, 160);
      storeRegister(0x4c, 0x40, 0x80, 168);
      storeRegister(0x4c, 0x48, 0x88, 176);
      storeRegister(0x4c, 0x50, 0x90, 184);
      storeRegister(0x4c, 0x58, 0x98, 192);
      movRbxImmediate(reportAddress);
      storeImmediate(128, 0x52454753544f5245n);
      storeImmediate(208, 0x52464c4147534f4bn);
      storeImmediate(8, 0x5354415445434f4en);
      storeImmediate(16, 0x7fn);
      storeImmediate(32, 0x4652414d45504153n);
      storeImmediate(40, 0x524553554d455041n);
      storeImmediate(48, 0x1fn);
      push(0x48, 0x89, 0xdf, 0xb8, 0x4d, 0, 0, 0, 0xc3);
      const stateEntry = Buffer.from(stateEntryBytes);
      for (const immediate of immediates) {
        stateEntry.writeBigUInt64LE(immediate.value, immediate.offset);
      }
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
          "--state-report-address",
          "0x600000000000",
          "--translated-return-address",
          translatedReturnAddress,
          "--resume-mode",
          "translated-frame",
          "--resume-rflags",
          "0x8d7",
          "--resume-register-rax",
          "0x2121212121212121",
          "--resume-register-rdi",
          "0x7171717171717171",
          "--resume-register-rsi",
          "0x6161616161616161",
          "--resume-register-rdx",
          "0x6262626262626262",
          "--resume-register-rcx",
          "0x6363636363636363",
          "--resume-register-r8",
          "0x8888888888888888",
          "--resume-register-r9",
          "0x9999999999999999",
          "--resume-register-r10",
          "0x1010101010101010",
          "--resume-register-r11",
          "0x1111111111111111",
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
        rflagsRestore: {
          status: "passed",
          conditionMask: "0x8d5",
          expectedRflags: "0x8d7",
        },
        registerRestore: {
          status: "passed",
          registers: [
            { register: "rax", status: "passed", value: "0x2121212121212121" },
            { register: "rdi", status: "passed", value: "0x7171717171717171" },
            { register: "rsi", status: "passed", value: "0x6161616161616161" },
            { register: "rdx", status: "passed", value: "0x6262626262626262" },
            { register: "rcx", status: "passed", value: "0x6363636363636363" },
            { register: "r8", status: "passed", value: "0x8888888888888888" },
            { register: "r9", status: "passed", value: "0x9999999999999999" },
            { register: "r10", status: "passed", value: "0x1010101010101010" },
            { register: "r11", status: "passed", value: "0x1111111111111111" },
          ],
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
