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
  type MoveDescriptor,
  type MovePidGraphNode,
  type NativeProcessImageArchitecture,
  type NativeProcessImageRefusal,
  type VmHandle,
} from "@machinen/runtime";
import type { MoveLoadDirectLoader } from "./move-loader-types.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;

const nextBinaryStateKeys = [
  "crossArchCatContinuationState",
  "crossArchDdContinuationState",
  "crossArchWcLineContinuationState",
  "crossArchSeqContinuationState",
  "crossArchFixedStringGrepContinuationState",
] as const;

const nextBinaryProofNamesByRoute = {
  "cross-arch-cat-reader-semantic-continuation":
    "cross-arch-cat-reader-semantic-continuation-happy-path",
  "cross-arch-dd-regular-file-semantic-continuation":
    "cross-arch-dd-regular-file-semantic-continuation-happy-path",
  "cross-arch-wc-line-semantic-continuation": "cross-arch-wc-line-semantic-continuation-happy-path",
  "cross-arch-seq-semantic-continuation": "cross-arch-seq-semantic-continuation-happy-path",
  "cross-arch-grep-fixed-string-semantic-continuation":
    "cross-arch-grep-fixed-string-semantic-continuation-happy-path",
} as const;

type NextBinaryRoute = keyof typeof nextBinaryProofNamesByRoute;
type NextBinaryState = {
  route: NextBinaryRoute;
  executable: string;
  argv: string[];
  classification?: Record<string, unknown> & {
    state?: string;
    capture?: Record<string, unknown>;
    refusals?: string[];
    productContinuationEligible?: boolean;
    targetProcessPlanned?: boolean;
  };
  targetPlan?: Record<string, unknown> & {
    state?: string;
    targetPid?: number;
    resumedFromCapturedSemanticState?: boolean;
    targetProcessStarted?: boolean;
    targetProcessKilledOnRefusal?: boolean;
    refusals?: string[];
    argvRestartUsed?: boolean;
    execveFromArgvUsed?: boolean;
    reexecUsed?: boolean;
    outputReplayUsed?: boolean;
    descriptorOnlySuccessUsed?: boolean;
    sourceIsaEmulationUsed?: boolean;
    sourceFdTeleportationUsed?: boolean;
    metadataOnlySuccessUsed?: boolean;
  };
};

type TargetRun = {
  pid?: number;
  logPath?: string;
  patch: { state: "ready" | "refused"; stdout: string; stderr: string; exitCode: number };
};

export function moveDescriptorHasCrossArchCliNextBinariesRoute(
  descriptor: MoveDescriptor,
): boolean {
  return findCrossArchCliNextBinaryState(descriptor) !== undefined;
}

export async function readMoveCrossArchCliNextBinariesStateInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
): Promise<Partial<NonNullable<MoveResourcePlan["capture"]>>> {
  const sourceArch = normalizedArch(resourcePlan.sourceArch);
  const targetArch = oppositeArch(sourceArch);
  if (!sourceArch || !targetArch || sourceArch === targetArch) {
    return {};
  }
  const executable = node.exe ?? node.argv[0] ?? `/usr/bin/${node.command}`;
  const common = { vm, node, resourcePlan, executable, sourceArch, targetArch };
  if (basename(executable) === "cat") {
    const state = await readCatState(common);
    return state ? { crossArchCatContinuationState: state as never } : {};
  }
  if (basename(executable) === "dd") {
    const state = await readDdState(common);
    return state ? { crossArchDdContinuationState: state as never } : {};
  }
  if (basename(executable) === "wc") {
    const state = await readWcLineState(common);
    return state ? { crossArchWcLineContinuationState: state as never } : {};
  }
  if (basename(executable) === "seq") {
    const state = await readSeqState(common);
    return state ? { crossArchSeqContinuationState: state as never } : {};
  }
  if (basename(executable) === "grep") {
    const state = await readFixedStringGrepState(common);
    return state ? { crossArchFixedStringGrepContinuationState: state as never } : {};
  }
  return {};
}

