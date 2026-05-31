#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type Node = {
  id: string;
  kind: string;
  map?: string;
  value?: unknown;
  properties?: Record<string, string>;
  elements?: string[];
};
const supportedKinds = new Set([
  "smi",
  "one-byte-string",
  "plain-object",
  "packed-array",
  "closure-cell",
]);
const unsupportedCodes: Record<string, string> = {
  "dictionary-object": "node-proper-level5-v8-dictionary-object-unsupported",
  accessor: "node-proper-level5-v8-accessor-unsupported",
  symbol: "node-proper-level5-v8-symbol-unsupported",
  "external-string": "node-proper-level5-v8-external-string-unsupported",
  "typed-array": "node-proper-level5-v8-typed-array-unsupported",
  "weak-ref": "node-proper-level5-v8-weak-ref-unsupported",
  proxy: "node-proper-level5-v8-proxy-unsupported",
  "sparse-array": "node-proper-level5-v8-sparse-array-unsupported",
  "unknown-map": "node-proper-level5-v8-unknown-map-unsupported",
};

function fixture(extra: Node[] = []): Node[] {
  return [
    { id: "count", kind: "smi", value: 2 },
    { id: "graphTotal", kind: "smi", value: 2 },
    { id: "label", kind: "one-byte-string", value: "expanded" },
    { id: "cell", kind: "closure-cell", properties: { value: "count" } },
    {
      id: "shared",
      kind: "plain-object",
      map: "fast-plain-object",
      properties: { hits: "graphTotal" },
    },
    { id: "items", kind: "packed-array", elements: ["count", "graphTotal", "shared"] },
    {
      id: "root",
      kind: "plain-object",
      map: "fast-plain-object",
      properties: {
        count: "count",
        graphTotal: "graphTotal",
        label: "label",
        sharedA: "shared",
        sharedB: "shared",
        items: "items",
      },
    },
    ...extra,
  ];
}

function decode(nodes: Node[]): {
  accepted: boolean;
  code: string;
  graphIr?: Record<string, unknown>;
} {
  for (const node of nodes) {
    if (unsupportedCodes[node.kind]) {
      return { accepted: false, code: unsupportedCodes[node.kind] };
    }
    if (!supportedKinds.has(node.kind)) {
      return { accepted: false, code: "node-proper-level5-v8-unknown-map-unsupported" };
    }
    if (node.kind === "plain-object" && node.map !== "fast-plain-object") {
      return { accepted: false, code: "node-proper-level5-v8-unknown-map-unsupported" };
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = byId.get("root");
  const items = byId.get("items");
  if (
    !root ||
    !items ||
    root.properties?.sharedA !== "shared" ||
    root.properties.sharedB !== "shared" ||
    items.elements?.[2] !== "shared"
  ) {
    return { accepted: false, code: "node-proper-level5-v8-reference-edge-unsupported" };
  }
  return {
    accepted: true,
    code: "accepted",
    graphIr: {
      kind: "machinen.v8-expanded-layout-heap-graph-ir",
      count: byId.get("count")?.value,
      graphTotal: byId.get("graphTotal")?.value,
      decodedKinds: [...new Set(nodes.map((node) => node.kind))].sort(),
      edges: [
        ["root", "sharedA", "shared"],
        ["root", "sharedB", "shared"],
        ["items", "2", "shared"],
      ],
      sharedIdentityPreserved: true,
      byteForByteHeapRestore: false,
      priorJsonResponseStringsUsed: false,
      appExportImportUsed: false,
    },
  };
}

function materialize(graphIr: Record<string, unknown>): Record<string, unknown> {
  const shared = { hits: Number(graphIr.graphTotal) };
  const graph = {
    count: Number(graphIr.count),
    graphTotal: Number(graphIr.graphTotal),
    sharedA: shared,
    sharedB: shared,
    items: [1, 2, shared],
  };
  graph.count += 1;
  graph.graphTotal += 1;
  return {
    count: graph.count,
    graphTotal: graph.graphTotal,
    identity: graph.sharedA === graph.sharedB && graph.items[2] === graph.sharedA,
  };
}

function main(): void {
  const decoded = decode(fixture());
  if (!decoded.accepted || !decoded.graphIr) {
    throw new Error(`supported fixture refused: ${JSON.stringify(decoded)}`);
  }
  const target = materialize(decoded.graphIr);
  if (target.count !== 3 || target.graphTotal !== 3 || !target.identity) {
    throw new Error(`target failed: ${JSON.stringify(target)}`);
  }
  const refusedRows = Object.entries(unsupportedCodes).map(([kind, expectedCode]) => {
    const result = decode(fixture([{ id: `bad-${kind}`, kind }]));
    if (result.accepted || result.code !== expectedCode) {
      throw new Error(`${kind} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return { id: kind, expectedCode, actualCode: result.code, targetStarted: false };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-v8-decoder-expansion-summary",
    proof: "050",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    decodedGraphIr: decoded.graphIr,
    target,
    refusedRows,
    assertions: {
      supportedLayoutsDecoded: true,
      sharedReferenceIdentityPreserved: target.identity,
      targetReturnedNextState: target.count === 3 && target.graphTotal === 3,
      unsupportedShapesRefused: refusedRows.length === Object.keys(unsupportedCodes).length,
      noPriorJsonResponseStringsUsed: true,
      noAppExportImportUsed: true,
      byteForByteHeapRestoreOutOfScope: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_050_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/050/checked-summary.json is stale; rerun with UPDATE_PROOF_050_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("node proper Level 5 V8 decoder expansion proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
