import { describe, expect, it } from "vitest";

import {
  classifyCrossArchCatContinuationCapture,
  classifyCrossArchDdContinuationCapture,
  classifyCrossArchFixedStringGrepContinuationCapture,
  classifyCrossArchSeqContinuationCapture,
  classifyCrossArchWcLineContinuationCapture,
  planCrossArchCatContinuationTarget,
  planCrossArchDdContinuationTarget,
  planCrossArchFixedStringGrepContinuationTarget,
  planCrossArchSeqContinuationTarget,
  planCrossArchWcLineContinuationTarget,
  type CrossArchCatContinuationRequest,
  type CrossArchCatTargetContinuationRequest,
  type CrossArchDdContinuationRequest,
  type CrossArchDdTargetContinuationRequest,
  type CrossArchFixedStringGrepContinuationRequest,
  type CrossArchFixedStringGrepTargetContinuationRequest,
  type CrossArchSeqContinuationRequest,
  type CrossArchSeqTargetContinuationRequest,
  type CrossArchWcLineContinuationRequest,
  type CrossArchWcLineTargetContinuationRequest,
} from "../cross-arch-cli-next-binaries.ts";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

function eligibleCatRequest(): CrossArchCatContinuationRequest {
  return {
    sourceArch: "arm64",
    targetArch: "amd64",
    process: {
      pid: 4100,
      executable: "/usr/bin/cat",
      argv: ["/usr/bin/cat", "/tmp/input.txt"],
      cwd: "/tmp",
      executableSha256: "cat-sha256",
    },
    input: {
      kind: "regular-file",
      path: "/tmp/input.txt",
      device: "dev:1",
      inode: "ino:7",
      identityDigest: "input-identity",
      size: 64,
      mtimeMs: 123_456,
      contentHashWindow: "hash-window-around-32",
      readOffset: 32,
      partialReadBufferHex: "6361707475726564",
      partialReadBufferComplete: true,
      dirtyWritableAliasPresent: false,
    },
    output: {
      stdoutKind: "regular-file",
      stdoutCursor: 32,
      stderrCursor: 0,
      terminalSessionAbsent: true,
    },
    safePoint: {
      kind: "between-reads",
      evidence: "stopped after read(2) copied prefix through offset 32",
    },
    targetPreflight: {
      equivalentInputIdentityVerified: true,
      contentHashWindowMatches: true,
      regularFileOpenable: true,
      stdoutCursorInstallable: true,
      crossIsaReaderVesselAvailable: true,
      noTargetProcessBeforeEligibilityEvidence: "target pid absent before eligible classification",
    },
  };
}

function readyCatTargetRequest(): CrossArchCatTargetContinuationRequest {
  const classification = classifyCrossArchCatContinuationCapture(eligibleCatRequest());
  return {
    classification,
    target: {
      crossIsaVerified: true,
      readerVesselCreated: true,
      fileIdentityVerified: true,
      contentWindowVerified: true,
      seekInstalled: true,
      partialBufferInstalled: true,
      stdoutCursorInstalled: true,
      noReplayGuardInstalled: true,
      targetPid: 7100,
      marker: {
        sourceReadOffset: 32,
        targetFirstByteOffset: 32,
        targetFirstByteHex: "6e",
        replayedByteOffsets: [],
        freshRestartWouldStartAtOffset: 0,
        finalReadOffset: 64,
      },
    },
  };
}

