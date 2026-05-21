import { describe, expect, it } from "vitest";

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
  targetAddress: "0x7001000b6ca0",
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