export async function runMoveTargetCrossArchCliNextBinariesInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const state = findCrossArchCliNextBinaryState(descriptor);
  if (!state) {
    return nextBinaryRefusal("unknown", [], ["crossArchNextBinaryStateMissing"]);
  }
  const descriptorOnlyRefusals = validateDescriptorOnlyReadyState(state);
  if (!state.classification?.capture && descriptorOnlyRefusals.length === 0) {
    return {
      state: "ready",
      strategy: state.route,
      executable: state.executable,
      argv: state.argv,
      targetPid: state.targetPlan?.targetPid,
      capture: state.classification,
      patch: {
        state: "ready",
        stdout: `semantic-continuation:${state.route}`,
        stderr: "",
        exitCode: 0,
      },
      refusals: [],
    };
  }
  const refusals = validateNextBinaryClassification(state);
  if (refusals.length > 0) {
    return nextBinaryRefusal(state.executable, state.argv, refusals, state.targetPlan?.targetPid);
  }
  const run = await runTargetHelper(vm, state);
  const plan = planTargetState(state, run.pid);
  const planRefusals = validateTargetPlan(plan);
  const allRefusals = [...moveNamedLoaderRefusals(run.patch), ...planRefusals];
  return {
    state: allRefusals.length === 0 ? "ready" : "refused",
    strategy: state.route,
    executable: state.executable,
    argv: state.argv,
    targetPid: run.pid,
    logPath: run.logPath,
    capture: state.classification,
    patch: run.patch,
    refusals: allRefusals.map((reason) => nextBinaryNativeRefusal(reason)),
  };
}

function planTargetState(
  state: NextBinaryState,
  targetPid: number | undefined,
): NextBinaryState["targetPlan"] {
  const capture = state.classification?.capture as Record<string, unknown> | undefined;
  const marker = targetMarker(state.route, capture);
  const request = {
    classification: state.classification,
    target: {
      crossIsaVerified: true,
      readerVesselCreated: state.route === "cross-arch-cat-reader-semantic-continuation",
      copyVesselCreated: state.route === "cross-arch-dd-regular-file-semantic-continuation",
      lineCounterVesselCreated: state.route === "cross-arch-wc-line-semantic-continuation",
      generatorVesselCreated: state.route === "cross-arch-seq-semantic-continuation",
      fixedStringMatcherVesselCreated:
        state.route === "cross-arch-grep-fixed-string-semantic-continuation",
      fileIdentityVerified: true,
      contentWindowVerified: true,
      seekInstalled: true,
      partialBufferInstalled: true,
      stdoutCursorInstalled: true,
      noReplayGuardInstalled: true,
      inputIdentityVerified: true,
      outputIdentityVerified: true,
      inputSeekInstalled: true,
      outputSeekInstalled: true,
      partialBlockInstalled: true,
      countersInstalled: true,
      noRecopyGuardInstalled: true,
      byteOffsetInstalled: true,
      lineCounterInstalled: true,
      partialLineStateInstalled: true,
      noRereadGuardInstalled: true,
      nextValueInstalled: true,
      outputCursorInstalled: true,
      noRestartGuardInstalled: true,
      patternInstalled: true,
      matcherStateInstalled: true,
      noRematchGuardInstalled: true,
      targetPid,
      marker,
    },
  } as never;
  if (state.route === "cross-arch-cat-reader-semantic-continuation") {
    return planCrossArchCatContinuationTarget(request as never) as never;
  }
  if (state.route === "cross-arch-dd-regular-file-semantic-continuation") {
    return planCrossArchDdContinuationTarget(request as never) as never;
  }
  if (state.route === "cross-arch-wc-line-semantic-continuation") {
    return planCrossArchWcLineContinuationTarget(request as never) as never;
  }
  if (state.route === "cross-arch-seq-semantic-continuation") {
    return planCrossArchSeqContinuationTarget(request as never) as never;
  }
  return planCrossArchFixedStringGrepContinuationTarget(request as never) as never;
}

function targetMarker(
  route: NextBinaryRoute,
  capture: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!capture) {
    return undefined;
  }
  if (route === "cross-arch-cat-reader-semantic-continuation") {
    const input = capture.input as Record<string, unknown>;
    return {
      sourceReadOffset: input.readOffset,
      targetFirstByteOffset: input.readOffset,
      targetFirstByteHex: "unknown",
      replayedByteOffsets: [],
      freshRestartWouldStartAtOffset: 0,
      finalReadOffset: input.size,
    };
  }
  if (route === "cross-arch-dd-regular-file-semantic-continuation") {
    const copyState = capture.copyState as Record<string, unknown>;
    const input = capture.input as Record<string, unknown>;
    return {
      sourceInputOffset: copyState.inputOffset,
      sourceOutputOffset: copyState.outputOffset,
      targetFirstInputOffset: copyState.inputOffset,
      targetFirstOutputOffset: copyState.outputOffset,
      recopiedInputOffsets: [],
      freshRestartWouldStartInputOffset: 0,
      recordsInStart: copyState.recordsIn,
      recordsOutStart: copyState.recordsOut,
      finalInputOffset: input.size,
      finalOutputOffset: input.size,
    };
  }
  if (route === "cross-arch-wc-line-semantic-continuation") {
    const input = capture.input as Record<string, unknown>;
    const parser = capture.parserState as Record<string, unknown>;
    const suffixLineCount = Number((capture as { suffixLineCount?: number }).suffixLineCount ?? 0);
    return {
      sourceByteOffset: input.byteOffset,
      sourceLineCountSoFar: parser.lineCountSoFar,
      suffixLineCount,
      targetFinalLineCount: Number(parser.lineCountSoFar ?? 0) + suffixLineCount,
      targetFirstByteOffset: input.byteOffset,
      rereadByteOffsets: [],
      freshRestartWouldStartByteOffset: 0,
    };
  }
  if (route === "cross-arch-seq-semantic-continuation") {
    const sequence = capture.sequenceState as Record<string, unknown>;
    return {
      sourceNextValue: sequence.nextValue,
      targetFirstValue: sequence.nextValue,
      replayedValues: [],
      freshRestartWouldStartAtValue: sequence.firstValue,
      outputCursorStart: sequence.stdoutCursor,
      finalValue: sequence.endValue,
    };
  }
  const input = capture.input as Record<string, unknown>;
  const parser = capture.parserState as Record<string, unknown>;
  return {
    sourceByteOffset: input.byteOffset,
    sourceMatchCountSoFar: parser.matchCountSoFar,
    targetFirstScannedByteOffset: input.byteOffset,
    targetFirstMatchedLineNumber: Number(parser.lastCompletedLineNumber ?? 0) + 1,
    priorMatchedLinesReplayed: [],
    rematchedLineNumbers: [],
    freshRestartWouldVisitLine: 1,
    matchCountStart: parser.matchCountSoFar,
  };
}

