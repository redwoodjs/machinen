import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  NODE_LEVEL5_HTTP_PROFILE_NAME,
  buildLevel5RefusalEnvelope,
  buildNodeLevel5HttpProfileCapture,
  buildNodeLevel5ProofComposition,
  createLevel5RuntimeAdapterRegistry,
  runNodeLevel5TargetSideProof,
} from "@machinen/runtime";
import type {
  Level5AdapterDetectInput,
  Level5RefusalEnvelope,
  Level5RestorePlan,
  Level5RuntimeAdapter,
  Level5RuntimeAdapterMatch,
  Level5VerifierEvidence,
  NodeLevel5HttpProfileCapture,
  NodeLevel5ProofComposition,
  NodeLevel5TargetProofEvidence,
} from "@machinen/runtime";

import type { PortableNodeSnapshotCapture } from "./clean-service/node-adapter.ts";

const NODE_LEVEL5_PROOF_COMPOSITION_FILE = "node-level5-proof-composition.json";
const NODE_LEVEL5_HTTP_PROFILE_FILE = "node-level5-runtime-profile.json";
const NODE_LEVEL5_PROOF_RESTORE_SUMMARY_FILE = "node-level5-proof-restore-summary.json";
const NODE_LEVEL5_HTTP_PROFILE_RESTORE_SUMMARY_FILE =
  "node-level5-runtime-profile-restore-summary.json";
const NODE_LEVEL5_TARGET_PROOF_FILE = "node-level5-target-proof.json";

interface NodeLevel5ProofSnapshotContext {
  snapDir: string;
  portableNode: PortableNodeSnapshotCapture;
}

interface NodeLevel5ProofRestoreContext {
  snapDir: string;
  verifyProofOnly?: boolean;
  allowProofOnlySuccess?: boolean;
}

interface NodeLevel5ProofRestorePlan extends Level5RestorePlan {
  adapterId: "node-level5-proof-runtime-adapter";
  runtimeFamily: "node";
  profile: "node-http-clean-root-v1-with-level4-event-loop-map";
  proofPath: string;
  summaryPath: string;
  targetProofPath: string;
  proof: NodeLevel5ProofComposition;
  verifyProofOnlyRequested: boolean;
  allowProofOnlySuccess: boolean;
}

interface NodeLevel5ProofRestoreResult {
  plan: NodeLevel5ProofRestorePlan;
  targetProof: NodeLevel5TargetProofEvidence;
}

interface NodeLevel5ProofRestoreSummary {
  kind: "machinen.node-level5-proof-restore-summary";
  sourceKind: NodeLevel5ProofComposition["kind"];
  evidenceStatus: NodeLevel5ProofComposition["evidenceStatus"];
  productSupport: NodeLevel5ProofComposition["productSupport"];
  implementationLevel: NodeLevel5ProofComposition["implementationLevel"];
  graduationTargetLevel: NodeLevel5ProofComposition["graduationTargetLevel"];
  migrationCompleted: false;
  restoreRoutedThroughPublicVerb: true;
  level5AdapterId: "node-level5-proof-runtime-adapter";
  level5AdapterRegistryRouted: true;
  targetProofVerifierRanByDefault: true;
  targetProofVerifierRequestedByFlag: boolean;
  refusal: {
    code: "node-level5-proof-only-not-product";
    message: string;
  };
  gates: NodeLevel5ProofComposition["gates"];
  summary: NodeLevel5ProofComposition["summary"];
  targetProof: NodeLevel5TargetProofEvidence;
}

interface NodeLevel5HttpProfileRestorePlan extends Level5RestorePlan {
  adapterId: "node-level5-http-runtime-adapter";
  runtimeFamily: "node";
  profile: typeof NODE_LEVEL5_HTTP_PROFILE_NAME;
  profilePath: string;
  summaryPath: string;
  targetProofPath: string;
  profileArtifact: NodeLevel5HttpProfileCapture;
  verifyProofOnlyRequested: boolean;
  allowProofOnlySuccess: boolean;
}

interface NodeLevel5HttpProfileRestoreResult {
  plan: NodeLevel5HttpProfileRestorePlan;
  targetProof: NodeLevel5TargetProofEvidence;
}

