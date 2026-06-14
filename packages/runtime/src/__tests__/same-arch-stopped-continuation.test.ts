import { describe, expect, it } from "vitest";

import {
  classifySameArchStoppedContinuationCapture,
  materializeSameArchStoppedContinuationTarget,
  type SameArchStoppedContinuationRequest,
} from "../same-arch-stopped-continuation.ts";

function happyRequest(): SameArchStoppedContinuationRequest {
  return {
    sourceArch: "arm64",
    targetArch: "arm64",
    process: {
      pid: 4242,
      ppid: 1,
      exe: "/tmp/safe-point-fixture",
      argv: ["/tmp/safe-point-fixture"],
      cwd: "/tmp",
      uid: 1000,
      gid: 1000,
      executableSha256: "a".repeat(64),
      targetTextIdentityMatches: true,
    },
    thread: {
      id: "thread:4242:1",
      threadCount: 1,
      stopState: "ptrace-stopped",
      activeSyscallState: "outside-syscall",
      instructionPointer: "0x400010",
      stackPointer: "0x70000000ff00",
      generalPurposeRegisters: { x0: "0x29", x1: "0x70000000ff10" },
      flagsOrPstate: "0x0",
      tlsPointer: "0x700000000000",
      pcMappingId: "mapping:text",
    },
    mappings: [
      {
        id: "mapping:text",
        kind: "text",
        start: "0x400000",
        end: "0x401000",
        permissions: "r-xp",
        sha256: "b".repeat(64),
      },
      {
        id: "mapping:heap",
        kind: "private-writable",
        start: "0x500000",
        end: "0x501000",
        permissions: "rw-p",
        capturedBytesSha256: "c".repeat(64),
        capturedBytesLength: 4096,
      },
      {
        id: "mapping:stack",
        kind: "stack",
        start: "0x700000000000",
        end: "0x700000010000",
        permissions: "rw-p",
        capturedBytesSha256: "d".repeat(64),
        capturedBytesLength: 65536,
      },
    ],
    resources: {
      fds: [
        { fd: 0, kind: "dev-null", target: "/dev/null" },
        { fd: 1, kind: "move-owned-stdio", target: "target-log" },
        { fd: 2, kind: "move-owned-stdio", target: "target-log" },
      ],
      signals: {
        pending: [],
        blocked: [],
        caughtHandlers: [],
        activeFrame: false,
        alternateStack: "disabled",
      },
      timers: { timers: [], eventLoopState: "none" },
      sockets: { sockets: [], activeSessions: [] },
      session: {
        controllingTerminal: false,
        pty: false,
        processGroup: "default",
        jobControl: "none",
      },
    },
    integrity: {
      capturedAt: "2026-06-14T09:45:00.000Z",
      sourceFreezeEvidence: "ptrace-stop-sigstop",
      targetPreflightIdentityEvidence: "target text sha256 matched",
      noReexecGuardEvidence: "no target loader invoked during capture classification",
    },
  };
}

