import { describe, expect, it } from "vitest";

import {
  inventoryNativeSourceCodeModules,
  resolveNativeRealUtilityCodeLocations,
  type NativeRealUtilityTargetModule,
} from "../native-real-utility-code-map.ts";
import type {
  NativeMemoryMapping,
  NativeProcessImageDocuments,
  NativeThreadState,
} from "../native-process-image.ts";

const emptyRefusals = { vocabularyVersion: 1 as const, refusals: [] };

function modeledSleepTimerMetadata() {
  const remainingTime = {
    state: "modeled" as const,
    kind: "relative-duration" as const,
    source: "active-syscall-request-timespec" as const,
    precision: "requested-duration-upper-bound" as const,
    seconds: "30",
    nanoseconds: 0,
  };
  return {
    remainingTime,
    sleepTimer: {
      kind: "relative-duration" as const,
      syscallName: "clock_nanosleep",
      argumentSource: "registers" as const,
      clockId: 0,
      flags: 0,
      requestPointer: "0x1000",
      requestedTime: { seconds: "30", nanoseconds: 0 },
      remainingTime,
    },
    policy: "conservative-target-timer-rearm-required" as const,
  };
}

function sourceMapping(overrides: Partial<NativeMemoryMapping> = {}): NativeMemoryMapping {
  return {
    id: "mapping:exe-text",
    kind: "text",
    sourceStart: "0x400000",
    sourceEnd: "0x402000",
    sizeBytes: 8192,
    permissions: { read: true, write: false, execute: true, private: true, shared: false },
    file: { path: "/usr/bin/realspin", offset: 0, buildId: "source-realspin-arm64" },
    target: { materialization: "omit", reason: "source text is never reused as target code" },
    ...overrides,
  };
}

function arm64Registers(pc = "0x401234") {
  return {
    arch: "arm64" as const,
    pc,
    sp: "0x7fff0000",
    pstate: "0x0",
    x: Array.from({ length: 31 }, () => "0x0"),
  };
}