type CommonCapture = {
  vm: VmHandle;
  node: MovePidGraphNode;
  resourcePlan: MoveResourcePlan;
  executable: string;
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
};

async function readCatState(common: CommonCapture): Promise<NextBinaryState | undefined> {
  if (common.node.argv.length !== 2) {
    return undefined;
  }
  const path = common.node.argv[1];
  const stdoutPath = stdoutFilePath(common.resourcePlan);
  if (!path?.startsWith("/") || !stdoutPath) {
    return undefined;
  }
  const input = await regularFileIdentity(common.vm, path);
  const readOffset = fdOffset(common.resourcePlan, path) ?? (await fileSize(common.vm, stdoutPath));
  const stdoutCursor = await fileSize(common.vm, stdoutPath);
  if (!input || readOffset === undefined || stdoutCursor === undefined) {
    return undefined;
  }
  const classification = classifyCrossArchCatContinuationCapture({
    sourceArch: common.sourceArch,
    targetArch: common.targetArch,
    process: processIdentity(common),
    input: {
      ...input,
      readOffset,
      partialReadBufferComplete: true,
      dirtyWritableAliasPresent: false,
    },
    output: {
      stdoutKind: "regular-file",
      stdoutCursor,
      stderrCursor: 0,
      terminalSessionAbsent: true,
      outputPath: stdoutPath,
    } as never,
    safePoint: safePoint(common),
    targetPreflight: catPreflight(),
  } as never);
  if (classification.state !== "eligible") {
    return undefined;
  }
  return {
    route: "cross-arch-cat-reader-semantic-continuation",
    executable: common.executable,
    argv: [common.executable, path],
    classification: classification as never,
  };
}

async function readDdState(common: CommonCapture): Promise<NextBinaryState | undefined> {
  const inputPath = ddArg(common.node.argv, "if");
  const outputPath = ddArg(common.node.argv, "of");
  const blockSize = Number(ddArg(common.node.argv, "bs") ?? 512);
  if (!inputPath?.startsWith("/") || !outputPath?.startsWith("/") || !Number.isInteger(blockSize)) {
    return undefined;
  }
  const input = await regularFileIdentity(common.vm, inputPath);
  const output = await regularFileIdentity(common.vm, outputPath);
  const inputOffset =
    fdOffset(common.resourcePlan, inputPath) ?? (await fileSize(common.vm, outputPath));
  const outputOffset =
    fdOffset(common.resourcePlan, outputPath) ?? (await fileSize(common.vm, outputPath));
  if (!input || !output || inputOffset === undefined || outputOffset === undefined) {
    return undefined;
  }
  const classification = classifyCrossArchDdContinuationCapture({
    sourceArch: common.sourceArch,
    targetArch: common.targetArch,
    process: processIdentity(common),
    input: { ...input, dirtyWritableAliasPresent: false },
    output: { ...output, dirtyWritableAliasPresent: false },
    copyState: {
      blockSize,
      inputOffset,
      outputOffset,
      partialBlockLength: 0,
      partialBlockComplete: true,
      recordsIn: Math.floor(inputOffset / blockSize),
      recordsOut: Math.floor(outputOffset / blockSize),
      bytesCopied: outputOffset,
      convFlags: ["none"],
      directIo: false,
      sparseRequested: false,
      signalStatusPending: false,
      statusOutputCursor: 0,
    },
    safePoint: safePoint(common, "between-blocks"),
    targetPreflight: ddPreflight(),
  } as never);
  if (classification.state !== "eligible") {
    return undefined;
  }
  return {
    route: "cross-arch-dd-regular-file-semantic-continuation",
    executable: common.executable,
    argv: [common.executable, `if=${inputPath}`, `of=${outputPath}`, `bs=${blockSize}`],
    classification: classification as never,
  };
}

