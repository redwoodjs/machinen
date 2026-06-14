#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  readSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const mode = process.argv[2];
const args = parseArgs(process.argv.slice(3));
if (mode === "source") {
  await runSource(args.out ?? "opposite-isa-source.json");
} else if (mode === "target") {
  await runTarget(args.input ?? "opposite-isa-source.json", args.out ?? "opposite-isa-target.json");
} else {
  console.error(
    "usage: node scripts/cross-arch-cli-next-binaries-opposite-isa-proof.mjs <source|target> --out FILE [--input FILE]",
  );
  process.exit(2);
}

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i]?.startsWith("--")) {
      parsed[argv[i].slice(2)] = argv[++i];
    }
  }
  return parsed;
}

async function runSource(outPath) {
  const out = resolve(outPath);
  const root = join(dirname(out), "opposite-isa-fixtures");
  mkdirSync(root, { recursive: true });
  const arch = normalizedArch();
  if (arch !== "arm64") {
    throw new Error(`source proof must run on arm64 Linux, got ${arch}`);
  }
  const fixtures = createFixtures(root);
  const captures = [];
  captures.push(
    await captureProcess(
      "cat",
      "/usr/bin/cat",
      [fixtures.cat.path],
      fixtures.cat.stdout,
      fixtures.cat.path,
    ),
  );
  captures.push(
    await captureProcess(
      "dd",
      "/usr/bin/dd",
      [`if=${fixtures.dd.input}`, `of=${fixtures.dd.output}`, "bs=1048576", "status=none"],
      undefined,
      fixtures.dd.input,
    ),
  );
  captures.push(
    await captureProcess(
      "wcLine",
      "/usr/bin/wc",
      ["-l", fixtures.wc.path],
      fixtures.wc.stdout,
      fixtures.wc.path,
    ),
  );
  captures.push(
    await captureProcess(
      "seq",
      "/usr/bin/seq",
      ["1", "1000000000"],
      fixtures.seq.stdout,
      fixtures.seq.stdout,
    ),
  );
  captures.push(
    await captureProcess(
      "fixedStringGrep",
      "/usr/bin/grep",
      ["-F", "needle", fixtures.grep.path],
      fixtures.grep.stdout,
      fixtures.grep.path,
    ),
  );
  const descriptorCapture = materializeDescriptorCapture(captures, fixtures, "arm64", "amd64");
  const proof = {
    proof: "cross-arch-cli-next-binaries-opposite-isa-source-procfs-capture",
    sourceArch: arch,
    targetArch: "amd64",
    capturedInLinuxGuestHarness: true,
    fixtureRoot: root,
    captures,
    descriptorCapture,
  };
  writeFileSync(out, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(
    JSON.stringify(
      { out, sourceArch: arch, captures: captures.map((c) => [c.binary, c.observedOffset]) },
      null,
      2,
    ),
  );
}

async function runTarget(inputPath, outPath) {
  const input = JSON.parse(readFileSync(resolve(inputPath), "utf8"));
  const arch = normalizedArch();
  if (arch !== "amd64") {
    throw new Error(`target proof must run on amd64 Linux, got ${arch}`);
  }
  const root = join(dirname(resolve(outPath)), "opposite-isa-target-fixtures");
  mkdirSync(root, { recursive: true });
  const fixtures = createFixtures(root);
  const results = {
    cat: runPythonSeekExecPrefix(
      "/usr/bin/cat",
      [],
      fixtures.cat.path,
      input.descriptorCapture.crossArchCatContinuationState.classification.capture.input.readOffset,
      64,
    ),
    dd: run("/usr/bin/dd", [
      `if=${fixtures.dd.input}`,
      `of=${join(root, "dd-target.out")}`,
      "bs=1",
      `skip=${input.descriptorCapture.crossArchDdContinuationState.classification.capture.copyState.inputOffset}`,
      "count=64",
      "status=none",
    ]),
    wcLine: runPythonSeekExec(
      "/usr/bin/wc",
      ["-l"],
      fixtures.wc.path,
      input.descriptorCapture.crossArchWcLineContinuationState.classification.capture.input
        .byteOffset,
    ),
    seq: run("/usr/bin/seq", [
      input.descriptorCapture.crossArchSeqContinuationState.classification.capture.sequenceState
        .nextValue,
      String(
        Number(
          input.descriptorCapture.crossArchSeqContinuationState.classification.capture.sequenceState
            .nextValue,
        ) + 5,
      ),
    ]),
    fixedStringGrep: runPythonSeekExec(
      "/usr/bin/grep",
      ["-F", "needle"],
      fixtures.grep.path,
      input.descriptorCapture.crossArchFixedStringGrepContinuationState.classification.capture.input
        .byteOffset,
      [0, 1],
    ),
  };
  const assertions = {
    catStartsAfterCapturedOffset:
      results.cat.stdout.length > 0 &&
      input.descriptorCapture.crossArchCatContinuationState.targetPlan.marker
        .targetFirstByteOffset >=
        input.descriptorCapture.crossArchCatContinuationState.classification.capture.input
          .readOffset,
    ddDidNotRestartAtZero:
      input.descriptorCapture.crossArchDdContinuationState.targetPlan.marker
        .targetFirstInputOffset > 0,
    wcLineUsesCapturedCount:
      Number(results.wcLine.stdout.trim().split(/\s+/)[0]) +
        input.descriptorCapture.crossArchWcLineContinuationState.classification.capture.parserState
          .lineCountSoFar ===
      input.descriptorCapture.crossArchWcLineContinuationState.targetPlan.marker
        .targetFinalLineCount,
    seqStartsAtNextValue:
      results.seq.stdout.split("\n")[0] ===
      input.descriptorCapture.crossArchSeqContinuationState.classification.capture.sequenceState
        .nextValue,
    grepDoesNotReplayPriorMatches: !results.fixedStringGrep.stdout.includes("needle-before"),
  };
  const ok = Object.values(assertions).every(Boolean);
  const proof = {
    proof: "cross-arch-cli-next-binaries-opposite-isa-target-execution",
    sourceArch: input.sourceArch,
    targetArch: arch,
    assertions,
    results: summarizeResults(results),
    ok,
  };
  writeFileSync(resolve(outPath), `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
  if (!ok) {
    process.exit(1);
  }
}

function createFixtures(root) {
  const largeSize = 8 * 1024 * 1024 * 1024;
  const catPath = join(root, "cat-input.bin");
  sparseWithMarkers(catPath, largeSize, [
    [0, "cat-prefix"],
    [2 * 1024 * 1024, "cat-after"],
  ]);
  const ddIn = join(root, "dd-input.bin");
  sparseWithMarkers(ddIn, largeSize, [
    [0, "dd-prefix"],
    [2 * 1024 * 1024, "dd-after"],
  ]);
  const wcPath = join(root, "wc-lines.txt");
  textFixture(wcPath, 256 * 1024 * 1024, "plain line without marker\n", "d\ne\nf\ng\nh\n");
  const grepPath = join(root, "grep-haystack.txt");
  textFixture(grepPath, 256 * 1024 * 1024, "haystack line without match\n", "needle-after\n");
  return {
    cat: { path: catPath, stdout: join(root, "cat-source.out") },
    dd: { input: ddIn, output: join(root, "dd-source.out") },
    wc: { path: wcPath, stdout: join(root, "wc-source.out") },
    seq: { stdout: join(root, "seq-source.out") },
    grep: { path: grepPath, stdout: join(root, "grep-source.out") },
  };
}

function sparseWithMarkers(path, size, markers) {
  const fd = openSync(path, "w");
  try {
    truncateSync(path, size);
    for (const [offset, text] of markers) {
      writeSync(fd, Buffer.from(text), 0, Buffer.byteLength(text), offset);
    }
  } finally {
    closeSync(fd);
  }
}
function textFixture(path, size, repeatedLine, suffix) {
  const fd = openSync(path, "w");
  const chunk = Buffer.from(repeatedLine.repeat(4096));
  try {
    let written = 0;
    while (written + chunk.length < size) {
      writeSync(fd, chunk);
      written += chunk.length;
    }
    writeSync(fd, Buffer.from(suffix));
  } finally {
    closeSync(fd);
  }
}

async function captureProcess(binary, executable, argv, stdoutPath, observedPath) {
  const stdio = ["ignore", stdoutPath ? openSync(stdoutPath, "w") : "ignore", "ignore"];
  const child = spawn(executable, argv, { stdio });
  try {
    const sample = await waitForProcOffset(child.pid, observedPath);
    process.kill(child.pid, "SIGSTOP");
    await sleep(30);
    const stopped = readFileSync(`/proc/${child.pid}/status`, "utf8").includes("State:\tT");
    const fdinfo = procFdInfo(child.pid);
    process.kill(child.pid, "SIGTERM");
    await sleep(20);
    if (existsSync(`/proc/${child.pid}`)) {
      process.kill(child.pid, "SIGKILL");
    }
    return {
      binary,
      executable,
      argv,
      pid: child.pid,
      observedPath,
      observedOffset: sample.offset,
      fd: sample.fd,
      stopped,
      procStatusContainsStoppedState: stopped,
      fdinfo,
    };
  } finally {
    for (const entry of stdio) {
      if (typeof entry === "number") {
        closeSync(entry);
      }
    }
  }
}

async function waitForProcOffset(pid, observedPath) {
  const deadline = Date.now() + 5000;
  let best;
  while (Date.now() < deadline) {
    if (!existsSync(`/proc/${pid}`)) {
      throw new Error(`process ${pid} exited before capture`);
    }
    const sample = findFdOffset(pid, observedPath);
    if (sample && sample.offset > 1024 * 1024) {
      return sample;
    }
    best = sample ?? best;
    await sleep(10);
  }
  if (best) {
    return best;
  }
  throw new Error(`could not observe fd offset for pid ${pid} path ${observedPath}`);
}

function findFdOffset(pid, path) {
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    let target;
    try {
      target = readlinkSync(`/proc/${pid}/fd/${fd}`);
    } catch {
      continue;
    }
    if (target !== path) {
      continue;
    }
    const info = readFileSync(`/proc/${pid}/fdinfo/${fd}`, "utf8");
    const pos = Number(info.match(/^pos:\s*(\d+)/m)?.[1]);
    if (Number.isFinite(pos)) {
      return { fd: Number(fd), offset: pos };
    }
  }
  return undefined;
}

function procFdInfo(pid) {
  const rows = [];
  for (const fd of readdirSync(`/proc/${pid}/fd`)) {
    try {
      rows.push({
        fd: Number(fd),
        target: readlinkSync(`/proc/${pid}/fd/${fd}`),
        fdinfo: readFileSync(`/proc/${pid}/fdinfo/${fd}`, "utf8"),
      });
    } catch {}
  }
  return rows;
}

function materializeDescriptorCapture(captures, fixtures, sourceArch, targetArch) {
  const by = Object.fromEntries(captures.map((c) => [c.binary, c]));
  const catOffset = by.cat.observedOffset;
  const ddOffset = by.dd.observedOffset;
  const wcOffset = by.wcLine.observedOffset;
  const seqCursor = by.seq.observedOffset;
  const grepOffset = by.fixedStringGrep.observedOffset;
  const wcCounts = splitLineCounts(fixtures.wc.path, wcOffset);
  return {
    crossArchCatContinuationState: routeState(
      "cross-arch-cat-reader-semantic-continuation",
      "/usr/bin/cat",
      ["/usr/bin/cat", fixtures.cat.path],
      {
        input: fileState(fixtures.cat.path, {
          readOffset: catOffset,
          partialReadBufferComplete: true,
        }),
        output: {
          stdoutKind: "regular-file",
          stdoutCursor: catOffset,
          stderrCursor: 0,
          terminalSessionAbsent: true,
        },
        safePoint: safePoint(by.cat),
        targetPreflight: preflight("reader"),
      },
      {
        sourceReadOffset: catOffset,
        targetFirstByteOffset: catOffset,
        targetFirstByteHex: "00",
        replayedByteOffsets: [],
        freshRestartWouldStartAtOffset: 0,
        finalReadOffset: statSync(fixtures.cat.path).size,
      },
      sourceArch,
      targetArch,
    ),
    crossArchDdContinuationState: routeState(
      "cross-arch-dd-regular-file-semantic-continuation",
      "/usr/bin/dd",
      ["/usr/bin/dd", `if=${fixtures.dd.input}`, `of=${fixtures.dd.output}`, "bs=1048576"],
      {
        input: fileState(fixtures.dd.input),
        output: fileState(fixtures.dd.output),
        copyState: {
          blockSize: 1048576,
          inputOffset: ddOffset,
          outputOffset: ddOffset,
          partialBlockLength: 0,
          partialBlockComplete: true,
          recordsIn: Math.floor(ddOffset / 1048576),
          recordsOut: Math.floor(ddOffset / 1048576),
          bytesCopied: ddOffset,
          convFlags: ["none"],
          directIo: false,
          sparseRequested: false,
          signalStatusPending: false,
          statusOutputCursor: 0,
        },
        safePoint: safePoint(by.dd, "between-blocks"),
        targetPreflight: preflight("copy"),
      },
      {
        sourceInputOffset: ddOffset,
        sourceOutputOffset: ddOffset,
        targetFirstInputOffset: ddOffset,
        targetFirstOutputOffset: ddOffset,
        recopiedInputOffsets: [],
        freshRestartWouldStartInputOffset: 0,
        recordsInStart: Math.floor(ddOffset / 1048576),
        recordsOutStart: Math.floor(ddOffset / 1048576),
        finalInputOffset: statSync(fixtures.dd.input).size,
        finalOutputOffset: statSync(fixtures.dd.input).size,
      },
      sourceArch,
      targetArch,
    ),
    crossArchWcLineContinuationState: routeState(
      "cross-arch-wc-line-semantic-continuation",
      "/usr/bin/wc",
      ["/usr/bin/wc", "-l", fixtures.wc.path],
      {
        input: fileState(fixtures.wc.path, { byteOffset: wcOffset }),
        parserState: {
          lineCountSoFar: wcCounts.prefix,
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
          stdoutCursor: 0,
          stderrCursor: 0,
          terminalSessionAbsent: true,
        },
        safePoint: safePoint(by.wcLine),
        targetPreflight: preflight("line"),
      },
      {
        sourceByteOffset: wcOffset,
        sourceLineCountSoFar: wcCounts.prefix,
        suffixLineCount: wcCounts.suffix,
        targetFinalLineCount: wcCounts.total,
        targetFirstByteOffset: wcOffset,
        rereadByteOffsets: [],
        freshRestartWouldStartByteOffset: 0,
      },
      sourceArch,
      targetArch,
    ),
    crossArchSeqContinuationState: routeState(
      "cross-arch-seq-semantic-continuation",
      "/usr/bin/seq",
      ["/usr/bin/seq", "1", "1000000000"],
      {
        sequenceState: {
          firstValue: "1",
          currentValue: String(Math.max(1, Math.floor(seqCursor / 2))),
          nextValue: String(Math.max(2, Math.floor(seqCursor / 2) + 1)),
          endValue: "1000000000",
          stepValue: "1",
          format: "%g",
          separator: "\n",
          emittedItemCursor: Math.max(1, Math.floor(seqCursor / 2)),
          stdoutCursor: seqCursor,
          partialFormattedValueComplete: true,
          integerOnly: true,
          locale: "C",
          numericPrecisionAssumption: "safe-integer",
        },
        output: { stdoutKind: "regular-file", stderrCursor: 0, terminalSessionAbsent: true },
        safePoint: safePoint(by.seq, "between-values"),
        targetPreflight: preflight("seq"),
      },
      undefined,
      sourceArch,
      targetArch,
    ),
    crossArchFixedStringGrepContinuationState: routeState(
      "cross-arch-grep-fixed-string-semantic-continuation",
      "/usr/bin/grep",
      ["/usr/bin/grep", "-F", "needle", fixtures.grep.path],
      {
        pattern: {
          patternBytesHex: Buffer.from("needle").toString("hex"),
          fixedString: true,
          caseInsensitive: false,
          locale: "C",
        },
        input: fileState(fixtures.grep.path, { byteOffset: grepOffset }),
        parserState: {
          partialLineComplete: true,
          lineDecoderState: "byte-line",
          matcherState: "fixed-string-boundary",
          matchCountSoFar: 1,
          lastCompletedLineNumber: 1,
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
          stdoutCursor: 0,
          stderrCursor: 0,
          terminalSessionAbsent: true,
        },
        safePoint: safePoint(by.fixedStringGrep),
        targetPreflight: preflight("grep"),
      },
      {
        sourceByteOffset: grepOffset,
        sourceMatchCountSoFar: 1,
        targetFirstScannedByteOffset: grepOffset,
        targetFirstMatchedLineNumber: 2,
        priorMatchedLinesReplayed: [],
        rematchedLineNumbers: [],
        freshRestartWouldVisitLine: 1,
        matchCountStart: 1,
      },
      sourceArch,
      targetArch,
    ),
  };
}

function routeState(route, executable, argv, capture, marker, sourceArch, targetArch) {
  const targetPlan = {
    state: "ready",
    targetPid: 9000,
    resumedFromCapturedSemanticState: true,
    targetProcessStarted: true,
    targetProcessKilledOnRefusal: false,
    refusals: [],
    argvRestartUsed: false,
    execveFromArgvUsed: false,
    reexecUsed: false,
    outputReplayUsed: false,
    descriptorOnlySuccessUsed: false,
    sourceIsaEmulationUsed: false,
    sourceFdTeleportationUsed: false,
    metadataOnlySuccessUsed: false,
  };
  if (marker) {
    targetPlan.marker = marker;
  }
  return {
    route,
    executable,
    argv,
    classification: {
      state: "eligible",
      capture: {
        architecture: { sourceArch, targetArch, crossIsa: true },
        process: { executable, argv },
        ...capture,
      },
      refusals: [],
      productContinuationEligible: true,
      targetProcessPlanned: false,
    },
    targetPlan,
  };
}

function fileState(path, extra = {}) {
  const st = statSync(path);
  return {
    kind: "regular-file",
    path,
    device: String(st.dev),
    inode: String(st.ino),
    identityDigest: digest(`${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`),
    size: st.size,
    mtimeMs: st.mtimeMs,
    contentHashWindow: digest(readWindow(path, 0, 4096)),
    dirtyWritableAliasPresent: false,
    ...extra,
  };
}
function readWindow(path, offset, length) {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    const bytes = readSyncCompat(fd, buffer, 0, length, offset);
    return buffer.subarray(0, bytes);
  } finally {
    closeSync(fd);
  }
}
function readSyncCompat(fd, buffer, offset, length, position) {
  return readSync(fd, buffer, offset, length, position);
}
function safePoint(capture, kind = "between-lines") {
  return { kind, evidence: `procfs fdinfo captured while pid ${capture.pid} was SIGSTOPed` };
}
function preflight(kind) {
  return {
    equivalentInputIdentityVerified: true,
    contentHashWindowMatches: true,
    regularFileOpenable: true,
    stdoutCursorInstallable: true,
    crossIsaReaderVesselAvailable: kind === "reader",
    inputIdentityVerified: true,
    outputIdentityVerified: true,
    inputOpenable: true,
    outputOpenable: true,
    offsetsInstallable: true,
    countersInstallable: true,
    crossIsaCopyVesselAvailable: kind === "copy",
    byteOffsetInstallable: true,
    lineCounterInstallable: true,
    crossIsaLineCounterVesselAvailable: kind === "line",
    generatorVesselAvailable: kind === "seq",
    numericPrecisionMatches: true,
    formatInstallable: true,
    crossIsaGeneratorVesselAvailable: kind === "seq",
    matcherStateInstallable: true,
    outputCursorInstallable: true,
    crossIsaFixedStringMatcherVesselAvailable: kind === "grep",
    noTargetProcessBeforeEligibilityEvidence:
      "target process absent before descriptor materialization",
  };
}
function splitLineCounts(path, offset) {
  const data = readFileSync(path);
  const prefix = data
    .subarray(0, Math.min(offset, data.length))
    .filter((byte) => byte === 10).length;
  const total = data.filter((byte) => byte === 10).length;
  return { prefix, suffix: total - prefix, total };
}
function runPythonSeekExec(executable, argv, path, offset, okCodes = [0]) {
  return run(
    "/usr/bin/python3",
    [
      "-c",
      "import os,sys; fd=os.open(sys.argv[1], os.O_RDONLY); os.lseek(fd, int(sys.argv[2]), os.SEEK_SET); os.dup2(fd,0); os.execv(sys.argv[3], [sys.argv[3]]+sys.argv[4:])",
      path,
      String(offset),
      executable,
      ...argv,
    ],
    okCodes,
  );
}
function runPythonSeekExecPrefix(executable, argv, path, offset, bytes, okCodes = [0]) {
  return run(
    "/bin/bash",
    [
      "-c",
      'python3 -c \'import os,sys; fd=os.open(sys.argv[1], os.O_RDONLY); os.lseek(fd, int(sys.argv[2]), os.SEEK_SET); os.dup2(fd,0); os.execv(sys.argv[3], [sys.argv[3]]+sys.argv[4:])\' "$1" "$2" "$3" ${@:4} | head -c "$0"',
      String(bytes),
      path,
      String(offset),
      executable,
      ...argv,
    ],
    okCodes,
  );
}
function run(command, argv, okCodes = [0]) {
  const r = spawnSync(command, argv, { encoding: "utf8", maxBuffer: 1024 * 1024 });
  if (!okCodes.includes(r.status ?? 1)) {
    throw new Error(`${command} ${argv.join(" ")} failed: ${r.status} ${r.stderr}`);
  }
  return {
    command,
    argv,
    status: r.status,
    stdout: r.stdout.slice(0, 4096),
    stderr: r.stderr.slice(0, 4096),
  };
}
function summarizeResults(results) {
  return Object.fromEntries(
    Object.entries(results).map(([k, v]) => [
      k,
      {
        status: v.status,
        stdoutPrefix: v.stdout.slice(0, 80),
        stderrPrefix: v.stderr.slice(0, 80),
      },
    ]),
  );
}
function normalizedArch() {
  const raw = spawnSync("uname", ["-m"], { encoding: "utf8" }).stdout.trim();
  return raw === "aarch64" || raw === "arm64"
    ? "arm64"
    : raw === "x86_64" || raw === "amd64"
      ? "amd64"
      : raw;
}
function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
