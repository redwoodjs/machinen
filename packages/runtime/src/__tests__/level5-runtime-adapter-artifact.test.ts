import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { level5SubstrateRefusalCodes } from "../level5-runtime-adapter.ts";

describe("Goal 020 Level 5 runtime adapter substrate artifact", () => {
  it("keeps the substrate proof-only and records the adapter/refusal contract", () => {
    const artifact = JSON.parse(
      readFileSync(
        "research/snapshot/checked-summaries/node-level5/goal-020-level5-runtime-adapter-substrate.json",
        "utf8",
      ),
    );
    expect(artifact).toMatchObject({
      kind: "machinen.level5-runtime-adapter-substrate-summary",
      goal: "020",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "level-5-cross-arch-process-continuation-substrate",
      graduationTargetLevel: "level-5-cross-arch-process-continuation",
      migrationCompleted: false,
      shortcutGates: {
        sourceIsaEmulationAllowed: false,
        sidecarOutputAllowed: false,
        metadataOnlySuccessAllowed: false,
        rawVmstateReplayAcceptedAsLevel5: false,
      },
    });
    expect(artifact.adapterContract).toEqual([
      "detect",
      "quiesce",
      "capture",
      "validate",
      "planRestore",
      "restoreTargetNative",
      "verify",
      "refuse",
    ]);
    expect(artifact.registeredAdapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "node-level5-proof-runtime-adapter",
          runtimeFamily: "node",
          productSupport: "not-yet-supported",
          migrationCompleted: false,
        }),
      ]),
    );
    expect(artifact.stableRefusalCodes).toEqual(level5SubstrateRefusalCodes);
  });
});
