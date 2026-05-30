import { describe, expect, it } from "vitest";

import {
  assertNodeLevel5ProductSupport20MatrixComplete,
  nodeLevel5ProductSupport20Matrix,
} from "../node-level5-product-support-20.ts";

describe("Node Level 5 product support 20% matrix", () => {
  it("claims 20% Node product support without claiming broad Node support", () => {
    expect(assertNodeLevel5ProductSupport20MatrixComplete()).toBe(true);
    expect(nodeLevel5ProductSupport20Matrix).toMatchObject({
      nodeProductSupportClaimed: 20,
      nodeProductSupportScope: "five-idle-service-families",
      declaredSubsetExperimentalProductSupportClaimed: 100,
      broadNodeProductSupportClaimed: 0,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    });
  });

  it("assigns four percent to each supported family", () => {
    expect(nodeLevel5ProductSupport20Matrix.families).toHaveLength(5);
    expect(
      nodeLevel5ProductSupport20Matrix.families.map((family) => family.coveragePercent),
    ).toEqual([4, 4, 4, 4, 4]);
  });
});