describe("cross-arch next-binary cat continuation", () => {
  it("captures eligible cat reader state as cross-ISA semantic state", () => {
    const classification = classifyCrossArchCatContinuationCapture(eligibleCatRequest());

    expect(classification).toMatchObject({
      primitive: "cross-arch-cat-reader-semantic-continuation-v1",
      state: "eligible",
      refusals: [],
      productContinuationEligible: true,
      targetProcessPlanned: false,
    });
    expect(classification.capture).toMatchObject({
      architecture: { sourceArch: "arm64", targetArch: "amd64", crossIsa: true },
      process: { executable: "/usr/bin/cat", argv: ["/usr/bin/cat", "/tmp/input.txt"] },
      input: {
        path: "/tmp/input.txt",
        device: "dev:1",
        inode: "ino:7",
        identityDigest: "input-identity",
        contentHashWindow: "hash-window-around-32",
        readOffset: 32,
        partialReadBufferHex: "6361707475726564",
      },
      output: { stdoutCursor: 32, stderrCursor: 0, terminalSessionAbsent: true },
      safePoint: { kind: "between-reads" },
      targetPreflight: { crossIsaReaderVesselAvailable: true },
    });
  });

  it("plans target cat continuation from captured cursor without replay or argv restart", () => {
    const plan = planCrossArchCatContinuationTarget(readyCatTargetRequest());

    expect(plan).toMatchObject({
      primitive: "cross-arch-cat-reader-semantic-continuation-v1",
      state: "ready",
      targetPid: 7100,
      resumedFromCapturedSemanticState: true,
      targetProcessStarted: true,
      targetProcessKilledOnRefusal: false,
      argvRestartUsed: false,
      execveFromArgvUsed: false,
      reexecUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
      sourceIsaEmulationUsed: false,
      sourceFdTeleportationUsed: false,
      metadataOnlySuccessUsed: false,
      marker: {
        sourceReadOffset: 32,
        targetFirstByteOffset: 32,
        replayedByteOffsets: [],
        freshRestartWouldStartAtOffset: 0,
        finalReadOffset: 64,
      },
    });
  });

  it.each([
    ["terminal input", { input: { kind: "terminal" as const } }, "terminalInputRefused"],
    ["pipe input", { input: { kind: "pipe" as const } }, "pipeInputRefused"],
    ["socket output", { output: { stdoutKind: "socket" as const } }, "socketOutputRefused"],
    [
      "dirty writable alias",
      { input: { dirtyWritableAliasPresent: true } },
      "dirtyWritableAliasRefused",
    ],
    ["same arch", { targetArch: "arm64" as const }, "sameArchProductSuccessRefused"],
    ["argv restart", { shortcuts: { argvRestartAttempted: true } }, "argvRestartRefused"],
    [
      "target execve from argv",
      { shortcuts: { execveFromArgvAttempted: true } },
      "targetExecveFromArgvRefused",
    ],
    ["output replay", { shortcuts: { outputReplayAttempted: true } }, "outputReplayRefused"],
    [
      "descriptor-only success",
      { shortcuts: { descriptorOnlySuccessAttempted: true } },
      "descriptorOnlySuccessRefused",
    ],
  ])("refuses unsafe cat capture: %s", (_name, patch, refusal) => {
    const request = mergeCatRequest(eligibleCatRequest(), patch);
    const classification = classifyCrossArchCatContinuationCapture(request);
    const plan = planCrossArchCatContinuationTarget({
      classification,
      target: { ...readyCatTargetRequest().target, targetPid: 7101 },
    });

    expect(classification.state).toBe("refused");
    expect(classification.productContinuationEligible).toBe(false);
    expect(classification.targetProcessPlanned).toBe(false);
    expect(classification.refusals).toContain(refusal);
    expect(plan).toMatchObject({
      state: "refused",
      resumedFromCapturedSemanticState: false,
      targetProcessStarted: false,
      targetProcessKilledOnRefusal: true,
      argvRestartUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
    });
  });

  it("refuses target markers that would replay bytes before the captured cursor", () => {
    const request = readyCatTargetRequest();
    request.target.marker = {
      sourceReadOffset: 32,
      targetFirstByteOffset: 0,
      targetFirstByteHex: "70",
      replayedByteOffsets: [0, 1, 2],
      freshRestartWouldStartAtOffset: 0,
      finalReadOffset: 64,
    };

    const plan = planCrossArchCatContinuationTarget(request);

    expect(plan.state).toBe("refused");
    expect(plan.targetProcessStarted).toBe(false);
    expect(plan.targetProcessKilledOnRefusal).toBe(true);
    expect(plan.refusals).toEqual(
      expect.arrayContaining([
        "markerReplaysBytesBeforeCapturedOffset",
        "markerContainsReplayedByteOffsets",
      ]),
    );
  });
});

function mergeCatRequest(
  request: CrossArchCatContinuationRequest,
  patch: DeepPartial<CrossArchCatContinuationRequest>,
): CrossArchCatContinuationRequest {
  return {
    ...request,
    ...patch,
    process: { ...request.process, ...patch.process },
    input: { ...request.input, ...patch.input },
    output: { ...request.output, ...patch.output },
    safePoint: { ...request.safePoint, ...patch.safePoint },
    targetPreflight: { ...request.targetPreflight, ...patch.targetPreflight },
    shortcuts: { ...request.shortcuts, ...patch.shortcuts },
  };
}

function eligibleDdRequest(): CrossArchDdContinuationRequest {
  return {
    sourceArch: "arm64",
    targetArch: "amd64",
    process: {
      pid: 4200,
      executable: "/usr/bin/dd",
      argv: ["/usr/bin/dd", "if=/tmp/in.bin", "of=/tmp/out.bin", "bs=16"],
      cwd: "/tmp",
      executableSha256: "dd-sha256",
    },
    input: {
      kind: "regular-file",
      path: "/tmp/in.bin",
      device: "dev:1",
      inode: "ino:11",
      identityDigest: "dd-input-identity",
      size: 128,
      mtimeMs: 222_000,
      contentHashWindow: "input-window-around-64",
      dirtyWritableAliasPresent: false,
    },
    output: {
      kind: "regular-file",
      path: "/tmp/out.bin",
      device: "dev:1",
      inode: "ino:12",
      identityDigest: "dd-output-identity",
      size: 64,
      mtimeMs: 222_001,
      contentHashWindow: "output-window-around-64",
      dirtyWritableAliasPresent: false,
    },
    copyState: {
      blockSize: 16,
      inputOffset: 64,
      outputOffset: 64,
      partialBlockHex: "64642d7061727469616c",
      partialBlockLength: 0,
      partialBlockComplete: true,
      recordsIn: 4,
      recordsOut: 4,
      bytesCopied: 64,
      convFlags: ["none"],
      directIo: false,
      sparseRequested: false,
      signalStatusPending: false,
      statusOutputCursor: 0,
    },
    safePoint: {
      kind: "between-blocks",
      evidence: "stopped after block 4 copied and counters flushed",
    },
    targetPreflight: {
      inputIdentityVerified: true,
      outputIdentityVerified: true,
      inputOpenable: true,
      outputOpenable: true,
      offsetsInstallable: true,
      countersInstallable: true,
      crossIsaCopyVesselAvailable: true,
      noTargetProcessBeforeEligibilityEvidence:
        "target pid absent before dd eligible classification",
    },
  };
}

