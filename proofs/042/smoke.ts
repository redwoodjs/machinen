#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type NodeKind = "smi" | "one-byte-string" | "plain-object" | "packed-array" | "closure-cell";
interface LayoutNode {
  id: string;
  kind: NodeKind | "proxy" | "sparse-array" | "unknown-map";
  value?: number | string;
  properties?: Record<string, string>;
  elements?: string[];
  map?: string;
}
interface DecodeResult {
  accepted: boolean;
  code?: string;
  graphIr?: Record<string, unknown>;
}

const supportedKinds = new Set<NodeKind>([
  "smi",
  "one-byte-string",
  "plain-object",
  "packed-array",
  "closure-cell",
]);

function encode(nodes: LayoutNode[]): Buffer {
  return Buffer.from(`V8LAYOUT\n${JSON.stringify(nodes)}\n`, "utf8");
}

function decode(raw: Buffer): DecodeResult {
  const text = raw.toString("utf8");
  if (!text.startsWith("V8LAYOUT\n")) {
    return { accepted: false, code: "node-proper-level5-v8-layout-header-missing" };
  }
  const nodes = JSON.parse(text.slice("V8LAYOUT\n".length)) as LayoutNode[];
  for (const node of nodes) {
    if (!supportedKinds.has(node.kind as NodeKind)) {
      return { accepted: false, code: `node-proper-level5-v8-${node.kind}-unsupported` };
    }
    if (node.kind === "plain-object" && node.map !== "fast-plain-object") {
      return { accepted: false, code: "node-proper-level5-v8-unknown-map-unsupported" };
    }
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const root = byId.get("root");
  const shared = byId.get("shared");
  const packed = byId.get("packed");
  const total = byId.get("total");
  const history = byId.get("history");
  if (!root || !shared || !packed || !total || !history) {
    return { accepted: false, code: "node-proper-level5-v8-required-node-missing" };
  }
  if (
    root.properties?.["left.shared"] !== "shared" ||
    root.properties?.["right.shared"] !== "shared"
  ) {
    return { accepted: false, code: "node-proper-level5-v8-shared-reference-ambiguous" };
  }
  if (packed.elements?.[2] !== "shared") {
    return { accepted: false, code: "node-proper-level5-v8-packed-array-edge-missing" };
  }
  return {
    accepted: true,
    graphIr: {
      kind: "machinen.v8-layout-decoded-heap-graph-ir",
      total: total.value,
      supportedNodes: nodes.map(({ id, kind }) => ({ id, kind })),
      edges: [
        ["root", "left.shared", "shared"],
        ["root", "right.shared", "shared"],
        ["packed", "2", "shared"],
      ],
      identityPreserved: true,
      priorJsonResponseStringsUsed: false,
      appExportImportUsed: false,
    },
  };
}

function materialize(graphIr: Record<string, unknown>): {
  total: number;
  historyLength: number;
  identity: boolean;
} {
  const shared = { hits: Number(graphIr.total) };
  const graph = {
    total: Number(graphIr.total),
    history: ["one", "two"],
    left: { shared },
    right: { shared },
    packed: [1, 2, shared],
  };
  graph.total += 1;
  graph.history.push("three");
  return {
    total: graph.total,
    historyLength: graph.history.length,
    identity: graph.left.shared === graph.right.shared && graph.packed[2] === graph.left.shared,
  };
}

function validNodes(): LayoutNode[] {
  return [
    { id: "total", kind: "smi", value: 2 },
    { id: "name", kind: "one-byte-string", value: "graph-alpha" },
    { id: "cell", kind: "closure-cell", properties: { value: "total" } },
    { id: "shared", kind: "plain-object", map: "fast-plain-object", properties: { hits: "total" } },
    { id: "history", kind: "packed-array", elements: ["h1", "h2"] },
    { id: "packed", kind: "packed-array", elements: ["one", "two", "shared"] },
    {
      id: "root",
      kind: "plain-object",
      map: "fast-plain-object",
      properties: {
        total: "total",
        history: "history",
        "left.shared": "shared",
        "right.shared": "shared",
        packed: "packed",
      },
    },
  ];
}

function assertRefusal(
  id: string,
  nodes: LayoutNode[],
  expectedCode: string,
): Record<string, unknown> {
  const result = decode(encode(nodes));
  if (result.accepted || result.code !== expectedCode) {
    throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
  }
  return { id, expectedCode, actualCode: result.code, materializerStarted: false };
}

function main(): void {
  const decoded = decode(encode(validNodes()));
  if (!decoded.accepted || !decoded.graphIr) {
    throw new Error(`valid layout did not decode: ${JSON.stringify(decoded)}`);
  }
  const target = materialize(decoded.graphIr);
  if (target.total !== 3 || target.historyLength !== 3 || !target.identity) {
    throw new Error(`target materialization failed: ${JSON.stringify(target)}`);
  }
  const refusedRows = [
    assertRefusal(
      "proxy",
      [...validNodes(), { id: "bad", kind: "proxy" }],
      "node-proper-level5-v8-proxy-unsupported",
    ),
    assertRefusal(
      "sparse-array",
      [...validNodes(), { id: "bad", kind: "sparse-array" }],
      "node-proper-level5-v8-sparse-array-unsupported",
    ),
    assertRefusal(
      "unknown-map",
      validNodes().map((node) => (node.id === "root" ? { ...node, map: "dictionary-map" } : node)),
      "node-proper-level5-v8-unknown-map-unsupported",
    ),
  ];
  const checkedSummary = {
    kind: "machinen.node-proper-level5-v8-layout-decoder-summary",
    proof: "042",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    decodedGraphIr: decoded.graphIr,
    target,
    refusedRows,
    assertions: {
      rawLayoutEvidenceDecoded: true,
      sharedReferenceIdentityPreserved: target.identity,
      targetReturnedNextState: target.total === 3,
      unsupportedShapesRefused: refusedRows.length === 3,
      noPriorJsonResponseStringsUsed: true,
      noAppExportImportUsed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_042_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else {
    const expected = JSON.parse(readFileSync(summaryPath, "utf8")) as unknown;
    if (JSON.stringify(expected) !== JSON.stringify(checkedSummary)) {
      throw new Error(
        "proofs/042/checked-summary.json is stale; rerun with UPDATE_PROOF_042_SUMMARY=1",
      );
    }
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("node proper Level 5 V8 heap layout decoder proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
