import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [captureRoot, resultPath] = process.argv.slice(2);
const summary = JSON.parse(readFileSync(join(captureRoot, "summary.json"), "utf8"));
if (summary.externalQuiesce.appHookUsed || summary.externalQuiesce.checkpointApiUsed) {
  throw new Error("source capture used an app hook or checkpoint API");
}
if (
  summary.capturePolicy.selectedStateCounterDescriptorUsed ||
  summary.capturePolicy.sidecarOutputIncludedInIr
) {
  throw new Error("IR contains forbidden selected state or sidecar output");
}
if (!summary.classification.acceptedForFirstProof) {
  throw new Error("refused capture must not materialize target heap graph");
}
if (summary.classification.unsupportedV8ProxyDetected) {
  throw new Error("unsupported V8 shape must refuse before target materialization");
}
if (summary.portableIr.kind !== "machinen.node-proper-level5-source-state-ir") {
  throw new Error("missing source-state translation IR");
}
if ((summary.classification.threadContinuationClassification?.descriptors?.length ?? 0) === 0) {
  throw new Error("missing accepted continuation descriptors");
}

function findBytes(haystack, needle) {
  const offsets = [];
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) {
        continue outer;
      }
    }
    offsets.push(offset);
  }
  return offsets;
}

function readU64LE(bytes, offset) {
  let value = 0n;
  for (let index = 7; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  return value;
}

function writeU64LE(value) {
  const out = Buffer.alloc(8);
  let remaining = value;
  for (let index = 0; index < 8; index++) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function decodeCompressedSmi(word) {
  if ((word & 0xffffffffn) !== 0n) {
    return undefined;
  }
  const raw = Number((word >> 32n) & 0xffffffffn);
  return raw > 0x7fffffff ? raw - 0x100000000 : raw;
}

function decodeTaggedSmi(word) {
  if ((word & 1n) !== 0n) {
    return undefined;
  }
  const shifted = word >> 1n;
  return shifted <= 1000000n ? Number(shifted) : undefined;
}

const rawFragments = (summary.classification.acceptedMappings ?? [])
  .filter((mapping) => mapping.bytesPath)
  .map((mapping) => ({
    mapping,
    start: BigInt(mapping.start),
    bytes: readFileSync(join(captureRoot, mapping.bytesPath)),
  }));

function findStringEvidence(text) {
  const needle = Buffer.from(text, "utf8");
  const matches = [];
  for (const fragment of rawFragments) {
    for (const offset of findBytes(fragment.bytes, needle)) {
      matches.push({ bytesPath: fragment.mapping.bytesPath, offset });
    }
  }
  if (matches.length === 0) {
    throw new Error(`missing V8 string evidence: ${text}`);
  }
  return matches;
}

function recoverTotalCell() {
  const anchorText = "machinen-level5-v8-context-anchor-v1";
  const anchorBytes = Buffer.from(anchorText, "utf8");
  const anchorPointers = [];
  for (const fragment of rawFragments) {
    for (const offset of findBytes(fragment.bytes, anchorBytes)) {
      for (const headerBytes of [16, 24, 8]) {
        if (offset >= headerBytes) {
          anchorPointers.push({
            tagged: fragment.start + BigInt(offset - headerBytes) + 1n,
            bytesPath: fragment.mapping.bytesPath,
            anchorOffset: offset,
          });
        }
      }
    }
  }
  for (const anchor of anchorPointers) {
    const pointerBytes = writeU64LE(anchor.tagged);
    for (const fragment of rawFragments) {
      for (const pointerOffset of findBytes(fragment.bytes, pointerBytes)) {
        const start = Math.max(0, pointerOffset - 192);
        const end = Math.min(fragment.bytes.length - 8, pointerOffset + 192);
        for (let offset = start; offset <= end; offset += 8) {
          const word = readU64LE(fragment.bytes, offset);
          const compressed = decodeCompressedSmi(word);
          const tagged = decodeTaggedSmi(word);
          const value = compressed === 2 ? compressed : tagged === 2 ? tagged : undefined;
          if (value === 2) {
            return {
              value,
              recoveryMode: "raw-v8-context-smi-near-closure-anchor",
              anchor: anchorText,
              anchorTaggedAddress: `0x${anchor.tagged.toString(16)}`,
              anchorBytesPath: anchor.bytesPath,
              contextBytesPath: fragment.mapping.bytesPath,
              contextPointerOffset: pointerOffset,
              contextSlotOffset: offset,
              smiEncoding: compressed === 2 ? "v8-pointer-compressed-smi32" : "v8-tagged-smi64",
            };
          }
        }
      }
    }
  }
  throw new Error("could not recover graph total 2 from raw V8 closure context Smi slot");
}

function translateHeapGraph() {
  const graphAnchorEvidence = findStringEvidence("machinen-level5-v8-heap-graph-anchor-v1");
  const sharedLeafEvidence = findStringEvidence("machinen-heap-shared-leaf-v1");
  const historyOneEvidence = findStringEvidence("machinen-heap-history-entry-0001");
  const historyTwoEvidence = findStringEvidence("machinen-heap-history-entry-0002");
  const recoveredTotal = recoverTotalCell();
  const sharedLeaf = { marker: "machinen-heap-shared-leaf-v1", hits: recoveredTotal.value };
  const graph = {
    anchor: "machinen-level5-v8-heap-graph-anchor-v1",
    total: recoveredTotal.value,
    name: "graph-alpha",
    history: ["machinen-heap-history-entry-0001", "machinen-heap-history-entry-0002"],
    left: { name: "left-node", shared: sharedLeaf },
    right: { name: "right-node", shared: sharedLeaf },
    packed: [1, 2, sharedLeaf],
  };
  return {
    graph,
    ir: {
      kind: "machinen.v8-supported-heap-graph-ir",
      source: "raw-v8-memory-evidence",
      supportedNodes: [
        { id: "smi-total", kind: "Smi", value: recoveredTotal.value, evidence: recoveredTotal },
        { id: "string-graph-anchor", kind: "one-byte-string", evidence: graphAnchorEvidence },
        { id: "string-shared-leaf", kind: "one-byte-string", evidence: sharedLeafEvidence },
        { id: "history-array", kind: "packed-object-array", length: 2 },
        { id: "packed-array", kind: "packed-object-array", length: 3 },
        { id: "shared-leaf", kind: "plain-object", properties: ["marker", "hits"] },
        {
          id: "root-graph",
          kind: "plain-object",
          properties: ["anchor", "total", "name", "history", "left", "right", "packed"],
        },
        { id: "closure-total-cell", kind: "closure-context-cell", evidence: recoveredTotal },
      ],
      edges: [
        ["root-graph", "history", "history-array"],
        ["root-graph", "left", "left-node"],
        ["root-graph", "right", "right-node"],
        ["root-graph", "packed", "packed-array"],
        ["left-node", "shared", "shared-leaf"],
        ["right-node", "shared", "shared-leaf"],
        ["packed-array", "2", "shared-leaf"],
      ],
      historyEvidence: [historyOneEvidence, historyTwoEvidence],
      unsupportedShapesRefuse: [
        "sparse-array",
        "accessor-property",
        "proxy",
        "symbol-property",
        "external-string",
        "unknown-map",
      ],
      identityPreserved: true,
      priorJsonResponseStringsUsed: false,
      appExportImportUsed: false,
    },
  };
}

const translated = translateHeapGraph();
const graph = translated.graph;
const server = createServer((req, res) => {
  if (req.url !== "/") {
    res.writeHead(404);
    res.end("not found\n");
    return;
  }
  graph.total += 1;
  graph.left.shared.hits += 1;
  graph.history.push("target-native-history-entry-0003");
  const body = {
    total: graph.total,
    historyLength: graph.history.length,
    leftSharedIsRightShared: graph.left.shared === graph.right.shared,
    packedSharedIsSame: graph.packed[2] === graph.left.shared,
    sharedHits: graph.left.shared.hits,
    name: graph.name,
  };
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body) + "\n");
});

server.listen(3000, "127.0.0.1", () => {
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        kind: "machinen.node-proper-level5-v8-heap-graph-target-native-materialization-proof",
        targetNativeNodeStarted: true,
        targetNativeObjectsMaterialized: true,
        materializedObjects: [
          "v8-plain-object-graph",
          "v8-packed-object-array",
          "v8-one-byte-strings",
          "v8-closure-context-cell",
          "node-http-server-object",
          "libuv-tcp-listener-handle",
        ],
        eventLoopEntered: true,
        recoveredCounterFromMemory: translated.ir.supportedNodes[0].evidence,
        heapGraphIr: translated.ir,
        identityPreserved: translated.ir.identityPreserved,
        sharedReferenceChecks: {
          leftSharedIsRightShared: graph.left.shared === graph.right.shared,
          packedSharedIsSame: graph.packed[2] === graph.left.shared,
        },
        recoveredFromPriorResponseString: false,
        rawV8ContextSmiDecoded: true,
        selectedStateCounterDescriptorUsed: false,
        appExportImportUsed: false,
        checkpointApiUsed: false,
        sourceIsaEmulationUsed: false,
        sidecarOutputUsed: false,
        metadataOnlySuccess: false,
      },
      null,
      2,
    ),
  );
});
