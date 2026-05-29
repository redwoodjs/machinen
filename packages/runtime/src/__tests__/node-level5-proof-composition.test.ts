import { describe, expect, it } from "vitest";

import {
  buildNodeLevel5ProofComposition,
  nodeLevel5ProofIngredientNames,
  nodeLevel5ProofRefusalCodes,
} from "../node-level5-proof-composition.ts";

describe("Node Level 5 proof composition", () => {
  it("composes checked native/process ingredients with the Goal 008 Level 4 resource map", () => {
    const composition = buildNodeLevel5ProofComposition({
      eventLoopResourceMapPresent: true,
      targetNativeVerifierPresent: true,
    });

    expect(composition).toMatchObject({
      kind: "machinen.node-level5-proof-composition",
      sourceGoal: "009",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "not-implemented",
      graduationTargetLevel: "level-5-cross-arch-process-continuation",
      selectedSubset: "node-http-clean-root-v1-with-level4-event-loop-map",
      summary: {
        required: nodeLevel5ProofIngredientNames.length,
        present: nodeLevel5ProofIngredientNames.length,
        missing: 0,
        refusalCount: nodeLevel5ProofRefusalCodes.length,
        proofReady: true,
      },
    });
    expect(composition.requiredIngredients.map((ingredient) => ingredient.name)).toEqual([
      "register-translation",
      "stack-return-chain-translation",
      "private-memory-materialization",
      "executable-target-module-materialization",
      "target-restore-loader",
      "level4-event-loop-resource-map",
      "target-native-verifier",
    ]);
    expect(composition.gates).toMatchObject({
      arbitraryV8HeapContinuationAllowed: false,
      arbitraryNativeStackContinuationAllowed: false,
      sourceIsaEmulationAllowed: false,
      sidecarRuntimeAllowed: false,
      metadataOnlyContinuationAllowed: false,
    });
  });

  it("keeps the selected Level 5 path blocked until the Level 4 map and verifier are present", () => {
    const composition = buildNodeLevel5ProofComposition({
      eventLoopResourceMapPresent: false,
      targetNativeVerifierPresent: false,
    });

    expect(composition.summary).toMatchObject({ missing: 2, proofReady: false });
    expect(
      composition.requiredIngredients.filter(
        (ingredient) => ingredient.evidenceStatus === "missing",
      ),
    ).toEqual([
      expect.objectContaining({ name: "level4-event-loop-resource-map" }),
      expect.objectContaining({ name: "target-native-verifier" }),
    ]);
  });

  it("records unsafe Level 5 neighbors as non-product refusals", () => {
    const composition = buildNodeLevel5ProofComposition({
      eventLoopResourceMapPresent: true,
      targetNativeVerifierPresent: true,
    });

    expect(composition.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "node-level5-arbitrary-heap-stack-continuation-refused",
          migrationCompleted: false,
          productSupport: "unsupported",
          implementationLevel: "level-0-fail-closed-discovery",
          evidenceStatus: "refusal",
        }),
        expect.objectContaining({
          code: "node-level5-active-syscall-unsupported",
          migrationCompleted: false,
        }),
      ]),
    );
  });
});
