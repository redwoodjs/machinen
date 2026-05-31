import { describe, expect, it } from "vitest";

import {
  assertNodeLevel5ProductSupport50MatrixComplete,
  nodeLevel5ProductSupport50Matrix,
} from "../node-level5-product-support-50.ts";

describe("Node Level 5 product support 50% matrix", () => {
  it("claims 50% Node product support without claiming broad Node support", () => {
    expect(assertNodeLevel5ProductSupport50MatrixComplete()).toBe(true);
    expect(nodeLevel5ProductSupport50Matrix).toMatchObject({
      nodeProductSupportClaimed: 50,
      nodeProductSupportScope: "eleven-service-families",
      previousNodeProductSupportClaimed: 20,
      newNodeProductSupportClaimed: 30,
      broadNodeProductSupportClaimed: 0,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });
  });

  it("keeps the coverage math explicit", () => {
    expect(nodeLevel5ProductSupport50Matrix.families).toHaveLength(11);
    expect(
      nodeLevel5ProductSupport50Matrix.families.reduce(
        (sum, family) => sum + family.coveragePercent,
        0,
      ),
    ).toBe(50);
  });
});
