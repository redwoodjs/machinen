import { describe, expect, it } from "vitest";

import {
  assertNodeLevel5ReadinessMatrixComplete,
  nodeLevel5ReadinessMatrix,
} from "../node-level5-readiness-matrix.ts";

describe("Node Level 5 readiness matrix", () => {
  it("closes the declared proof matrix without claiming broad product support", () => {
    expect(assertNodeLevel5ReadinessMatrixComplete()).toBe(true);
    expect(nodeLevel5ReadinessMatrix).toMatchObject({
      declaredSubsetCoverage: 100,
      narrowExperimentalProductReadiness: 100,
      broadNodeProofReadiness: 100,
      broadNodeProductSupportClaimed: 0,
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
    });
  });

  it("refuses unsupported neighbors before target start", () => {
    expect(nodeLevel5ReadinessMatrix.unsupportedNeighborGates.length).toBe(15);
    expect(
      nodeLevel5ReadinessMatrix.unsupportedNeighborGates.every(
        (gate) =>
          gate.status === "refused" &&
          gate.targetStarted === false &&
          gate.rawCpuRestoreUsed === false &&
          gate.sourceIsaEmulationUsed === false,
      ),
    ).toBe(true);
  });
});