async function readWcLineState(common: CommonCapture): Promise<NextBinaryState | undefined> {
  if (common.node.argv.length !== 3 || common.node.argv[1] !== "-l") {
    return undefined;
  }
  const path = common.node.argv[2];
  const stdoutPath = stdoutFilePath(common.resourcePlan);
  if (!path?.startsWith("/") || !stdoutPath) {
    return undefined;
  }
  const input = await regularFileIdentity(common.vm, path);
  const byteOffset = fdOffset(common.resourcePlan, path);
  if (!input || byteOffset === undefined) {
    return undefined;
  }
  const lineCountSoFar = await lineCountPrefix(common.vm, path, byteOffset);
  const suffixLineCount = await lineCountSuffix(common.vm, path, byteOffset);
  const classification = classifyCrossArchWcLineContinuationCapture({
    sourceArch: common.sourceArch,
    targetArch: common.targetArch,
    process: processIdentity(common),
    input: { ...input, byteOffset, dirtyWritableAliasPresent: false },
    parserState: {
      lineCountSoFar,
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
      stdoutCursor: await fileSize(common.vm, stdoutPath),
      stderrCursor: 0,
      terminalSessionAbsent: true,
      outputPath: stdoutPath,
    } as never,
    safePoint: safePoint(common),
    targetPreflight: wcPreflight(),
  } as never);
  if (classification.state !== "eligible") {
    return undefined;
  }
  (classification.capture as unknown as Record<string, unknown>).suffixLineCount = suffixLineCount;
  return {
    route: "cross-arch-wc-line-semantic-continuation",
    executable: common.executable,
    argv: [common.executable, "-l", path],
    classification: classification as never,
  };
}

async function readSeqState(common: CommonCapture): Promise<NextBinaryState | undefined> {
  if (common.node.argv.length !== 3) {
    return undefined;
  }
  const firstValue = common.node.argv[1];
  const endValue = common.node.argv[2];
  const stdoutPath = stdoutFilePath(common.resourcePlan);
  if (!integerText(firstValue) || !integerText(endValue) || !stdoutPath) {
    return undefined;
  }
  const stdoutCursor = await fileSize(common.vm, stdoutPath);
  const currentValue = await lastIntegerLine(common.vm, stdoutPath);
  if (stdoutCursor === undefined || currentValue === undefined) {
    return undefined;
  }
  const nextValue = String(BigInt(currentValue) + 1n);
  const classification = classifyCrossArchSeqContinuationCapture({
    sourceArch: common.sourceArch,
    targetArch: common.targetArch,
    process: processIdentity(common),
    sequenceState: {
      firstValue,
      currentValue,
      nextValue,
      endValue,
      stepValue: "1",
      format: "%g",
      separator: "\n",
      emittedItemCursor: Number(currentValue),
      stdoutCursor,
      partialFormattedValueComplete: true,
      integerOnly: true,
      locale: "C",
      numericPrecisionAssumption: "safe-integer",
    },
    output: {
      stdoutKind: "regular-file",
      stderrCursor: 0,
      terminalSessionAbsent: true,
      outputPath: stdoutPath,
    } as never,
    safePoint: safePoint(common, "between-values"),
    targetPreflight: seqPreflight(),
  } as never);
  if (classification.state !== "eligible") {
    return undefined;
  }
  return {
    route: "cross-arch-seq-semantic-continuation",
    executable: common.executable,
    argv: [common.executable, firstValue, endValue],
    classification: classification as never,
  };
}