function readyDdTargetRequest(): CrossArchDdTargetContinuationRequest {
  const classification = classifyCrossArchDdContinuationCapture(eligibleDdRequest());
  return {
    classification,
    target: {
      crossIsaVerified: true,
      copyVesselCreated: true,
      inputIdentityVerified: true,
      outputIdentityVerified: true,
      inputSeekInstalled: true,
      outputSeekInstalled: true,
      partialBlockInstalled: true,
      countersInstalled: true,
      noRecopyGuardInstalled: true,
      targetPid: 7200,
      marker: {
        sourceInputOffset: 64,
        sourceOutputOffset: 64,
        targetFirstInputOffset: 64,
        targetFirstOutputOffset: 64,
        recopiedInputOffsets: [],
        freshRestartWouldStartInputOffset: 0,
        recordsInStart: 4,
        recordsOutStart: 4,
        finalInputOffset: 128,
        finalOutputOffset: 128,
      },
    },
  };
}

describe("cross-arch next-binary dd continuation", () => {
  it("captures eligible dd regular-file copy state as cross-ISA semantic state", () => {
    const classification = classifyCrossArchDdContinuationCapture(eligibleDdRequest());

    expect(classification).toMatchObject({
      primitive: "cross-arch-dd-regular-file-semantic-continuation-v1",
      state: "eligible",
      refusals: [],
      productContinuationEligible: true,
      targetProcessPlanned: false,
    });
    expect(classification.capture).toMatchObject({
      architecture: { sourceArch: "arm64", targetArch: "amd64", crossIsa: true },
      process: { executable: "/usr/bin/dd" },
      input: { path: "/tmp/in.bin", identityDigest: "dd-input-identity" },
      output: { path: "/tmp/out.bin", identityDigest: "dd-output-identity" },
      copyState: {
        blockSize: 16,
        inputOffset: 64,
        outputOffset: 64,
        partialBlockHex: "64642d7061727469616c",
        recordsIn: 4,
        recordsOut: 4,
        bytesCopied: 64,
        convFlags: ["none"],
      },
      safePoint: { kind: "between-blocks" },
      targetPreflight: { crossIsaCopyVesselAvailable: true },
    });
  });

  it("plans target dd continuation from captured offsets without recopy or argv restart", () => {
    const plan = planCrossArchDdContinuationTarget(readyDdTargetRequest());

    expect(plan).toMatchObject({
      primitive: "cross-arch-dd-regular-file-semantic-continuation-v1",
      state: "ready",
      targetPid: 7200,
      resumedFromCapturedSemanticState: true,
      targetProcessStarted: true,
      targetProcessKilledOnRefusal: false,
      argvRestartUsed: false,
      execveFromArgvUsed: false,
      reexecUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
      sourceIsaEmulationUsed: false,
      sourceFdTeleportationUsed: false,
      metadataOnlySuccessUsed: false,
      marker: {
        sourceInputOffset: 64,
        sourceOutputOffset: 64,
        targetFirstInputOffset: 64,
        targetFirstOutputOffset: 64,
        recopiedInputOffsets: [],
        freshRestartWouldStartInputOffset: 0,
        recordsInStart: 4,
        recordsOutStart: 4,
      },
    });
  });

  it.each([
    ["device input", { input: { kind: "device" as const } }, "deviceInputRefused"],
    ["pipe output", { output: { kind: "pipe" as const } }, "pipeOutputRefused"],
    [
      "dirty writable alias",
      { output: { dirtyWritableAliasPresent: true } },
      "dirtyWritableAliasRefused",
    ],
    ["direct I/O", { copyState: { directIo: true } }, "directIoRefused"],
    ["sparse mode", { copyState: { sparseRequested: true } }, "sparseModeRefused"],
    ["unsafe conv flag", { copyState: { convFlags: ["sync" as const] } }, "unsafeConvFlagRefused"],
    [
      "signal pending",
      { copyState: { signalStatusPending: true } },
      "signalInterruptedStatusRefused",
    ],
    ["same arch", { targetArch: "arm64" as const }, "sameArchProductSuccessRefused"],
    ["argv restart", { shortcuts: { argvRestartAttempted: true } }, "argvRestartRefused"],
    ["output replay", { shortcuts: { outputReplayAttempted: true } }, "outputReplayRefused"],
    [
      "descriptor-only success",
      { shortcuts: { descriptorOnlySuccessAttempted: true } },
      "descriptorOnlySuccessRefused",
    ],
  ])("refuses unsafe dd capture: %s", (_name, patch, refusal) => {
    const request = mergeDdRequest(eligibleDdRequest(), patch);
    const classification = classifyCrossArchDdContinuationCapture(request);
    const plan = planCrossArchDdContinuationTarget({
      classification,
      target: { ...readyDdTargetRequest().target, targetPid: 7201 },
    });

    expect(classification.state).toBe("refused");
    expect(classification.productContinuationEligible).toBe(false);
    expect(classification.targetProcessPlanned).toBe(false);
    expect(classification.refusals).toContain(refusal);
    expect(plan).toMatchObject({
      state: "refused",
      resumedFromCapturedSemanticState: false,
      targetProcessStarted: false,
      targetProcessKilledOnRefusal: true,
      argvRestartUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
    });
  });

  it("refuses target markers that would recopy input before the captured offset", () => {
    const request = readyDdTargetRequest();
    request.target.marker = {
      sourceInputOffset: 64,
      sourceOutputOffset: 64,
      targetFirstInputOffset: 0,
      targetFirstOutputOffset: 0,
      recopiedInputOffsets: [0, 16, 32],
      freshRestartWouldStartInputOffset: 0,
      recordsInStart: 0,
      recordsOutStart: 0,
      finalInputOffset: 128,
      finalOutputOffset: 128,
    };

    const plan = planCrossArchDdContinuationTarget(request);

    expect(plan.state).toBe("refused");
    expect(plan.targetProcessStarted).toBe(false);
    expect(plan.targetProcessKilledOnRefusal).toBe(true);
    expect(plan.refusals).toEqual(
      expect.arrayContaining([
        "markerRecopiesInputBeforeCapturedOffset",
        "markerRewritesOutputBeforeCapturedOffset",
        "markerContainsRecopiedInputOffsets",
      ]),
    );
  });
});

