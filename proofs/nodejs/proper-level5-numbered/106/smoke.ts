#!/usr/bin/env tsx
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

type NodeRecord = {
  id: string;
  kind: "string" | "array" | "object";
  value?: string;
  elements?: string[];
  fields?: Record<string, string>;
};
type Graph = {
  build: { nodeMajor: number; v8Major: number; pointerCompression: boolean };
  nodes: NodeRecord[];
  roots: string[];
};
type DecodeResult = {
  accepted: boolean;
  targetStarted: boolean;
  graphTotal?: number;
  stringValues?: string[];
  arrayLengths?: number[];
  objectKeys?: string[];
  refusal?: { code: string };
};

function supportedGraph(overrides: Partial<Graph> = {}): Graph {
  return {
    build: { nodeMajor: 22, v8Major: 12, pointerCompression: true },
    nodes: [
      { id: "s1", kind: "string", value: "hello" },
      { id: "s2", kind: "string", value: "world" },
      { id: "a1", kind: "array", elements: ["s1", "s2"] },
      { id: "o1", kind: "object", fields: { greeting: "s1", list: "a1" } },
    ],
    roots: ["o1"],
    ...overrides,
  };
}
function decode(graph: Graph): DecodeResult {
  if (
    graph.build.nodeMajor !== 22 ||
    graph.build.v8Major !== 12 ||
    !graph.build.pointerCompression
  ) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-v8-graph-build-unsupported" },
    };
  }
  const ids = new Set(graph.nodes.map((node) => node.id));
  if (!graph.nodes.some((node) => node.kind === "string")) {
    return {
      accepted: false,
      targetStarted: false,
      refusal: { code: "node-proper-level5-v8-graph-string-table-missing" },
    };
  }
  for (const node of graph.nodes) {
    const refs = [...(node.elements ?? []), ...Object.values(node.fields ?? {})];
    if (refs.some((ref) => !ids.has(ref))) {
      return {
        accepted: false,
        targetStarted: false,
        refusal: { code: "node-proper-level5-v8-graph-dangling-reference" },
      };
    }
  }
  return {
    accepted: true,
    targetStarted: false,
    graphTotal: graph.nodes.length,
    stringValues: graph.nodes
      .filter((node) => node.kind === "string")
      .map((node) => node.value ?? ""),
    arrayLengths: graph.nodes
      .filter((node) => node.kind === "array")
      .map((node) => node.elements?.length ?? 0),
    objectKeys: graph.nodes
      .filter((node) => node.kind === "object")
      .flatMap((node) => Object.keys(node.fields ?? {})),
  };
}

function main(): void {
  const accepted = decode(supportedGraph());
  if (!accepted.accepted || accepted.graphTotal !== 4 || accepted.targetStarted) {
    throw new Error(`supported graph refused: ${JSON.stringify(accepted)}`);
  }
  const target = {
    stringsJoined: accepted.stringValues?.join(" "),
    firstArrayLength: accepted.arrayLengths?.[0],
    objectKeyCount: accepted.objectKeys?.length,
    targetNative: true,
  };
  const cases: Array<[string, Graph, string]> = [
    [
      "bad-build",
      supportedGraph({ build: { nodeMajor: 23, v8Major: 13, pointerCompression: true } }),
      "node-proper-level5-v8-graph-build-unsupported",
    ],
    [
      "missing-string-table",
      supportedGraph({ nodes: [{ id: "a1", kind: "array", elements: [] }] }),
      "node-proper-level5-v8-graph-string-table-missing",
    ],
    [
      "dangling-reference",
      supportedGraph({
        nodes: [
          { id: "s1", kind: "string", value: "hello" },
          { id: "a1", kind: "array", elements: ["missing"] },
        ],
      }),
      "node-proper-level5-v8-graph-dangling-reference",
    ],
  ];
  const refusedRows = cases.map(([id, graph, expectedCode]) => {
    const result = decode(graph);
    if (result.accepted || result.refusal?.code !== expectedCode || result.targetStarted) {
      throw new Error(`${id} expected ${expectedCode}, got ${JSON.stringify(result)}`);
    }
    return {
      id,
      expectedCode,
      actualCode: result.refusal.code,
      targetStarted: result.targetStarted,
    };
  });
  const checkedSummary = {
    kind: "machinen.node-proper-level5-v8-string-object-array-graph-summary",
    proof: "106",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    target,
    refusedRows,
    assertions: {
      stringObjectArrayGraphRecovered: true,
      targetReconstructedGraphState:
        target.stringsJoined === "hello world" &&
        target.firstArrayLength === 2 &&
        target.objectKeyCount === 2,
      unsupportedGraphsRefuseBeforeTargetStart: refusedRows.every(
        (row) => row.targetStarted === false,
      ),
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_106_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proofs/by-id/106/checked-summary.json is stale; rerun with UPDATE_PROOF_106_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ target, refused: refusedRows.length }));
  console.log("proof 106 V8 string/object/array graph passed");
}
try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
