import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./proof-script-utils.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTROLLED_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/controlled-binary-corpus.c",
);
export const CAPTURE_SOURCE = join(REPO_ROOT, "packages/microvm/assets/raw-process-capture.c");
export const NATIVE_CAPTURE_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-process-capture.c",
);
export const NATIVE_CAPTURE_TARGET_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-capture-target.c",
);
export const NATIVE_MAPPING_POLICY_TARGET_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-mapping-policy-target.c",
);
export const NATIVE_MAPPING_MATERIALIZER_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-mapping-materializer.c",
);
export const NATIVE_PIE_SHARED_MAIN_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-pie-shared-main.c",
);
export const NATIVE_PIE_SHARED_LIB_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-pie-shared-lib.c",
);
export const NATIVE_RESTORE_LOADER_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-restore-loader.c",
);
export const NATIVE_RESUME_TRAMPOLINE_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-resume-trampoline.c",
);
export const NATIVE_FINAL_JUMP_SOURCE_TARGET_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-final-jump-source.c",
);
export const NATIVE_TARGET_BINARY_CONTINUATION_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-target-binary-continuation.c",
);
export const NATIVE_CALL_FRAME_CONTINUATION_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-call-frame-continuation.c",
);
export const NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-dwarf-unwind-continuation.c",
);
export const NATIVE_HEAP_GRAPH_CONTINUATION_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-heap-graph-continuation.c",
);
export const NATIVE_FILE_RESOURCE_CONTINUATION_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/native-file-resource-continuation.c",
);
export const CONTROLLED_MARKER = "MACHINEN_CONTROLLED_BINARY ";
export const NATIVE_PROCESS_IMAGE_BUNDLE_FILES = [
  "native-process.json",
  "native-mappings.json",
  "native-threads.json",
  "native-resources.json",
  "native-translation.json",
  "native-memory.bin",
];

export function ensureSourcesExist(sources) {
  for (const source of sources) {
    if (!existsSync(source)) {
      throw new Error(`missing source: ${source}`);
    }
  }
}

export function createProofBinAndBundleDirs(outDir) {
  const binDir = join(outDir, "bin");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(bundleDir, { recursive: true });
  return { binDir, bundleDir };
}

export function compileControlledTarget(binDir) {
  const executable = join(binDir, "machinen-controlled-corpus");
  runCommand("cc", controlledCompileArgs(executable), { label: "controlled corpus build" });
  return executable;
}

export function controlledCompileArgs(executable) {
  return [
    "-std=c11",
    "-O0",
    "-g",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fno-pie",
    "-no-pie",
    "-pthread",
    CONTROLLED_SOURCE,
    "-o",
    executable,
  ];
}

export function compileRawCapturer(binDir) {
  const executable = join(binDir, "machinen-raw-process-capture");
  runCommand(
    "cc",
    ["-std=c11", "-O0", "-g", "-Wall", "-Wextra", "-Werror", CAPTURE_SOURCE, "-o", executable],
    { label: "raw capturer build" },
  );
  return executable;
}

export function compileNativeProcessCapturer(binDir) {
  const executable = join(binDir, "machinen-native-process-capture");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      NATIVE_CAPTURE_SOURCE,
      "-o",
      executable,
    ],
    { label: "native process capturer build" },
  );
  return executable;
}

export function compileNativeCaptureTarget(binDir) {
  const executable = join(binDir, "machinen-native-capture-target");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      NATIVE_CAPTURE_TARGET_SOURCE,
      "-o",
      executable,
    ],
    { label: "native capture target build" },
  );
  return executable;
}

export function compileNativeMappingPolicyTarget(binDir) {
  const executable = join(binDir, "machinen-native-mapping-policy-target");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      NATIVE_MAPPING_POLICY_TARGET_SOURCE,
      "-o",
      executable,
    ],
    { label: "native mapping policy target build" },
  );
  return executable;
}

