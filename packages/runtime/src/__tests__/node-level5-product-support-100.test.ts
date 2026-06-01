import { describe, expect, it } from "vitest";

import { nodeLevel5ProductSupport100ClaimRegistry } from "../node-level5-product-support-100.ts";

describe("Node Level 5 product support 100 claim", () => {
  it("claims 100 / 100 / 0 for selected Node services without arbitrary process support", () => {
    expect(nodeLevel5ProductSupport100ClaimRegistry).toMatchObject({
      status: "node-product-support-100-claimed",
      nodeProductSupportClaimed: 100,
      broadNodeProductSupportClaimed: 100,
      arbitraryProcessCrossArchRestoreClaimed: 0,
      previousNodeProductSupportClaimed: 90,
      previousBroadNodeProductSupportClaimed: 30,
      nodeServiceClaimLadderRequired: true,
      finalNodeServiceGaGateRequired: true,
      arbitraryNodeClaimed: false,
      arbitraryProcessClaimed: false,
    });
  });
});
