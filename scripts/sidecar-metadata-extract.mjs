#!/usr/bin/env node
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  CAPTURE_SOURCE,
  CONTROLLED_SOURCE,
  REPO_ROOT,
  buildPortableBundleMemory,
  bundleFileStats as sharedBundleFileStats,
  compileRawCapturer,
  controlledDwarfStateText,
  controlledPortableManifest,
  ensureSourcesExist,
  hostArch,
  jsonDocument,
  layoutField,
  linkedListPointerRelocations,
  loadRawCapture,
  memoryChunkByName,
  memoryChunkBytes,
  parseControlledMarker,
  readJson,
  readLayoutCString,
  readLayoutUnsigned,
  runControlledDwarfCapture,
  sha256File,
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
  "usage: node scripts/sidecar-metadata-extract.mjs [verify] [--out-dir path] [--json] [--keep]";
const DWARF_SCRIPT = join(REPO_ROOT, "scripts/dwarf-symbol-extract.mjs");
const META_FILE = ".machinen-meta.json";
const BUILD_ID = "4194194194194190";
const DWARF_GLOBAL_SYMBOL = "machinen_controlled_dwarf_global_state";
const DWARF_HEAP_SYMBOL = "machinen_controlled_dwarf_heap_state";
const NODE_PREFIX = "machinen_sidecar_dwarf_node";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "sidecar-metadata-extract", "sidecar proof uses Linux /proc and ptrace");
    return;
  }

  const workspace = createWorkspace(args, "machinen-sidecar-metadata-");
  try {
    emitResult(verifySidecarExtraction(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifySidecarExtraction(outDir) {
  ensureSourcesExist([CONTROLLED_SOURCE, CAPTURE_SOURCE, DWARF_SCRIPT]);
  const binDir = join(outDir, "bin");
  const captureDir = join(outDir, "capture-sidecar");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });

  const metadata = buildSidecarMetadata(outDir, binDir);
  const sidecar = metadata.sidecar;
  validateSidecar(sidecar);
  const targetCheck = validateTargetBuild(sidecar, metadata.strippedTarget);
  assert(targetCheck.accepted, "fresh stripped target did not match its sidecar");
  const mismatchRefusal = validateTargetBuild(
    sidecar,
    makeMismatchedTarget(binDir, metadata.strippedTarget),
  );
  assert(!mismatchRefusal.accepted, "mismatched target should be refused");

  const capturer = compileRawCapturer(binDir);
  runSidecarCapture({ capturer, target: metadata.strippedTarget, sidecar, captureDir });
  const capture = loadRawCapture(captureDir);
  const semanticState = recoverSidecarState(capture, sidecar);
  writeSidecarBundle({
    bundleDir,
    captureDir,
    capture,
    semanticState,
    sidecar,
    target: metadata.strippedTarget,
  });
  const restoreEvent = runTargetRestore(metadata.strippedTarget, bundleDir);
  validateRestore(semanticState, restoreEvent);

  return {
    formatVersion: 1,
    hostArch: hostArch(),
    sidecarPath: metadata.sidecarPath,
    strippedTarget: metadata.strippedTarget,
    strippedTargetHasDwarf: metadata.strippedTargetHasDwarf,
    captureDir,
    bundleDir,
    sidecar: summarizeSidecar(sidecar),
    mismatchRefusal,
    semanticState,
    restoreEvent,
    bundleFiles: bundleFileStats(bundleDir),
  };
}

function buildSidecarMetadata(outDir, binDir) {
  const debugProof = runDwarfProof(join(outDir, "debug-proof"));
  const layoutDocument = readJson(join(debugProof.bundleDir, "dwarf-layout.json"));
  const debugTarget = debugProof.target;
  const strippedTarget = join(binDir, "machinen-controlled-corpus.stripped");
  copyFileSync(debugTarget, strippedTarget);
  runCommand("strip", ["--strip-all", strippedTarget], { label: "strip controlled target" });

  const sidecar = createSidecar({ layoutDocument, debugTarget, strippedTarget });
  const sidecarPath = join(binDir, META_FILE);
  writeFileSync(sidecarPath, jsonDocument(sidecar));
  return {
    debugProof,
    sidecar,
    sidecarPath,
    strippedTarget,
    strippedTargetHasDwarf: binaryHasDwarf(strippedTarget),
  };
}

function runDwarfProof(outDir) {
  const result = runCommand(
    process.execPath,
    [DWARF_SCRIPT, "verify", "--out-dir", outDir, "--keep", "--json"],
    { label: "DWARF metadata source proof" },
  );
  return JSON.parse(result.stdout);
}

function createSidecar({ layoutDocument, debugTarget, strippedTarget }) {
  const build = {
    arch: hostArch(),
    buildIdentity: {
      kind: "sha256",
      binarySha256: sha256File(strippedTarget),
      debugSha256: sha256File(debugTarget),
    },
    binary: { stripped: true },
    symbols: layoutDocument.globals.map((symbol) => ({
      name: symbol.name,
      address: symbol.address,
      sizeBytes: symbol.sizeBytes,
      type: symbol.type,
    })),
    types: Object.values(layoutDocument.layouts),
    pointerFields: pointerFields(layoutDocument.layouts),
    continuations: [
      {
        id: "controlled-dwarf-observation",
        fixture: "dwarf",
        checkpointContinuation: "machinen_controlled_dwarf_observation",
        restoreEntrypoint: "machinen_controlled_dwarf_restore",
        safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
      },
    ],
    resources: {
      recipes: [
        { id: "argv", kind: "argv", capture: "copy" },
        { id: "env", kind: "env", capture: "allow-list", names: ["MACHINEN_CONTROLLED_ENV"] },
        { id: "cwd", kind: "cwd", capture: "copy" },
      ],
      refusalRules: [
        { code: "fd-kind-unsupported", message: "only argv/env/cwd resources are replayed" },
      ],
    },
  };
  return {
    schemaVersion: 1,
    format: "com.redwoodjs.machinen.sidecar",
    program: {
      name: "controlled-binary-corpus",
      identity: "com.redwoodjs.machinen.controlled-binary-corpus",
    },
    compatibility: {
      allowedSourceArchs: ["arm64", "amd64"],
      allowedTargetArchs: ["arm64", "amd64"],
      buildMatch: "sha256",
    },
    builds: [build],
  };
}

function pointerFields(layouts) {
  const fields = [];
  for (const layout of Object.values(layouts)) {
    for (const field of layout.fields) {
      if (field.pointer) {
        fields.push({
          type: layout.type,
          field: field.name,
          offset: field.offset,
          targetType: field.type,
        });
      }
    }
  }
  return fields;
}

function binaryHasDwarf(path) {
  const result = runCommand("readelf", ["--debug-dump=info", path], {
    label: "stripped DWARF check",
  });
  return result.stdout.includes("DW_TAG_");
}

function validateSidecar(sidecar) {
  assert(sidecar.schemaVersion === 1, "sidecar schema version changed");
  assert(sidecar.format === "com.redwoodjs.machinen.sidecar", "sidecar format changed");
  assert(Array.isArray(sidecar.builds) && sidecar.builds.length > 0, "sidecar has no builds");
  const build = sidecarBuild(sidecar, hostArch());
  validateSidecarBuild(build);
}

function validateSidecarBuild(build) {
  assert(build.binary.stripped === true, "sidecar build should describe a stripped binary");
  assert(symbol(build, DWARF_GLOBAL_SYMBOL), "sidecar missing global symbol");
  assert(symbol(build, DWARF_HEAP_SYMBOL), "sidecar missing heap symbol");
  assert(typeLayout(build, "struct ControlledDwarfNode"), "sidecar missing node layout");
  assertSidecarPolicy(build);
}

function assertSidecarPolicy(build) {
  assert(hasPointerFields(build), "sidecar missing pointer fields");
  assert(build.continuations[0]?.safePoint?.outsideSyscalls === true, "sidecar missing safe point");
  assert(
    build.resources.refusalRules[0]?.code === "fd-kind-unsupported",
    "sidecar missing refusal rule",
  );
}

function hasPointerFields(build) {
  const names = new Set(build.pointerFields.map((field) => field.field));
  return names.has("head") && names.has("next");
}

function validateTargetBuild(sidecar, target) {
  const build = sidecarBuild(sidecar, hostArch());
  const actual = sha256File(target);
  const expected = build.buildIdentity.binarySha256;
  if (actual === expected) {
    return { accepted: true, arch: build.arch, binarySha256: actual };
  }
  return {
    accepted: false,
    refusal: {
      code: "target-build-mismatch",
      message: "target binary sha256 does not match .machinen-meta.json",
      detail: { arch: build.arch, expectedSha256: expected, actualSha256: actual },
    },
  };
}

function makeMismatchedTarget(binDir, target) {
  const mismatched = join(binDir, "machinen-controlled-corpus.mismatched");
  copyFileSync(target, mismatched);
  writeFileSync(mismatched, "\n# mismatch\n", { flag: "a" });
  return mismatched;
}

function runSidecarCapture(context) {
  const build = sidecarBuild(context.sidecar, hostArch());
  runControlledDwarfCapture({
    capturer: context.capturer,
    target: context.target,
    captureDir: context.captureDir,
    globalSymbol: symbol(build, DWARF_GLOBAL_SYMBOL),
    heapSymbol: symbol(build, DWARF_HEAP_SYMBOL),
    heapLayout: typeLayout(build, "struct ControlledDwarfHeapState"),
    nodeLayout: typeLayout(build, "struct ControlledDwarfNode"),
    nodePrefix: NODE_PREFIX,
    label: "sidecar-guided raw capture",
  });
}

function recoverSidecarState(capture, sidecar) {
  const build = sidecarBuild(sidecar, hostArch());
  const globalLayout = typeLayout(build, "struct ControlledDwarfGlobalState");
  const heapLayout = typeLayout(build, "struct ControlledDwarfHeapState");
  const nodeLayout = typeLayout(build, "struct ControlledDwarfNode");
  const globalChunk = memoryChunkByName(capture, DWARF_GLOBAL_SYMBOL);
  const heapChunk = memoryChunkByName(capture, DWARF_HEAP_SYMBOL);
  const globalBytes = memoryChunkBytes(capture, globalChunk);
  const heapBytes = memoryChunkBytes(capture, heapChunk);
  const nodeCount = Number(readLayoutUnsigned(heapBytes, layoutField(heapLayout, "node_count")));
  const nodes = readNodes(capture, nodeLayout, nodeCount);
  const checksum = readLayoutUnsigned(heapBytes, layoutField(heapLayout, "checksum"));
  return {
    global: {
      label: readLayoutCString(globalBytes, layoutField(globalLayout, "label")),
      counter: Number(readLayoutUnsigned(globalBytes, layoutField(globalLayout, "counter"))),
      flags: Number(readLayoutUnsigned(globalBytes, layoutField(globalLayout, "flags"))),
      generation: Number(readLayoutUnsigned(globalBytes, layoutField(globalLayout, "generation"))),
      sourceAddress: globalChunk.sourceAddress,
    },
    heap: {
      nodeCount,
      values: nodes.map((node) => node.value),
      tags: nodes.map((node) => node.tag),
      colors: nodes.map((node) => node.color),
      nodes,
      checksumHex: hexAddress(checksum),
      headPointer: hexAddress(readLayoutUnsigned(heapBytes, layoutField(heapLayout, "head"))),
      sourceAddress: heapChunk.sourceAddress,
    },
  };
}

function readNodes(capture, nodeLayout, nodeCount) {
  return Array.from({ length: nodeCount }, (_unused, index) => {
    const chunk = memoryChunkByName(capture, `${NODE_PREFIX}_${index}`);
    const bytes = memoryChunkBytes(capture, chunk);
    return {
      id: `controlled-sidecar-node-${index}`,
      sourceAddress: chunk.sourceAddress,
      tag: Number(readLayoutUnsigned(bytes, layoutField(nodeLayout, "tag"))),
      color: Number(readLayoutUnsigned(bytes, layoutField(nodeLayout, "color"))),
      value: Number(readLayoutUnsigned(bytes, layoutField(nodeLayout, "value"))),
      nextPointer: hexAddress(readLayoutUnsigned(bytes, layoutField(nodeLayout, "next"))),
    };
  });
}

function writeSidecarBundle(context) {
  const memory = buildPortableBundleMemory(context.capture);
  writePortableBundleFiles({
    bundleDir: context.bundleDir,
    captureDir: context.captureDir,
    capture: context.capture,
    memory,
    manifest: sidecarManifest(context),
    objects: sidecarObjects(memory.chunks, context),
    relocations: sidecarRelocations(context),
    controlledStateText: controlledDwarfStateText(context.semanticState),
    extraDocuments: [{ name: META_FILE, value: context.sidecar }],
  });
}

function sidecarManifest(context) {
  return controlledPortableManifest({
    target: context.target,
    capture: context.capture,
    buildId: BUILD_ID,
    version: "sidecar-metadata-proof",
    checkpointContinuation: "machinen_controlled_dwarf_observation",
    restoreEntrypoint: "machinen_controlled_dwarf_restore",
    features: ["controlled-binary-corpus", "external-raw-capture", "sidecar-metadata-extraction"],
  });
}

function sidecarObjects(chunks, context) {
  const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]));
  const build = sidecarBuild(context.sidecar, hostArch());
  return {
    formatVersion: 1,
    objects: [
      objectForChunk(
        byName.get(DWARF_GLOBAL_SYMBOL),
        "controlled-sidecar-global-state",
        "global",
        symbol(build, DWARF_GLOBAL_SYMBOL).type,
      ),
      objectForChunk(
        byName.get(DWARF_HEAP_SYMBOL),
        "controlled-sidecar-heap-state",
        "global",
        symbol(build, DWARF_HEAP_SYMBOL).type,
      ),
      ...context.semanticState.heap.nodes.map((node, index) => {
        const chunk = byName.get(`${NODE_PREFIX}_${index}`);
        return {
          ...objectForChunk(chunk, node.id, "heap", "struct ControlledDwarfNode"),
          allocation: { id: index + 1, sourceAddress: chunk.sourceAddress },
        };
      }),
    ],
    unsupported: unsupportedVocabulary(),
  };
}

