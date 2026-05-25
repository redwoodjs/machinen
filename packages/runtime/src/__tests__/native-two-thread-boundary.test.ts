import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NATIVE_PROCESS_IMAGE_FILES,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeThreadState,
} from "../native-process-image.ts";
import { planNativeControlledTwoThreadRestoreBoundary } from "../native-two-thread-boundary.ts";

const stackA: NativeMemoryMapping = stackMapping("mapping:stack-a", "0x700000000000");
const stackB: NativeMemoryMapping = stackMapping("mapping:stack-b", "0x700000010000");
const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

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

  it("accepts a modeled active syscall on one controlled thread", () => {
    const input = request();
    input.threads[1]!.syscall = { state: "inside-syscall", number: 115, name: "clock_nanosleep" };
    if (input.threads[1]!.sourceRegisters.arch === "arm64") {
      input.threads[1]!.sourceRegisters.x = [
        "0x0",
        "0x0",
        "0x700000000100",
        "0x0",
        ...Array.from({ length: 27 }, () => "0x0"),
      ];
    }

    expect(
      planNativeControlledTwoThreadRestoreBoundary({
        ...input,
        activeSyscall: {
          sleepTimerPolicy: "defer-target-resume",
          documents: documentsWithTimespec(input.threads[1]!),
        },
      }),
    ).toMatchObject({
      state: "accepted",
      threadPlans: [
        { activeSyscallContinuations: [] },
        { activeSyscallContinuations: [expect.objectContaining({ syscallClass: "sleep-timer" })] },
      ],
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
      refusals: [
        expect.objectContaining({
          code: "futex-state-unsupported",
          detail: expect.objectContaining({ resourceId: "resource:futex" }),
        }),
      ],
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

  it("refuses active futex syscall state precisely", () => {
    const input = request();
    input.threads[0]!.syscall = { state: "inside-syscall", number: 202, name: "futex" };

    expect(planNativeControlledTwoThreadRestoreBoundary(input)).toMatchObject({
      state: "refused",
      refusals: [
        expect.objectContaining({
          code: "futex-state-unsupported",
          detail: expect.objectContaining({ syscallClass: "futex-wait" }),
        }),
      ],
    });
  });
});

function documentsWithTimespec(activeThread: NativeThreadState): NativeProcessImageDocuments {
  const rootDir = mkdtempSync(join(tmpdir(), "machinen-two-thread-syscall-"));
  tempDirs.push(rootDir);
  const memory = Buffer.alloc(4096);
  memory.writeBigUInt64LE(30n, 0x100);
  memory.writeBigUInt64LE(123n, 0x108);
  writeFileSync(join(rootDir, NATIVE_PROCESS_IMAGE_FILES.memory), memory);
  return {
    rootDir,
    manifest: {
      formatVersion: 1,
      kind: "machinen.native-process-image",
      capture: { method: "external-ptrace-procfs", sourceArch: "arm64" },
      target: { mode: "native-cross-isa", arch: "amd64", abi: "linux-user" },
      process: { exe: "/bin/sleep", argv: ["sleep"], env: {}, cwd: "/" },
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
    mappings: {
      formatVersion: 1,
      mappings: [
        {
          id: "mapping:timespec",
          kind: "data",
          sourceStart: "0x700000000000",
          sourceEnd: "0x700000001000",
          sizeBytes: 4096,
          permissions: { read: true, write: true, execute: false, private: true, shared: false },
          captured: { file: "native-memory.bin", offset: 0, sizeBytes: 4096 },
          target: { materialization: "translate", targetStart: "0x500000001000" },
        },
      ],
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
    threads: {
      formatVersion: 1,
      threads: [activeThread],
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
    resources: {
      formatVersion: 1,
      resources: [],
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
    translation: {
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: "arm64",
      targetArch: "amd64",
      codeLocations: [],
      threads: [],
      memoryRelocations: [],
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
  };
}
