import { describe, expect, it } from "vitest";

import { planNativeTargetResumeExecution } from "../native-target-resume-execution.ts";
import type { NativeCodeLocationMapping } from "../native-process-image.ts";
import type { NativeSyntheticTargetCallerFrame } from "../native-target-caller-frame.ts";
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
});
