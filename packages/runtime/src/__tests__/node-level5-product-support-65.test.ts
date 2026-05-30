import { describe, expect, it } from "vitest";

import {
  assertNodeLevel5ProductSupport65MatrixComplete,
  nodeLevel5ProductSupport65Matrix,
} from "../node-level5-product-support-65.ts";

describe("Node Level 5 product support 65% matrix", () => {
  it("claims 65% Node support and only 5% broad Node support", () => {
    expect(assertNodeLevel5ProductSupport65MatrixComplete()).toBe(true);
    expect(nodeLevel5ProductSupport65Matrix).toMatchObject({
      nodeProductSupportClaimed: 65,
      nodeProductSupportScope: "fourteen-service-and-boundary-families",
      previousNodeProductSupportClaimed: 50,
      newNodeProductSupportClaimed: 15,
      broadNodeProductSupportClaimed: 5,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });
  });

  it("keeps the hard-facility broad claim explicit and partial", () => {
    expect(nodeLevel5ProductSupport65Matrix.hardFacilitiesAddressed).toEqual([
      "active-async-idle-boundary",
      "tls-boundary-policy",
      "child-process-boundary",
    ]);
    expect(nodeLevel5ProductSupport65Matrix.safety.broadNodeSupportIsPartial).toBe(true);
  });
});