export function compileNativeMappingMaterializer(binDir) {
  const executable = join(binDir, "machinen-native-mapping-materializer");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      NATIVE_MAPPING_MATERIALIZER_SOURCE,
      "-o",
      executable,
    ],
    { label: "native mapping materializer build" },
  );
  return executable;
}

export function compileNativePieSharedTarget(binDir) {
  const libraryName = "libmachinen-native-pie-shared.so";
  const library = join(binDir, libraryName);
  const executable = join(binDir, "machinen-native-pie-shared-main");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-fPIC",
      "-shared",
      "-Wl,--build-id=sha1",
      NATIVE_PIE_SHARED_LIB_SOURCE,
      "-o",
      library,
    ],
    { label: "native PIE shared library build" },
  );
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-fPIE",
      "-pie",
      "-Wl,--build-id=sha1",
      NATIVE_PIE_SHARED_MAIN_SOURCE,
      "-L",
      binDir,
      "-lmachinen-native-pie-shared",
      "-Wl,-rpath,$ORIGIN",
      "-o",
      executable,
    ],
    { label: "native PIE shared executable build" },
  );
  return { executable, library, libraryName };
}

export function compileNativeFinalJumpSourceTarget(binDir) {
  const executable = join(binDir, "machinen-native-final-jump-source");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      NATIVE_FINAL_JUMP_SOURCE_TARGET_SOURCE,
      "-o",
      executable,
    ],
    { label: "native final-jump source target build" },
  );
  return executable;
}

export function compileNativeTargetBinaryContinuation(binDir) {
  const executable = join(binDir, "machinen-native-target-binary-continuation");
  runCommand(
    "cc",
    nativeTargetBinaryCompileArgs(executable, NATIVE_TARGET_BINARY_CONTINUATION_SOURCE),
    {
      label: "native target-binary continuation build",
    },
  );
  return executable;
}

export function compileNativeCallFrameContinuation(binDir) {
  const executable = join(binDir, "machinen-native-call-frame-continuation");
  runCommand(
    "cc",
    nativeTargetBinaryCompileArgs(executable, NATIVE_CALL_FRAME_CONTINUATION_SOURCE),
    {
      label: "native call-frame continuation build",
    },
  );
  return executable;
}

export function compileNativeDwarfUnwindContinuation(binDir) {
  const executable = join(binDir, "machinen-native-dwarf-unwind-continuation");
  runCommand(
    "cc",
    nativeTargetBinaryCompileArgs(executable, NATIVE_DWARF_UNWIND_CONTINUATION_SOURCE),
    {
      label: "native DWARF unwind continuation build",
    },
  );
  return executable;
}

export function compileNativeHeapGraphContinuation(binDir) {
  const executable = join(binDir, "machinen-native-heap-graph-continuation");
  runCommand(
    "cc",
    nativeTargetBinaryCompileArgs(executable, NATIVE_HEAP_GRAPH_CONTINUATION_SOURCE),
    {
      label: "native heap graph continuation build",
    },
  );
  return executable;
}

export function compileNativeFileResourceContinuation(binDir) {
  const executable = join(binDir, "machinen-native-file-resource-continuation");
  runCommand(
    "cc",
    nativeTargetBinaryCompileArgs(executable, NATIVE_FILE_RESOURCE_CONTINUATION_SOURCE),
    {
      label: "native file resource continuation build",
    },
  );
  return executable;
}

function nativeTargetBinaryCompileArgs(executable, source) {
  return [
    "-std=c11",
    "-O0",
    "-g",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fno-pie",
    "-no-pie",
    source,
    "-o",
    executable,
  ];
}

export function compileNativeRestoreLoader(binDir) {
  const executable = join(binDir, "machinen-native-restore-loader");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      NATIVE_RESTORE_LOADER_SOURCE,
      "-o",
      executable,
    ],
    { label: "native restore loader build" },
  );
  return executable;
}