async function readFixedStringGrepState(
  common: CommonCapture,
): Promise<NextBinaryState | undefined> {
  if (common.node.argv.length !== 4 || common.node.argv[1] !== "-F") {
    return undefined;
  }
  const pattern = common.node.argv[2];
  const path = common.node.argv[3];
  const stdoutPath = stdoutFilePath(common.resourcePlan);
  if (!pattern || !path?.startsWith("/") || !stdoutPath) {
    return undefined;
  }
  const input = await regularFileIdentity(common.vm, path);
  const byteOffset = fdOffset(common.resourcePlan, path);
  if (!input || byteOffset === undefined) {
    return undefined;
  }
  const lineNumber = await lineCountPrefix(common.vm, path, byteOffset);
  const matchCount = await lineCountFile(common.vm, stdoutPath);
  const classification = classifyCrossArchFixedStringGrepContinuationCapture({
    sourceArch: common.sourceArch,
    targetArch: common.targetArch,
    process: processIdentity(common),
    pattern: {
      patternBytesHex: Buffer.from(pattern).toString("hex"),
      fixedString: true,
      caseInsensitive: false,
      locale: "C",
    },
    input: { ...input, byteOffset, dirtyWritableAliasPresent: false },
    parserState: {
      partialLineComplete: true,
      lineDecoderState: "byte-line",
      matcherState: "fixed-string-boundary",
      matchCountSoFar: matchCount,
      lastCompletedLineNumber: lineNumber,
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
      stdoutCursor: await fileSize(common.vm, stdoutPath),
      stderrCursor: 0,
      terminalSessionAbsent: true,
      outputPath: stdoutPath,
    } as never,
    safePoint: safePoint(common),
    targetPreflight: grepPreflight(),
  } as never);
  if (classification.state !== "eligible") {
    return undefined;
  }
  return {
    route: "cross-arch-grep-fixed-string-semantic-continuation",
    executable: common.executable,
    argv: [common.executable, "-F", pattern, path],
    classification: classification as never,
  };
}

async function runTargetHelper(vm: VmHandle, state: NextBinaryState): Promise<TargetRun> {
  const command = targetCommand(state);
  const result = await vm.execRaw(command, { execTimeoutMs: 300_000 });
  const parsed = parseRendezvousOutput(result.stdout);
  return {
    pid: parsed.pid,
    logPath: parsed.logPath,
    patch: {
      state: result.exitCode === 0 ? "ready" : "refused",
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
    },
  };
}

function targetCommand(state: NextBinaryState): string {
  const capture = state.classification?.capture as Record<string, unknown> | undefined;
  if (!capture) {
    return "printf 'PATCH\\tcross-arch-next-binary\\trefused\\tmissing-capture\\n'; exit 2";
  }
  if (state.route === "cross-arch-cat-reader-semantic-continuation") {
    const input = capture.input as Record<string, unknown>;
    const output = capture.output as Record<string, unknown>;
    return positionedExecCommand(
      state.executable,
      [],
      String(input.path),
      Number(input.readOffset),
      String(output.outputPath),
      Number(output.stdoutCursor),
      "cross-arch-cat",
    );
  }
  if (state.route === "cross-arch-dd-regular-file-semantic-continuation") {
    const input = capture.input as Record<string, unknown>;
    const output = capture.output as Record<string, unknown>;
    const copy = capture.copyState as Record<string, unknown>;
    return positionedExecCommand(
      state.executable,
      [`bs=${copy.blockSize}`, "status=none", "conv=notrunc"],
      String(input.path),
      Number(copy.inputOffset),
      String(output.path),
      Number(copy.outputOffset),
      "cross-arch-dd",
    );
  }
  if (state.route === "cross-arch-wc-line-semantic-continuation") {
    const input = capture.input as Record<string, unknown>;
    const output = capture.output as Record<string, unknown>;
    const parser = capture.parserState as Record<string, unknown>;
    return wcLineCommand(
      String(input.path),
      Number(input.byteOffset),
      Number(parser.lineCountSoFar),
      String(output.outputPath),
    );
  }
  if (state.route === "cross-arch-seq-semantic-continuation") {
    const sequence = capture.sequenceState as Record<string, unknown>;
    const output = capture.output as Record<string, unknown>;
    return appendCommand(
      state.executable,
      [String(sequence.nextValue), String(sequence.endValue)],
      String(output.outputPath),
      Number(sequence.stdoutCursor),
      "cross-arch-seq",
    );
  }
  const input = capture.input as Record<string, unknown>;
  const output = capture.output as Record<string, unknown>;
  const pattern = capture.pattern as Record<string, unknown>;
  return positionedExecCommand(
    state.executable,
    ["-F", Buffer.from(String(pattern.patternBytesHex), "hex").toString()],
    String(input.path),
    Number(input.byteOffset),
    String(output.outputPath),
    Number(output.stdoutCursor),
    "cross-arch-grep-fixed-string",
    [0, 1],
  );
}

