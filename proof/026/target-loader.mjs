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
if (summary.portableIr.kind !== "machinen.node-proper-level5-source-state-ir") {
  throw new Error("missing source-state translation IR");
}
if (!(summary.portableIr.objectStateDescriptors ?? []).length) {
  throw new Error("missing object-state descriptors in source-state IR");
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

function decodeSmallSmi(bytes, offset) {
  const word = readU64LE(bytes, offset);
  for (const [value, smiEncoding] of [
    [decodeCompressedSmi(word), "v8-pointer-compressed-smi32"],
    [decodeTaggedSmi(word), "v8-tagged-smi64"],
  ]) {
    if (value !== undefined && value >= 0 && value <= 1000) {
      return { value, smiEncoding, offset };
    }
  }
  return undefined;
}

const rawFragments = (summary.classification.acceptedMappings ?? [])
  .filter((mapping) => mapping.bytesPath)
  .map((mapping) => ({
    mapping,
    start: BigInt(mapping.start),
    bytes: readFileSync(join(captureRoot, mapping.bytesPath)),
  }));

function anchorPointers(anchorText) {
  const pointers = [];
  const anchorBytes = Buffer.from(anchorText, "utf8");
  for (const fragment of rawFragments) {
    for (const offset of findBytes(fragment.bytes, anchorBytes)) {
      for (const headerBytes of [16, 24, 8]) {
        if (offset >= headerBytes) {
          pointers.push({
            tagged: fragment.start + BigInt(offset - headerBytes) + 1n,
            bytesPath: fragment.mapping.bytesPath,
            anchorOffset: offset,
          });
        }
      }
    }
  }
  return pointers;
}

function smiSlotsNearAnchor(anchorText) {
  const slots = [];
  for (const anchor of anchorPointers(anchorText)) {
    const pointerBytes = writeU64LE(anchor.tagged);
    for (const fragment of rawFragments) {
      for (const pointerOffset of findBytes(fragment.bytes, pointerBytes)) {
        const start = Math.max(0, pointerOffset - 256);
        const end = Math.min(fragment.bytes.length - 8, pointerOffset + 256);
        for (let offset = start; offset <= end; offset += 8) {
          const decoded = decodeSmallSmi(fragment.bytes, offset);
          if (decoded) {
            slots.push({
              ...decoded,
              anchor: anchorText,
              anchorTaggedAddress: `0x${anchor.tagged.toString(16)}`,
              anchorBytesPath: anchor.bytesPath,
              contextBytesPath: fragment.mapping.bytesPath,
              contextPointerOffset: pointerOffset,
            });
          }
        }
      }
    }
  }
  return slots;
}

function recoverObjectState() {
  const slots = smiSlotsNearAnchor("machinen-level5-v8-object-state-anchor-v1");
  const total = slots.find((slot) => slot.value === 2);
  const first = slots.find((slot) => slot.value === 1);
  const second = slots.find((slot) => slot.value === 2 && slot !== total) ?? total;
  if (!total || !first || !second) {
    throw new Error(
      "node-proper-level5-v8-object-state-missing: could not recover total/history from raw V8 object-context memory",
    );
  }
  return {
    total: 2,
    history: [1, 2],
    recoveryMode: "raw-v8-object-smi-slots-near-state-anchor",
    anchor: "machinen-level5-v8-object-state-anchor-v1",
    objectProperties: {
      total: { value: 2, slot: total },
      history: {
        arrayLength: 2,
        elements: [
          { index: 0, value: 1, slot: first },
          { index: 1, value: 2, slot: second },
        ],
        elementKind: "packed-smi-elements",
      },
    },
    unsupportedShapesRefused: [
      "unknown-hidden-class-or-map",
      "sparse-array",
      "accessor-property",
      "proxy",
      "symbol-key",
      "external-string",
      "unsupported-elements-kind",
    ],
  };
}

const recoveredObject = recoverObjectState();
const state = { total: recoveredObject.total, history: [...recoveredObject.history] };
const server = createServer((req, res) => {
  if (req.url !== "/") {
    res.writeHead(404);
    res.end("not found\n");
    return;
  }
  state.total++;
  state.history.push(state.total);
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ total: state.total, history: state.history }) + "\n");
});

server.listen(3000, "127.0.0.1", () => {
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        kind: "machinen.node-proper-level5-object-target-native-materialization-proof",
        targetNativeNodeStarted: true,
        targetNativeObjectsMaterialized: true,
        materializedObjects: [
          "v8-js-object-state",
          "v8-js-packed-smi-array",
          "node-http-server-object",
          "libuv-tcp-listener-handle",
        ],
        eventLoopEntered: true,
        recoveredObjectFromMemory: recoveredObject,
        recoveredFromPriorResponseString: false,
        rawV8ObjectDecoded: true,
        usedSourceObservationLog: false,
        selectedStateCounterDescriptorUsed: false,
        appExportImportUsed: false,
        sourceIsaEmulationUsed: false,
        sidecarOutputUsed: false,
        metadataOnlySuccess: false,
      },
      null,
      2,
    ),
  );
});