function thread(overrides: Partial<NativeThreadState> = {}): NativeThreadState {
  return {
    id: "thread:1",
    lwpid: 1001,
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: arm64Registers(),
    syscall: { state: "outside-syscall" },
    signal: {
      blocked: [],
      pending: [],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
    tls: { threadPointer: "0x0", rseq: { state: "absent" } },
    ...overrides,
  };
}

function documents(
  options: {
    mapping?: NativeMemoryMapping;
    activeThread?: NativeThreadState;
  } = {},
): NativeProcessImageDocuments {
  const mapping = options.mapping ?? sourceMapping();
  const activeThread = options.activeThread ?? thread();
  return {
    manifest: {
      formatVersion: 1,
      kind: "machinen.native-process-image",
      capture: { method: "external-ptrace-procfs", sourceArch: "arm64", pid: 1000 },
      target: { mode: "native-cross-isa", arch: "amd64", abi: "linux-user" },
      process: { exe: "/usr/bin/realspin", argv: ["realspin"], env: {}, cwd: "/tmp" },
      refusals: emptyRefusals,
    },
    mappings: { formatVersion: 1, mappings: [mapping], refusals: emptyRefusals },
    threads: { formatVersion: 1, threads: [activeThread], refusals: emptyRefusals },
    resources: { formatVersion: 1, resources: [], refusals: emptyRefusals },
    translation: {
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: "arm64",
      targetArch: "amd64",
      codeLocations: [],
      threads: [],
      memoryRelocations: [],
      refusals: emptyRefusals,
    },
  };
}

function targetModule(overrides: Partial<NativeRealUtilityTargetModule> = {}) {
  return {
    id: "target:realspin",
    logicalName: "realspin",
    path: "/target/usr/bin/realspin",
    arch: "amd64" as const,
    kind: "pie-executable" as const,
    buildId: "target-realspin-amd64",
    loadBias: "0x700000000000",
    textMapping: "target-mapping:realspin-text",
    executable: true,
    executableRanges: [{ relativeStart: "0x0", relativeEnd: "0x3000" }],
    ...overrides,
  };
}

describe("native real utility code-location map", () => {
  it("inventories source modules and maps a captured PC by module-relative RVA", () => {
    const source = documents();
    const modules = inventoryNativeSourceCodeModules(source);
    expect(modules).toMatchObject([
      {
        logicalName: "realspin",
        path: "/usr/bin/realspin",
        arch: "arm64",
        kind: "pie-executable",
        loadBias: "0x400000",
        sourceStart: "0x400000",
        sourceEnd: "0x402000",
      },
    ]);

    const result = resolveNativeRealUtilityCodeLocations({
      documents: source,
      targetArch: "amd64",
      targetModules: [targetModule()],
      moduleExpectations: [
        {
          sourcePath: "/usr/bin/realspin",
          targetModuleId: "target:realspin",
          expectedTargetBuildId: "target-realspin-amd64",
        },
      ],
    });

    expect(result.refusals).toEqual([]);
    expect(result.resolved[0]).toMatchObject({
      threadId: "thread:1",
      sourceRva: "0x1234",
      targetRva: "0x1234",
      targetAddress: "0x700000001234",
      continuationStrategy: "module-rva-equivalence",
    });
    expect(result.codeLocations[0]).toMatchObject({
      state: "mapped",
      sourceAddress: "0x401234",
      targetAddress: "0x700000001234",
    });
    expect(result.codeLocations[0]?.targetAddress).not.toBe(result.codeLocations[0]?.sourceAddress);
  });

  it("preserves active-syscall refusal ordering before target module lookup", () => {
    const result = resolveNativeRealUtilityCodeLocations({
      documents: documents({
        activeThread: thread({
          syscall: { state: "inside-syscall", number: 230, name: "clock_nanosleep" },
        }),
      }),
      targetArch: "amd64",
      targetModules: [],
    });

    expect(result.refusals[0]).toMatchObject({ code: "active-syscall" });
    expect(result.codeLocations[0]).toMatchObject({ state: "refused" });
  });

  it("maps deferred sleep/timer syscall code locations with semantic target symbols", () => {
    const activeThread = thread({
      syscall: { state: "inside-syscall", number: 230, name: "clock_nanosleep" },
    });
    const continuation = {
      threadId: activeThread.id,
      syscallClass: "sleep-timer" as const,
      action: "defer-target-resume" as const,
      syscall: activeThread.syscall,
      metadata: modeledSleepTimerMetadata(),
    };
    const result = resolveNativeRealUtilityCodeLocations({
      documents: documents({ activeThread }),
      targetArch: "amd64",
      targetModules: [
        targetModule({
          semanticContinuations: [
            {
              kind: "sleep-timer",
              source: "elf-symbol",
              symbolName: "clock_nanosleep@@GLIBC_2.17",
              relativeAddress: "0x2200",
              sizeBytes: 134,
            },
          ],
        }),
      ],
      activeSyscallContinuations: [continuation],
    });

    expect(result.refusals).toEqual([]);
    expect(result.codeLocations[0]).toMatchObject({
      state: "mapped",
      targetAddress: "0x700000002200",
    });
    expect(result.resolved[0]).toMatchObject({
      sourceRva: "0x1234",
      targetRva: "0x2200",
      targetAddress: "0x700000002200",
      continuationStrategy: "semantic-sleep-timer-symbol",
      semanticContinuation: {
        kind: "sleep-timer",
        symbolName: "clock_nanosleep@@GLIBC_2.17",
        targetRelativeAddress: "0x2200",
      },
    });
    expect(result.resolved[0]?.deferredActiveSyscallLanding).toMatchObject({
      threadId: activeThread.id,
      syscallClass: "sleep-timer",
      action: "defer-target-resume",
      sourceAddress: "0x401234",
      sourceRva: "0x1234",
      targetAddress: "0x700000002200",
      targetRva: "0x2200",
      strategy: "semantic-sleep-timer-symbol",
      metadata: { remainingTime: { state: "modeled", seconds: "30", nanoseconds: 0 } },
      semanticContinuation: { symbolName: "clock_nanosleep@@GLIBC_2.17" },
    });
  });

  it("refuses deferred sleep/timer code locations without falling back to source RVA", () => {
    const activeThread = thread({
      syscall: { state: "inside-syscall", number: 230, name: "clock_nanosleep" },
    });
    const continuation = {
      threadId: activeThread.id,
      syscallClass: "sleep-timer" as const,
      action: "defer-target-resume" as const,
      syscall: activeThread.syscall,
      metadata: modeledSleepTimerMetadata(),
    };

    expect(
      resolveNativeRealUtilityCodeLocations({
        documents: documents({ activeThread }),
        targetArch: "amd64",
        targetModules: [targetModule()],
        activeSyscallContinuations: [continuation],
      }).refusals[0]?.code,
    ).toBe("target-semantic-continuation-missing");

    expect(
      resolveNativeRealUtilityCodeLocations({
        documents: documents({ activeThread }),
        targetArch: "amd64",
        targetModules: [],
        activeSyscallContinuations: [continuation],
      }).refusals[0]?.code,
    ).toBe("target-module-missing");
  });

  it("uses precise refusals for missing, non-executable, mismatched, and unmapped targets", () => {
    const source = documents();
    const baseRequest = {
      documents: source,
      targetArch: "amd64" as const,
      moduleExpectations: [
        {
          sourcePath: "/usr/bin/realspin",
          targetModuleId: "target:realspin",
          expectedTargetBuildId: "target-realspin-amd64",
        },
      ],
    };

    expect(
      resolveNativeRealUtilityCodeLocations({ ...baseRequest, targetModules: [] }).refusals[0]
        ?.code,
    ).toBe("target-module-missing");
    expect(
      resolveNativeRealUtilityCodeLocations({
        ...baseRequest,
        targetModules: [targetModule({ executable: false })],
      }).refusals[0]?.code,
    ).toBe("target-module-not-executable");
    expect(
      resolveNativeRealUtilityCodeLocations({
        ...baseRequest,
        targetModules: [targetModule({ buildId: "wrong-target-build" })],
      }).refusals[0]?.code,
    ).toBe("target-build-id-mismatch");
    expect(
      resolveNativeRealUtilityCodeLocations({
        ...baseRequest,
        targetModules: [
          targetModule({ executableRanges: [{ relativeStart: "0x2000", relativeEnd: "0x3000" }] }),
        ],
      }).refusals[0]?.code,
    ).toBe("target-code-rva-unmapped");
  });

  it("refuses source PCs outside executable module inventory", () => {
    const result = resolveNativeRealUtilityCodeLocations({
      documents: documents({
        activeThread: thread({ sourceRegisters: arm64Registers("0x500000") }),
      }),
      targetArch: "amd64",
      targetModules: [targetModule()],
    });

    expect(result.refusals[0]).toMatchObject({ code: "target-code-location-unresolved" });
  });
});