interface NodeLevel5HttpProfileRestoreSummary {
  kind: "machinen.node-level5-runtime-profile-restore-summary";
  sourceKind: NodeLevel5HttpProfileCapture["kind"];
  evidenceStatus: NodeLevel5HttpProfileCapture["evidenceStatus"];
  productSupport: NodeLevel5HttpProfileCapture["productSupport"];
  implementationLevel: NodeLevel5HttpProfileCapture["implementationLevel"];
  graduationTargetLevel: NodeLevel5HttpProfileCapture["graduationTargetLevel"];
  migrationCompleted: false;
  restoreRoutedThroughPublicVerb: true;
  level5AdapterId: "node-level5-http-runtime-adapter";
  level5AdapterRegistryRouted: true;
  targetProofVerifierRanByDefault: true;
  targetProofVerifierRequestedByFlag: boolean;
  refusal: {
    code: "node-level5-http-profile-proof-only-not-product";
    message: string;
  };
  gates: NodeLevel5HttpProfileCapture["gates"];
  summary: NodeLevel5HttpProfileCapture["summary"];
  targetProof: NodeLevel5TargetProofEvidence;
  refusals: NodeLevel5HttpProfileCapture["refusals"];
}

interface NodeLevel5RuntimeRestoreAdapterResult {
  summary: NodeLevel5ProofRestoreSummary | NodeLevel5HttpProfileRestoreSummary;
  exitCode: 0 | 1;
}

const nodeLevel5HttpRuntimeAdapter: Level5RuntimeAdapter<
  NodeLevel5ProofSnapshotContext,
  NodeLevel5HttpProfileCapture,
  NodeLevel5ProofRestoreContext,
  NodeLevel5HttpProfileRestorePlan,
  NodeLevel5HttpProfileRestoreResult,
  Level5VerifierEvidence
