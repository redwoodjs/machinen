import { describe, expect, it } from "vitest";
import { materializeNativeStackWindowWrites } from "../native-stack-window-materializer.ts";
import { planNativeStackWindowMaterialization } from "../native-stack-translation.ts";

function plan() {
  return planNativeStackWindowMaterialization({
    stackMapping: "mapping:stack",
    sourceStackBase: "0x700000000000",
    sourceStackLimit: "0x700000001000",
    targetStackBase: "0x50000000f000",
    targetStackLimit: "0x500000010000",
    guardBelowAddress: "0x50000000e000",
    guardAboveAddress: "0x500000011000",
    pointerRanges: [{ id: "heap", targetBase: "0x60000000f000", targetLimit: "0x600000010000" }],
    codeLocations: [
      {
        id: "code:return",
        sourceMapping: "mapping:text",
        sourceAddress: "0x400180",
        targetAddress: "0x700300000316",
        state: "mapped",
      },
    ],
    frames: [
      {
        id: "frame:caller",
        sourceSp: "0x700000000f00",
        sourceReturnAddress: "0x400180",
        sizeBytes: 64,
        metadata: "dwarf",
        locals: [
          {
            offset: 24,
            kind: "pointer",
            sourceValue: "0x600000000000",
            targetValue: "0x60000000f000",
          },
        ],
      },
    ],
  });
}

describe("native stack-window materializer", () => {
  it("emits target u64 writes for translated return and pointer slots", () => {
    const result = materializeNativeStackWindowWrites(plan());

    expect(result).toMatchObject({ state: "materialized", stackMapping: "mapping:stack" });
    expect(result.state === "materialized" ? result.writes : []).toEqual([
      expect.objectContaining({
        offset: 0,
        targetAddress: "0x50000000f000",
        value: "0x700300000316",
        bytes: "1603000003700000",
        kind: "return-address",
      }),
      expect.objectContaining({
        offset: 24,
        targetAddress: "0x50000000f018",
        value: "0x60000000f000",
        bytes: "00f0000000600000",
        kind: "pointer",
      }),
    ]);
  });

  it("preserves guard ranges for target mapping", () => {
    const result = materializeNativeStackWindowWrites(plan());

    expect(result.state === "materialized" ? result.guards : []).toEqual([
      { targetStart: "0x50000000e000", sizeBytes: 4096, placement: "below" },
      { targetStart: "0x500000010000", sizeBytes: 4096, placement: "above" },
    ]);
  });

  it("refuses to materialize refused stack-window plans", () => {
    const refused = plan();
    refused.state = "refused";
    refused.refusals = [{ code: "target-stack-window-unsupported", message: "bad stack" }];

    expect(materializeNativeStackWindowWrites(refused)).toEqual({
      state: "refused",
      stackMapping: "mapping:stack",
      refusals: [{ code: "target-stack-window-unsupported", message: "bad stack" }],
    });
  });
});
