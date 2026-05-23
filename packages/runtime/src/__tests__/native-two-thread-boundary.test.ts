import { describe, expect, it } from "vitest";
import type { NativeMemoryMapping, NativeThreadState } from "../native-process-image.ts";
import { planNativeControlledTwoThreadRestoreBoundary } from "../native-two-thread-boundary.ts";

const stackA: NativeMemoryMapping = stackMapping("mapping:stack-a", "0x700000000000");
const stackB: NativeMemoryMapping = stackMapping("mapping:stack-b", "0x700000010000");

function stackMapping(id: string, sourceStart: string): NativeMemoryMapping {
  const start = BigInt(sourceStart);
  return {
    id,
    kind: "stack",
    sourceStart,
    sourceEnd: `0x${(start + 0x1000n).toString(16)}`,
    sizeBytes: 4096,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    target: {
      materialization: "translate",
      targetStart: `0x${(start + 0x10000000n).toString(16)}`,
    },
  };
}

function thread(id: string, stackMappingId: string): NativeThreadState {
  return {
    id,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: stackMappingId,
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

function request() {
  return {
    threads: [thread("thread:a", stackA.id), thread("thread:b", stackB.id)],
    mappings: [stackA, stackB],
    resources: [],
  };
}

describe("controlled two-thread restore boundary", () => {
  it("accepts exactly two independently safe stopped threads", () => {
    expect(planNativeControlledTwoThreadRestoreBoundary(request())).toMatchObject({
      state: "accepted",
      targetThreadCount: 2,
      threadIds: ["thread:a", "thread:b"],
      refusals: [],
    });
  });

  it("refuses non-two-thread inputs", () => {
    const input = request();
    input.threads.pop();

    expect(planNativeControlledTwoThreadRestoreBoundary(input)).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "thread-state-unsupported" })],
    });
  });

  it("refuses futex resources before claiming controlled multi-thread restore", () => {
    const input = request();
    input.resources = [{ id: "resource:futex", kind: "futex", state: "captured" }];

    expect(planNativeControlledTwoThreadRestoreBoundary(input)).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "futex-state-unsupported" })],
    });
  });

  it("refuses captured rseq state on either thread", () => {
    const input = request();
    input.threads[1]!.tls.rseq = { state: "captured" };

    expect(planNativeControlledTwoThreadRestoreBoundary(input)).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "rseq-state-unsupported" })],
    });
  });

  it("refuses unsafe per-thread state", () => {
    const input = request();
    input.threads[0]!.syscall = { state: "inside-syscall", number: 202, name: "futex" };

    expect(planNativeControlledTwoThreadRestoreBoundary(input)).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "active-syscall" })],
    });
  });
});