function mergeDdRequest(
  request: CrossArchDdContinuationRequest,
  patch: DeepPartial<CrossArchDdContinuationRequest>,
): CrossArchDdContinuationRequest {
  return {
    ...request,
    ...patch,
    process: { ...request.process, ...patch.process },
    input: { ...request.input, ...patch.input },
    output: { ...request.output, ...patch.output },
    copyState: { ...request.copyState, ...patch.copyState },
    safePoint: { ...request.safePoint, ...patch.safePoint },
    targetPreflight: { ...request.targetPreflight, ...patch.targetPreflight },
    shortcuts: { ...request.shortcuts, ...patch.shortcuts },
  };
}

function eligibleWcLineRequest(): CrossArchWcLineContinuationRequest {
  return {
    sourceArch: "arm64",
    targetArch: "amd64",
    process: {
      pid: 4300,
      executable: "/usr/bin/wc",
      argv: ["/usr/bin/wc", "-l", "/tmp/lines.txt"],
      cwd: "/tmp",
      executableSha256: "wc-sha256",
    },
    input: {
      kind: "regular-file",
      path: "/tmp/lines.txt",
      device: "dev:1",
      inode: "ino:21",
      identityDigest: "wc-input-identity",
      size: 100,
      mtimeMs: 333_000,
      contentHashWindow: "line-window-around-50",
      byteOffset: 50,
      dirtyWritableAliasPresent: false,
    },
    parserState: {
      lineCountSoFar: 7,
      partialNewlineState: "at-boundary",
      lineDecoderState: "byte-newline",
      locale: "C",
      broadByteModeRequested: false,
      broadCharModeRequested: false,
      broadWordModeRequested: false,
      multipleInputsPresent: false,
    },
    output: {
      stdoutKind: "regular-file",
      stdoutCursor: 2,
      stderrCursor: 0,
      terminalSessionAbsent: true,
    },
    safePoint: {
      kind: "between-lines",
      evidence: "stopped after counting seven complete newline records",
    },
    targetPreflight: {
      inputIdentityVerified: true,
      contentHashWindowMatches: true,
      inputOpenable: true,
      byteOffsetInstallable: true,
      lineCounterInstallable: true,
      stdoutCursorInstallable: true,
      crossIsaLineCounterVesselAvailable: true,
      noTargetProcessBeforeEligibilityEvidence:
        "target pid absent before wc eligible classification",
    },
  };
}

function readyWcLineTargetRequest(): CrossArchWcLineTargetContinuationRequest {
  const classification = classifyCrossArchWcLineContinuationCapture(eligibleWcLineRequest());
  return {
    classification,
    target: {
      crossIsaVerified: true,
      lineCounterVesselCreated: true,
      inputIdentityVerified: true,
      contentWindowVerified: true,
      byteOffsetSeekInstalled: true,
      lineCountInstalled: true,
      newlineStateInstalled: true,
      stdoutCursorInstalled: true,
      noRereadGuardInstalled: true,
      targetPid: 7300,
      marker: {
        sourceByteOffset: 50,
        sourceLineCountSoFar: 7,
        suffixLineCount: 5,
        targetFinalLineCount: 12,
        targetFirstByteOffset: 50,
        rereadByteOffsets: [],
        freshRestartWouldStartByteOffset: 0,
      },
    },
  };
}

