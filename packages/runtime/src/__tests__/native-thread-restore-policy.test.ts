import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NATIVE_PROCESS_IMAGE_FILES,
  type NativeMemoryMapping,
  type NativeProcessImageDocuments,
  type NativeProcessResource,
  type NativeThreadState,
} from "../native-process-image.ts";
import { planNativeThreadRestoreBoundary } from "../native-thread-restore-policy.ts";

const tempDirs: string[] = [];

const stackMapping: NativeMemoryMapping = {
  id: "mapping:stack",
  kind: "stack",
  sourceStart: "0x700000000000",
  sourceEnd: "0x700000001000",
  sizeBytes: 4096,
  permissions: { read: true, write: true, execute: false, private: true, shared: false },
  target: { materialization: "translate", targetStart: "0x500000000000" },
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

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

  it("accepts an opt-in safe blocked signal mask under the full thread gate", () => {
    const masked = thread("thread:blocked-mask");
    masked.signal.blocked = ["0x2"];

    expect(
      planNativeThreadRestoreBoundary({
        threads: [masked],
        mappings: [stackMapping],
        signal: { blockedMaskPolicy: "restore-safe-mask" },
      }),
    ).toMatchObject({
      state: "accepted",
      signalRestore: { blockedMasks: ["0x2"] },
      refusals: [],
    });
  });

  it("accepts a modeled active sleep syscall under the full thread gate", () => {
    const active = thread("thread:active-sleep");
    active.syscall = { state: "inside-syscall", number: 115, name: "clock_nanosleep" };
    if (active.sourceRegisters.arch === "arm64") {
      active.sourceRegisters.x = [
        "0x0",
        "0x0",
        "0x700000000100",
        "0x0",
        ...Array.from({ length: 27 }, () => "0x0"),
      ];
    }

    const result = planNativeThreadRestoreBoundary({
      threads: [active],
      mappings: [stackMapping],
      activeSyscall: {
        sleepTimerPolicy: "defer-target-resume",
        documents: documentsWithTimespec(active),
      },
    });

    expect(result).toMatchObject({
      state: "accepted",
      threadId: "thread:active-sleep",
      activeSyscallContinuations: [
        expect.objectContaining({
          syscallClass: "sleep-timer",
          action: "defer-target-resume",
        }),
      ],
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
        id: "active-futex-syscall",
        expectedCode: "futex-state-unsupported",
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
        id: "partial-simd-fpu-subset",
        expectedCode: "simd-fpu-state-unsupported",
        mutate: (value) => {
          value.simdFpu = {
            state: "requires-restore",
            arch: "arm64",
            byteLength: 528,
            liveSubset: "fp-control-state",
          };
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
      expect(result, entry.id).toMatchObject({ state: "refused" });
      expect(result.refusals, entry.id).toContainEqual(
        expect.objectContaining({ code: entry.expectedCode }),
      );
    }
  });
});

function documentsWithTimespec(activeThread: NativeThreadState): NativeProcessImageDocuments {
  const rootDir = mkdtempSync(join(tmpdir(), "machinen-thread-restore-syscall-"));
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
