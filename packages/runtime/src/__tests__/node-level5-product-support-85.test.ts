import { describe, expect, it } from "vitest";

import { nodeLevel5ProductSupport85ClaimRegistry } from "../node-level5-product-support-85.ts";

describe("Node Level 5 product support 85 claim", () => {
  it("claims 85% Node support, 25% broad Node support, and 0% arbitrary process restore", () => {
    expect(nodeLevel5ProductSupport85ClaimRegistry).toMatchObject({
      status: "node-product-support-85-claimed",
      nodeProductSupportTiers: [20, 50, 65, 80, 85],
      nodeProductSupportClaimed: 85,
      broadNodeProductSupportClaimed: 25,
      arbitraryProcessCrossArchRestoreClaimed: 0,
      previousNodeProductSupportClaimed: 80,
      previousBroadNodeProductSupportClaimed: 20,
      genericVmDetectedEvidenceRequired: true,
      retainedEvidenceRequired: true,
      rowArtifactEvidenceRequired: true,
      refusalArtifactEvidenceRequired: true,
      supportedAppRows: 72,
      refusedAppRows: 42,
      notProvenAppRows: 0,
    });
  });
});
