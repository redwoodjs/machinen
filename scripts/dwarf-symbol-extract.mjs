#!/usr/bin/env node
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CAPTURE_SOURCE,
  CONTROLLED_SOURCE,
  buildPortableBundleMemory,
  bundleFileStats as sharedBundleFileStats,
  compileControlledTarget,
  compileRawCapturer,
  controlledPortableManifest,
  ensureSourcesExist,
  hostArch,
  loadRawCapture,
  memoryChunkByName,
  memoryChunkBytes,
  parseControlledMarker,
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
  "usage: node scripts/dwarf-symbol-extract.mjs [verify] [--out-dir path] [--json] [--keep]";
const DWARF_GLOBAL_SYMBOL = "machinen_controlled_dwarf_global_state";
const DWARF_HEAP_SYMBOL = "machinen_controlled_dwarf_heap_state";
const DWARF_NODE_PREFIX = "machinen_controlled_dwarf_node";
const BUILD_ID = "4184184184184180";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(
      args,
      "dwarf-symbol-extract",
      "DWARF extraction proof uses Linux /proc, ptrace, and readelf",
    );
    return;
  }

  const workspace = createWorkspace(args, "machinen-dwarf-symbol-extract-");
  try {
    emitResult(verifyDwarfExtraction(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyDwarfExtraction(outDir) {
  ensureSourcesExist([CONTROLLED_SOURCE, CAPTURE_SOURCE]);
  const binDir = join(outDir, "bin");
  const captureDir = join(outDir, "capture-dwarf");
  const bundleDir = join(outDir, "bundle");
  mkdirSync(binDir, { recursive: true });

  const target = compileControlledTarget(binDir);
  const capturer = compileRawCapturer(binDir);
  const dwarf = readDwarfModel(target);
  const layouts = controlledDwarfLayouts(dwarf);
  const stackProbe = summarizeStackProbe(dwarf);
  runDwarfCapture({ capturer, target, layouts, captureDir });

  const capture = loadRawCapture(captureDir);
  const semanticState = recoverDwarfState(capture, layouts);
  const layoutMapping = mapLayouts(layouts, layouts);
  writePortableBundle({
    bundleDir,
    captureDir,
    capture,
    semanticState,
    layouts,
    layoutMapping,
    target,
    dwarfProducer: dwarf.producer,
  });
  const restoreEvent = runTargetRestore(target, bundleDir);
  validateRestore(semanticState, restoreEvent);

  return {
    formatVersion: 1,
    hostArch: hostArch(),
    captureDir,
    bundleDir,
    target,
    dwarf: {
      producer: dwarf.producer,
      globals: [layouts.global.symbol, layouts.heap.symbol],
      layouts: summarizeLayouts(layouts),
      layoutMapping,
      stackProbe,
    },
    semanticState,
    restoreEvent,
    bundleFiles: bundleFileStats(bundleDir),
  };
}

function readDwarfModel(target) {
  const result = runCommand("readelf", ["--debug-dump=info", target], { label: "DWARF scan" });
  const dies = parseDwarfInfo(result.stdout);
  return buildDwarfModel(dies);
}

function parseDwarfInfo(text) {
  const roots = [];
  const byOffset = new Map();
  const stack = [];
  let current = null;

  for (const line of text.split(/\r?\n/)) {
    current = processDwarfInfoLine(line, current, { roots, byOffset, stack });
  }

  return { roots, byOffset, all: [...byOffset.values()] };
}

function processDwarfInfoLine(line, current, state) {
  const die = parseDieLine(line);
  if (die) {
    return appendDieNode({ die, ...state });
  }
  const attr = parseAttributeLine(line);
  if (attr && current) {
    current.attrs.set(attr.name, attr.value);
  }
  return current;
}

function parseDieLine(line) {
  const match =
    /^\s*<(\d+)><([0-9a-fA-F]+)>:\s+Abbrev Number:\s+\d+(?:\s+\((DW_TAG_[^)]+)\))?/.exec(line);
  return match ? { level: Number(match[1]), offset: match[2], tag: match[3] } : null;
}

function appendDieNode({ die, roots, byOffset, stack }) {
  if (!die.tag) {
    return null;
  }
  const node = {
    level: die.level,
    offset: normalizeDwarfOffset(die.offset),
    tag: die.tag,
    attrs: new Map(),
    children: [],
    parent: null,
  };
  const parent = die.level > 0 ? stack[die.level - 1] : null;
  if (parent) {
    node.parent = parent;
    parent.children.push(node);
  } else {
    roots.push(node);
  }
  stack[die.level] = node;
  stack.length = die.level + 1;
  byOffset.set(node.offset, node);
  return node;
}

function parseAttributeLine(line) {
  const match = /^\s*<[^>]+>\s+(DW_AT_[^\s:]+)\s*:\s+(.*)$/.exec(line);
  return match ? { name: match[1], value: match[2].trim() } : null;
}

function buildDwarfModel(dies) {
  const producerNode = dies.all.find((node) => node.attrs.has("DW_AT_producer"));
  return {
    ...dies,
    producer: producerNode ? parseDwarfString(producerNode.attrs.get("DW_AT_producer")) : "unknown",
    findTypeByName(name) {
      const node = dies.all.find(
        (candidate) => candidate.tag === "DW_TAG_structure_type" && dwarfName(candidate) === name,
      );
      assert(node, `missing DWARF struct type: ${name}`);
      return node;
    },
    findGlobal(name) {
      const node = dies.all.find(
        (candidate) =>
          candidate.tag === "DW_TAG_variable" &&
          dwarfName(candidate) === name &&
          !candidate.attrs.has("DW_AT_declaration"),
      );
      assert(node, `missing DWARF global variable: ${name}`);
      return node;
    },
    describeType(ref) {
      return describeType(dies.byOffset, ref);
    },
    typeSize(ref) {
      return typeSize(dies.byOffset, ref);
    },
    isPointerType(ref) {
      return isPointerType(dies.byOffset, ref);
    },
  };
}

function controlledDwarfLayouts(dwarf) {
  const globalType = dwarf.findTypeByName("ControlledDwarfGlobalState");
  const heapType = dwarf.findTypeByName("ControlledDwarfHeapState");
  const nodeType = dwarf.findTypeByName("ControlledDwarfNode");
  return {
    global: {
      symbol: globalVariable(dwarf, DWARF_GLOBAL_SYMBOL),
      layout: structLayout(dwarf, globalType),
    },
    heap: {
      symbol: globalVariable(dwarf, DWARF_HEAP_SYMBOL),
      layout: structLayout(dwarf, heapType),
    },
    node: { layout: structLayout(dwarf, nodeType) },
  };
}

function globalVariable(dwarf, name) {
  const variable = dwarf.findGlobal(name);
  const typeRef = parseDwarfRef(requireAttr(variable, "DW_AT_type"));
  const address = parseDwarfAddress(requireAttr(variable, "DW_AT_location"));
  const type = dwarf.describeType(typeRef);
  const sizeBytes = dwarf.typeSize(typeRef);
  return { name, address, type, sizeBytes, typeRef };
}

function structLayout(dwarf, typeNode) {
  const name = parseDwarfName(typeNode);
  const byteSize = parseDwarfInteger(requireAttr(typeNode, "DW_AT_byte_size"));
  const members = typeNode.children
    .filter((child) => child.tag === "DW_TAG_member")
    .map((member) => {
      const typeRef = parseDwarfRef(requireAttr(member, "DW_AT_type"));
      return {
        name: parseDwarfName(member),
        offset: member.attrs.has("DW_AT_data_member_location")
          ? parseMemberOffset(member.attrs.get("DW_AT_data_member_location"))
          : 0,
        type: dwarf.describeType(typeRef),
        typeRef,
        sizeBytes: dwarf.typeSize(typeRef),
        pointer: dwarf.isPointerType(typeRef),
      };
    })
    .sort((left, right) => left.offset - right.offset);
  return { type: `struct ${name}`, name, byteSize, members };
}

function summarizeLayouts(layouts) {
  return {
    global: summarizeLayout(layouts.global.layout),
    heap: summarizeLayout(layouts.heap.layout),
    node: summarizeLayout(layouts.node.layout),
  };
}

function summarizeLayout(layout) {
  return {
    type: layout.type,
    byteSize: layout.byteSize,
    fields: layout.members.map((member) => ({
      name: member.name,
      offset: member.offset,
      sizeBytes: member.sizeBytes,
      type: member.type,
      pointer: member.pointer,
    })),
  };
}

function summarizeStackProbe(dwarf) {
  const subprogram = dwarf.all.find(
    (candidate) =>
      candidate.tag === "DW_TAG_subprogram" &&
      dwarfName(candidate) === "controlled_nested_stack_point",
  );
  if (!subprogram) {
    return { function: "controlled_nested_stack_point", variables: [], limitation: "not found" };
  }
  return {
    function: "controlled_nested_stack_point",
    variables: subprogram.children
      .filter((child) => child.tag === "DW_TAG_variable" || child.tag === "DW_TAG_formal_parameter")
      .map((child) => ({
        name: parseDwarfName(child),
        tag: child.tag,
        type: child.attrs.has("DW_AT_type")
          ? dwarf.describeType(parseDwarfRef(child.attrs.get("DW_AT_type")))
          : "unknown",
        location:
          child.attrs.get("DW_AT_location") || child.attrs.get("DW_AT_location_list") || "missing",
      })),
  };
}

function runDwarfCapture(context) {
  const global = context.layouts.global.symbol;
  const heap = context.layouts.heap.symbol;
  const heapLayout = context.layouts.heap.layout;
  const nodeLayout = context.layouts.node.layout;
  const resourceFile = join(context.captureDir, "resource-file.txt");
  const followList = [
    heap.name,
    field(heapLayout, "head").offset,
    field(heapLayout, "node_count").offset,
    nodeLayout.byteSize,
    field(nodeLayout, "next").offset,
    DWARF_NODE_PREFIX,
  ].join(":");

  runCommand(
    context.capturer,
    [
      "--output",
      context.captureDir,
      "--symbol",
      `${global.name}:${global.address}:${global.sizeBytes}`,
      "--symbol",
      `${heap.name}:${heap.address}:${heap.sizeBytes}`,
      "--follow-list",
      followList,
      "--",
      context.target,
      "--fixture",
      "dwarf",
      "--pause-at-observation",
      "--resource-file",
      resourceFile,
    ],
    {
      label: "DWARF-guided raw capture",
      env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
    },
  );
}

function recoverDwarfState(capture, layouts) {
  const globalChunk = memoryChunkByName(capture, DWARF_GLOBAL_SYMBOL);
  const heapChunk = memoryChunkByName(capture, DWARF_HEAP_SYMBOL);
  const globalBytes = memoryChunkBytes(capture, globalChunk);
  const heapBytes = memoryChunkBytes(capture, heapChunk);
  const heapLayout = layouts.heap.layout;
  const nodeLayout = layouts.node.layout;

  const nodeCount = Number(readUnsigned(heapBytes, field(heapLayout, "node_count")));
  const checksum = readUnsigned(heapBytes, field(heapLayout, "checksum"));
  const headPointer = readUnsigned(heapBytes, field(heapLayout, "head"));
  const nodes = [];
  for (let i = 0; i < nodeCount; i++) {
    const chunk = memoryChunkByName(capture, `${DWARF_NODE_PREFIX}_${i}`);
    const bytes = memoryChunkBytes(capture, chunk);
    nodes.push({
      id: `controlled-dwarf-node-${i}`,
      sourceAddress: chunk.sourceAddress,
      tag: Number(readUnsigned(bytes, field(nodeLayout, "tag"))),
      color: Number(readUnsigned(bytes, field(nodeLayout, "color"))),
      value: Number(readUnsigned(bytes, field(nodeLayout, "value"))),
      nextPointer: hexAddress(readUnsigned(bytes, field(nodeLayout, "next"))),
      sizeBytes: chunk.sizeBytes,
      memory: { offset: chunk.fileOffset, sizeBytes: chunk.sizeBytes },
    });
  }

  return {
    global: {
      sourceAddress: globalChunk.sourceAddress,
      sizeBytes: globalChunk.sizeBytes,
      label: readCString(globalBytes, field(layouts.global.layout, "label")),
      counter: Number(readUnsigned(globalBytes, field(layouts.global.layout, "counter"))),
      flags: Number(readUnsigned(globalBytes, field(layouts.global.layout, "flags"))),
      generation: Number(readUnsigned(globalBytes, field(layouts.global.layout, "generation"))),
      memory: globalChunk,
    },
    heap: {
      sourceAddress: heapChunk.sourceAddress,
      sizeBytes: heapChunk.sizeBytes,
      version: Number(readUnsigned(heapBytes, field(heapLayout, "version"))),
      nodeCount,
      checksum: checksum.toString(10),
      checksumHex: hexAddress(checksum),
      headPointer: hexAddress(headPointer),
      values: nodes.map((node) => node.value),
      tags: nodes.map((node) => node.tag),
      colors: nodes.map((node) => node.color),
      nodes,
      memory: heapChunk,
    },
  };
}

function field(layout, name) {
  const member = layout.members.find((candidate) => candidate.name === name);
  if (!member) {
    throw new Error(`missing DWARF field ${layout.type}.${name}`);
  }
  return member;
}

const UNSIGNED_READERS = new Map([
  [1, (bytes, offset) => BigInt(bytes.readUInt8(offset))],
  [2, (bytes, offset) => BigInt(bytes.readUInt16LE(offset))],
  [4, (bytes, offset) => BigInt(bytes.readUInt32LE(offset))],
  [8, (bytes, offset) => bytes.readBigUInt64LE(offset)],
]);

function readUnsigned(bytes, member) {
  const offset = member.offset;
  if (offset + member.sizeBytes > bytes.length) {
    throw new Error(`field ${member.name} is outside captured bytes`);
  }
  const reader = UNSIGNED_READERS.get(member.sizeBytes);
  if (!reader) {
    throw new Error(`unsupported unsigned field width for ${member.name}: ${member.sizeBytes}`);
  }
  return reader(bytes, offset);
}

function readCString(bytes, member) {
  const start = member.offset;
  const limit = Math.min(bytes.length, start + member.sizeBytes);
  let end = start;
  while (end < limit && bytes[end] !== 0) {
    end++;
  }
  return bytes.subarray(start, end).toString("utf8");
}

function writePortableBundle(context) {
  const memory = buildPortableBundleMemory(context.capture);
  writePortableBundleFiles({
    bundleDir: context.bundleDir,
    captureDir: context.captureDir,
    capture: context.capture,
    memory,
    manifest: manifest(context),
    objects: objects(memory.chunks, context),
    relocations: relocations(context),
    controlledStateText: controlledStateText(context.semanticState),
    extraDocuments: [{ name: "dwarf-layout.json", value: dwarfLayoutDocument(context) }],
  });
}

function manifest(context) {
  return controlledPortableManifest({
    target: context.target,
    capture: context.capture,
    buildId: BUILD_ID,
    version: "dwarf-metadata-proof",
    checkpointContinuation: "machinen_controlled_dwarf_observation",
    restoreEntrypoint: "machinen_controlled_dwarf_restore",
    features: ["controlled-binary-corpus", "external-raw-capture", "dwarf-metadata-extraction"],
  });
}

function objects(chunks, context) {
  const byName = new Map(chunks.map((chunk) => [chunk.name, chunk]));
  const global = byName.get(DWARF_GLOBAL_SYMBOL);
  const heap = byName.get(DWARF_HEAP_SYMBOL);
  return {
    formatVersion: 1,
    objects: [
      {
        id: "controlled-dwarf-global-state",
        kind: "global",
        type: context.layouts.global.layout.type,
        sizeBytes: global.sizeBytes,
        sourceAddress: global.sourceAddress,
        memory: { offset: global.bundleOffset, sizeBytes: global.sizeBytes },
      },
      {
        id: "controlled-dwarf-heap-state",
        kind: "global",
        type: context.layouts.heap.layout.type,
        sizeBytes: heap.sizeBytes,
        sourceAddress: heap.sourceAddress,
        memory: { offset: heap.bundleOffset, sizeBytes: heap.sizeBytes },
      },
      ...context.semanticState.heap.nodes.map((node, index) =>
        nodeObject(byName, node, index, context),
      ),
    ],
    unsupported: unsupportedVocabulary(),
  };
}

function nodeObject(byName, node, index, context) {
  const chunk = byName.get(`${DWARF_NODE_PREFIX}_${index}`);
  return {
    id: node.id,
    kind: "heap",
    type: context.layouts.node.layout.type,
    sizeBytes: chunk.sizeBytes,
    sourceAddress: chunk.sourceAddress,
    allocation: { id: index + 1, sourceAddress: chunk.sourceAddress },
    memory: { offset: chunk.bundleOffset, sizeBytes: chunk.sizeBytes },
  };
}

function relocations(context) {
  const heapHead = field(context.layouts.heap.layout, "head");
  const nodeNext = field(context.layouts.node.layout, "next");
  const relocs = [
    {
      fromObject: "controlled-dwarf-heap-state",
      fromOffset: heapHead.offset,
      toObject: "controlled-dwarf-node-0",
      addend: 0,
      kind: "pointer",
      sourcePointer: context.semanticState.heap.headPointer,
    },
  ];
  for (let i = 0; i + 1 < context.semanticState.heap.nodes.length; i++) {
    relocs.push({
      fromObject: `controlled-dwarf-node-${i}`,
      fromOffset: nodeNext.offset,
      toObject: `controlled-dwarf-node-${i + 1}`,
      addend: 0,
      kind: "pointer",
      sourcePointer: context.semanticState.heap.nodes[i].nextPointer,
    });
  }
  return { formatVersion: 1, relocations: relocs, unsupported: unsupportedVocabulary() };
}

function dwarfLayoutDocument(context) {
  return {
    formatVersion: 1,
    sourceGuestArch: hostArch(),
    producer: context.dwarfProducer,
    globals: [context.layouts.global.symbol, context.layouts.heap.symbol].map((symbol) => ({
      name: symbol.name,
      address: symbol.address,
      sizeBytes: symbol.sizeBytes,
      type: symbol.type,
    })),
    layouts: summarizeLayouts(context.layouts),
    layoutMapping: context.layoutMapping,
  };
}

function controlledStateText(semanticState) {
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

function mapLayouts(source, target) {
  return {
    global: mapLayout(source.global.layout, target.global.layout),
    heap: mapLayout(source.heap.layout, target.heap.layout),
    node: mapLayout(source.node.layout, target.node.layout),
  };
}

function mapLayout(source, target) {
  return {
    sourceType: source.type,
    targetType: target.type,
    fields: source.members.map((sourceField) => {
      const targetField = field(target, sourceField.name);
      return {
        name: sourceField.name,
        sourceOffset: sourceField.offset,
        targetOffset: targetField.offset,
        sourceType: sourceField.type,
        targetType: targetField.type,
        pointer: sourceField.pointer || targetField.pointer,
      };
    }),
  };
}

function runTargetRestore(target, bundleDir) {
  const result = runCommand(target, ["--restore-dwarf-bundle", bundleDir], {
    label: "DWARF target restore",
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });
  return parseControlledMarker(result.stdout, "dwarf-restore");
}

function validateRestore(semanticState, restoreEvent) {
  assert(restoreEvent.arch === hostArch(), "restore ran on unexpected host architecture");
  assert(restoreEvent.global.label === semanticState.global.label, "restored global label changed");
  assert(
    restoreEvent.global.counter === semanticState.global.counter,
    "restored global counter changed",
  );
  assert(restoreEvent.global.flags === semanticState.global.flags, "restored global flags changed");
  assert(
    restoreEvent.global.generation === semanticState.global.generation,
    "restored global generation changed",
  );
  assert(
    restoreEvent.heap.node_count === semanticState.heap.nodeCount,
    "restored node count changed",
  );
  assert(
    JSON.stringify(restoreEvent.heap.values) === JSON.stringify(semanticState.heap.values),
    "restored node values changed",
  );
  assert(
    JSON.stringify(restoreEvent.heap.tags) === JSON.stringify(semanticState.heap.tags),
    "restored node tags changed",
  );
  assert(
    JSON.stringify(restoreEvent.heap.colors) === JSON.stringify(semanticState.heap.colors),
    "restored node colors changed",
  );
  assert(restoreEvent.heap.checksum_hex === semanticState.heap.checksumHex, "checksum changed");
}

function bundleFileStats(bundleDir) {
  return sharedBundleFileStats(bundleDir, [
    "manifest.json",
    "objects.json",
    "relocations.json",
    "resources.json",
    "dwarf-layout.json",
    "memory.bin",
  ]);
}

function dwarfName(node) {
  return node.attrs.has("DW_AT_name") ? parseDwarfString(node.attrs.get("DW_AT_name")) : undefined;
}

function parseDwarfName(node) {
  const name = dwarfName(node);
  assert(name !== undefined, `missing DW_AT_name on ${node.tag} ${node.offset}`);
  return name;
}

function parseDwarfString(raw) {
  const value = String(raw).trim();
  const indirect = /\):\s*(.*)$/.exec(value);
  if (indirect) {
    return indirect[1].trim();
  }
  const lineString = /^\([^)]*\)\s*(.*)$/.exec(value);
  if (lineString && lineString[1]) {
    return lineString[1].trim();
  }
  return value;
}

function parseDwarfRef(raw) {
  const match = /<0x([0-9a-fA-F]+)>/.exec(String(raw));
  assert(match, `missing DWARF reference in ${raw}`);
  return normalizeDwarfOffset(match[1]);
}

function parseDwarfAddress(raw) {
  const match = /DW_OP_addr:\s*(?:0x)?([0-9a-fA-F]+)/.exec(String(raw));
  assert(match, `missing DW_OP_addr in ${raw}`);
  return hexAddress(BigInt(`0x${match[1]}`));
}

function parseDwarfInteger(raw) {
  const text = String(raw).trim();
  const plusUconst = /DW_OP_plus_uconst:\s*(0x[0-9a-fA-F]+|\d+)/.exec(text);
  if (plusUconst) {
    return Number.parseInt(plusUconst[1], 0);
  }
  const match = /(0x[0-9a-fA-F]+|\d+)/.exec(text);
  assert(match, `missing integer in ${raw}`);
  return Number.parseInt(match[1], 0);
}

function parseMemberOffset(raw) {
  return parseDwarfInteger(raw);
}

function normalizeDwarfOffset(offset) {
  return `0x${offset.replace(/^0x/i, "").toLowerCase()}`;
}

function requireAttr(node, name) {
  const value = node.attrs.get(name);
  assert(value !== undefined, `missing ${name} on ${node.tag} ${node.offset}`);
  return value;
}

const TYPE_MODIFIER_TAGS = new Set([
  "DW_TAG_const_type",
  "DW_TAG_volatile_type",
  "DW_TAG_restrict_type",
  "DW_TAG_typedef",
]);

function describeType(byOffset, ref, seen = new Set()) {
  const node = requireType(byOffset, ref);
  if (seen.has(ref)) {
    return dwarfName(node) || node.tag;
  }
  seen.add(ref);
  return describeUnseenType(byOffset, node, seen);
}

function describeUnseenType(byOffset, node, seen) {
  const named = describeSimpleType(node);
  if (named) {
    return named;
  }
  const compound = describeCompoundType(byOffset, node, seen);
  if (compound) {
    return compound;
  }
  return describeModifiedOrFallback(byOffset, node, seen);
}

function describeModifiedOrFallback(byOffset, node, seen) {
  const modified = describeModifiedType(byOffset, node, seen);
  if (modified) {
    return modified;
  }
  return dwarfName(node) || node.tag;
}

function describeCompoundType(byOffset, node, seen) {
  if (node.tag === "DW_TAG_pointer_type") {
    return `${describePointerTarget(byOffset, node, seen)} *`;
  }
  if (node.tag === "DW_TAG_array_type") {
    const target = describeType(byOffset, parseDwarfRef(requireAttr(node, "DW_AT_type")), seen);
    return `${target}[]`;
  }
  return null;
}

function describeModifiedType(byOffset, node, seen) {
  return isTypeModifier(node)
    ? describeType(byOffset, parseDwarfRef(requireAttr(node, "DW_AT_type")), seen)
    : null;
}

function describeSimpleType(node) {
  if (node.tag === "DW_TAG_base_type") {
    return parseDwarfName(node);
  }
  if (node.tag === "DW_TAG_structure_type") {
    return `struct ${dwarfName(node) || "<anonymous>"}`;
  }
  return null;
}

function describePointerTarget(byOffset, node, seen) {
  return node.attrs.has("DW_AT_type")
    ? describeType(byOffset, parseDwarfRef(node.attrs.get("DW_AT_type")), seen)
    : "void";
}

function typeSize(byOffset, ref, seen = new Set()) {
  const node = requireType(byOffset, ref);
  const explicitSize = explicitTypeSize(node);
  if (explicitSize !== null) {
    return explicitSize;
  }
  if (seen.has(ref)) {
    throw new Error(`recursive DWARF type size: ${ref}`);
  }
  seen.add(ref);
  return derivedTypeSize(byOffset, node, seen, ref);
}

function explicitTypeSize(node) {
  return node.attrs.has("DW_AT_byte_size")
    ? parseDwarfInteger(node.attrs.get("DW_AT_byte_size"))
    : null;
}

function derivedTypeSize(byOffset, node, seen, ref) {
  if (node.tag === "DW_TAG_array_type") {
    const elementSize = typeSize(byOffset, parseDwarfRef(requireAttr(node, "DW_AT_type")), seen);
    return elementSize * arrayElementCount(node);
  }
  if (isTypeModifier(node)) {
    return typeSize(byOffset, parseDwarfRef(requireAttr(node, "DW_AT_type")), seen);
  }
  throw new Error(`DWARF type has no size: ${node.tag} ${ref}`);
}

function arrayElementCount(node) {
  const subrange = node.children.find((child) => child.tag === "DW_TAG_subrange_type");
  assert(subrange, `array type ${node.offset} has no subrange`);
  if (subrange.attrs.has("DW_AT_count")) {
    return parseDwarfInteger(subrange.attrs.get("DW_AT_count"));
  }
  if (subrange.attrs.has("DW_AT_upper_bound")) {
    return parseDwarfInteger(subrange.attrs.get("DW_AT_upper_bound")) + 1;
  }
  throw new Error(`array type ${node.offset} has no count or upper bound`);
}

function isPointerType(byOffset, ref, seen = new Set()) {
  const node = requireType(byOffset, ref);
  if (node.tag === "DW_TAG_pointer_type") {
    return true;
  }
  if (seen.has(ref) || !isTypeModifier(node)) {
    return false;
  }
  seen.add(ref);
  return isPointerType(byOffset, parseDwarfRef(requireAttr(node, "DW_AT_type")), seen);
}

function isTypeModifier(node) {
  return TYPE_MODIFIER_TAGS.has(node.tag);
}

function requireType(byOffset, ref) {
  const node = byOffset.get(ref);
  assert(node, `missing DWARF type ${ref}`);
  return node;
}

function hexAddress(value) {
  return `0x${value.toString(16)}`;
}

function printSummary(summary, temporary) {
  console.log(
    `dwarf-symbol-extract: ${summary.hostArch} extracted global + ${summary.semanticState.heap.nodeCount} heap nodes`,
  );
  console.log(
    `dwarf-symbol-extract: restored ${summary.semanticState.global.label} values ${summary.restoreEvent.heap.values.join(",")}`,
  );
  if (temporary) {
    console.log("dwarf-symbol-extract: temporary artifacts removed; pass --keep to inspect them");
  }
}

main();