describe("same-arch stopped continuation capture classification", () => {
  it("marks only the exact stopped single-thread same-arch source shape eligible", () => {
    const result = classifySameArchStoppedContinuationCapture(happyRequest());

    expect(result).toMatchObject({
      primitive: "same-arch-stopped-continuation-v1",
      state: "eligible",
      productSupport: false,
      refusals: [],
    });
    expect(result.capture).toMatchObject({
      processIdentity: { pid: 4242, exe: "/tmp/safe-point-fixture" },
      architecture: { sourceArch: "arm64", targetArch: "arm64", abi: "linux-user" },
      threadState: {
        instructionPointer: "0x400010",
        stackPointer: "0x70000000ff00",
        activeSyscallState: "outside-syscall",
      },
      memoryState: {
        programCounterMappingId: "mapping:text",
        stackMapping: { id: "mapping:stack", capturedBytesLength: 65536 },
      },
      resourceState: {
        timers: { timers: [], eventLoopState: "none" },
        sockets: { sockets: [], activeSessions: [] },
      },
      integrity: {
        sourceFreezeEvidence: "ptrace-stop-sigstop",
        noReexecGuardEvidence: "no target loader invoked during capture classification",
      },
    });
    expect(result.nonClaims).toContain("no reexec or restart");
    expect(result.nonClaims).toContain("no metadata-only success");
  });

  it("materializes a target-native resume only when the marker depends on captured live state", () => {
    const classification = classifySameArchStoppedContinuationCapture(happyRequest());

    const result = materializeSameArchStoppedContinuationTarget({
      classification,
      target: {
        textIdentityVerified: true,
        memoryMaterialized: true,
        registersInstalled: true,
        noRefusedResourceDuringPreflight: true,
        targetPid: 7001,
        marker: {
          kind: "captured-state-dependent",
          observedValue: 42,
          freshRestartWouldProduce: 1,
          capturedStateInputs: ["register:x0=0x29", "memory:mapping:heap"],
        },
      },
    });

    expect(result).toEqual({
      primitive: "same-arch-stopped-continuation-v1",
      state: "ready",
      targetPid: 7001,
      resumedFromCapturedState: true,
      targetProcessStarted: true,
      targetProcessKilledOnRefusal: false,
      reexecUsed: false,
      restartUsed: false,
      resourceReconstructionUsed: false,
    });
  });

  it.each([
    ["reexec", { reexecAttempted: true }, "noReexecRestartReconstruction"],
    ["restart", { restartAttempted: true }, "noReexecRestartReconstruction"],
    [
      "resource reconstruction",
      { resourceReconstructionAttempted: true },
      "noReexecRestartReconstruction",
    ],
    ["missing text identity", { textIdentityVerified: false }, "textIdentityRequired"],
    [
      "missing materialized memory",
      { memoryMaterialized: false },
      "targetStateMaterializationRequired",
    ],
    ["missing registers", { registersInstalled: false }, "targetStateMaterializationRequired"],
    [
      "target resource refusal",
      { noRefusedResourceDuringPreflight: false },
      "targetPreflightResourceRefusal",
    ],
    ["missing target pid", { targetPid: undefined }, "targetPidRequired"],
    [
      "metadata-only marker",
      {
        marker: {
          kind: "metadata-only" as const,
          observedValue: 42,
          freshRestartWouldProduce: 1,
          capturedStateInputs: ["register:x0"],
        },
      },
      "capturedStateDependentMarkerRequired",
    ],
    [
      "fresh-start-equivalent marker",
      {
        marker: {
          kind: "captured-state-dependent" as const,
          observedValue: 1,
          freshRestartWouldProduce: 1,
          capturedStateInputs: ["register:x0"],
        },
      },
      "metadataOnlySuccessRefused",
    ],
  ])(
    "refuses target materialization on %s without leaving a target process",
    (_name, mutation, refusalClass) => {
      const classification = classifySameArchStoppedContinuationCapture(happyRequest());
      const target = {
        textIdentityVerified: true,
        memoryMaterialized: true,
        registersInstalled: true,
        noRefusedResourceDuringPreflight: true,
        targetPid: 7001,
        marker: {
          kind: "captured-state-dependent" as const,
          observedValue: 42,
          freshRestartWouldProduce: 1,
          capturedStateInputs: ["register:x0=0x29"],
        },
        ...mutation,
      };

      const result = materializeSameArchStoppedContinuationTarget({ classification, target });

      expect(result).toMatchObject({
        state: "refused",
        resumedFromCapturedState: false,
        targetProcessStarted: false,
        reexecUsed: false,
        restartUsed: false,
        resourceReconstructionUsed: false,
        refusal: { detail: { refusalClass } },
      });
    },
  );

  it("refuses target materialization when capture classification already refused", () => {
    const request = happyRequest();
    request.thread.activeSyscallState = "active-syscall";
    const classification = classifySameArchStoppedContinuationCapture(request);

    const result = materializeSameArchStoppedContinuationTarget({
      classification,
      target: {
        textIdentityVerified: true,
        memoryMaterialized: true,
        registersInstalled: true,
        noRefusedResourceDuringPreflight: true,
        targetPid: 7001,
        marker: {
          kind: "captured-state-dependent",
          observedValue: 42,
          freshRestartWouldProduce: 1,
          capturedStateInputs: ["register:x0=0x29"],
        },
      },
    });

    expect(result).toMatchObject({
      state: "refused",
      targetProcessStarted: false,
      targetProcessKilledOnRefusal: true,
      refusal: { detail: { refusalClass: "eligibleCaptureRequired" } },
    });
  });

  it.each([
    [
      "source-ISA mismatch",
      (request: SameArchStoppedContinuationRequest) => (request.targetArch = "amd64"),
      "architecture-pair-unsupported",
    ],
    [
      "multiple threads",
      (request: SameArchStoppedContinuationRequest) => (request.thread.threadCount = 2),
      "thread-state-unsupported",
    ],
    [
      "running source",
      (request: SameArchStoppedContinuationRequest) => (request.thread.stopState = "running"),
      "target-semantic-continuation-missing",
    ],
    [
      "active syscall",
      (request: SameArchStoppedContinuationRequest) =>
        (request.thread.activeSyscallState = "active-syscall"),
      "active-syscall",
    ],
    [
      "missing text identity",
      (request: SameArchStoppedContinuationRequest) =>
        (request.process.targetTextIdentityMatches = false),
      "target-build-mismatch",
    ],
    [
      "pc outside verified text",
      (request: SameArchStoppedContinuationRequest) =>
        (request.thread.pcMappingId = "mapping:heap"),
      "target-code-location-unresolved",
    ],
    [
      "uncaptured private memory",
      (request: SameArchStoppedContinuationRequest) =>
        delete request.mappings[1]!.capturedBytesSha256,
      "target-resume-fault-unmodeled-memory",
    ],
    [
      "unsupported mapping",
      (request: SameArchStoppedContinuationRequest) =>
        request.mappings.push({
          id: "mapping:shared",
          kind: "shared",
          start: "0x800000",
          end: "0x801000",
          permissions: "rw-s",
        }),
      "mapping-shared-unsupported",
    ],
    [
      "non-stdio fd",
      (request: SameArchStoppedContinuationRequest) =>
        request.resources.fds.push({ fd: 3, kind: "file", target: "/tmp/state" }),
      "fd-kind-unsupported",
    ],
    [
      "socket",
      (request: SameArchStoppedContinuationRequest) =>
        request.resources.sockets.sockets.push("socket:[1]"),
      "target-socket-syscall-state-unsupported",
    ],
    [
      "timer",
      (request: SameArchStoppedContinuationRequest) =>
        request.resources.timers.timers.push("timerfd:4"),
      "target-ppoll-timeout-missing",
    ],
    [
      "signal",
      (request: SameArchStoppedContinuationRequest) =>
        request.resources.signals.pending.push("SIGUSR1"),
      "signal-state-unsupported",
    ],
    [
      "terminal session",
      (request: SameArchStoppedContinuationRequest) =>
        (request.resources.session.pty = "/dev/pts/0"),
      "kernel-state-unsupported",
    ],
  ])("refuses %s before target materialization", (_name, mutate, code) => {
    const request = happyRequest();
    mutate(request);

    const result = classifySameArchStoppedContinuationCapture(request);

    expect(result.state).toBe("refused");
    expect(result.capture).toBeUndefined();
    expect(result.productSupport).toBe(false);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code,
        detail: expect.objectContaining({ boundary: "same-arch-stopped-continuation-capture" }),
      }),
    ]);
  });
});