describe("cross-arch next-binary wc -l continuation", () => {
  it("captures eligible wc -l line-count state as cross-ISA semantic state", () => {
    const classification = classifyCrossArchWcLineContinuationCapture(eligibleWcLineRequest());

    expect(classification).toMatchObject({
      primitive: "cross-arch-wc-line-semantic-continuation-v1",
      state: "eligible",
      refusals: [],
      productContinuationEligible: true,
      targetProcessPlanned: false,
    });
    expect(classification.capture).toMatchObject({
      architecture: { sourceArch: "arm64", targetArch: "amd64", crossIsa: true },
      process: { executable: "/usr/bin/wc", argv: ["/usr/bin/wc", "-l", "/tmp/lines.txt"] },
      input: {
        path: "/tmp/lines.txt",
        identityDigest: "wc-input-identity",
        contentHashWindow: "line-window-around-50",
        byteOffset: 50,
      },
      parserState: {
        lineCountSoFar: 7,
        partialNewlineState: "at-boundary",
        lineDecoderState: "byte-newline",
        locale: "C",
      },
      output: { stdoutCursor: 2, stderrCursor: 0, terminalSessionAbsent: true },
      safePoint: { kind: "between-lines" },
      targetPreflight: { crossIsaLineCounterVesselAvailable: true },
    });
  });

  it("plans target wc -l continuation from captured offset and count without reread or argv restart", () => {
    const plan = planCrossArchWcLineContinuationTarget(readyWcLineTargetRequest());

    expect(plan).toMatchObject({
      primitive: "cross-arch-wc-line-semantic-continuation-v1",
      state: "ready",
      targetPid: 7300,
      resumedFromCapturedSemanticState: true,
      targetProcessStarted: true,
      targetProcessKilledOnRefusal: false,
      argvRestartUsed: false,
      execveFromArgvUsed: false,
      reexecUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
      sourceIsaEmulationUsed: false,
      sourceFdTeleportationUsed: false,
      metadataOnlySuccessUsed: false,
      marker: {
        sourceByteOffset: 50,
        sourceLineCountSoFar: 7,
        suffixLineCount: 5,
        targetFinalLineCount: 12,
        targetFirstByteOffset: 50,
        rereadByteOffsets: [],
        freshRestartWouldStartByteOffset: 0,
      },
    });
  });

  it.each([
    [
      "broad byte mode",
      { parserState: { broadByteModeRequested: true } },
      "broadWcByteModeRefused",
    ],
    [
      "broad char mode",
      { parserState: { broadCharModeRequested: true } },
      "broadWcCharModeRefused",
    ],
    [
      "broad word mode",
      { parserState: { broadWordModeRequested: true } },
      "broadWcWordModeRefused",
    ],
    [
      "multiple inputs",
      { parserState: { multipleInputsPresent: true } },
      "multipleInputsWithoutListCursorRefused",
    ],
    [
      "unknown newline",
      { parserState: { partialNewlineState: "unknown" as const } },
      "partialNewlineStateMissing",
    ],
    [
      "unknown decoder",
      { parserState: { lineDecoderState: "unknown" as const } },
      "lineDecoderStateMissing",
    ],
    ["pipe input", { input: { kind: "pipe" as const } }, "pipeInputRefused"],
    ["same arch", { targetArch: "arm64" as const }, "sameArchProductSuccessRefused"],
    ["argv restart", { shortcuts: { argvRestartAttempted: true } }, "argvRestartRefused"],
    ["output replay", { shortcuts: { outputReplayAttempted: true } }, "outputReplayRefused"],
    [
      "descriptor-only success",
      { shortcuts: { descriptorOnlySuccessAttempted: true } },
      "descriptorOnlySuccessRefused",
    ],
  ])("refuses unsafe wc -l capture: %s", (_name, patch, refusal) => {
    const request = mergeWcLineRequest(eligibleWcLineRequest(), patch);
    const classification = classifyCrossArchWcLineContinuationCapture(request);
    const plan = planCrossArchWcLineContinuationTarget({
      classification,
      target: { ...readyWcLineTargetRequest().target, targetPid: 7301 },
    });

    expect(classification.state).toBe("refused");
    expect(classification.productContinuationEligible).toBe(false);
    expect(classification.targetProcessPlanned).toBe(false);
    expect(classification.refusals).toContain(refusal);
    expect(plan).toMatchObject({
      state: "refused",
      resumedFromCapturedSemanticState: false,
      targetProcessStarted: false,
      targetProcessKilledOnRefusal: true,
      argvRestartUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
    });
  });

  it("refuses target markers that reread bytes or ignore the captured line count", () => {
    const request = readyWcLineTargetRequest();
    request.target.marker = {
      sourceByteOffset: 50,
      sourceLineCountSoFar: 7,
      suffixLineCount: 5,
      targetFinalLineCount: 5,
      targetFirstByteOffset: 0,
      rereadByteOffsets: [0, 1, 2],
      freshRestartWouldStartByteOffset: 0,
    };

    const plan = planCrossArchWcLineContinuationTarget(request);

    expect(plan.state).toBe("refused");
    expect(plan.targetProcessStarted).toBe(false);
    expect(plan.targetProcessKilledOnRefusal).toBe(true);
    expect(plan.refusals).toEqual(
      expect.arrayContaining([
        "markerRereadsBytesBeforeCapturedOffset",
        "markerContainsRereadByteOffsets",
        "markerFinalLineCountNotCapturedPlusSuffix",
      ]),
    );
  });
});

function mergeWcLineRequest(
  request: CrossArchWcLineContinuationRequest,
  patch: DeepPartial<CrossArchWcLineContinuationRequest>,
): CrossArchWcLineContinuationRequest {
  return {
    ...request,
    ...patch,
    process: { ...request.process, ...patch.process },
    input: { ...request.input, ...patch.input },
    parserState: { ...request.parserState, ...patch.parserState },
    output: { ...request.output, ...patch.output },
    safePoint: { ...request.safePoint, ...patch.safePoint },
    targetPreflight: { ...request.targetPreflight, ...patch.targetPreflight },
    shortcuts: { ...request.shortcuts, ...patch.shortcuts },
  };
}

function eligibleSeqRequest(): CrossArchSeqContinuationRequest {
  return {
    sourceArch: "arm64",
    targetArch: "amd64",
    process: {
      pid: 4400,
      executable: "/usr/bin/seq",
      argv: ["/usr/bin/seq", "1", "10"],
      cwd: "/tmp",
      executableSha256: "seq-sha256",
    },
    sequenceState: {
      firstValue: "1",
      currentValue: "4",
      nextValue: "5",
      endValue: "10",
      stepValue: "1",
      format: "%g",
      separator: "\n",
      emittedItemCursor: 4,
      stdoutCursor: 8,
      partialFormattedValue: undefined,
      partialFormattedValueComplete: true,
      integerOnly: true,
      locale: "C",
      numericPrecisionAssumption: "safe-integer",
    },
    output: {
      stdoutKind: "regular-file",
      stderrCursor: 0,
      terminalSessionAbsent: true,
    },
    safePoint: {
      kind: "between-values",
      evidence: "stopped after emitting value 4 and separator",
    },
    targetPreflight: {
      generatorVesselAvailable: true,
      numericPrecisionMatches: true,
      formatInstallable: true,
      stdoutCursorInstallable: true,
      crossIsaGeneratorVesselAvailable: true,
      noTargetProcessBeforeEligibilityEvidence:
        "target pid absent before seq eligible classification",
    },
  };
}

