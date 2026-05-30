import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  NODE_LEVEL5_HTTP_PROFILE_NAME,
  buildNodeLevel5HttpProfileCapture,
  nodeLevel5HttpProfileRefusalCodes,
  nodeLevel5HttpProfileRefusalRows,
} from "../node-level5-http-profile.ts";

describe("Node Level 5 single-thread HTTP profile", () => {
  it("labels selected counter state as a reconstruction harness proof, not product support", () => {
    const profile = buildNodeLevel5HttpProfileCapture({
      sourceArch: "arm64",
      nodeVersion: "v22.0.0",
      sourceCwd: "/opt/app",
      argv: ["/usr/bin/node", "/opt/app/server.mjs"],
      guestPort: 3000,
      verifier: { kind: "http-get", path: "/", sha256: "abc", bytes: 12 },
      selectedState: {
        kind: "node-http-counter-selected-state-v1",
        route: "/",
        captureMethod: "http-root-json-next-count",
        observedNextCount: 3,
        restoredInitialCount: 2,
        expectedFirstTargetBody: '{"count":3}\n',
      },
      eventLoopResources: { summary: { mapped: 1, refused: 0 } },
      kernelResources: { summary: { supported: 1, refused: 0 } },
    });

    expect(profile).toMatchObject({
      kind: "machinen.node-level5-runtime-profile",
      sourceGoal: "022",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "not-implemented",
      graduationTargetLevel: "level-5-cross-arch-process-continuation",
      migrationCompleted: false,
      runtimeFamily: "node",
      profile: NODE_LEVEL5_HTTP_PROFILE_NAME,
      runtimeIdentity: { executable: "node", targetNativeRuntimeRequired: true },
      processModel: {
        processCount: 1,
        threadModel: "single-thread-required",
        activeSyscallsAllowed: false,
        activeRequestsAllowed: false,
        activeTcpStreamsAllowed: false,
      },
      moduleIdentity: {
        sourceCwd: "/opt/app",
        entrypoint: "/opt/app/server.mjs",
        unsupportedModuleStateAllowed: false,
      },
      selectedV8State: {
        stateModel: "bounded-profile-roots-only",
        arbitraryHeapContinuationAllowed: false,
        arbitraryNativeStackContinuationAllowed: false,
      },
      selectedState: {
        kind: "node-http-counter-selected-state-v1",
        observedNextCount: 3,
        restoredInitialCount: 2,
      },
      kernelResources: {
        httpListeners: [
          {
            protocol: "tcp",
            bindAddress: "127.0.0.1",
            port: 3000,
            level4Profile: "tcp-listener-v1-loopback-empty-accept-queue",
          },
        ],
      },
      gates: {
        sourceIsaEmulationAllowed: false,
        sidecarOutputAllowed: false,
        metadataOnlySuccessAllowed: false,
        targetNativeNodeRequired: true,
      },
      summary: {
        productSupportBlockedUntilActualRuntimeStateContinuation: true,
        selectedStateReconstructionHarness: true,
        notProperLevel5Reason: "app-specific-selected-state-descriptor",
      },
    });
  });

  it("keeps broad Node profile captures unsupported without selected state", () => {
    const profile = buildNodeLevel5HttpProfileCapture({
      sourceArch: "arm64",
      nodeVersion: "v22.0.0",
      sourceCwd: "/opt/app",
      argv: ["/usr/bin/node", "/opt/app/server.mjs"],
      guestPort: 3000,
      verifier: { kind: "http-get", path: "/", sha256: "abc", bytes: 12 },
    });

    expect(profile).toMatchObject({
      sourceGoal: "021",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "not-implemented",
      migrationCompleted: false,
      summary: {
        productSupportBlockedUntilActualRuntimeStateContinuation: true,
        selectedStateReconstructionHarness: false,
        notProperLevel5Reason: "no-selected-state",
      },
    });
    expect(profile.selectedState).toBeUndefined();
  });

  it("records the Goal 022 quickstart fixture as selected-state harness evidence", () => {
    const artifact = JSON.parse(
      readFileSync(
        "docs/snapshot/checked-summaries/level4-graduation/goal-022-real-cross-arch-quickstart-fixture.json",
        "utf8",
      ),
    );
    expect(artifact).toMatchObject({
      goal: "022",
      profile: NODE_LEVEL5_HTTP_PROFILE_NAME,
      sourceArchitecture: "amd64",
      targetArchitecture: "arm64",
      evidenceStatus: "proof",
      implementationLevel: "not-implemented",
      migrationCompleted: false,
      sourceObservation: {
        beforeSnapshotRequests: [{ response: { count: 1 } }, { response: { count: 2 } }],
        snapshotCaptureState: {
          observedNextCount: 3,
          restoredInitialCount: 2,
        },
      },
      targetContinuation: {
        sourceArchitecture: "amd64",
        targetArchitecture: "arm64",
        targetRuntime: "node",
        targetNativeExecution: true,
        servedContinuedBehavior: true,
        firstUserRequestAfterRestore: { response: { count: 3 } },
      },
      shortcutGates: {
        sourceIsaEmulationUsed: false,
        sidecarOutputUsed: false,
        metadataOnlySuccess: false,
      },
    });
  });

  it("keeps every unsafe neighbor as a stable refusal family", () => {
    const rows = nodeLevel5HttpProfileRefusalRows();
    expect(rows.map((row) => row.code)).toEqual(nodeLevel5HttpProfileRefusalCodes);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ unsafeNeighbor: "arbitrary-v8-heap-native-stack" }),
        expect.objectContaining({ unsafeNeighbor: "native-addon" }),
        expect.objectContaining({ unsafeNeighbor: "worker-thread" }),
        expect.objectContaining({ unsafeNeighbor: "inspector-debug" }),
        expect.objectContaining({ unsafeNeighbor: "active-request" }),
        expect.objectContaining({ unsafeNeighbor: "active-tcp-stream" }),
        expect.objectContaining({ unsafeNeighbor: "active-syscall" }),
        expect.objectContaining({ unsafeNeighbor: "unsupported-timer-async-handle" }),
        expect.objectContaining({ unsafeNeighbor: "unsupported-module-runtime-state" }),
        expect.objectContaining({ unsafeNeighbor: "missing-target-native-node" }),
        expect.objectContaining({ unsafeNeighbor: "source-isa-emulation" }),
        expect.objectContaining({ unsafeNeighbor: "sidecar-output" }),
        expect.objectContaining({ unsafeNeighbor: "metadata-only-success" }),
      ]),
    );
    expect(
      rows.every((row) => row.productSupport === "unsupported" && row.migrationCompleted === false),
    ).toBe(true);
  });
});
