import { describe, expect, it } from "vitest";

import { buildNodeLevel5FrameworkCapabilityMatrix } from "../node-level5-framework-capability-matrix.ts";

describe("Node Level 5 framework capability matrix", () => {
  it("defines a claimed framework-capability path without arbitrary claims", () => {
    const matrix = buildNodeLevel5FrameworkCapabilityMatrix();

    expect(matrix).toMatchObject({
      accepted: true,
      rowCount: 24,
      currentNodeProductSupportClaimed: 100,
      currentBroadNodeProductSupportClaimed: 100,
      currentArbitraryProcessCrossArchRestoreClaimed: 0,
      candidateNodeProductSupportClaimed: 90,
      candidateBroadNodeProductSupportClaimed: 30,
      candidateArbitraryProcessCrossArchRestoreClaimed: 0,
      claimChangeAllowed: true,
      arbitraryExpressClaimed: false,
      arbitraryFastifyClaimed: false,
      arbitraryNodeClaimed: false,
    });
    expect(matrix.rows.every((row) => row.arbitraryFrameworkClaimed === false)).toBe(true);
    expect(matrix.rows.every((row) => row.arbitraryNodeClaimed === false)).toBe(true);
    expect(matrix.rows.every((row) => row.arbitraryProcessCrossArchRestoreClaimed === 0)).toBe(
      true,
    );
  });

  it("keeps arbitrary framework apps not proven", () => {
    const rows = buildNodeLevel5FrameworkCapabilityMatrix().rows.filter(
      (row) => row.capability === "arbitrary-framework-app",
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "not-proven")).toBe(true);
    expect(rows.every((row) => row.claimScope === "not-claimed")).toBe(true);
  });
});