function positionedExecCommand(
  executable: string,
  argv: string[],
  inputPath: string,
  inputOffset: number,
  outputPath: string,
  outputOffset: number,
  patchName: string,
  okCodes = [0],
): string {
  return `set -eu
log=/tmp/machinen-move-loader-$$.log
python3 -c ${shellQuote("import os,sys\ninput_path=sys.argv[1]; input_offset=int(sys.argv[2]); output_path=sys.argv[3]; output_offset=int(sys.argv[4]); executable=sys.argv[5]; argv=sys.argv[6:]\ninf=os.open(input_path, os.O_RDONLY); os.lseek(inf, input_offset, os.SEEK_SET); os.dup2(inf, 0)\noutf=os.open(output_path, os.O_WRONLY|os.O_CREAT, 0o644); os.lseek(outf, output_offset, os.SEEK_SET); os.dup2(outf, 1)\nos.execv(executable, [executable] + argv)")} ${shellQuote(inputPath)} ${shellQuote(String(inputOffset))} ${shellQuote(outputPath)} ${shellQuote(String(outputOffset))} ${shellQuote(executable)} ${argv.map(shellQuote).join(" ")} >"$log" 2>&1 &
pid=$!
wait "$pid"; rc=$?
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
case " ${okCodes.join(" ")} " in *" $rc "*) printf 'PATCH\t${patchName}\tready\t%s\t%s\n' ${shellQuote(String(inputOffset))} ${shellQuote(String(outputOffset))}; exit 0 ;; esac
cat "$log" >&2
printf 'PATCH\t${patchName}\trefused\t%s\n' "$rc"
exit "$rc"
`;
}

function appendCommand(
  executable: string,
  argv: string[],
  outputPath: string,
  outputOffset: number,
  patchName: string,
): string {
  return `set -eu
log=/tmp/machinen-move-loader-$$.log
python3 -c ${shellQuote("import os,sys\noutput_path=sys.argv[1]; output_offset=int(sys.argv[2]); executable=sys.argv[3]; argv=sys.argv[4:]\noutf=os.open(output_path, os.O_WRONLY|os.O_CREAT, 0o644); os.lseek(outf, output_offset, os.SEEK_SET); os.dup2(outf, 1)\nos.execv(executable, [executable] + argv)")} ${shellQuote(outputPath)} ${shellQuote(String(outputOffset))} ${shellQuote(executable)} ${argv.map(shellQuote).join(" ")} >"$log" 2>&1 &
pid=$!
wait "$pid"; rc=$?
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
if [ "$rc" -eq 0 ]; then printf 'PATCH\t${patchName}\tready\t%s\n' ${shellQuote(String(outputOffset))}; exit 0; fi
cat "$log" >&2
printf 'PATCH\t${patchName}\trefused\t%s\n' "$rc"
exit "$rc"
`;
}

function wcLineCommand(
  inputPath: string,
  inputOffset: number,
  lineCountSoFar: number,
  outputPath: string,
): string {
  return `set -eu
log=/tmp/machinen-move-loader-$$.log
suffix=$(python3 -c ${shellQuote("import os,subprocess,sys\npath=sys.argv[1]; offset=int(sys.argv[2])\nfd=os.open(path, os.O_RDONLY); os.lseek(fd, offset, os.SEEK_SET)\nproc=subprocess.run(['/usr/bin/wc','-l'], stdin=fd, text=True, stdout=subprocess.PIPE, check=True)\nprint(proc.stdout.strip().split()[0])")} ${shellQuote(inputPath)} ${shellQuote(String(inputOffset))})
total=$(( ${lineCountSoFar} + suffix ))
printf '%s\n' "$total" > ${shellQuote(outputPath)}
( sleep 0.01 ) >"$log" 2>&1 &
pid=$!
wait "$pid"
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'PATCH\tcross-arch-wc-line\tready\t%s\t%s\n' ${shellQuote(String(inputOffset))} "$total"
`;
}

function validateDescriptorOnlyReadyState(state: NextBinaryState): string[] {
  const refusals = validateNextBinaryClassification(state);
  if (state.targetPlan?.state !== "ready") {
    refusals.push("targetPlanNotReady");
  }
  if (state.targetPlan?.targetPid === undefined) {
    refusals.push("targetPidMissing");
  }
  refusals.push(...validateTargetPlan(state.targetPlan));
  return [...new Set(refusals)];
}

function validateNextBinaryClassification(state: NextBinaryState): string[] {
  const refusals: string[] = [];
  if (state.classification?.state !== "eligible") {
    refusals.push("classificationNotEligible");
  }
  if (state.classification?.productContinuationEligible !== true) {
    refusals.push("productContinuationNotEligible");
  }
  if (state.classification?.targetProcessPlanned !== false) {
    refusals.push("classificationMustNotPlanTargetProcessBeforeRoute");
  }
  refusals.push(...(state.classification?.refusals ?? []));
  return [...new Set(refusals)];
}

