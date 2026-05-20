#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CAPTURE_SOURCE,
  CONTROLLED_SOURCE,
  bundleFileStats as sharedBundleFileStats,
  compileControlledTarget,
  compileRawCapturer,
  controlledPortableManifest,
  ensureSourcesExist,
  hostArch,
  layoutField,
  loadRawCapture,
  memoryChunkByName,
  memoryChunkBytes,
  parseControlledMarker,
  readLayoutCString,
  readLayoutUnsigned,
  readSymbols,
  unsupportedVocabulary,
  writePortableBundleFiles,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
  runCommand,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: node scripts/continuation-translate.mjs [verify] [--out-dir path] [--json] [--keep]";
const BUILD_ID = "4204204204204200";
const ANCHOR_SYMBOL = "machinen_controlled_continuation_anchor";
const FRAME_CHUNK = "machinen_controlled_continuation_frame";
const CONTINUATION_ID = "controlled_continuation_point";
const RESTORE_ENTRYPOINT = "machinen_controlled_continuation_restore";
const REQUIRED_LIVE_VALUES = ["continuation", "seed", "live_local", "resume_delta", "checksum"];

const CONTINUATION_LAYOUTS = {
  anchor: {
    type: "struct ControlledContinuationAnchor",
    byteSize: 48,
    fields: [
      {
        name: "frame",
        offset: 0,
        sizeBytes: 8,
        type: "struct ControlledContinuationFrame *",
        pointer: true,
      },
      { name: "frame_size", offset: 8, sizeBytes: 8, type: "uint64_t", pointer: false },
      { name: "continuation", offset: 16, sizeBytes: 32, type: "char[]", pointer: false },
    ],
  },
  frame: {
    type: "struct ControlledContinuationFrame",
    byteSize: 64,
    fields: [
      { name: "seed", offset: 0, sizeBytes: 8, type: "uint64_t", pointer: false },
      { name: "live_local", offset: 8, sizeBytes: 8, type: "uint64_t", pointer: false },
      { name: "resume_delta", offset: 16, sizeBytes: 8, type: "uint64_t", pointer: false },
      { name: "checksum", offset: 24, sizeBytes: 8, type: "uint64_t", pointer: false },
      { name: "continuation", offset: 32, sizeBytes: 32, type: "char[]", pointer: false },
    ],
  },
};

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "continuation-translate",
      "continuation translation proof uses Linux /proc and ptrace",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-continuation-translate-");
  try {
    emitResult(verifyContinuationTranslation(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyContinuationTranslation(outDir) {
  ensureSourcesExist([CONTROLLED_SOURCE, CAPTURE_SOURCE]);
  const binDir = join(outDir, "bin");
  const captureDir = join(outDir, "capture-continuation");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });

  const target = compileControlledTarget(binDir);
  const capturer = compileRawCapturer(binDir);
  const metadata = continuationMetadata(target);
  runContinuationCapture({ capturer, target, captureDir, metadata });

  const capture = loadRawCapture(captureDir);
  const sourceEvent = parseControlledMarker(capture.targetLog, "continuation");
  const recovered = recoverContinuationState(capture, metadata);
  assert(recovered.accepted, recovered.refusal?.message || "continuation recovery failed");
  const semanticState = recovered.state;
  validateSourceEvent(sourceEvent, semanticState);

  const missingValueRefusal = recoverContinuationState(
    capture,
    metadataWithoutFrameField(metadata, "live_local"),
  );
  assert(!missingValueRefusal.accepted, "missing live value should refuse");

  writeContinuationBundle({ bundleDir, captureDir, capture, semanticState, metadata, target });
  const restoreEvent = runTargetRestore(target, bundleDir);
  validateRestore(semanticState, restoreEvent);

  return {
    formatVersion: 1,
    hostArch: hostArch(),
    target,
    captureDir,
    bundleDir,
    continuation: continuationSummary(metadata, semanticState),
    sourceEvent,
    semanticState,
    missingValueRefusal: missingValueRefusal.refusal,
    restoreEvent,
    bundleFiles: bundleFileStats(bundleDir),
  };
}

function continuationMetadata(target) {
  const symbols = readSymbols(target, [ANCHOR_SYMBOL]);
  const anchor = symbols.get(ANCHOR_SYMBOL);
  return {
    formatVersion: 1,
    continuation: {
      id: CONTINUATION_ID,
      captureFunction: "controlled_continuation_point",
      restoreEntrypoint: RESTORE_ENTRYPOINT,
      requiredLiveValues: REQUIRED_LIVE_VALUES,
      safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
    },
    symbols: [{ name: ANCHOR_SYMBOL, type: CONTINUATION_LAYOUTS.anchor.type, ...anchor }],
    layouts: CONTINUATION_LAYOUTS,
  };
}

function runContinuationCapture(context) {
  const anchor = symbol(context.metadata, ANCHOR_SYMBOL);
  const framePointer = layoutField(context.metadata.layouts.anchor, "frame");
  runCommand(
    context.capturer,
    [
      "--output",
      context.captureDir,
      "--symbol",
      `${anchor.name}:${anchor.address}:${anchor.sizeBytes}`,
      "--follow-pointer",
      [
        ANCHOR_SYMBOL,
        framePointer.offset,
        context.metadata.layouts.frame.byteSize,
        FRAME_CHUNK,
      ].join(":"),
      "--",
      context.target,
      "--fixture",
      "continuation",
      "--pause-at-observation",
    ],
    { label: "continuation raw capture", env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" } },
  );
}

function recoverContinuationState(capture, metadata) {
  const missing = missingRequiredLiveValues(metadata);
  if (missing.length > 0) {
    return liveValueRefusal(missing);
  }

  const anchorChunk = memoryChunkByName(capture, ANCHOR_SYMBOL);
  const frameChunk = memoryChunkByName(capture, FRAME_CHUNK);
  const anchorBytes = memoryChunkBytes(capture, anchorChunk);
  const frameBytes = memoryChunkBytes(capture, frameChunk);
  const anchorContinuation = readLayoutCString(
    anchorBytes,
    layoutField(metadata.layouts.anchor, "continuation"),
  );
  const frameContinuation = readLayoutCString(
    frameBytes,
    layoutField(metadata.layouts.frame, "continuation"),
  );
  const seed = readLayoutUnsigned(frameBytes, layoutField(metadata.layouts.frame, "seed"));
  const liveLocal = readLayoutUnsigned(
    frameBytes,
    layoutField(metadata.layouts.frame, "live_local"),
  );
  const resumeDelta = readLayoutUnsigned(
    frameBytes,
    layoutField(metadata.layouts.frame, "resume_delta"),
  );
  const checksum = readLayoutUnsigned(frameBytes, layoutField(metadata.layouts.frame, "checksum"));
  const expectedChecksum = checksumContinuationValues(
    seed,
    liveLocal,
    resumeDelta,
    frameContinuation,
  );
  if (checksum !== expectedChecksum) {
    return {
      accepted: false,
      refusal: {
        code: "continuation-live-value-missing",
        message: "continuation live value checksum did not match captured locals",
        detail: {
          expectedChecksum: hexAddress(expectedChecksum),
          actualChecksum: hexAddress(checksum),
        },
      },
    };
  }

  return {
    accepted: true,
    state: {
      id: frameContinuation,
      anchorContinuation,
      sourceFrameAddress: frameChunk.sourceAddress,
      sourceAnchorAddress: anchorChunk.sourceAddress,
      rawStackCopied: false,
      seed: Number(seed),
      liveLocal: Number(liveLocal),
      resumeDelta: Number(resumeDelta),
      checksumHex: hexAddress(checksum),
      result: Number(liveLocal + resumeDelta),
      liveValues: [
        liveValue("seed", seed, metadata),
        liveValue("live_local", liveLocal, metadata),
        liveValue("resume_delta", resumeDelta, metadata),
        liveValue("checksum", checksum, metadata),
      ],
    },
  };
}

function missingRequiredLiveValues(metadata) {
  return metadata.continuation.requiredLiveValues.filter((name) => {
    if (name === "continuation") {
      return (
        !hasLayoutField(metadata.layouts.frame, name) ||
        !hasLayoutField(metadata.layouts.anchor, name)
      );
    }
    return !hasLayoutField(metadata.layouts.frame, name);
  });
}

function hasLayoutField(layout, name) {
  return layout.fields.some((field) => field.name === name);
}

function liveValueRefusal(missing) {
  return {
    accepted: false,
    refusal: {
      code: "continuation-live-value-missing",
      message: "required continuation live values could not be found",
      detail: { missing },
    },
  };
}

function liveValue(name, value, metadata) {
  const field = layoutField(metadata.layouts.frame, name);
  return {
    name,
    value: name === "checksum" ? hexAddress(value) : Number(value),
    source: "stack-frame-field",
    offset: field.offset,
    sizeBytes: field.sizeBytes,
  };
}

function metadataWithoutFrameField(metadata, fieldName) {
  return {
    ...metadata,
    layouts: {
      ...metadata.layouts,
      frame: {
        ...metadata.layouts.frame,
        fields: metadata.layouts.frame.fields.filter((field) => field.name !== fieldName),
      },
    },
  };
}

function validateSourceEvent(sourceEvent, semanticState) {
  assert(sourceEvent.continuation === semanticState.id, "source continuation id changed");
  assert(sourceEvent.seed === semanticState.seed, "source seed changed");
  assert(sourceEvent.live_local === semanticState.liveLocal, "source live local changed");
  assert(sourceEvent.resume_delta === semanticState.resumeDelta, "source resume delta changed");
  assert(sourceEvent.checksum_hex === semanticState.checksumHex, "source checksum changed");
}

function writeContinuationBundle(context) {
  writePortableBundleFiles({
    bundleDir: context.bundleDir,
    captureDir: context.captureDir,
    capture: context.capture,
    memory: { chunks: [], bytes: Buffer.alloc(0) },
    manifest: manifest(context),
    objects: objects(context),
    relocations: relocations(),
    controlledStateText: controlledStateText(context.semanticState),
    extraDocuments: [{ name: "continuation.json", value: continuationDocument(context) }],
  });
}

function manifest(context) {
  return controlledPortableManifest({
    target: context.target,
    capture: context.capture,
    buildId: BUILD_ID,
    version: "continuation-translation-proof",
    checkpointContinuation: CONTINUATION_ID,
    restoreEntrypoint: RESTORE_ENTRYPOINT,
    features: ["controlled-binary-corpus", "external-raw-capture", "continuation-translation"],
  });
}

function objects(context) {
  return {
    formatVersion: 1,
    objects: [
      {
        id: "controlled-continuation-frame",
        kind: "stack",
        type: context.metadata.layouts.frame.type,
        sizeBytes: context.metadata.layouts.frame.byteSize,
        sourceAddress: context.semanticState.sourceFrameAddress,
      },
      {
        id: "controlled-continuation-live-values",
        kind: "opaque",
        type: "semantic continuation live values",
        sizeBytes: 0,
      },
    ],
    unsupported: unsupportedVocabulary(),
  };
}

function relocations() {
  return { formatVersion: 1, relocations: [], unsupported: unsupportedVocabulary() };
}

function controlledStateText(semanticState) {
  return [
    `continuation=${semanticState.id}`,
    `seed=${semanticState.seed}`,
    `live_local=${semanticState.liveLocal}`,
    `resume_delta=${semanticState.resumeDelta}`,
    `checksum=${semanticState.checksumHex}`,
    "",
  ].join("\n");
}

function continuationDocument(context) {
  return {
    formatVersion: 1,
    sourceGuestArch: hostArch(),
    continuation: context.metadata.continuation,
    layouts: context.metadata.layouts,
    source: {
      anchorAddress: context.semanticState.sourceAnchorAddress,
      frameAddress: context.semanticState.sourceFrameAddress,
      capturedFrameForDecodingOnly: true,
      rawStackCopied: false,
    },
    liveValues: context.semanticState.liveValues,
    unsupported: unsupportedVocabulary(),
  };
}

function runTargetRestore(target, bundleDir) {
  const result = runCommand(target, ["--restore-continuation-bundle", bundleDir], {
    label: "continuation target restore",
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });
  return parseControlledMarker(result.stdout, "continuation-restore");
}

function validateRestore(semanticState, restoreEvent) {
  assert(restoreEvent.arch === hostArch(), "restore ran on unexpected host architecture");
  assert(restoreEvent.continuation === semanticState.id, "restored continuation id changed");
  assert(restoreEvent.seed === semanticState.seed, "restored seed changed");
  assert(restoreEvent.live_local === semanticState.liveLocal, "restored live local changed");
  assert(restoreEvent.resume_delta === semanticState.resumeDelta, "restored resume delta changed");
  assert(restoreEvent.checksum_hex === semanticState.checksumHex, "restored checksum changed");
  assert(restoreEvent.result === semanticState.result, "restored continuation result changed");
  assert(restoreEvent.resumed === true, "restore trampoline did not resume");
}

function continuationSummary(metadata, semanticState) {
  return {
    id: metadata.continuation.id,
    captureFunction: metadata.continuation.captureFunction,
    restoreEntrypoint: metadata.continuation.restoreEntrypoint,
    requiredLiveValues: metadata.continuation.requiredLiveValues,
    rawStackCopied: semanticState.rawStackCopied,
    liveValues: semanticState.liveValues,
  };
}

function bundleFileStats(bundleDir) {
  return sharedBundleFileStats(bundleDir, [
    "manifest.json",
    "objects.json",
    "relocations.json",
    "resources.json",
    "continuation.json",
    "memory.bin",
  ]);
}

function symbol(metadata, name) {
  const found = metadata.symbols.find((candidate) => candidate.name === name);
  assert(found, `missing continuation symbol ${name}`);
  return found;
}

function checksumContinuationValues(seed, liveLocal, resumeDelta, continuation) {
  let hash = 0x14650fb0739d0383n;
  hash = fnv1aWord(hash, seed);
  hash = fnv1aWord(hash, liveLocal);
  hash = fnv1aWord(hash, resumeDelta);
  for (const byte of Buffer.from(continuation, "utf8")) {
    hash ^= BigInt(byte);
    hash = fnv1aMul(hash);
  }
  return hash;
}

function fnv1aWord(hash, value) {
  return fnv1aMul(hash ^ value);
}

function fnv1aMul(value) {
  return (value * 0x100000001b3n) & 0xffffffffffffffffn;
}

function hexAddress(value) {
  return `0x${value.toString(16)}`;
}

function printSummary(summary, temporary) {
  console.log(
    `continuation-translate: ${summary.hostArch} captured ${summary.continuation.id} live_local=${summary.semanticState.liveLocal}`,
  );
  console.log(
    `continuation-translate: restored result ${summary.restoreEvent.result} without raw stack copy`,
  );
  if (temporary) {
    console.log("continuation-translate: temporary artifacts removed; pass --keep to inspect them");
  }
}

main();