function readySeqTargetRequest(): CrossArchSeqTargetContinuationRequest {
  const classification = classifyCrossArchSeqContinuationCapture(eligibleSeqRequest());
  return {
    classification,
    target: {
      crossIsaVerified: true,
      generatorVesselCreated: true,
      nextValueInstalled: true,
      endStepFormatInstalled: true,
      stdoutCursorInstalled: true,
      noRestartGuardInstalled: true,
      targetPid: 7400,
      marker: {
        sourceFirstValue: "1",
        sourceCurrentValue: "4",
        sourceNextValue: "5",
        targetFirstEmittedValue: "5",
        emittedItemCursorStart: 4,
        freshRestartWouldEmitFirstValue: "1",
        replayedValues: [],
      },
    },
  };
}

describe("cross-arch next-binary seq continuation", () => {
  it("captures eligible seq generator state as cross-ISA semantic state", () => {
    const classification = classifyCrossArchSeqContinuationCapture(eligibleSeqRequest());

    expect(classification).toMatchObject({
      primitive: "cross-arch-seq-semantic-continuation-v1",
      state: "eligible",
      refusals: [],
      productContinuationEligible: true,
      targetProcessPlanned: false,
    });
    expect(classification.capture).toMatchObject({
      architecture: { sourceArch: "arm64", targetArch: "amd64", crossIsa: true },
      process: { executable: "/usr/bin/seq", argv: ["/usr/bin/seq", "1", "10"] },
      sequenceState: {
        firstValue: "1",
        currentValue: "4",
        nextValue: "5",
        endValue: "10",
        stepValue: "1",
        format: "%g",
        separator: "\n",
        emittedItemCursor: 4,
        stdoutCursor: 8,
        integerOnly: true,
        locale: "C",
        numericPrecisionAssumption: "safe-integer",
      },
      output: { stderrCursor: 0, terminalSessionAbsent: true },
      safePoint: { kind: "between-values" },
      targetPreflight: { crossIsaGeneratorVesselAvailable: true },
    });
  });

  it("plans target seq continuation from captured next value without restarting at the first value", () => {
    const plan = planCrossArchSeqContinuationTarget(readySeqTargetRequest());

    expect(plan).toMatchObject({
      primitive: "cross-arch-seq-semantic-continuation-v1",
      state: "ready",
      targetPid: 7400,
      resumedFromCapturedSemanticState: true,
      targetProcessStarted: true,
      targetProcessKilledOnRefusal: false,
      argvRestartUsed: false,
      execveFromArgvUsed: false,
      reexecUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
      sourceIsaEmulationUsed: false,
      sourceFdTeleportationUsed: false,
      metadataOnlySuccessUsed: false,
      marker: {
        sourceFirstValue: "1",
        sourceCurrentValue: "4",
        sourceNextValue: "5",
        targetFirstEmittedValue: "5",
        emittedItemCursorStart: 4,
        freshRestartWouldEmitFirstValue: "1",
        replayedValues: [],
      },
    });
  });

  it.each([
    [
      "floating format",
      { sequenceState: { integerOnly: false } },
      "unsupportedFloatingFormatRefused",
    ],
    [
      "floating precision",
      { sequenceState: { numericPrecisionAssumption: "floating" as const } },
      "unsupportedFloatingPrecisionRefused",
    ],
    ["unknown locale", { sequenceState: { locale: "unknown" as const } }, "unmodeledLocaleRefused"],
    [
      "missing partial formatted value",
      {
        safePoint: { kind: "partial-value" as const },
        sequenceState: { partialFormattedValueComplete: false },
      },
      "partialFormattedValueStateMissing",
    ],
    ["terminal output", { output: { stdoutKind: "terminal" as const } }, "terminalOutputRefused"],
    ["same arch", { targetArch: "arm64" as const }, "sameArchProductSuccessRefused"],
    ["argv restart", { shortcuts: { argvRestartAttempted: true } }, "argvRestartRefused"],
    ["output replay", { shortcuts: { outputReplayAttempted: true } }, "outputReplayRefused"],
    [
      "descriptor-only success",
      { shortcuts: { descriptorOnlySuccessAttempted: true } },
      "descriptorOnlySuccessRefused",
    ],
  ])("refuses unsafe seq capture: %s", (_name, patch, refusal) => {
    const request = mergeSeqRequest(eligibleSeqRequest(), patch);
    const classification = classifyCrossArchSeqContinuationCapture(request);
    const plan = planCrossArchSeqContinuationTarget({
      classification,
      target: { ...readySeqTargetRequest().target, targetPid: 7401 },
    });

    expect(classification.state).toBe("refused");
    expect(classification.productContinuationEligible).toBe(false);
    expect(classification.targetProcessPlanned).toBe(false);
    expect(classification.refusals).toContain(refusal);
    expect(plan).toMatchObject({
      state: "refused",
      resumedFromCapturedSemanticState: false,
      targetProcessStarted: false,
      targetProcessKilledOnRefusal: true,
      argvRestartUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
    });
  });

  it("refuses target markers that restart at the first value", () => {
    const request = readySeqTargetRequest();
    request.target.marker = {
      sourceFirstValue: "1",
      sourceCurrentValue: "4",
      sourceNextValue: "5",
      targetFirstEmittedValue: "1",
      emittedItemCursorStart: 0,
      freshRestartWouldEmitFirstValue: "1",
      replayedValues: ["1", "2", "3", "4"],
    };

    const plan = planCrossArchSeqContinuationTarget(request);

    expect(plan.state).toBe("refused");
    expect(plan.targetProcessStarted).toBe(false);
    expect(plan.targetProcessKilledOnRefusal).toBe(true);
    expect(plan.refusals).toEqual(
      expect.arrayContaining(["markerDoesNotEmitCapturedNextValue", "markerReplaysFirstValue"]),
    );
  });
});