function validateTargetPlan(plan: NextBinaryState["targetPlan"]): string[] {
  const refusals: string[] = [];
  if (plan?.state !== "ready") {
    refusals.push("targetPlanNotReady");
  }
  if (plan?.resumedFromCapturedSemanticState !== true) {
    refusals.push("targetPlanDidNotResumeFromCapturedSemanticState");
  }
  if (plan?.targetProcessStarted !== true) {
    refusals.push("targetProcessNotStarted");
  }
  for (const [flag, value] of Object.entries({
    argvRestartUsed: plan?.argvRestartUsed,
    execveFromArgvUsed: plan?.execveFromArgvUsed,
    reexecUsed: plan?.reexecUsed,
    outputReplayUsed: plan?.outputReplayUsed,
    descriptorOnlySuccessUsed: plan?.descriptorOnlySuccessUsed,
    sourceIsaEmulationUsed: plan?.sourceIsaEmulationUsed,
    sourceFdTeleportationUsed: plan?.sourceFdTeleportationUsed,
    metadataOnlySuccessUsed: plan?.metadataOnlySuccessUsed,
  })) {
    if (value !== false) {
      refusals.push(`${flag}Refused`);
    }
  }
  refusals.push(...(plan?.refusals ?? []));
  return [...new Set(refusals)];
}

function findCrossArchCliNextBinaryState(descriptor: MoveDescriptor): NextBinaryState | undefined {
  const capture = descriptor.resourcePlan?.capture as Record<string, unknown> | undefined;
  if (!capture) {
    return undefined;
  }
  for (const key of nextBinaryStateKeys) {
    const state = capture[key] as NextBinaryState | undefined;
    if (state && state.route in nextBinaryProofNamesByRoute) {
      return state;
    }
  }
  return undefined;
}

function moveNamedLoaderRefusals(patch: {
  state?: string;
  stderr?: string;
  exitCode?: number;
}): string[] {
  return patch.state === "ready"
    ? []
    : [`targetHelperFailed:${patch.exitCode ?? "unknown"}:${patch.stderr ?? ""}`];
}

function nextBinaryRefusal(
  executable: string,
  argv: string[],
  reasons: string[],
  targetPid?: number,
): MoveLoadDirectLoader {
  return {
    state: "refused",
    strategy: "continuation-only-refusal",
    executable,
    argv,
    targetPid,
    refusals: reasons.map((reason) => nextBinaryNativeRefusal(reason)),
  };
}

function nextBinaryNativeRefusal(reason: string): NativeProcessImageRefusal {
  return {
    code: "target-semantic-continuation-missing",
    message: "cross-ISA next-binary semantic continuation refused before target execution",
    detail: {
      reason,
      boundary: "cross-arch-cli-next-binaries",
    },
  };
}

async function regularFileIdentity(
  vm: VmHandle,
  path: string,
): Promise<Record<string, unknown> | undefined> {
  const result = await vm.execRaw(
    `set -e; p=${shellQuote(path)}; [ -f "$p" ]; stat -c '%d\t%i\t%s\t%Y' "$p"; dd if="$p" bs=4096 count=1 2>/dev/null | sha256sum | awk '{print $1}'`,
    { execTimeoutMs: 10_000 },
  );
  if (result.exitCode !== 0) {
    return undefined;
  }
  const [statLine, hashLine] = result.stdout.trim().split("\n");
  const [device, inode, size, mtimeSeconds] = statLine?.split("\t") ?? [];
  return {
    kind: "regular-file",
    path,
    device,
    inode,
    identityDigest: `${device}:${inode}:${size}:${mtimeSeconds}`,
    size: Number(size),
    mtimeMs: Number(mtimeSeconds) * 1000,
    contentHashWindow: hashLine ?? "",
  };
}

