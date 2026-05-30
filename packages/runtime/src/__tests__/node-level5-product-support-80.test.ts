import { describe, expect, it } from "vitest";

import {
  assertNodeLevel5ProductSupport80MatrixComplete,
  nodeLevel5ProductSupport80Matrix,
} from "../node-level5-product-support-80.ts";

describe("Node Level 5 product support 80% matrix", () => {
  it("claims 80% Node support and 20% partial broad Node support", () => {
    expect(assertNodeLevel5ProductSupport80MatrixComplete()).toBe(true);
    expect(nodeLevel5ProductSupport80Matrix).toMatchObject({
      nodeProductSupportClaimed: 80,
      nodeProductSupportScope: "seventeen-service-app-and-boundary-families",
      previousNodeProductSupportClaimed: 65,
      newNodeProductSupportClaimed: 15,
      broadNodeProductSupportClaimed: 20,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });
  });

  it("requires real bidirectional VM evidence for every supported family", () => {
    expect(nodeLevel5ProductSupport80Matrix.families).toHaveLength(17);
    expect(
      nodeLevel5ProductSupport80Matrix.families.every(
        (family) =>
          family.realVmCrossArchEvidence.length === 2 &&
          family.realVmCrossArchEvidence.every(
            (evidence) => evidence.substrate === "machinen-real-vm-cross-arch",
          ),
      ),
    ).toBe(true);
  });
});