export function compileNativeResumeTrampoline(binDir) {
  const executable = join(binDir, "machinen-native-resume-trampoline");
  runCommand(
    "cc",
    [
      "-std=c11",
      "-O0",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      NATIVE_RESUME_TRAMPOLINE_SOURCE,
      "-o",
      executable,
    ],
    { label: "native resume trampoline build" },
  );
  return executable;
}

export function readSymbols(target, wantedSymbols) {
  const result = runCommand("nm", ["-S", "--defined-only", target], { label: "symbol scan" });
  const symbols = parseNm(result.stdout);
  for (const name of wantedSymbols) {
    if (!symbols.has(name)) {
      throw new Error(`missing target symbol: ${name}`);
    }
  }
  return symbols;
}

function parseNm(stdout) {
  const symbols = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+\S\s+(\S+)$/.exec(line.trim());
    if (match) {
      symbols.set(match[3], { address: `0x${match[1]}`, sizeBytes: Number.parseInt(match[2], 16) });
    }
  }
  return symbols;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadRawCapture(captureDir) {
  return {
    manifest: readJson(join(captureDir, "manifest.json")),
    symbols: readJson(join(captureDir, "symbols.json")),
    memory: readJson(join(captureDir, "memory.json")),
    memoryBin: readFileSync(join(captureDir, "memory.bin")),
    targetLog: readFileSync(join(captureDir, "target.log"), "utf8"),
  };
}

export function memoryChunkByName(capture, name) {
  const chunk = capture.memory.chunks.find((candidate) => candidate.name === name);
  if (!chunk) {
    throw new Error(`missing memory chunk: ${name}`);
  }
  return chunk;
}

export function memoryChunkBytes(capture, chunk) {
  return capture.memoryBin.subarray(chunk.fileOffset, chunk.fileOffset + chunk.sizeBytes);
}

export function buildPortableBundleMemory(capture) {
  const chunks = capture.memory.chunks.map((source) => ({ ...source }));
  const buffers = [];
  let offset = 0;
  for (const chunk of chunks) {
    const bytes = memoryChunkBytes(capture, chunk);
    chunk.bundleOffset = offset;
    buffers.push(bytes);
    offset += bytes.length;
  }
  return { chunks, bytes: Buffer.concat(buffers) };
}

export function controlledPortableManifest(options) {
  return {
    formatVersion: 1,
    sourceGuestArch: hostArch(),
    allowedTargetGuestArchs: ["arm64", "amd64"],
    program: {
      name: "controlled-binary-corpus",
      executable: options.target,
      identity: "com.redwoodjs.machinen.controlled-binary-corpus",
    },
    sourceBuild: { buildId: options.buildId, version: options.version },
    targetBuild: { version: options.version },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
    },
    checkpointContinuation: { name: options.checkpointContinuation },
    restoreEntrypoint: { name: options.restoreEntrypoint },
    process: {
      argv: options.capture.manifest.target.argv,
      env: { MACHINEN_CONTROLLED_ENV: "1" },
      cwd: process.cwd(),
    },
    features: options.features,
    unsupported: unsupportedVocabulary(),
  };
}

export function writePortableBundleFiles(options) {
  mkdirSync(options.bundleDir, { recursive: true });
  mkdirSync(join(options.bundleDir, "logs"), { recursive: true });
  writeFileSync(join(options.bundleDir, "memory.bin"), options.memory.bytes);
  writeFileSync(join(options.bundleDir, "manifest.json"), jsonDocument(options.manifest));
  writeFileSync(join(options.bundleDir, "objects.json"), jsonDocument(options.objects));
  writeFileSync(join(options.bundleDir, "relocations.json"), jsonDocument(options.relocations));
  writeFileSync(
    join(options.bundleDir, "resources.json"),
    jsonDocument(controlledResources(options.capture)),
  );
  for (const document of options.extraDocuments || []) {
    writeFileSync(join(options.bundleDir, document.name), jsonDocument(document.value));
  }
  writeFileSync(join(options.bundleDir, "controlled-state.txt"), options.controlledStateText);
  copyFileSync(
    join(options.captureDir, "target.log"),
    join(options.bundleDir, "logs/source-target.log"),
  );
}

