import { describe, expect, it } from "vitest";
import {
  buildNativeMachineRestoreDescriptor,
  NativeMachineRestoreDescriptorValidationError,
  parseNativeMachineRestoreDescriptor,
  serializeNativeMachineRestoreDescriptor,
  validateNativeMachineRestoreDescriptor,
} from "../native-machine-restore-descriptor.ts";
import { planNativeMachineRestore } from "../native-machine-restore-plan.ts";
import type { NativeMemoryMapping, NativeThreadState } from "../native-process-image.ts";

const stack: NativeMemoryMapping = {
  id: "mapping:stack",
  kind: "stack",
  sourceStart: "0x700000000000",
  sourceEnd: "0x700000001000",
  sizeBytes: 4096,
  permissions: { read: true, write: true, execute: false, private: true, shared: false },
  target: { materialization: "translate", targetStart: "0x50000000f000" },
};

function thread(): NativeThreadState {
  return {
    id: "thread:descriptor",
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: stack.id,
    sourceRegisters: {
      arch: "arm64",
      pc: "0x400120",
      sp: "0x700000000f00",
      pstate: "0x0",
      x: Array.from({ length: 31 }, () => "0x0"),
    },
    syscall: { state: "outside-syscall" },
    signal: {
      blocked: ["0x2"],
      pending: ["0x0"],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
    tls: { threadPointer: "0x0", sourceRegister: "arm64-tpidr-el0", rseq: { state: "absent" } },
    simdFpu: { state: "not-live", provenance: "unit-test-zero-fpstate" },
  };
}

function acceptedPlan() {
  return planNativeMachineRestore({
    thread: {
      threads: [thread()],
      mappings: [stack],
      signal: { blockedMaskPolicy: "restore-safe-mask" },
    },
    stackWindow: {
      stackMapping: stack.id,
      sourceStackBase: "0x700000000000",
      sourceStackLimit: "0x700000001000",
      targetStackBase: "0x50000000f000",
      targetStackLimit: "0x500000010000",
      guardBelowAddress: "0x50000000e000",
      guardAboveAddress: "0x500000011000",
      pointerRanges: [],
      codeLocations: [
        {
          id: "code:return",
          sourceMapping: "mapping:text",
          sourceAddress: "0x400180",
          targetAddress: "0x700300000316",
          state: "mapped",
        },
      ],
      frames: [
        {
          id: "frame:caller",
          sourceSp: "0x700000000f00",
          sourceReturnAddress: "0x400180",
          sizeBytes: 64,
          metadata: "dwarf",
          locals: [],
        },
      ],
    },
    returnChain: {
      targetStackBase: "0x50000000f000",
      targetStackLimit: "0x500000010000",
      maxFrames: 1,
      frames: [
        {
          id: "frame:caller",
          framePointer: "0x50000000ff00",
          canonicalFrameAddress: "0x50000000ff10",
          returnAddressSlot: "0x50000000ff08",
          returnAddress: "0x700300000316",
          unwindId: "target:caller@v1",
        },
      ],
    },
  });
}

describe("native machine restore descriptor", () => {
  it("serializes accepted restore state deterministically", () => {
    const descriptor = buildNativeMachineRestoreDescriptor(acceptedPlan());
    const text = serializeNativeMachineRestoreDescriptor(descriptor);

    expect(parseNativeMachineRestoreDescriptor(text)).toEqual(descriptor);
    expect(descriptor).toMatchObject({
      formatVersion: 1,
      kind: "machinen.native-machine-restore",
      thread: { id: "thread:descriptor", targetThreadCount: 1 },
      signal: { blockedMasks: ["0x2"] },
      stackWindow: { stackMapping: "mapping:stack", relocationCount: 1 },
      returnChain: { frames: [expect.objectContaining({ id: "frame:caller" })] },
    });
  });

  it("rejects refused plans", () => {
    const refusedThread = thread();
    refusedThread.signal.pending = ["0x1"];
    const plan = planNativeMachineRestore({
      thread: { threads: [refusedThread], mappings: [stack] },
    });

    expect(() => buildNativeMachineRestoreDescriptor(plan)).toThrow(
      NativeMachineRestoreDescriptorValidationError,
    );
  });

  it("validates required descriptor sections fail-closed", () => {
    const descriptor = buildNativeMachineRestoreDescriptor(acceptedPlan());
    expect(() =>
      validateNativeMachineRestoreDescriptor({ ...descriptor, activeSyscalls: undefined as never }),
    ).toThrow(/active syscall/);
    expect(() =>
      validateNativeMachineRestoreDescriptor({
        ...descriptor,
        stackWindow: {
          ...descriptor.stackWindow!,
          targetWindow: { ...descriptor.stackWindow!.targetWindow, base: "nope" },
        },
      }),
    ).toThrow(/hex address/);
  });
});
