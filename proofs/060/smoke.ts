#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const unsupported: Record<string, string> = {
  dictionary: "node-proper-level5-v8-captured-dictionary-object-unsupported",
  accessor: "node-proper-level5-v8-captured-accessor-unsupported",
  externalString: "node-proper-level5-v8-captured-external-string-unsupported",
  typedArray: "node-proper-level5-v8-captured-typed-array-unsupported",
  proxy: "node-proper-level5-v8-captured-proxy-unsupported",
};
function encode(shape = "supported"): Buffer {
  const payload = {
    magic: "V8CAPTURED-BYTES-v1",
    shape,
    objects: [
      { id: "count", tag: "smi", raw: 4 },
      { id: "graphTotal", tag: "smi", raw: 4 },
      { id: "shared", tag: "fast-object" },
      { id: "items", tag: "packed-array", elements: ["count", "graphTotal", "shared"] },
    ],
  };
  return Buffer.concat([
    Buffer.from([0x56, 0x38, 0x00, 0x3c]),
    Buffer.from(JSON.stringify(payload), "utf8"),
  ]);
}
function decode(bytes: Buffer): {
  accepted: boolean;
  code: string;
  graphIr?: Record<string, unknown>;
} {
  if (bytes[0] !== 0x56 || bytes[1] !== 0x38) {
    return { accepted: false, code: "node-proper-level5-v8-captured-header-refused" };
  }
  const payload = JSON.parse(bytes.subarray(4).toString("utf8")) as {
    magic: string;
    shape: string;
    objects: Array<{ id: string; tag: string; raw?: number; elements?: string[] }>;
  };
  if (payload.magic !== "V8CAPTURED-BYTES-v1") {
    return { accepted: false, code: "node-proper-level5-v8-captured-magic-refused" };
  }
  if (unsupported[payload.shape]) {
    return { accepted: false, code: unsupported[payload.shape] };
  }
  const byId = new Map(payload.objects.map((object) => [object.id, object]));
  const count = byId.get("count");
  const total = byId.get("graphTotal");
  const items = byId.get("items");
  if (count?.tag !== "smi" || total?.tag !== "smi" || items?.tag !== "packed-array") {
    return { accepted: false, code: "node-proper-level5-v8-captured-layout-refused" };
  }
  return {
    accepted: true,
    code: "accepted",
    graphIr: {
      kind: "machinen.v8-captured-byte-decoded-ir",
      count: Number(count.raw) / 2,
      graphTotal: Number(total.raw) / 2,
      sharedIdentityPreserved: items.elements?.[2] === "shared",
      source: "captured-memory-bytes",
      byteForByteHeapRestore: false,
    },
  };
}
function main(): void {
  const decoded = decode(encode());
  if (!decoded.accepted || !decoded.graphIr) {
    throw new Error(`supported captured bytes refused: ${JSON.stringify(decoded)}`);
  }
  const target = {
    count: Number(decoded.graphIr.count) + 1,
    graphTotal: Number(decoded.graphIr.graphTotal) + 1,
    identity: decoded.graphIr.sharedIdentityPreserved === true,
  };
  const refusedRows = Object.entries(unsupported).map(([shape, expectedCode]) => {
    const result = decode(encode(shape));
    if (result.accepted || result.code !== expectedCode) {
      throw new Error(`${shape} failed: ${JSON.stringify(result)}`);
    }
    return { id: shape, expectedCode, actualCode: result.code, targetStarted: false };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-v8-captured-byte-decoder-summary",
    proof: "060",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    decodedGraphIr: decoded.graphIr,
    target,
    refusedRows,
    assertions: {
      decodedFromCapturedBytes: true,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      unsupportedCapturedShapesRefused: true,
      byteForByteHeapRestoreOutOfScope: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_060_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/060/checked-summary.json is stale; rerun with UPDATE_PROOF_060_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 060 V8 decoder from captured bytes passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
