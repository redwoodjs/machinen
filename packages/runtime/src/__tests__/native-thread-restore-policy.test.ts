import { describe, expect, it } from "vitest";
import type {
  NativeMemoryMapping,
  NativeProcessResource,
  NativeThreadState,
} from "../native-process-image.ts";
import { planNativeThreadRestoreBoundary } from "../native-thread-restore-policy.ts";

const stackMapping: NativeMemoryMapping = {
  id: "mapping:stack",
  kind: "stack",
  sourceStart: "0x700000000000",
  sourceEnd: "0x700000001000",
  sizeBytes: 4096,
  permissions: { read: true, write: true, execute: false, private: true, shared: false },
  target: { materialization: "translate", targetStart: "0x500000000000" },
};

describe("native thread restore boundary", () => {
  it("accepts one safe stopped thread", () => {
    expect(
      planNativeThreadRestoreBoundary({ threads: [thread("thread:1")], mappings: [stackMapping] }),
    ).toMatchObject({
      state: "accepted",
      threadId: "thread:1",
      targetThreadCount: 1,
      refusals: [],
    });
  });

  it("refuses unsafe or ambiguous thread states precisely", () => {
    const cases: Array<{
      id: string;
      expectedCode: string;
      threads?: NativeThreadState[];
      mappings?: NativeMemoryMapping[];
      resources?: NativeProcessResource[];
      mutate?: (value: NativeThreadState) => void;
    }> = [
      {
        id: "multi-thread",
        expectedCode: "thread-state-unsupported",
        threads: [thread("thread:1"), thread("thread:2")],
      },
      {
        id: "active-syscall",
        expectedCode: "active-syscall",
        mutate: (value) => {
          value.syscall = { state: "inside-syscall", number: 202, name: "futex" };
        },
      },
      {
        id: "signal-delivery-stop",
        expectedCode: "signal-state-unsupported",
        mutate: (value) => {
          value.stopReason = "signal-delivery-stop";
        },
      },
      {
        id: "signal-frame",
        expectedCode: "signal-frame-active",
        mutate: (value) => {
          value.signal.activeFrame = true;
        },
      },
      {
        id: "shared-stack",
        expectedCode: "mapping-shared-unsupported",
        mappings: [{ ...stackMapping, permissions: { ...stackMapping.permissions, shared: true } }],
      },
      {
        id: "unknown-tls",
        expectedCode: "tls-state-unsupported",
        mutate: (value) => {
          value.tls.threadPointer = "unknown";
        },
      },
      {
        id: "wrong-tls-source-register",
        expectedCode: "tls-state-unsupported",
        mutate: (value) => {
          value.tls.sourceRegister = "amd64-fs-base";
        },
      },
      {
        id: "unsupported-target-segment-bases",
        expectedCode: "tls-state-unsupported",
        mutate: (value) => {
          value.tls.targetSegmentBases = { state: "unsupported", reason: "no target TCB" };
        },
      },
      {
        id: "ambiguous-registers",
        expectedCode: "thread-state-unsupported",
        mutate: (value) => {
          if (value.sourceRegisters.arch === "arm64") {
            value.sourceRegisters.pc = "unknown";
          }
        },
      },
      {
        id: "missing-simd-fpu-state",
        expectedCode: "simd-fpu-state-unsupported",
        mutate: (value) => {
          value.simdFpu = undefined;
        },
      },
      {
        id: "live-simd-fpu-state",
        expectedCode: "simd-fpu-state-unsupported",
        mutate: (value) => {
          value.simdFpu = { state: "requires-restore", arch: "arm64", byteLength: 528 };
        },
      },
      {
        id: "futex-resource",
        expectedCode: "futex-state-unsupported",
        resources: [{ id: "resource:futex", kind: "futex", state: "captured" }],
      },
      {
        id: "debug-resource-refusal",
        expectedCode: "thread-state-unsupported",
        resources: [
          {
            id: "resource:ptrace-debug",
            kind: "unknown",
            state: "refused",
            refusal: { code: "thread-state-unsupported", message: "ptrace/debug state" },
          },
        ],
      },
    ];

    for (const entry of cases) {
      const candidate = thread(`thread:${entry.id}`);
      entry.mutate?.(candidate);
      const result = planNativeThreadRestoreBoundary({
        threads: entry.threads ?? [candidate],
        mappings: entry.mappings ?? [stackMapping],
        resources: entry.resources ?? [],
      });
      expect(result, entry.id).toMatchObject({
        state: "refused",
        refusals: [expect.objectContaining({ code: entry.expectedCode })],
      });
    }
  });
});

function thread(id: string): NativeThreadState {
  return {
    id,
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
      pending: ["0000000000000000"],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
    tls: { threadPointer: "0x0", sourceRegister: "arm64-tpidr-el0", rseq: { state: "absent" } },
    simdFpu: { state: "not-live", provenance: "unit-test-zero-fpstate" },
  };
}