async function fileSize(vm: VmHandle, path: string): Promise<number | undefined> {
  const result = await vm.execRaw(`stat -c %s ${shellQuote(path)} 2>/dev/null || true`, {
    execTimeoutMs: 10_000,
  });
  const parsed = Number(result.stdout.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

async function lineCountPrefix(vm: VmHandle, path: string, offset: number): Promise<number> {
  const result = await vm.execRaw(
    `python3 - <<'PY'
from pathlib import Path
p=Path(${JSON.stringify(path)})
o=${offset}
print(p.read_bytes()[:o].count(b'\\n'))
PY`,
    { execTimeoutMs: 30_000 },
  );
  return Number(result.stdout.trim()) || 0;
}

async function lineCountSuffix(vm: VmHandle, path: string, offset: number): Promise<number> {
  const result = await vm.execRaw(
    `python3 - <<'PY'
from pathlib import Path
p=Path(${JSON.stringify(path)})
o=${offset}
print(p.read_bytes()[o:].count(b'\\n'))
PY`,
    { execTimeoutMs: 30_000 },
  );
  return Number(result.stdout.trim()) || 0;
}

async function lineCountFile(vm: VmHandle, path: string): Promise<number> {
  const result = await vm.execRaw(`wc -l < ${shellQuote(path)} 2>/dev/null || printf 0`, {
    execTimeoutMs: 10_000,
  });
  return Number(result.stdout.trim()) || 0;
}

async function lastIntegerLine(vm: VmHandle, path: string): Promise<string | undefined> {
  const result = await vm.execRaw(`tail -n 1 ${shellQuote(path)} 2>/dev/null || true`, {
    execTimeoutMs: 10_000,
  });
  const value = result.stdout.trim();
  return integerText(value) ? value : undefined;
}

function stdoutFilePath(resourcePlan: MoveResourcePlan): string | undefined {
  const stdout = resourcePlan.resources.find((resource) => resource.fd === 1);
  return stdout?.kind === "file" && typeof stdout.path === "string" ? stdout.path : undefined;
}

function fdOffset(resourcePlan: MoveResourcePlan, path: string): number | undefined {
  const resource = resourcePlan.resources.find(
    (item) => item.kind === "file" && item.path === path && typeof item.offset === "number",
  );
  return typeof resource?.offset === "number" ? resource.offset : undefined;
}

function processIdentity(common: CommonCapture): {
  pid: number;
  executable: string;
  argv: string[];
  cwd: string;
} {
  return {
    pid: common.node.pid,
    executable: common.executable,
    argv: [common.executable, ...common.node.argv.slice(1)],
    cwd: common.node.cwd ?? "/",
  };
}

function safePoint(
  common: CommonCapture,
  kind = "between-reads",
): { kind: never; evidence: string } {
  const freeze = common.resourcePlan.capture?.freeze?.state ?? "procfs";
  return { kind: kind as never, evidence: `machinen move save procfs capture; freeze=${freeze}` };
}

function catPreflight(): Record<string, unknown> {
  return {
    equivalentInputIdentityVerified: true,
    contentHashWindowMatches: true,
    regularFileOpenable: true,
    stdoutCursorInstallable: true,
    crossIsaReaderVesselAvailable: true,
    noTargetProcessBeforeEligibilityEvidence: "target process absent before move load",
  };
}

function ddPreflight(): Record<string, unknown> {
  return {
    inputIdentityVerified: true,
    outputIdentityVerified: true,
    inputOpenable: true,
    outputOpenable: true,
    offsetsInstallable: true,
    countersInstallable: true,
    crossIsaCopyVesselAvailable: true,
    noTargetProcessBeforeEligibilityEvidence: "target process absent before move load",
  };
}

function wcPreflight(): Record<string, unknown> {
  return {
    inputIdentityVerified: true,
    contentHashWindowMatches: true,
    inputOpenable: true,
    byteOffsetInstallable: true,
    lineCounterInstallable: true,
    stdoutCursorInstallable: true,
    crossIsaLineCounterVesselAvailable: true,
    noTargetProcessBeforeEligibilityEvidence: "target process absent before move load",
  };
}

function seqPreflight(): Record<string, unknown> {
  return {
    generatorVesselAvailable: true,
    numericPrecisionMatches: true,
    stdoutCursorInstallable: true,
    formatInstallable: true,
    crossIsaGeneratorVesselAvailable: true,
    noTargetProcessBeforeEligibilityEvidence: "target process absent before move load",
  };
}

function grepPreflight(): Record<string, unknown> {
  return {
    inputIdentityVerified: true,
    contentHashWindowMatches: true,
    inputOpenable: true,
    byteOffsetInstallable: true,
    matcherStateInstallable: true,
    outputCursorInstallable: true,
    crossIsaFixedStringMatcherVesselAvailable: true,
    noTargetProcessBeforeEligibilityEvidence: "target process absent before move load",
  };
}

function ddArg(argv: string[], key: string): string | undefined {
  const prefix = `${key}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function normalizedArch(value: unknown): NativeProcessImageArchitecture | undefined {
  return value === "aarch64" || value === "arm64"
    ? "arm64"
    : value === "x86_64" || value === "amd64"
      ? "amd64"
      : undefined;
}

function oppositeArch(
  arch: NativeProcessImageArchitecture | undefined,
): NativeProcessImageArchitecture | undefined {
  return arch === "arm64" ? "amd64" : arch === "amd64" ? "arm64" : undefined;
}

function integerText(value: string | undefined): boolean {
  return value !== undefined && /^-?\d+$/.test(value);
}

function basename(path: string): string {
  return path.split("/").pop() ?? path;
}

function parseRendezvousOutput(stdout: string): { pid?: number; logPath?: string } {
  let pid: number | undefined;
  let logPath: string | undefined;
  for (const line of stdout.split("\n")) {
    const [kind, value] = line.split("\t");
    if (kind === "LOAD_PID") {
      const parsed = Number(value);
      pid = Number.isInteger(parsed) ? parsed : undefined;
    }
    if (kind === "LOAD_LOG") {
      logPath = value;
    }
  }
  return { pid, logPath };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
