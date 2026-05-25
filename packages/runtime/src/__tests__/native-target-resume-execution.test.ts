import { describe, expect, it } from "vitest";

import { buildNativeSyntheticSyscallContinuationDescriptor } from "../native-synthetic-continuation.ts";
import {
  classifyNativeTargetResumeExecutionAttempt,
  planNativeTargetResumeExecution,
} from "../native-target-resume-execution.ts";
import type { NativeCodeLocationMapping } from "../native-process-image.ts";
import type { NativeSyntheticTargetCallerFrame } from "../native-target-caller-frame.ts";
import type { NativeTargetResumeLandingProvenance } from "../native-target-landing-provenance.ts";
import type { NativeTargetModuleByteMaterialization } from "../native-target-module-bytes.ts";

const codeLocations: NativeCodeLocationMapping[] = [
  {
    id: "code:thread:pc",
    sourceMapping: "mapping:libc",
    sourceAddress: "0x1000",
    targetAddress: "0x7001000b6ca0",
    state: "mapped",
  },
];

const callerFrame: NativeSyntheticTargetCallerFrame = {
  id: "synthetic-target-caller-frame:actual-real-utility",
  stackPointer: "0x7fff0000",
  returnAddress: "0x0",
  slots: [],
  sourceTextReusedAsTargetCode: false,
  sourceIsaEmulationUsed: false,
  sidecarRuntimeUsed: false,
};

const invalidLanding: NativeTargetResumeLandingProvenance = {
  id: "target-resume-landing:thread",
  threadId: "thread",
  sourceAddress: "0x1000",
  sourceRva: "0xb6ca0",
  targetRva: "0xb6ca0",
  targetAddress: "0x7001000b6ca0",
  continuationStrategy: "module-rva-equivalence",
  targetRelativeAddress: "0xb6ca0",
  targetFileOffset: 0xb6ca0,
  targetInstructionBytes: "e7064883f03f4129c74181ff00400000",
  targetModule: {
    id: "target:libc",
    logicalName: "libc.so.6",
    path: "/target/libc.so.6",
    buildId: "abc",
    loadBias: "0x700100000000",
  },
  instructionBoundary: {
    state: "known-invalid",
    reason: "entry is inside a decoded instruction",
  },
  refusal: {
    code: "target-resume-fault-invalid-code-landing",
    message: "entry is inside a decoded instruction",
  },
};

function syntheticLanding(
  failureKind:
    | "signal-interrupted-unsupported"
    | "signal-restart-unsupported"
    | "syscall-return-unmodeled",
  failureExitStatus: number,
): NativeTargetResumeLandingProvenance {
  const syscall =
    failureKind === "syscall-return-unmodeled"
      ? { name: "ppoll", number: 271 }
      : { name: "clock_nanosleep", number: 230 };
  const syscallReturn =
    failureKind === "signal-interrupted-unsupported"
      ? {
          register: "rax" as const,
          condition: "equals-negative-errno" as const,
          errno: 4,
          errnoName: "EINTR",
        }
      : failureKind === "signal-restart-unsupported"
        ? {
            register: "rax" as const,
            condition: "restart-like-negative-errno" as const,
            errnos: [{ errno: 512, errnoName: "ERESTARTSYS" }],
          }
        : {
            register: "rax" as const,
            condition: "other-negative-errno" as const,
            errnoRange: { min: 1, max: 4095 },
            excludedErrnos: [
              { errno: 4, errnoName: "EINTR" },
              { errno: 512, errnoName: "ERESTARTSYS" },
            ],
          };
  const descriptor = buildNativeSyntheticSyscallContinuationDescriptor({
    targetArch: "amd64",
    entryAddress: "0x700200000000",
    relativeAddress: "0x0",
    generatorBuildId: "test-synthetic-syscall",
    bytes: new Uint8Array([0x0f, 0x05]),
    syscall: {
      ...syscall,
      arguments: [],
    },
    registerSetup: {
      abi: "linux-amd64-syscall",
      arguments: [],
      clobberedBySyscall: ["rax", "rcx", "r11"],
      notes: [],
    },
    stackSetup: {
      entryStackPointer: "target-caller-frame-stack-pointer",
      stackBytesWrittenByContinuation: 0,
      returnAddress: "not-used-exit-process-completion",
      requiresSourceStackBytes: false,
    },
    completion: {
      mode: "exit-process",
      failureExitBuckets: [
        {
          exitStatus: failureExitStatus,
          failureKind,
          failureReason:
            failureKind === "signal-interrupted-unsupported"
              ? "test syscall returned -EINTR"
              : failureKind === "signal-restart-unsupported"
                ? "test syscall returned a restart-like errno"
                : "test syscall returned another negative errno",
          syscallReturn,
        },
      ],
    },
  });
  return {
    ...invalidLanding,
    id: `target-resume-landing:synthetic:${failureKind}`,
    targetRva: "0x0",
    targetAddress: "0x700200000000",
    targetRelativeAddress: "0x0",
    continuationStrategy: "synthetic-sleep-syscall",
    syntheticContinuation: { descriptor },
    instructionBoundary: { state: "known-valid", reason: "generated synthetic entry" },
    refusal: undefined,
  } as NativeTargetResumeLandingProvenance;
}

