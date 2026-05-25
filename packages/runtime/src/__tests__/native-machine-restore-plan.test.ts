import { describe, expect, it } from "vitest";
import { planNativeMachineRestore } from "../native-machine-restore-plan.ts";
import type { NativeMemoryMapping, NativeThreadState } from "../native-process-image.ts";
import type { NativeReturnChainPlanRequest } from "../native-return-chain.ts";
import type { NativeStackWindowMaterializationRequest } from "../native-stack-translation.ts";

const stackMapping: NativeMemoryMapping = {
  id: "mapping:stack",
  kind: "stack",
  sourceStart: "0x700000000000",
  sourceEnd: "0x700000001000",
  sizeBytes: 4096,
  permissions: { read: true, write: true, execute: false, private: true, shared: false },
  target: { materialization: "translate", targetStart: "0x50000000f000" },
};

const heapMapping: NativeMemoryMapping = {
  id: "mapping:heap",
  kind: "heap",
  sourceStart: "0x600000000000",
  sourceEnd: "0x600000001000",
  sizeBytes: 4096,
  permissions: { read: true, write: true, execute: false, private: true, shared: false },
  captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
  target: { materialization: "translate", targetStart: "0x60000000f000" },
};

function thread(): NativeThreadState {
  return {
    id: "thread:main",
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: stackMapping.id,
    sourceRegisters: {
      arch: "arm64",
      pc: "0x400120",
      sp: "0x700000000f00",
      pstate: "0x0",
      x: Array.from({ length: 31 }, (_value, index) => `0x${(index + 1).toString(16)}`),
    },
    syscall: { state: "outside-syscall" },
    signal: {
      blocked: ["0x0"],
      pending: ["0x0"],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
    tls: { threadPointer: "0x0", sourceRegister: "arm64-tpidr-el0", rseq: { state: "absent" } },
    simdFpu: { state: "not-live", provenance: "unit-test-zero-fpstate" },
  };
}

function stackWindow(): NativeStackWindowMaterializationRequest {
  return {
    stackMapping: stackMapping.id,
    sourceStackBase: "0x700000000000",
    sourceStackLimit: "0x700000001000",
    targetStackBase: "0x50000000f000",
    targetStackLimit: "0x500000010000",
    guardBelowAddress: "0x50000000e000",
    guardAboveAddress: "0x500000011000",
    pointerRanges: [{ id: "heap", targetBase: "0x60000000f000", targetLimit: "0x600000010000" }],
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
        locals: [
          {
            offset: 24,
            kind: "pointer",
            sourceValue: "0x600000000000",
            targetValue: "0x60000000f000",
          },
        ],
      },
    ],
  };
}

function returnChain(): NativeReturnChainPlanRequest {
  return {
    targetStackBase: "0x50000000f000",
    targetStackLimit: "0x500000010000",
    maxFrames: 2,
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
  };
}

describe("native machine restore plan", () => {
  it("accepts when thread, stack, return-chain, and mapping subplans all pass", () => {
    const result = planNativeMachineRestore({
      thread: { threads: [thread()], mappings: [stackMapping] },
      stackWindow: stackWindow(),
      returnChain: returnChain(),
      mappings: { mappings: [heapMapping], memorySizeBytes: 4096 },
    });

    expect(result).toMatchObject({
      state: "accepted",
      thread: { state: "accepted" },
      stackWindow: { state: "materialized" },
      returnChain: { state: "materialized" },
      refusals: [],
    });
  });

  it("aggregates precise refusals from every subplan", () => {
    const unsafeThread = thread();
    unsafeThread.signal.pending = ["0x1"];
    const unsafeStack = stackWindow();
    unsafeStack.frames[0]!.locals[0]!.targetValue = "0x90000000";
    const unsafeReturnChain = returnChain();
    unsafeReturnChain.frames[0]!.returnAddressSlot = "0x50000000ff20";
    const executableHeap = {
      ...heapMapping,
      permissions: { ...heapMapping.permissions, execute: true },
    };

    const result = planNativeMachineRestore({
      thread: { threads: [unsafeThread], mappings: [stackMapping] },
      stackWindow: unsafeStack,
      returnChain: unsafeReturnChain,
      mappings: { mappings: [executableHeap], memorySizeBytes: 4096 },
    });

    expect(result.state).toBe("refused");
    expect(result.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "signal-state-unsupported" }),
        expect.objectContaining({ code: "pointer-ambiguous" }),
        expect.objectContaining({ code: "target-return-slot-unsupported" }),
        expect.objectContaining({ code: "mapping-permission-unsupported" }),
      ]),
    );
  });
});