> = {
  id: "node-level5-http-runtime-adapter",
  runtimeFamily: "node",
  supportedProfiles: [NODE_LEVEL5_HTTP_PROFILE_NAME],
  graduationTargetLevel: "level-5-cross-arch-process-continuation",
  // fallow-ignore-next-line complexity
  detect(input: Level5AdapterDetectInput) {
    const hasProfileFile =
      (input.bundleFiles ?? []).includes(NODE_LEVEL5_HTTP_PROFILE_FILE) ||
      (input.snapDir !== undefined &&
        existsSync(join(input.snapDir, NODE_LEVEL5_HTTP_PROFILE_FILE)));
    return {
      matched:
        hasProfileFile ||
        input.profile === NODE_LEVEL5_HTTP_PROFILE_NAME ||
        input.artifactKind === "machinen.node-level5-runtime-profile",
      adapterId: "node-level5-http-runtime-adapter",
      runtimeFamily: "node",
      profile: NODE_LEVEL5_HTTP_PROFILE_NAME,
      reason: hasProfileFile
        ? "node-level5-runtime-profile bundle detected"
        : "Node/V8/libuv single-thread HTTP profile requested",
    };
  },
  quiesce(_input) {
    return { state: "quiesced", refusals: [] };
  },
  capture(input) {
    return buildNodeLevel5HttpProfileCapture({
      sourceArch: input.portableNode.sourceArch,
      nodeVersion: input.portableNode.nodeVersion,
      sourceCwd: input.portableNode.sourceCwd,
      argv: input.portableNode.argv,
      guestPort: input.portableNode.guestPort,
      verifier: input.portableNode.verifier,
      eventLoopResources: input.portableNode.eventLoopResources,
      kernelResources: input.portableNode.kernelResources,
    });
  },
  validate(input) {
    const profile = isNodeLevel5ProofRestoreContext(input)
      ? readNodeLevel5HttpProfile(input.snapDir)
      : input;
    const productProfile = profile as { productSupport?: string; migrationCompleted?: boolean };
    if (
      productProfile.productSupport !== "not-yet-supported" ||
      productProfile.migrationCompleted === true
    ) {
      return {
        state: "refused",
        refusals: [
          this.refuse({
            code: "level5-metadata-only-success-forbidden",
            message:
              "Node HTTP Level 5 profile remains proof-only until workload continuation graduates",
            profile: NODE_LEVEL5_HTTP_PROFILE_NAME,
          }),
        ],
      };
    }
    return { state: "passed", refusals: [] };
  },
  planRestore(input) {
    const profilePath = join(input.snapDir, NODE_LEVEL5_HTTP_PROFILE_FILE);
    const profileArtifact = readNodeLevel5HttpProfile(input.snapDir);
    return {
      kind: "machinen.level5-restore-plan",
      formatVersion: 1,
      adapterId: "node-level5-http-runtime-adapter",
      runtimeFamily: "node",
      profile: NODE_LEVEL5_HTTP_PROFILE_NAME,
      evidenceStatus: "proof",
      productSupport: profileArtifact.productSupport,
      implementationLevel: profileArtifact.implementationLevel,
      graduationTargetLevel: profileArtifact.graduationTargetLevel,
      migrationCompleted: false,
      planState: "planned",
      sourceArch: profileArtifact.sourceArch,
      targetArch: undefined,
      steps: [
        "read node-level5-runtime-profile.json",
        "verify Node/V8/libuv single-thread HTTP profile gates",
        "recreate Level 4 HTTP listener resources through target-native Node profile plan",
        "run target-side Node verifier",
        "return proof-only refusal until actual workload continuation graduates",
      ],
      refusals: [],
      profilePath,
      summaryPath: join(input.snapDir, NODE_LEVEL5_HTTP_PROFILE_RESTORE_SUMMARY_FILE),
      targetProofPath: join(input.snapDir, NODE_LEVEL5_TARGET_PROOF_FILE),
      profileArtifact,
      verifyProofOnlyRequested: input.verifyProofOnly === true,
      allowProofOnlySuccess: input.allowProofOnlySuccess === true,
    };
  },
  async restoreTargetNative(plan) {
    const targetProof = await runNodeLevel5RestoreProofOnlyVerifier(plan.targetProofPath);
    return { plan, targetProof };
  },
  verify(result) {
    return nodeLevel5VerifierEvidence(result.targetProof);
  },
  refuse(input): Level5RefusalEnvelope {
    return buildLevel5RefusalEnvelope({
      ...input,
      adapterId: "node-level5-http-runtime-adapter",
      runtimeFamily: "node",
      profile: input.profile ?? NODE_LEVEL5_HTTP_PROFILE_NAME,
    });
  },
};

const nodeLevel5ProofRuntimeAdapter: Level5RuntimeAdapter<
  NodeLevel5ProofSnapshotContext,
  NodeLevel5ProofComposition,
  NodeLevel5ProofRestoreContext,
  NodeLevel5ProofRestorePlan,
  NodeLevel5ProofRestoreResult,
  Level5VerifierEvidence
