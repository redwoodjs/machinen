#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  buildNodeLevel5ProofComposition,
  type NodeLevel5ProofEvidenceCheck,
  type NodeLevel5ProofIngredientName,
} from "../packages/runtime/src/index.ts";

interface Args {
  out: string;
  json: boolean;
}

const DEFAULT_OUT = "docs/snapshot/checked-summaries/level4-graduation/goal-009-proof-run.json";

const evidenceRequirements: Array<{
  name: NodeLevel5ProofIngredientName;
  path: string;
  requiredFragments: string[];
}> = [
  {
    name: "register-translation",
    path: "docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: ["native-register-translation", "target-registers-translated"],
  },
  {
    name: "stack-return-chain-translation",
    path: "docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: [
      "native-stack-return-chain-translation",
      "stack-window-materialized",
      "return-chain-materialized",
    ],
  },
  {
    name: "private-memory-materialization",
    path: "docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: ["native-private-memory-materialization", "target-memory-materialized"],
  },
  {
    name: "executable-target-module-materialization",
    path: "docs/snapshot/native-process-continuation-audit.md",
    requiredFragments: ["Memory/executable materialization", "native-target-module-bytes"],
  },
  {
    name: "target-restore-loader",
    path: "docs/snapshot/checked-summaries/architecture-portable-snapshot/final-gauntlet.json",
    requiredFragments: ["native-target-restore-loader", "node scripts/native-restore-loader.mjs"],
  },
  {
    name: "level4-event-loop-resource-map",
    path: "docs/snapshot/checked-summaries/level4-graduation/goal-008-node-event-loop-resource-map.json",
    requiredFragments: [
      "machinen.node-event-loop-level4-resource-map-summary",
      "tcp-listener-v1-loopback-empty-accept-queue",
      "eventfd-counter-v1-nonsemaphore-no-waiters",
    ],
  },
  {
    name: "target-native-verifier",
    path: "docs/snapshot/checked-summaries/level4-graduation/goal-009-node-level5-proof-composition.json",
    requiredFragments: ["target-native-verifier", "sourceIsaEmulationAllowed"],
  },
];

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): Args {
  const args: Args = { out: DEFAULT_OUT, json: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "verify" || arg === "--") {
      continue;
    }
    if (arg === "--json") {
      args.json = true;
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

function main(): void {
  const args = parseArgs(process.argv);
  const evidenceChecks = evidenceRequirements.map(checkEvidence);
  const checkedSummaries = Object.fromEntries(
    evidenceRequirements.map((requirement) => [requirement.name, requirement.path]),
  ) as Partial<Record<NodeLevel5ProofIngredientName, string>>;
  const composition = buildNodeLevel5ProofComposition({
    eventLoopResourceMapPresent: evidencePassed("level4-event-loop-resource-map", evidenceChecks),
    targetNativeVerifierPresent: evidencePassed("target-native-verifier", evidenceChecks),
    checkedSummaries,
    evidenceChecks,
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

main();
