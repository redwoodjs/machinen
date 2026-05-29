import { describe, expect, it } from "vitest";

import {
  buildLevel5RefusalEnvelope,
  buildLevel5RuntimeAdapterRegistrySummary,
  createLevel5RuntimeAdapterRegistry,
  level5SubstrateRefusalCodes,
} from "../level5-runtime-adapter.ts";
import type {
  Level5RuntimeAdapter,
  Level5RestorePlan,
  Level5VerifierEvidence,
} from "../level5-runtime-adapter.ts";

const adapter: Level5RuntimeAdapter<
  { runtimeFamily: string },
  { profile: string },
  { profile: string },
  Level5RestorePlan,
  { targetNativeExecution: true },
  Level5VerifierEvidence
> = {
  id: "test-node-level5-adapter",
  runtimeFamily: "node",
  supportedProfiles: ["node-v8-libuv-single-thread-http-v1"],
  graduationTargetLevel: "level-5-cross-arch-process-continuation",
  detect(input) {
    return {
      matched:
        input.runtimeFamily === "node" || input.profile === "node-v8-libuv-single-thread-http-v1",
      adapterId: "test-node-level5-adapter",
      runtimeFamily: "node",
      profile: "node-v8-libuv-single-thread-http-v1",
      reason: "test adapter matched Node profile",
    };
  },
  quiesce() {
    return { state: "quiesced", refusals: [] };
  },
  capture() {
    return { profile: "node-v8-libuv-single-thread-http-v1" };
  },
  validate() {
    return { state: "passed", refusals: [] };
  },
  planRestore() {
    return {
      kind: "machinen.level5-restore-plan",
      formatVersion: 1,
      adapterId: "test-node-level5-adapter",
      runtimeFamily: "node",
      profile: "node-v8-libuv-single-thread-http-v1",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "not-implemented",
      graduationTargetLevel: "level-5-cross-arch-process-continuation",
      migrationCompleted: false,
      planState: "planned",
      steps: ["launch target-native runtime"],
      refusals: [],
    };
  },
  restoreTargetNative() {
    return { targetNativeExecution: true };
  },
  verify() {
    return {
      kind: "machinen.level5-target-verifier-evidence",
      status: "passed",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "not-implemented",
      graduationTargetLevel: "level-5-cross-arch-process-continuation",
      migrationCompleted: false,
      targetNativeExecution: true,
      sourceIsaEmulationUsed: false,
      sidecarOutputUsed: false,
      metadataOnlySuccess: false,
      message: "target-native continuation verified",
    };
  },
  refuse(input) {
    return buildLevel5RefusalEnvelope({ ...input, adapterId: "test-node-level5-adapter" });
  },
};

describe("Level 5 runtime adapter substrate", () => {
  it("selects adapters through a generic registry", () => {
    const registry = createLevel5RuntimeAdapterRegistry([adapter]);
    const match = registry.detect({ operation: "restore", runtimeFamily: "node" });
    expect(match?.adapter.id).toBe("test-node-level5-adapter");
    expect(match?.detection).toMatchObject({
      matched: true,
      runtimeFamily: "node",
      profile: "node-v8-libuv-single-thread-http-v1",
    });
    expect(registry.detect({ operation: "restore", runtimeFamily: "python" })).toBeUndefined();
  });

  it("builds stable fail-closed refusals with product support separated from proof status", () => {
    const refusal = buildLevel5RefusalEnvelope({
      code: "level5-active-tcp-stream-unsupported",
      message: "active TCP streams are refused",
      runtimeFamily: "node",
      profile: "node-v8-libuv-single-thread-http-v1",
    });
    expect(refusal).toMatchObject({
      kind: "machinen.level5-refusal",
      evidenceStatus: "refusal",
      productSupport: "unsupported",
      implementationLevel: "level-0-fail-closed-discovery",
      graduationTargetLevel: "level-5-cross-arch-process-continuation",
      migrationCompleted: false,
      stable: true,
    });
  });

  it("summarizes the substrate without claiming product support", () => {
    const summary = buildLevel5RuntimeAdapterRegistrySummary([adapter]);
    expect(summary).toMatchObject({
      kind: "machinen.level5-runtime-adapter-registry-summary",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "level-5-cross-arch-process-continuation-substrate",
      migrationCompleted: false,
      adapterCount: 1,
    });
    expect(summary.stableRefusalCodes).toEqual(level5SubstrateRefusalCodes);
    expect(summary.stableRefusalCodes).toEqual(
      expect.arrayContaining([
        "level5-runtime-family-unsupported",
        "level5-target-native-runtime-missing",
        "level5-source-isa-emulation-forbidden",
        "level5-sidecar-output-forbidden",
        "level5-metadata-only-success-forbidden",
        "level5-active-syscall-unsupported",
        "level5-active-tcp-stream-unsupported",
        "level5-thread-state-unsupported",
        "level5-kernel-resource-unsupported",
        "level5-runtime-heap-stack-unsupported",
      ]),
    );
  });
});
