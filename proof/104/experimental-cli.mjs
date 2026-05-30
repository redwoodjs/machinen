#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";

const args = process.argv.slice(2);
function fail(code, message) {
  console.error(
    JSON.stringify({
      accepted: false,
      targetStarted: false,
      refusal: { code, message },
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
    }),
  );
  process.exit(1);
}
if (!args.includes("--proof-only") || !args.includes("--experimental-translated-continuation")) {
  fail(
    "node-proper-level5-experimental-cli-proof-flags-required",
    "This experimental translated-continuation path is proof-only and requires explicit proof flags.",
  );
}
if (args.includes("--claim-product-support")) {
  fail(
    "node-proper-level5-experimental-cli-product-claim-refused",
    "The real-capture E2E lane is not product support.",
  );
}
const summaryIndex = args.indexOf("--proof-100-summary");
if (summaryIndex === -1 || !args[summaryIndex + 1]) {
  fail(
    "node-proper-level5-experimental-cli-summary-required",
    "Pass --proof-100-summary to reuse checked proof evidence.",
  );
}
const summaryPath = args[summaryIndex + 1];
if (!existsSync(summaryPath)) {
  fail(
    "node-proper-level5-experimental-cli-summary-missing",
    "The Proof 100 checked summary was not found.",
  );
}
const summary = JSON.parse(readFileSync(summaryPath, "utf8"));
if (
  summary.scope !== "proof-only-harness-not-product-support" ||
  summary.productSupportClaimed !== false
) {
  fail(
    "node-proper-level5-experimental-cli-boundary-refused",
    "Only proof-only checked summaries may be consumed.",
  );
}
if (
  !summary.assertions?.zigGuestCaptureRan ||
  !summary.assertions?.nativeVerifierRanBeforeTarget ||
  !summary.assertions?.amd64TargetReturnedNextState
) {
  fail(
    "node-proper-level5-experimental-cli-gates-incomplete",
    "The Proof 100 checked summary does not contain the required real-capture gates.",
  );
}
console.log(
  JSON.stringify({
    accepted: true,
    targetStarted: false,
    proof: "104",
    consumedProof: "100",
    mode: "proof-only",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  }),
);
