import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildLevel5RefusalEnvelope,
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
  NodeLevel5ProofComposition,
  NodeLevel5TargetProofEvidence,
} from "@machinen/runtime";

import type { PortableNodeSnapshotCapture } from "./clean-service/node-adapter.ts";

const NODE_LEVEL5_PROOF_COMPOSITION_FILE = "node-level5-proof-composition.json";
const NODE_LEVEL5_PROOF_RESTORE_SUMMARY_FILE = "node-level5-proof-restore-summary.json";
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

interface NodeLevel5ProofRestoreAdapterResult {
  summary: NodeLevel5ProofRestoreSummary;
  exitCode: 0 | 1;
}

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
    return {
      kind: "machinen.level5-target-verifier-evidence",
      status: result.targetProof.status === "passed" ? "passed" : "failed",
      evidenceStatus: "proof",
      productSupport: "not-yet-supported",
      implementationLevel: "not-implemented",
      graduationTargetLevel: "level-5-cross-arch-process-continuation",
      migrationCompleted: false,
      targetNativeExecution: result.targetProof.targetVerifierObservedActualNodeContinuation,
      sourceIsaEmulationUsed: !result.targetProof.noSourceIsaEmulation,
      sidecarOutputUsed: !result.targetProof.noSidecarOutput,
      metadataOnlySuccess: !result.targetProof.noMetadataOnlySuccess,
      message: result.targetProof.message,
    };
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

const level5RuntimeAdapterRegistry = createLevel5RuntimeAdapterRegistry([
  nodeLevel5ProofRuntimeAdapter,
]);

export function detectLevel5RestoreAdapter(
  snapDir: string,
): Level5RuntimeAdapterMatch<typeof nodeLevel5ProofRuntimeAdapter> | undefined {
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

// fallow-ignore-next-line complexity
export async function restoreLevel5RuntimeBundle(
  snapDir: string,
  input: { verifyProofOnly?: boolean; allowProofOnlySuccess?: boolean },
): Promise<NodeLevel5ProofRestoreAdapterResult> {
  const match = detectLevel5RestoreAdapter(snapDir);
  if (!match) {
    const refusal = level5RuntimeAdapterRegistry.refuseUnsupported({
      message: "no Level 5 runtime adapter detected for restore bundle",
    });
    throw new Error(refusal.message);
  }
  const context: NodeLevel5ProofRestoreContext = {
    snapDir,
    verifyProofOnly: input.verifyProofOnly,
    allowProofOnlySuccess: input.allowProofOnlySuccess,
  };
  const validation = await match.adapter.validate(context);
  if (validation.state === "refused") {
    const refusal =
      validation.refusals[0] ??
      match.adapter.refuse({
        code: "level5-runtime-profile-unsupported",
        message: "Level 5 runtime bundle refused",
      });
    throw new Error(refusal.message);
  }
  const plan = await match.adapter.planRestore(context);
  const result = await match.adapter.restoreTargetNative(plan);
  await match.adapter.verify(result);
  const summary = buildNodeLevel5ProofRestoreSummary(result);
  writeFileSync(plan.summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return {
    summary,
    exitCode: plan.allowProofOnlySuccess && result.targetProof.status === "passed" ? 0 : 1,
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

function isNodeLevel5ProofRestoreContext(
  input: NodeLevel5ProofComposition | NodeLevel5ProofRestoreContext,
): input is NodeLevel5ProofRestoreContext {
  return typeof (input as NodeLevel5ProofRestoreContext).snapDir === "string";
}