function objectForChunk(chunk, id, kind, type) {
  return {
    id,
    kind,
    type,
    sizeBytes: chunk.sizeBytes,
    sourceAddress: chunk.sourceAddress,
    memory: { offset: chunk.bundleOffset, sizeBytes: chunk.sizeBytes },
  };
}

function sidecarRelocations(context) {
  const build = sidecarBuild(context.sidecar, hostArch());
  const heapLayout = typeLayout(build, "struct ControlledDwarfHeapState");
  const nodeLayout = typeLayout(build, "struct ControlledDwarfNode");
  return {
    formatVersion: 1,
    relocations: linkedListPointerRelocations({
      heapObject: "controlled-sidecar-heap-state",
      nodePrefix: "controlled-sidecar-node",
      heapHeadOffset: layoutField(heapLayout, "head").offset,
      nodeNextOffset: layoutField(nodeLayout, "next").offset,
      nodes: context.semanticState.heap.nodes,
      headPointer: context.semanticState.heap.headPointer,
    }),
    unsupported: unsupportedVocabulary(),
  };
}

function runTargetRestore(target, bundleDir) {
  const result = runCommand(target, ["--restore-dwarf-bundle", bundleDir], {
    label: "sidecar target restore",
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });
  return parseControlledMarker(result.stdout, "dwarf-restore");
}

