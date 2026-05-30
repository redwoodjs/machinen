import { describe, expect, it } from "vitest";

import {
  recoverNodeProperLevel5RawV8ContextSmiCounter,
  recoverNodeProperLevel5V8ClosureCounterCell,
} from "../node-proper-level5-v8-closure-recovery.ts";

function heapSnapshotWithCountCell(cellType: "object" | "number") {
  const strings = ["", "machinenCounterHandler", "system / Context", "Object", "context", "count"];
  const nodeFields = ["type", "name", "id", "self_size", "edge_count", "detachedness"];
  const edgeFields = ["type", "name_or_index", "to_node"];
  const nodeTypes = [["hidden", "array", "string", "object", "code", "closure", "number"]];
  const edgeTypes = [["context", "element", "property", "internal", "hidden", "shortcut", "weak"]];
  const nodeSize = nodeFields.length;
  const closure = 0;
  const context = nodeSize;
  const cell = nodeSize * 2;
  return {
    snapshot: {
      meta: {
        node_fields: nodeFields,
        node_types: nodeTypes,
        edge_fields: edgeFields,
        edge_types: edgeTypes,
      },
    },
    strings,
    nodes: [
      5,
      1,
      1,
      64,
      1,
      0,
      3,
      2,
      2,
      48,
      1,
      0,
      cellType === "object" ? 3 : 6,
      cellType === "object" ? 3 : 0,
      3,
      32,
      0,
      0,
    ],
    edges: [3, 4, context, 0, 5, cell],
    nodeOffsets: { closure, context, cell },
  };
}

describe("proper Node Level 5 V8 closure/context recovery", () => {
  it("accepts an addressable counter cell found through closure -> context -> variable", () => {
    const result = recoverNodeProperLevel5V8ClosureCounterCell(
      heapSnapshotWithCountCell("object"),
      {
        closureNameIncludes: "Counter",
      },
    );

    expect(result).toMatchObject({
      accepted: true,
      variableName: "count",
      candidates: [
        {
          closureName: "machinenCounterHandler",
          variableName: "count",
          cellType: "object",
          cellName: "Object",
        },
      ],
      refusals: [],
    });
  });

  it("refuses primitive Smi-like cells until raw context slot decoding exists", () => {
    const result = recoverNodeProperLevel5V8ClosureCounterCell(heapSnapshotWithCountCell("number"));

    expect(result.accepted).toBe(false);
    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "node-proper-level5-v8-counter-cell-primitive-smi-not-addressable",
      }),
    ]);
  });

  it("decodes raw V8 pointer-compressed Smi slots near a closure context anchor", () => {
    const anchor = "machinen-level5-v8-context-anchor-v1";
    const anchorObject = new Uint8Array(96);
    anchorObject.set(new TextEncoder().encode(anchor), 16);
    const context = new Uint8Array(128);
    const taggedAnchor = 0x1000n + 1n;
    for (let index = 0; index < 8; index++) {
      context[32 + index] = Number((taggedAnchor >> BigInt(index * 8)) & 0xffn);
    }
    const smiTwo = 2n << 32n;
    for (let index = 0; index < 8; index++) {
      context[48 + index] = Number((smiTwo >> BigInt(index * 8)) & 0xffn);
    }

    const result = recoverNodeProperLevel5RawV8ContextSmiCounter(
      [
        { startAddress: 0x1000n, bytes: anchorObject, bytesPath: "anchor.bin" },
        { startAddress: 0x2000n, bytes: context, bytesPath: "context.bin" },
      ],
      { anchor, expectedValue: 2 },
    );

    expect(result).toMatchObject({
      accepted: true,
      value: 2,
      anchorTaggedAddress: "0x1001",
      contextBytesPath: "context.bin",
      contextSlotOffset: 48,
      smiEncoding: "v8-pointer-compressed-smi32",
      refusals: [],
    });
  });

  it("refuses malformed or unknown heap shapes fail-closed", () => {
    expect(recoverNodeProperLevel5V8ClosureCounterCell({}).refusals[0]?.code).toBe(
      "node-proper-level5-v8-heap-snapshot-malformed",
    );
    expect(
      recoverNodeProperLevel5V8ClosureCounterCell(heapSnapshotWithCountCell("object"), {
        variableName: "missing",
      }).refusals[0]?.code,
    ).toBe("node-proper-level5-v8-counter-closure-context-missing");
  });
});