> = {
  id: "node-level5-proof-runtime-adapter",
  runtimeFamily: "node",
  supportedProfiles: ["node-http-clean-root-v1-with-level4-event-loop-map"],
  graduationTargetLevel: "level-5-cross-arch-process-continuation",
  // fallow-ignore-next-line complexity
  detect(input: Level5AdapterDetectInput) {
    const bundleFiles = new Set(input.bundleFiles ?? []);
    const hasProofFile =
      bundleFiles.has(NODE_LEVEL5_PROOF_COMPOSITION_FILE) ||
      (input.snapDir !== undefined &&
        existsSync(join(input.snapDir, NODE_LEVEL5_PROOF_COMPOSITION_FILE)));
    return {
      matched:
        hasProofFile ||
        input.profile === "node-http-clean-root-v1-with-level4-event-loop-map" ||
        input.artifactKind === "machinen.node-level5-proof-composition",
      adapterId: "node-level5-proof-runtime-adapter",
      runtimeFamily: "node",
      profile: "node-http-clean-root-v1-with-level4-event-loop-map",
      reason: hasProofFile
        ? "node-level5-proof-composition bundle detected"
        : "node Level 5 proof profile requested",
    };
  },
  quiesce(_input) {
    return { state: "quiesced", refusals: [] };
  },
  capture(input) {
    return buildNodeLevel5ProofComposition({
      eventLoopResourceMapPresent: input.portableNode.eventLoopResources !== undefined,
      targetNativeVerifierPresent: false,
      checkedSummaries: {
        "level4-event-loop-resource-map":
          "docs/snapshot/checked-summaries/level4-graduation/goal-008-node-event-loop-resource-map.json",
        "target-native-verifier":
          "docs/snapshot/checked-summaries/level4-graduation/goal-009-proof-run.json",
      },
    });
  },
  validate(input) {
    const proof = isNodeLevel5ProofRestoreContext(input)
      ? readNodeLevel5Proof(input.snapDir)
      : input;
    const productProof = proof as NodeLevel5ProofComposition & { migrationCompleted?: boolean };
    if (
      productProof.productSupport !== "not-yet-supported" ||
      productProof.migrationCompleted === true
    ) {
      return {
        state: "refused",
        refusals: [
          this.refuse({
            code: "level5-metadata-only-success-forbidden",
            message:
              "Node Level 5 proof bundles must remain proof-only until product support graduates",
          }),
        ],
      };
    }
    return { state: "passed", refusals: [] };
  },
  planRestore(input) {
    const proofPath = join(input.snapDir, NODE_LEVEL5_PROOF_COMPOSITION_FILE);
    const proof = readNodeLevel5Proof(input.snapDir);
    return {
      kind: "machinen.level5-restore-plan",
      formatVersion: 1,
      adapterId: "node-level5-proof-runtime-adapter",
      runtimeFamily: "node",
      profile: "node-http-clean-root-v1-with-level4-event-loop-map",
      evidenceStatus: "proof",
      productSupport: proof.productSupport,
      implementationLevel: proof.implementationLevel,
      graduationTargetLevel: proof.graduationTargetLevel,
      migrationCompleted: false,
      planState: "planned",
      sourceArch: undefined,
      targetArch: undefined,
      steps: [
        "read node-level5-proof-composition.json",
        "run target-side Node proof verifier",
        "write node-level5-proof-restore-summary.json",
        "return proof-only refusal unless proof automation success is explicitly allowed",
      ],
      refusals: [],
      proofPath,
      summaryPath: join(input.snapDir, NODE_LEVEL5_PROOF_RESTORE_SUMMARY_FILE),
      targetProofPath: join(input.snapDir, NODE_LEVEL5_TARGET_PROOF_FILE),
      proof,
      verifyProofOnlyRequested: input.verifyProofOnly === true,
      allowProofOnlySuccess: input.allowProofOnlySuccess === true,
    };
  },
  async restoreTargetNative(plan) {
    const targetProof = await runNodeLevel5RestoreProofOnlyVerifier(plan.targetProofPath);
    return { plan, targetProof };
  },
  verify(result) {
    return nodeLevel5VerifierEvidence(result.targetProof);
  },
  refuse(input): Level5RefusalEnvelope {
    return buildLevel5RefusalEnvelope({
      ...input,
      adapterId: "node-level5-proof-runtime-adapter",
      runtimeFamily: "node",
      profile: input.profile ?? "node-http-clean-root-v1-with-level4-event-loop-map",
    });
  },
};

function nodeLevel5VerifierEvidence(
  targetProof: NodeLevel5TargetProofEvidence,
): Level5VerifierEvidence {
  return {
    kind: "machinen.level5-target-verifier-evidence",
    status: targetProof.status === "passed" ? "passed" : "failed",
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: false,
    targetNativeExecution: targetProof.targetVerifierObservedActualNodeContinuation,
    sourceIsaEmulationUsed: !targetProof.noSourceIsaEmulation,
    sidecarOutputUsed: !targetProof.noSidecarOutput,
    metadataOnlySuccess: !targetProof.noMetadataOnlySuccess,
    message: targetProof.message,
  };
}

const level5RuntimeAdapterRegistry = createLevel5RuntimeAdapterRegistry([
  nodeLevel5HttpRuntimeAdapter,
  nodeLevel5ProofRuntimeAdapter,
]);

