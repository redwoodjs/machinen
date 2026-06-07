import { createNodeLevel5DeclaredSubsetCapture } from "@machinen/runtime";
import { consumeDryRunFlag, consumeJsonFlag } from "../args.ts";
import { die } from "../errors.ts";
import { cmdNodeLevel5AbiCheck } from "./node-level5-abi.ts";
import { cmdNodeLevel5Artifacts } from "./node-level5-artifacts.ts";
import {
  cmdNodeLevel5Claims,
  cmdNodeLevel5Detectors,
  cmdNodeLevel5ReleaseGate,
  cmdNodeLevel5SupportMatrix,
} from "./node-level5-release.ts";
import {
  cmdNodeLevel5ProductSupport85ClaimReady,
  cmdNodeLevel5ProductSupport85Readiness,
} from "./node-level5-release-reports.ts";
import {
  parseNodeLevel5DeclaredSubsetCaptureArgs,
  reportNodeLevel5DeclaredSubsetCliRefusal,
  reportNodeLevel5DeclaredSubsetSummary,
} from "./node-level5-shared.ts";

export function cmdCapture(args: string[]): number {
  const { json, rest: withoutJson } = consumeJsonFlag(args);
  const { dryRun, rest } = consumeDryRunFlag(withoutJson);
  if (rest[0] === "node-level5") {
    return cmdCaptureNodeLevel5DeclaredSubset({ json, dryRun, rest });
  }
  die(captureUsage());
}

// fallow-ignore-next-line complexity code-duplication
function cmdCaptureNodeLevel5DeclaredSubset(input: {
  json: boolean;
  dryRun: boolean;
  rest: string[];
}): number {
  const options = parseNodeLevel5DeclaredSubsetCaptureArgs(input.rest.slice(1));
  if (!options.out) {
    reportNodeLevel5DeclaredSubsetCliRefusal(
      input.json,
      "node-level5-declared-subset-output-required",
      "machinen capture node-level5 requires --out <dir>",
    );
  }
  const summary = createNodeLevel5DeclaredSubsetCapture({
    outDir: options.out,
    sourceArch: options.sourceArch,
    targetArch: options.targetArch,
    experimental: options.experimental,
    productSupportClaimed: options.productSupportClaimed,
    dryRun: input.dryRun,
  });
  return reportNodeLevel5DeclaredSubsetSummary(input.json, summary, {
    accepted: (value) => `captured experimental node-level5 manifest: ${value.manifestPath}\n`,
    refused: (value) => `refused experimental node-level5 capture: ${value.refusal?.code}\n`,
  });
}

// fallow-ignore-next-line complexity
export function cmdNodeLevel5(args: string[]): number {
  const { json, rest } = consumeJsonFlag(args);
  if (rest[0] === "artifacts") {
    return cmdNodeLevel5Artifacts(rest.slice(1), json);
  }
  if (rest[0] === "detectors") {
    return cmdNodeLevel5Detectors(rest.slice(1), json);
  }
  if (rest[0] === "claims") {
    return cmdNodeLevel5Claims(rest.slice(1), json);
  }
  if (rest[0] === "support-matrix") {
    return cmdNodeLevel5SupportMatrix(rest.slice(1), json);
  }
  if (rest[0] === "release-gate") {
    return cmdNodeLevel5ReleaseGate(rest.slice(1), json);
  }
  if (rest[0] === "85-readiness") {
    return cmdNodeLevel5ProductSupport85Readiness(rest.slice(1), json);
  }
  if (rest[0] === "85-claim-ready") {
    return cmdNodeLevel5ProductSupport85ClaimReady(rest.slice(1), json);
  }
  if (rest[0] === "abi-check") {
    return cmdNodeLevel5AbiCheck(rest.slice(1), json);
  }
  die(nodeLevel5Usage());
}

function nodeLevel5Usage(): string {
  return (
    "usage: machinen node-level5 artifacts <write|verify> ... [--json]\n" +
    "       machinen node-level5 support-matrix [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-corpus --generic-vm-corpus-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-retained-evidence --generic-vm-retained-evidence-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-row-artifacts --generic-vm-row-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 release-gate [--include-generic-vm-refusal-artifacts --generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 85-readiness --generic-vm-corpus-report <file> [--generic-vm-retained-evidence-report <file>] [--generic-vm-row-artifacts-report <file>] [--generic-vm-refusal-artifacts-report <file>] [--json]\n" +
    "       machinen node-level5 85-claim-ready --readiness-report <file> [--json]\n"
  );
}

function captureUsage(): string {
  return (
    "usage: machinen capture node-level5 --out <dir> " +
    "[--source-arch <arm64|amd64>] [--target-arch <arm64|amd64>] " +
    "[--experimental-node-level5] [--claim-product-support] [--json] [--dry-run]"
  );
}
// fallow-ignore-next-line complexity code-duplication