export function controlledResources(capture) {
  return {
    formatVersion: 1,
    resources: [
      { id: "argv", kind: "argv", state: "captured", argv: capture.manifest.target.argv },
      { id: "env", kind: "env", state: "captured", env: { MACHINEN_CONTROLLED_ENV: "1" } },
      { id: "cwd", kind: "cwd", state: "captured", path: process.cwd() },
    ],
    unsupported: unsupportedVocabulary(),
  };
}

export function runControlledDwarfCapture(options) {
  const heapHead = layoutField(options.heapLayout, "head");
  const heapCount = layoutField(options.heapLayout, "node_count");
  const nodeNext = layoutField(options.nodeLayout, "next");
  const args = [
    "--output",
    options.captureDir,
    "--symbol",
    `${options.globalSymbol.name}:${options.globalSymbol.address}:${options.globalSymbol.sizeBytes}`,
    "--symbol",
    `${options.heapSymbol.name}:${options.heapSymbol.address}:${options.heapSymbol.sizeBytes}`,
    "--follow-list",
    [
      options.heapSymbol.name,
      heapHead.offset,
      heapCount.offset,
      options.nodeLayout.byteSize,
      nodeNext.offset,
      options.nodePrefix,
    ].join(":"),
    "--",
    options.target,
    "--fixture",
    "dwarf",
    "--pause-at-observation",
  ];
  if (options.resourceFile) {
    args.push("--resource-file", options.resourceFile);
  }
  runCommand(options.capturer, args, {
    label: options.label,
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });
}

export function layoutField(layout, name) {
  const fields = layout.fields || layout.members || [];
  const found = fields.find((candidate) => candidate.name === name);
  if (!found) {
    throw new Error(`layout ${layout.type} has no field ${name}`);
  }
  return found;
}

const UNSIGNED_READERS = new Map([
  [1, (bytes, offset) => BigInt(bytes.readUInt8(offset))],
  [2, (bytes, offset) => BigInt(bytes.readUInt16LE(offset))],
  [4, (bytes, offset) => BigInt(bytes.readUInt32LE(offset))],
  [8, (bytes, offset) => bytes.readBigUInt64LE(offset)],
]);

export function readLayoutUnsigned(bytes, fieldSpec) {
  const offset = fieldSpec.offset;
  if (offset + fieldSpec.sizeBytes > bytes.length) {
    throw new Error(`field ${fieldSpec.name} is outside captured bytes`);
  }
  const reader = UNSIGNED_READERS.get(fieldSpec.sizeBytes);
  if (!reader) {
    throw new Error(
      `unsupported unsigned field width for ${fieldSpec.name}: ${fieldSpec.sizeBytes}`,
    );
  }
  return reader(bytes, offset);
}

export function readLayoutCString(bytes, fieldSpec) {
  const start = fieldSpec.offset;
  const limit = Math.min(bytes.length, start + fieldSpec.sizeBytes);
  let end = start;
  while (end < limit && bytes[end] !== 0) {
    end++;
  }
  return bytes.subarray(start, end).toString("utf8");
}

export function linkedListPointerRelocations(options) {
  const relocations = [
    {
      fromObject: options.heapObject,
      fromOffset: options.heapHeadOffset,
      toObject: `${options.nodePrefix}-0`,
      addend: 0,
      kind: "pointer",
      sourcePointer: options.headPointer,
    },
  ];
  for (let index = 0; index + 1 < options.nodes.length; index++) {
    relocations.push({
      fromObject: `${options.nodePrefix}-${index}`,
      fromOffset: options.nodeNextOffset,
      toObject: `${options.nodePrefix}-${index + 1}`,
      addend: 0,
      kind: "pointer",
      sourcePointer: options.nodes[index].nextPointer,
    });
  }
  return relocations;
}

