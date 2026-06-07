#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildNodeLevel5ProofComposition,
  runNodeLevel5TargetSideProof,
  type NodeLevel5ProofEvidenceCheck,
  type NodeLevel5ProofIngredientName,
  type NodeLevel5TargetProofEvidence,
  type NodeLevel5TargetSideProof,
} from "../packages/runtime/src/index.ts";

interface Args {
  out: string;
  json: boolean;
  includeTargetProof: boolean;
  targetProof?: string;
}

const DEFAULT_OUT = "research/snapshot/checked-summaries/node-level5/goal-009-proof-run.json";

const evidenceRequirements: Array<{
  name: NodeLevel5ProofIngredientName;
  path: string;
  requiredFragments: string[];
}> = [
  {
    name: "register-translation",
    path: "research/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: ["native-register-translation", "target-registers-translated"],
  },
  {
    name: "stack-return-chain-translation",
    path: "research/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: [
      "native-stack-return-chain-translation",
      "stack-window-materialized",
      "return-chain-materialized",
    ],
  },
  {
    name: "private-memory-materialization",
    path: "research/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: ["native-private-memory-materialization", "target-memory-materialized"],
  },
  {
    name: "executable-target-module-materialization",
    path: "research/snapshot/native-process-continuation-audit.md",
    requiredFragments: ["Memory/executable materialization", "native-target-module-bytes"],
  },
  {
    name: "target-restore-loader",
    path: "research/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: ["native-target-restore-loader", "node scripts/native-restore-loader.mjs"],
  },
  {
    name: "level4-event-loop-resource-map",
    path: "research/snapshot/checked-summaries/node-level5/goal-008-node-event-loop-resource-map.json",
    requiredFragments: [
      "machinen.node-event-loop-level4-resource-map-summary",
      "tcp-listener-v1-loopback-empty-accept-queue",
      "eventfd-counter-v1-nonsemaphore-no-waiters",
    ],
  },
  {
    name: "target-native-verifier",
    path: "research/snapshot/checked-summaries/node-level5/goal-009-node-level5-proof-composition.json",
    requiredFragments: ["target-native-verifier", "sourceIsaEmulationAllowed"],
  },
];

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): Args {
  const args: Args = { out: DEFAULT_OUT, json: false, includeTargetProof: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "verify" || arg === "--") {
      continue;
    }
    if (arg === "--json") {
      args.json = true;
      continue;
    }
    if (arg === "--include-target-proof") {
      args.includeTargetProof = true;
      continue;
    }
    if (arg === "--target-proof") {
      args.targetProof = argv[++index] ?? fail("--target-proof requires a value");
      args.includeTargetProof = true;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[++index] ?? fail("--out requires a value");
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return args;
}

// fallow-ignore-next-line complexity
async function main(): Promise<void> {
  const args = parseArgs(process.argv);
  const evidenceChecks = evidenceRequirements.map(checkEvidence);
  const checkedSummaries = Object.fromEntries(
    evidenceRequirements.map((requirement) => [requirement.name, requirement.path]),
  ) as Partial<Record<NodeLevel5ProofIngredientName, string>>;
  const targetProof = args.includeTargetProof ? await resolveTargetProof(args) : undefined;
  const composition = buildNodeLevel5ProofComposition({
    eventLoopResourceMapPresent: evidencePassed("level4-event-loop-resource-map", evidenceChecks),
    targetNativeVerifierPresent: evidencePassed("target-native-verifier", evidenceChecks),
    checkedSummaries,
    evidenceChecks,
    ...(targetProof ? { targetProof } : {}),
    proofRunner: "scripts/node-level5-proof-composition.ts",
  });
  const out = resolve(args.out);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${JSON.stringify(composition, null, 2)}\n`);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(composition, null, 2)}\n`);
  } else {
    process.stdout.write(
      `node-level5-proof-composition: ${composition.summary.present}/${composition.summary.required} ingredients present, ${composition.refusalMatrix.length} refusals, artifact=${out}\n`,
    );
  }
  if (!composition.summary.proofReady) {
    process.exitCode = 1;
  }
}

async function resolveTargetProof(args: Args): Promise<NodeLevel5TargetProofEvidence> {
  const proofPath = args.targetProof
    ? resolve(args.targetProof)
    : resolve(
        "research/snapshot/checked-summaries/node-level5/goal-009-target-side-continuation.json",
      );
  if (!args.targetProof || !existsSync(proofPath)) {
    await runNodeLevel5TargetSideProof({ outPath: proofPath });
  }
  return readTargetProofEvidence(proofPath);
}

// fallow-ignore-next-line complexity
function readTargetProofEvidence(path: string): NodeLevel5TargetProofEvidence {
  if (!existsSync(path)) {
    return {
      path,
      status: "missing",
      noSourceIsaEmulation: false,
      noSidecarOutput: false,
      noMetadataOnlySuccess: false,
      targetVerifierObservedActualNodeContinuation: false,
      message: "target proof artifact is missing",
    };
  }
  const proof = JSON.parse(readFileSync(path, "utf8")) as NodeLevel5TargetSideProof;
  const passed =
    proof.kind === "machinen.node-level5-target-side-continuation-proof" &&
    proof.assertions.sourceIsaEmulationUsed === false &&
    proof.assertions.sidecarOutputUsed === false &&
    proof.assertions.metadataOnlySuccess === false &&
    proof.assertions.targetVerifierObservedActualNodeContinuation === true &&
    proof.summary.targetOutputVerified === true;
  return {
    path,
    status: passed ? "passed" : "failed",
    kind: proof.kind,
    noSourceIsaEmulation: proof.assertions.sourceIsaEmulationUsed === false,
    noSidecarOutput: proof.assertions.sidecarOutputUsed === false,
    noMetadataOnlySuccess: proof.assertions.metadataOnlySuccess === false,
    targetVerifierObservedActualNodeContinuation:
      proof.assertions.targetVerifierObservedActualNodeContinuation === true,
    message: passed
      ? "target proof observed actual target-native Node continuation"
      : "target proof artifact did not satisfy shortcut gates",
  };
}

function checkEvidence(
  requirement: (typeof evidenceRequirements)[number],
): NodeLevel5ProofEvidenceCheck {
  if (!existsSync(requirement.path)) {
    return {
      name: requirement.name,
      path: requirement.path,
      requiredFragments: requirement.requiredFragments,
      status: "missing",
      message: "evidence file is missing",
    };
  }
  const text = readFileSync(requirement.path, "utf8");
  const missingFragments = requirement.requiredFragments.filter(
    (fragment) => !text.includes(fragment),
  );
  if (missingFragments.length > 0) {
    return {
      name: requirement.name,
      path: requirement.path,
      requiredFragments: requirement.requiredFragments,
      status: "failed",
      message: `missing required evidence fragments: ${missingFragments.join(", ")}`,
    };
  }
  return {
    name: requirement.name,
    path: requirement.path,
    requiredFragments: requirement.requiredFragments,
    status: "passed",
    message: "evidence file contains the required fragments",
  };
}

function evidencePassed(
  name: NodeLevel5ProofIngredientName,
  evidenceChecks: NodeLevel5ProofEvidenceCheck[],
): boolean {
  return evidenceChecks.some((check) => check.name === name && check.status === "passed");
}

function fail(message: string): never {
  throw new Error(message);
}

await main();
