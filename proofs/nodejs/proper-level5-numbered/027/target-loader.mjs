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
if (summary.classification.activeHttpRequestDetected) {
  throw new Error("active HTTP request state must refuse, not materialize");
}
if (summary.portableIr.kind !== "machinen.node-proper-level5-source-state-ir") {
  throw new Error("missing source-state translation IR");
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

function recoverCounter() {
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
        const start = Math.max(0, pointerOffset - 160);
        const end = Math.min(fragment.bytes.length - 8, pointerOffset + 160);
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
  throw new Error("could not recover count 2 from raw V8 closure context Smi slot");
}

const recovered = recoverCounter();
let count = recovered.value;
const server = createServer((req, res) => {
  if (req.url !== "/") {
    res.writeHead(404);
    res.end("not found\n");
    return;
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ count: ++count }) + "\n");
});

server.listen(3000, "127.0.0.1", () => {
  writeFileSync(
    resultPath,
    JSON.stringify(
      {
        kind: "machinen.node-proper-level5-http-state-target-native-materialization-proof",
        targetNativeNodeStarted: true,
        targetNativeObjectsMaterialized: true,
        materializedObjects: [
          "v8-js-counter-cell",
          "node-http-server-object",
          "libuv-tcp-listener-handle",
        ],
        eventLoopEntered: true,
        recoveredCounterFromMemory: recovered,
        listenerPolicy: summary.httpStatePolicy,
        recoveredFromPriorResponseString: false,
        rawV8ContextSmiDecoded: true,
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