export function controlledDwarfStateText(semanticState) {
  const lines = [
    `global_label=${semanticState.global.label}`,
    `global_counter=${semanticState.global.counter}`,
    `global_flags=${semanticState.global.flags}`,
    `global_generation=${semanticState.global.generation}`,
    `node_count=${semanticState.heap.nodeCount}`,
  ];
  semanticState.heap.values.forEach((value, index) => lines.push(`value${index}=${value}`));
  semanticState.heap.tags.forEach((value, index) => lines.push(`tag${index}=${value}`));
  semanticState.heap.colors.forEach((value, index) => lines.push(`color${index}=${value}`));
  lines.push(`checksum=${semanticState.heap.checksumHex}`, "");
  return lines.join("\n");
}

export function parseControlledMarker(stdout, expectedFixture) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(CONTROLLED_MARKER));
  if (!line) {
    throw new Error("missing controlled binary marker");
  }
  const event = JSON.parse(line.slice(CONTROLLED_MARKER.length));
  if (expectedFixture && event.fixture !== expectedFixture) {
    throw new Error(`unexpected controlled fixture marker: ${event.fixture}`);
  }
  return event;
}

export function bundleFileStats(bundleDir, names) {
  return names.map((name) => ({ name, bytes: statSync(join(bundleDir, name)).size }));
}

export function assertNativeProofStepsTranslated(steps, label) {
  const checks = [
    ["code map", steps.codeMap],
    ["register translation", steps.registers],
    ["stack translation", steps.stack],
    ["memory translation", steps.memory],
    ["resource translation", steps.resources],
  ];
  for (const [name, result] of checks) {
    if (result.refusals.length !== 0) {
      throw new Error(`${label} ${name} refused unexpectedly`);
    }
  }
}

export function writeNativeProcessImageBundle(bundleDir, documents) {
  writeFileSync(join(bundleDir, "native-memory.bin"), documents.memory);
  writeFileSync(join(bundleDir, "native-process.json"), jsonDocument(documents.manifest));
  writeFileSync(join(bundleDir, "native-mappings.json"), jsonDocument(documents.mappings));
  writeFileSync(join(bundleDir, "native-threads.json"), jsonDocument(documents.threads));
  writeFileSync(join(bundleDir, "native-resources.json"), jsonDocument(documents.resources));
  writeFileSync(join(bundleDir, "native-translation.json"), jsonDocument(documents.translation));
}

export function nativeProofBundleDocuments(
  memory,
  manifest,
  mappings,
  threads,
  resources,
  steps,
  resourceRefusals = nativeEmptyRefusals(),
) {
  return {
    memory,
    manifest,
    mappings,
    threads,
    resources: nativeResourceDocument(resources, resourceRefusals),
    translation: nativeTranslationDocument(steps),
  };
}

export function nativeResourceDocument(resources, refusals = nativeEmptyRefusals()) {
  return { formatVersion: 1, resources, refusals };
}

export function nativeTranslationDocument(steps, refusals = nativeEmptyRefusals()) {
  return {
    formatVersion: 1,
    mode: "native-cross-isa",
    sourceArch: "arm64",
    targetArch: "amd64",
    codeLocations: steps.codeMap.codeLocations,
    threads: steps.registers.threads,
    memoryRelocations: [...steps.stack.relocations, ...steps.memory.relocations],
    refusals,
  };
}

export function nativeEmptyRefusals() {
  return { vocabularyVersion: 1, refusals: [] };
}

export function unsupportedVocabulary() {
  return nativeEmptyRefusals();
}

export function jsonDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function hostArch() {
  if (process.arch === "arm64") {
    return "arm64";
  }
  if (process.arch === "x64") {
    return "amd64";
  }
  return process.arch;
}