function validateRestore(semanticState, restoreEvent) {
  assert(restoreEvent.arch === hostArch(), "restore ran on the wrong architecture");
  assert(restoreEvent.global.label === semanticState.global.label, "global label changed");
  assert(restoreEvent.global.counter === semanticState.global.counter, "global counter changed");
  assert(restoreEvent.heap.node_count === semanticState.heap.nodeCount, "node count changed");
  assert(
    JSON.stringify(restoreEvent.heap.values) === JSON.stringify(semanticState.heap.values),
    "node values changed",
  );
  assert(restoreEvent.heap.checksum_hex === semanticState.heap.checksumHex, "checksum changed");
}

function summarizeSidecar(sidecar) {
  return {
    schemaVersion: sidecar.schemaVersion,
    builds: sidecar.builds.map((build) => ({
      arch: build.arch,
      binaryStripped: build.binary.stripped,
      symbolNames: build.symbols.map((item) => item.name),
      typeNames: build.types.map((item) => item.type),
      pointerFields: build.pointerFields,
      continuations: build.continuations.map((item) => item.id),
      resourceRefusals: build.resources.refusalRules,
    })),
  };
}

function sidecarBuild(sidecar, arch) {
  const build = sidecar.builds.find((candidate) => candidate.arch === arch);
  if (!build) {
    throw new Error(`sidecar has no build for ${arch}`);
  }
  return build;
}

function symbol(build, name) {
  return build.symbols.find((candidate) => candidate.name === name);
}

function typeLayout(build, typeName) {
  return build.types.find((candidate) => candidate.type === typeName);
}

function hexAddress(value) {
  return `0x${value.toString(16)}`;
}

function bundleFileStats(bundleDir) {
  return sharedBundleFileStats(bundleDir, [
    "manifest.json",
    "objects.json",
    "relocations.json",
    "resources.json",
    META_FILE,
    "memory.bin",
  ]);
}

function printSummary(summary, temporary) {
  console.log(
    `sidecar-metadata-extract: ${summary.hostArch} restored stripped target values ${summary.restoreEvent.heap.values.join(",")}`,
  );
  console.log(`sidecar-metadata-extract: mismatch refusal ${summary.mismatchRefusal.refusal.code}`);
  if (temporary) {
    console.log(
      "sidecar-metadata-extract: temporary artifacts removed; pass --keep to inspect them",
    );
  }
}

main();