export function detectLevel5RestoreAdapter(snapDir: string): Level5RuntimeAdapterMatch | undefined {
  return level5RuntimeAdapterRegistry.detect({ operation: "restore", snapDir });
}

export function writeNodeLevel5ProofCompositionSnapshot(
  snapDir: string,
  portableNode: PortableNodeSnapshotCapture,
): void {
  const proof = nodeLevel5ProofRuntimeAdapter.capture({ snapDir, portableNode });
  writeFileSync(
    join(snapDir, NODE_LEVEL5_PROOF_COMPOSITION_FILE),
    `${JSON.stringify(proof, null, 2)}\n`,
  );
}

export function writeNodeLevel5RuntimeProfileSnapshot(
  snapDir: string,
  portableNode: PortableNodeSnapshotCapture,
): void {
  const profile = nodeLevel5HttpRuntimeAdapter.capture({ snapDir, portableNode });
  writeFileSync(
    join(snapDir, NODE_LEVEL5_HTTP_PROFILE_FILE),
    `${JSON.stringify(profile, null, 2)}\n`,
  );
}

// fallow-ignore-next-line complexity
export async function restoreLevel5RuntimeBundle(
  snapDir: string,
  input: { verifyProofOnly?: boolean; allowProofOnlySuccess?: boolean },
): Promise<NodeLevel5RuntimeRestoreAdapterResult> {
  const match = detectLevel5RestoreAdapter(snapDir);
  if (!match) {
    const refusal = level5RuntimeAdapterRegistry.refuseUnsupported({
      message: "no Level 5 runtime adapter detected for restore bundle",
    });
    throw new Error(refusal.message);
  }
  if (match.adapter.id === "node-level5-http-runtime-adapter") {
    return await restoreNodeLevel5HttpProfileBundle(snapDir, input);
  }
  const context: NodeLevel5ProofRestoreContext = {
    snapDir,
    verifyProofOnly: input.verifyProofOnly,
    allowProofOnlySuccess: input.allowProofOnlySuccess,
  };
  const validation = await nodeLevel5ProofRuntimeAdapter.validate(context);
  if (validation.state === "refused") {
    const refusal =
      validation.refusals[0] ??
      nodeLevel5ProofRuntimeAdapter.refuse({
        code: "level5-runtime-profile-unsupported",
        message: "Level 5 runtime bundle refused",
      });
    throw new Error(refusal.message);
  }
  const plan = await nodeLevel5ProofRuntimeAdapter.planRestore(context);
  const result = await nodeLevel5ProofRuntimeAdapter.restoreTargetNative(plan);
  await nodeLevel5ProofRuntimeAdapter.verify(result);
  const summary = buildNodeLevel5ProofRestoreSummary(result);
  writeFileSync(plan.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return {
    summary,
    exitCode: plan.allowProofOnlySuccess && result.targetProof.status === "passed" ? 0 : 1,
  };
}

// fallow-ignore-next-line complexity
async function restoreNodeLevel5HttpProfileBundle(
  snapDir: string,
  input: { verifyProofOnly?: boolean; allowProofOnlySuccess?: boolean },
): Promise<NodeLevel5RuntimeRestoreAdapterResult> {
  const context: NodeLevel5ProofRestoreContext = {
    snapDir,
    verifyProofOnly: input.verifyProofOnly,
    allowProofOnlySuccess: input.allowProofOnlySuccess,
  };
  const validation = await nodeLevel5HttpRuntimeAdapter.validate(context);
  if (validation.state === "refused") {
    const refusal =
      validation.refusals[0] ??
      nodeLevel5HttpRuntimeAdapter.refuse({
        code: "level5-runtime-profile-unsupported",
        message: "Node HTTP Level 5 runtime profile refused",
      });
    throw new Error(refusal.message);
  }
  const plan = await nodeLevel5HttpRuntimeAdapter.planRestore(context);
  const result = await nodeLevel5HttpRuntimeAdapter.restoreTargetNative(plan);
  await nodeLevel5HttpRuntimeAdapter.verify(result);
  const summary = buildNodeLevel5HttpProfileRestoreSummary(result);
  writeFileSync(plan.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return {
    summary,
    exitCode: plan.allowProofOnlySuccess && result.targetProof.status === "passed" ? 0 : 1,
  };
}

function buildNodeLevel5HttpProfileRestoreSummary(
  result: NodeLevel5HttpProfileRestoreResult,
): NodeLevel5HttpProfileRestoreSummary {
  const profile = result.plan.profileArtifact;
  return {
    kind: "machinen.node-level5-runtime-profile-restore-summary",
    sourceKind: profile.kind,
    evidenceStatus: profile.evidenceStatus,
    productSupport: profile.productSupport,
    implementationLevel: profile.implementationLevel,
    graduationTargetLevel: profile.graduationTargetLevel,
    migrationCompleted: false,
    restoreRoutedThroughPublicVerb: true,
    level5AdapterId: "node-level5-http-runtime-adapter",
    level5AdapterRegistryRouted: true,
    targetProofVerifierRanByDefault: true,
    targetProofVerifierRequestedByFlag: result.plan.verifyProofOnlyRequested,
    refusal: {
      code: "node-level5-http-profile-proof-only-not-product",
      message:
        "Node Level 5 HTTP runtime profile is routed through machinen restore, but it is not product restore support yet",
    },
    gates: profile.gates,
    summary: profile.summary,
    targetProof: result.targetProof,
    refusals: profile.refusals,
  };
}

function buildNodeLevel5ProofRestoreSummary(
  result: NodeLevel5ProofRestoreResult,
): NodeLevel5ProofRestoreSummary {
  const proof = result.plan.proof;
  return {
    kind: "machinen.node-level5-proof-restore-summary",
    sourceKind: proof.kind,
    evidenceStatus: proof.evidenceStatus,
    productSupport: proof.productSupport,
    implementationLevel: proof.implementationLevel,
    graduationTargetLevel: proof.graduationTargetLevel,
    migrationCompleted: false,
    restoreRoutedThroughPublicVerb: true,
    level5AdapterId: "node-level5-proof-runtime-adapter",
    level5AdapterRegistryRouted: true,
    targetProofVerifierRanByDefault: true,
    targetProofVerifierRequestedByFlag: result.plan.verifyProofOnlyRequested,
    refusal: {
      code: "node-level5-proof-only-not-product",
      message:
        "Node Level 5 proof composition is routed through machinen restore, but it is not product restore support yet",
    },
    gates: proof.gates,
    summary: proof.summary,
    targetProof: result.targetProof,
  };
}

function readNodeLevel5HttpProfile(snapDir: string): NodeLevel5HttpProfileCapture {
  return JSON.parse(
    readFileSync(join(snapDir, NODE_LEVEL5_HTTP_PROFILE_FILE), "utf8"),
  ) as NodeLevel5HttpProfileCapture;
}

function readNodeLevel5Proof(snapDir: string): NodeLevel5ProofComposition {
  return JSON.parse(
    readFileSync(join(snapDir, NODE_LEVEL5_PROOF_COMPOSITION_FILE), "utf8"),
  ) as NodeLevel5ProofComposition;
}

async function runNodeLevel5RestoreProofOnlyVerifier(
  proofPath: string,
): Promise<NodeLevel5TargetProofEvidence> {
  const proof = await runNodeLevel5TargetSideProof({ outPath: proofPath });
  return {
    path: proofPath,
    status: "passed",
    kind: proof.kind,
    noSourceIsaEmulation: proof.assertions.sourceIsaEmulationUsed === false,
    noSidecarOutput: proof.assertions.sidecarOutputUsed === false,
    noMetadataOnlySuccess: proof.assertions.metadataOnlySuccess === false,
    targetVerifierObservedActualNodeContinuation:
      proof.assertions.targetVerifierObservedActualNodeContinuation === true,
    message: "restore proof-only verifier observed actual target-native Node continuation",
  };
}

function isNodeLevel5ProofRestoreContext(input: unknown): input is NodeLevel5ProofRestoreContext {
  return typeof (input as NodeLevel5ProofRestoreContext).snapDir === "string";
}