function mergeSeqRequest(
  request: CrossArchSeqContinuationRequest,
  patch: DeepPartial<CrossArchSeqContinuationRequest>,
): CrossArchSeqContinuationRequest {
  return {
    ...request,
    ...patch,
    process: { ...request.process, ...patch.process },
    sequenceState: { ...request.sequenceState, ...patch.sequenceState },
    output: { ...request.output, ...patch.output },
    safePoint: { ...request.safePoint, ...patch.safePoint },
    targetPreflight: { ...request.targetPreflight, ...patch.targetPreflight },
    shortcuts: { ...request.shortcuts, ...patch.shortcuts },
  };
}

function eligibleFixedStringGrepRequest(): CrossArchFixedStringGrepContinuationRequest {
  return {
    sourceArch: "arm64",
    targetArch: "amd64",
    process: {
      pid: 4500,
      executable: "/usr/bin/grep",
      argv: ["/usr/bin/grep", "-F", "needle", "/tmp/haystack.txt"],
      cwd: "/tmp",
      executableSha256: "grep-sha256",
    },
    pattern: {
      patternBytesHex: "6e6565646c65",
      fixedString: true,
      caseInsensitive: false,
      locale: "C",
    },
    input: {
      kind: "regular-file",
      path: "/tmp/haystack.txt",
      device: "dev:1",
      inode: "ino:31",
      identityDigest: "grep-input-identity",
      size: 180,
      mtimeMs: 444_000,
      contentHashWindow: "grep-window-around-90",
      byteOffset: 90,
      dirtyWritableAliasPresent: false,
    },
    parserState: {
      partialLineBufferHex: "7061727469616c",
      partialLineComplete: true,
      lineDecoderState: "byte-line",
      matcherState: "fixed-string-boundary",
      matchCountSoFar: 2,
      lastCompletedLineNumber: 8,
      regexModeRequested: false,
      pcreModeRequested: false,
      backrefsPresent: false,
      contextOutputRequested: false,
      colorOutputRequested: false,
      binaryFileModeUnmodeled: false,
      recursiveInputRequested: false,
      multipleFilesPresent: false,
    },
    output: {
      stdoutKind: "regular-file",
      stdoutCursor: 24,
      stderrCursor: 0,
      terminalSessionAbsent: true,
    },
    safePoint: {
      kind: "between-lines",
      evidence: "stopped after line 8 and two fixed-string matches",
    },
    targetPreflight: {
      inputIdentityVerified: true,
      contentHashWindowMatches: true,
      inputOpenable: true,
      byteOffsetInstallable: true,
      matcherStateInstallable: true,
      outputCursorInstallable: true,
      crossIsaFixedStringMatcherVesselAvailable: true,
      noTargetProcessBeforeEligibilityEvidence:
        "target pid absent before grep eligible classification",
    },
  };
}

function readyFixedStringGrepTargetRequest(): CrossArchFixedStringGrepTargetContinuationRequest {
  const classification = classifyCrossArchFixedStringGrepContinuationCapture(
    eligibleFixedStringGrepRequest(),
  );
  return {
    classification,
    target: {
      crossIsaVerified: true,
      matcherVesselCreated: true,
      inputIdentityVerified: true,
      contentWindowVerified: true,
      byteOffsetSeekInstalled: true,
      partialLineInstalled: true,
      matcherStateInstalled: true,
      matchCountInstalled: true,
      outputCursorInstalled: true,
      noRematchGuardInstalled: true,
      targetPid: 7500,
      marker: {
        sourceByteOffset: 90,
        sourceMatchCountSoFar: 2,
        targetFirstScannedByteOffset: 90,
        targetFirstMatchedLineNumber: 9,
        priorMatchedLinesReplayed: [],
        rematchedLineNumbers: [],
        freshRestartWouldVisitLine: 1,
        matchCountStart: 2,
      },
    },
  };
}