const targetBytes: NativeTargetModuleByteMaterialization[] = [
  {
    moduleId: "target:libc",
    path: "/target/libc.so.6",
    buildId: "abc",
    relativeStart: "0xb6ca0",
    relativeEnd: "0xb6cc0",
    fileOffset: 0xb6ca0,
    sizeBytes: 32,
    bytes: new Uint8Array([0xcc]),
    sourceTextReusedAsTargetCode: false,
  },
];

describe("native target resume execution planning", () => {
  it("plans a target-native execution path without attempting resume", () => {
    const planned = planNativeTargetResumeExecution({
      codeLocations,
      callerFrame,
      targetModuleBytes: targetBytes,
    });

    expect(planned.refusals).toEqual([]);
    expect(planned.plan).toMatchObject({
      mode: "planned-not-executed",
      executor: "native-resume-trampoline",
      targetArch: "amd64",
      entryAddress: "0x7001000b6ca0",
      stackPointer: "0x7fff0000",
      callerFrameId: callerFrame.id,
      targetModuleByteModules: ["target:libc"],
      attemptedResume: false,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });
  });

  it("refuses missing code, bytes, or caller frame precisely", () => {
    expect(
      planNativeTargetResumeExecution({
        codeLocations: [],
        callerFrame,
        targetModuleBytes: targetBytes,
      }).refusals[0]?.code,
    ).toBe("target-resume-execution-unavailable");

    expect(
      planNativeTargetResumeExecution({
        codeLocations,
        callerFrame,
        targetModuleBytes: [],
      }).refusals[0]?.code,
    ).toBe("target-resume-execution-unavailable");

    expect(
      planNativeTargetResumeExecution({
        codeLocations,
        targetModuleBytes: targetBytes,
      }).refusals[0]?.code,
    ).toBe("target-resume-execution-unavailable");
  });

  it("classifies target-native memory faults with instruction and register evidence", () => {
    const classified = classifyNativeTargetResumeExecutionAttempt({
      status: "faulted",
      targetArch: "amd64",
      entryAddress: "0x7001000b6ca0",
      stackPointer: "0x500000010000",
      targetBytesStart: "0x7001000b6ca0",
      targetBytesEnd: "0x7001000b6cc0",
      targetInstructionPointer: "0x7001000b6ca0",
      targetInstructionBytes: "660f6f0c0e660f73d80c660f73db0c",
      registers: { rsi: "0x0", rcx: "0x0", rsp: "0x50000000fff8" },
      signal: "SIGSEGV",
      signalNumber: 11,
      faultAddress: "0x0",
      instructionPointerInTargetBytes: true,
      attemptedResume: true,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });

    expect(classified.state).toBe("classified");
    expect(classified.classification).toMatchObject({
      boundary: "target-resume-fault-state",
      refusal: { code: "target-resume-fault-unmodeled-memory" },
      targetInstructionBytes: "660f6f0c0e660f73d80c660f73db0c",
      registers: { rsi: "0x0", rcx: "0x0" },
      attemptedResume: true,
      migrationCompleted: false,
    });
  });

  it("classifies invalid target instruction boundaries before raw signal shape", () => {
    const classified = classifyNativeTargetResumeExecutionAttempt(
      {
        status: "faulted",
        targetArch: "amd64",
        entryAddress: "0x7001000b6ca0",
        stackPointer: "0x500000010000",
        targetBytesStart: "0x7001000b6ca0",
        targetBytesEnd: "0x7001000b6cc0",
        targetInstructionPointer: "0x7001000b6ca0",
        targetInstructionBytes: "e7064883f03f4129c74181ff00400000",
        signal: "SIGSEGV",
        signalNumber: 11,
        faultAddress: "0x0",
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      },
      { landingProvenance: [invalidLanding] },
    );

    expect(classified.refusals[0]).toMatchObject({
      code: "target-resume-fault-invalid-code-landing",
      detail: { landing: { id: invalidLanding.id } },
    });
  });

  it("classifies privileged target instructions separately", () => {
    expect(
      classifyNativeTargetResumeExecutionAttempt({
        status: "faulted",
        targetArch: "amd64",
        entryAddress: "0x7001000b6ca0",
        stackPointer: "0x500000010000",
        targetBytesStart: "0x7001000b6ca0",
        targetBytesEnd: "0x7001000b6cc0",
        targetInstructionPointer: "0x7001000b6ca0",
        targetInstructionBytes: "e7064883f03f4129c74181ff00400000",
        signal: "SIGSEGV",
        signalNumber: 11,
        faultAddress: "0x0",
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      }).refusals[0]?.code,
    ).toBe("target-resume-fault-privileged-instruction");
  });

  it("treats target-native returns to the controlled caller as non-faulted", () => {
    const classified = classifyNativeTargetResumeExecutionAttempt({
      status: "returned",
      targetArch: "amd64",
      entryAddress: "0x700200000000",
      stackPointer: "0x500000010000",
      targetBytesStart: "0x700200000000",
      targetBytesEnd: "0x700200000040",
      returnValue: "0x0",
      instructionPointerInTargetBytes: true,
      attemptedResume: true,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });

    expect(classified).toEqual({ state: "not-faulted", refusals: [] });
  });

  it("classifies descriptor synthetic EINTR exits fail-closed through the shared gate", () => {
    const classified = classifyNativeTargetResumeExecutionAttempt(
      {
        status: "exited",
        targetArch: "amd64",
        entryAddress: "0x700200000000",
        stackPointer: "0x500000010000",
        targetBytesStart: "0x700200000000",
        targetBytesEnd: "0x700200000040",
        exitStatus: 110,
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      },
      { landingProvenance: [syntheticLanding("signal-interrupted-unsupported", 110)] },
    );

    expect(classified).toMatchObject({
      state: "classified",
      refusals: [
        {
          code: "target-synthetic-signal-interrupted-unsupported",
          detail: {
            descriptorHash: expect.any(String),
            exitStatus: 110,
            errno: 4,
            errnoName: "EINTR",
            syscall: { name: "clock_nanosleep", number: 230 },
            syscallReturn: { condition: "equals-negative-errno", errno: 4, errnoName: "EINTR" },
            syntheticContinuation: {
              kind: "synthetic-syscall-continuation",
              descriptorSha256: expect.any(String),
              syscall: { name: "clock_nanosleep", number: 230 },
              failureExitBucket: {
                exitStatus: 110,
                failureKind: "signal-interrupted-unsupported",
              },
            },
          },
        },
      ],
      classification: { attemptedResume: true, migrationCompleted: false },
    });
  });

  it("classifies descriptor synthetic restart exits fail-closed through the shared gate", () => {
    const classified = classifyNativeTargetResumeExecutionAttempt(
      {
        status: "exited",
        targetArch: "amd64",
        entryAddress: "0x700200000000",
        stackPointer: "0x500000010000",
        targetBytesStart: "0x700200000000",
        targetBytesEnd: "0x700200000040",
        exitStatus: 111,
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      },
      { landingProvenance: [syntheticLanding("signal-restart-unsupported", 111)] },
    );

    expect(classified).toMatchObject({
      state: "classified",
      refusals: [
        {
          code: "target-synthetic-signal-restart-unsupported",
          detail: {
            descriptorHash: expect.any(String),
            exitStatus: 111,
            errnos: [{ errno: 512, errnoName: "ERESTARTSYS" }],
            syscall: { name: "clock_nanosleep", number: 230 },
            syscallReturn: { condition: "restart-like-negative-errno" },
            syntheticContinuation: {
              kind: "synthetic-syscall-continuation",
              descriptorSha256: expect.any(String),
              syscall: { name: "clock_nanosleep", number: 230 },
              failureExitBucket: {
                exitStatus: 111,
                failureKind: "signal-restart-unsupported",
              },
            },
          },
        },
      ],
      classification: { attemptedResume: true, migrationCompleted: false },
    });
  });

  it("classifies descriptor synthetic syscall returns fail-closed through the shared gate", () => {
    const classified = classifyNativeTargetResumeExecutionAttempt(
      {
        status: "exited",
        targetArch: "amd64",
        entryAddress: "0x700200000000",
        stackPointer: "0x500000010000",
        targetBytesStart: "0x700200000000",
        targetBytesEnd: "0x700200000040",
        exitStatus: 112,
        instructionPointerInTargetBytes: true,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      },
      { landingProvenance: [syntheticLanding("syscall-return-unmodeled", 112)] },
    );

    expect(classified).toMatchObject({
      state: "classified",
      refusals: [
        {
          code: "target-synthetic-syscall-return-unmodeled",
          detail: {
            descriptorHash: expect.any(String),
            exitStatus: 112,
            syscall: { name: "ppoll", number: 271 },
            errnoRange: { min: 1, max: 4095 },
            excludedErrnos: [
              { errno: 4, errnoName: "EINTR" },
              { errno: 512, errnoName: "ERESTARTSYS" },
            ],
            syscallReturn: { condition: "other-negative-errno" },
            syntheticContinuation: {
              descriptorSha256: expect.any(String),
              syscall: { name: "ppoll", number: 271 },
              failureExitBucket: {
                exitStatus: 112,
                failureKind: "syscall-return-unmodeled",
              },
            },
          },
        },
      ],
      classification: { attemptedResume: true, migrationCompleted: false },
    });
  });

  it("keeps legacy synthetic sleep EINTR/restart exits fail-closed without descriptors", () => {
    const classified = classifyNativeTargetResumeExecutionAttempt({
      status: "exited",
      targetArch: "amd64",
      entryAddress: "0x700200000000",
      stackPointer: "0x500000010000",
      targetBytesStart: "0x700200000000",
      targetBytesEnd: "0x700200000040",
      exitStatus: 111,
      instructionPointerInTargetBytes: true,
      attemptedResume: true,
      sourceTextReusedAsTargetCode: false,
      sourceIsaEmulationUsed: false,
      sidecarRuntimeUsed: false,
    });

    expect(classified).toMatchObject({
      state: "classified",
      refusals: [{ code: "target-sleep-signal-restart-unsupported" }],
      classification: { attemptedResume: true, migrationCompleted: false },
    });
  });

  it("classifies faults outside the explicit target byte window separately", () => {
    expect(
      classifyNativeTargetResumeExecutionAttempt({
        status: "faulted",
        targetArch: "amd64",
        entryAddress: "0x7001000b6ca0",
        stackPointer: "0x500000010000",
        targetBytesStart: "0x7001000b6ca0",
        targetBytesEnd: "0x7001000b6cc0",
        signal: "SIGILL",
        instructionPointerInTargetBytes: false,
        attemptedResume: true,
        sourceTextReusedAsTargetCode: false,
        sourceIsaEmulationUsed: false,
        sidecarRuntimeUsed: false,
      }).refusals[0]?.code,
    ).toBe("target-resume-fault-outside-target-bytes");
  });
});
