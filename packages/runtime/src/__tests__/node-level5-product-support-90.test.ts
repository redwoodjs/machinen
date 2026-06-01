import { describe, expect, it } from "vitest";

import { nodeLevel5ProductSupport90ClaimRegistry } from "../node-level5-product-support-90.ts";

describe("Node Level 5 product support 90 claim", () => {
  it("claims 90 / 30 / 0 with framework claim-ready evidence", () => {
    expect(nodeLevel5ProductSupport90ClaimRegistry).toMatchObject({
      status: "node-product-support-90-claimed",
      nodeProductSupportTiers: [20, 50, 65, 80, 85, 90],
      nodeProductSupportClaimed: 90,
      broadNodeProductSupportClaimed: 30,
      arbitraryProcessCrossArchRestoreClaimed: 0,
      previousNodeProductSupportClaimed: 85,
      previousBroadNodeProductSupportClaimed: 25,
      frameworkCapabilityEvidenceRequired: true,
      frameworkIntrospectionCorpusRequired: true,
      frameworkProductEvidenceRequired: true,
      frameworkClaimReadyRequired: true,
      frameworkGraphArtifactCount: 18,
      restoredBehaviorProbeCount: 16,
      frameworkRefusalArtifactCount: 20,
      frameworkProductArtifactCount: 54,
      supportedAppRows: 68,
      refusedAppRows: 42,
      notProvenAppRows: 4,
    });
  });
});