describe("cross-arch next-binary fixed-string grep continuation", () => {
  it("captures eligible fixed-string grep state as cross-ISA semantic state", () => {
    const classification = classifyCrossArchFixedStringGrepContinuationCapture(
      eligibleFixedStringGrepRequest(),
    );

    expect(classification).toMatchObject({
      primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1",
      state: "eligible",
      refusals: [],
      productContinuationEligible: true,
      targetProcessPlanned: false,
    });
    expect(classification.capture).toMatchObject({
      architecture: { sourceArch: "arm64", targetArch: "amd64", crossIsa: true },
      process: {
        executable: "/usr/bin/grep",
        argv: ["/usr/bin/grep", "-F", "needle", "/tmp/haystack.txt"],
      },
      pattern: { patternBytesHex: "6e6565646c65", fixedString: true, locale: "C" },
      input: {
        path: "/tmp/haystack.txt",
        identityDigest: "grep-input-identity",
        contentHashWindow: "grep-window-around-90",
        byteOffset: 90,
      },
      parserState: {
        partialLineBufferHex: "7061727469616c",
        lineDecoderState: "byte-line",
        matcherState: "fixed-string-boundary",
        matchCountSoFar: 2,
        lastCompletedLineNumber: 8,
      },
      output: { stdoutCursor: 24, stderrCursor: 0, terminalSessionAbsent: true },
      safePoint: { kind: "between-lines" },
      targetPreflight: { crossIsaFixedStringMatcherVesselAvailable: true },
    });
  });

  it("plans target fixed-string grep continuation without rematching or replaying prior lines", () => {
    const plan = planCrossArchFixedStringGrepContinuationTarget(
      readyFixedStringGrepTargetRequest(),
    );

    expect(plan).toMatchObject({
      primitive: "cross-arch-grep-fixed-string-semantic-continuation-v1",
      state: "ready",
      targetPid: 7500,
      resumedFromCapturedSemanticState: true,
      targetProcessStarted: true,
      targetProcessKilledOnRefusal: false,
      argvRestartUsed: false,
      execveFromArgvUsed: false,
      reexecUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
      sourceIsaEmulationUsed: false,
      sourceFdTeleportationUsed: false,
      metadataOnlySuccessUsed: false,
      marker: {
        sourceByteOffset: 90,
        sourceMatchCountSoFar: 2,
        targetFirstScannedByteOffset: 90,
        targetFirstMatchedLineNumber: 9,
        priorMatchedLinesReplayed: [],
        rematchedLineNumbers: [],
        freshRestartWouldVisitLine: 1,
        matchCountStart: 2,
      },
    });
  });

  it.each([
    ["regex mode", { parserState: { regexModeRequested: true } }, "regexModeRefused"],
    ["PCRE mode", { parserState: { pcreModeRequested: true } }, "pcreModeRefused"],
    ["backrefs", { parserState: { backrefsPresent: true } }, "backrefsRefused"],
    ["context output", { parserState: { contextOutputRequested: true } }, "contextOutputRefused"],
    ["color output", { parserState: { colorOutputRequested: true } }, "colorOutputRefused"],
    ["binary mode", { parserState: { binaryFileModeUnmodeled: true } }, "binaryFileModeRefused"],
    [
      "recursive input",
      { parserState: { recursiveInputRequested: true } },
      "recursiveInputRefused",
    ],
    [
      "multiple files",
      { parserState: { multipleFilesPresent: true } },
      "multipleFilesWithoutListCursorRefused",
    ],
    ["pipe input", { input: { kind: "pipe" as const } }, "pipeInputRefused"],
    ["same arch", { targetArch: "arm64" as const }, "sameArchProductSuccessRefused"],
    ["argv restart", { shortcuts: { argvRestartAttempted: true } }, "argvRestartRefused"],
    ["output replay", { shortcuts: { outputReplayAttempted: true } }, "outputReplayRefused"],
    [
      "descriptor-only success",
      { shortcuts: { descriptorOnlySuccessAttempted: true } },
      "descriptorOnlySuccessRefused",
    ],
  ])("refuses unsafe fixed-string grep capture: %s", (_name, patch, refusal) => {
    const request = mergeFixedStringGrepRequest(eligibleFixedStringGrepRequest(), patch);
    const classification = classifyCrossArchFixedStringGrepContinuationCapture(request);
    const plan = planCrossArchFixedStringGrepContinuationTarget({
      classification,
      target: { ...readyFixedStringGrepTargetRequest().target, targetPid: 7501 },
    });

    expect(classification.state).toBe("refused");
    expect(classification.productContinuationEligible).toBe(false);
    expect(classification.targetProcessPlanned).toBe(false);
    expect(classification.refusals).toContain(refusal);
    expect(plan).toMatchObject({
      state: "refused",
      resumedFromCapturedSemanticState: false,
      targetProcessStarted: false,
      targetProcessKilledOnRefusal: true,
      argvRestartUsed: false,
      outputReplayUsed: false,
      descriptorOnlySuccessUsed: false,
    });
  });

  it("refuses target markers that rematch or replay prior lines", () => {
    const request = readyFixedStringGrepTargetRequest();
    request.target.marker = {
      sourceByteOffset: 90,
      sourceMatchCountSoFar: 2,
      targetFirstScannedByteOffset: 0,
      targetFirstMatchedLineNumber: 3,
      priorMatchedLinesReplayed: [3, 6],
      rematchedLineNumbers: [1, 8],
      freshRestartWouldVisitLine: 1,
      matchCountStart: 0,
    };

    const plan = planCrossArchFixedStringGrepContinuationTarget(request);

    expect(plan.state).toBe("refused");
    expect(plan.targetProcessStarted).toBe(false);
    expect(plan.targetProcessKilledOnRefusal).toBe(true);
    expect(plan.refusals).toEqual(
      expect.arrayContaining([
        "markerScansBeforeCapturedOffset",
        "markerRematchesPriorLines",
        "markerReplaysPriorMatchedOutput",
      ]),
    );
  });
});

function mergeFixedStringGrepRequest(
  request: CrossArchFixedStringGrepContinuationRequest,
  patch: DeepPartial<CrossArchFixedStringGrepContinuationRequest>,
): CrossArchFixedStringGrepContinuationRequest {
  return {
    ...request,
    ...patch,
    process: { ...request.process, ...patch.process },
    pattern: { ...request.pattern, ...patch.pattern },
    input: { ...request.input, ...patch.input },
    parserState: { ...request.parserState, ...patch.parserState },
    output: { ...request.output, ...patch.output },
    safePoint: { ...request.safePoint, ...patch.safePoint },
    targetPreflight: { ...request.targetPreflight, ...patch.targetPreflight },
    shortcuts: { ...request.shortcuts, ...patch.shortcuts },
  };
}
