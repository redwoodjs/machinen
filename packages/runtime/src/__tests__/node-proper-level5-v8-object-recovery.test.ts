import { describe, expect, it } from "vitest";

import {
  recoverNodeProperLevel5V8ObjectStateEvidence,
  type NodeProperLevel5V8ObjectRecoveryRefusalCode,
} from "../node-proper-level5-v8-object-recovery.ts";

function smi32(value: number): Uint8Array {
  const bytes = new Uint8Array(8);
  const view = new DataView(bytes.buffer);
  view.setUint32(4, value >>> 0, true);
  return bytes;
}

function fragment(anchor: string, values: number[]): Uint8Array {
  const anchorBytes = new TextEncoder().encode(anchor);
  const bytes = new Uint8Array(anchorBytes.length + 16 + values.length * 8);
  bytes.set(anchorBytes, 0);
  values.forEach((value, index) => bytes.set(smi32(value), anchorBytes.length + 16 + index * 8));
  return bytes;
}

describe("recoverNodeProperLevel5V8ObjectStateEvidence", () => {
  const anchor = "machinen-level5-v8-object-state-anchor-v1";

  it("accepts one plain object with total and packed Smi history evidence", () => {
    const result = recoverNodeProperLevel5V8ObjectStateEvidence(
      [{ bytes: fragment(anchor, [2, 1, 2]), bytesPath: "memory/object.bin" }],
      { anchor, expectedTotal: 2, expectedHistory: [1, 2] },
    );

    expect(result.accepted).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({ total: 2, history: [1, 2] });
    expect(result.refusals).toEqual([]);
  });

  it("refuses missing object evidence", () => {
    const result = recoverNodeProperLevel5V8ObjectStateEvidence([{ bytes: new Uint8Array(32) }], {
      anchor,
      expectedTotal: 2,
      expectedHistory: [1, 2],
    });

    expect(result.accepted).toBe(false);
    expect(result.refusals[0]?.code).toBe("node-proper-level5-v8-object-state-missing");
  });

  it("refuses ambiguous object evidence", () => {
    const result = recoverNodeProperLevel5V8ObjectStateEvidence(
      [
        { bytes: fragment(anchor, [2, 1, 2]), bytesPath: "memory/a.bin" },
        { bytes: fragment(anchor, [2, 1, 2]), bytesPath: "memory/b.bin" },
      ],
      { anchor, expectedTotal: 2, expectedHistory: [1, 2] },
    );

    expect(result.accepted).toBe(false);
    expect(result.refusals[0]?.code).toBe("node-proper-level5-v8-object-state-ambiguous");
  });

  it.each<NodeProperLevel5V8ObjectRecoveryRefusalCode>([
    "node-proper-level5-v8-object-hidden-class-unsupported",
    "node-proper-level5-v8-object-sparse-array-unsupported",
    "node-proper-level5-v8-object-accessor-unsupported",
    "node-proper-level5-v8-object-proxy-unsupported",
    "node-proper-level5-v8-object-symbol-key-unsupported",
    "node-proper-level5-v8-object-external-string-unsupported",
    "node-proper-level5-v8-object-elements-kind-unsupported",
  ])("refuses unsupported shape %s", (unsupportedShape) => {
    const result = recoverNodeProperLevel5V8ObjectStateEvidence(
      [{ bytes: fragment(anchor, [2, 1, 2]) }],
      { anchor, expectedTotal: 2, expectedHistory: [1, 2], unsupportedShape },
    );

    expect(result.accepted).toBe(false);
    expect(result.refusals[0]?.code).toBe(unsupportedShape);
  });
});
