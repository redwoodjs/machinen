#!/usr/bin/env node
const args = process.argv.slice(2);
const hasExperimental = args.includes("--experimental-translated-continuation");
const hasProofOnly = args.includes("--proof-only");
const unsafe = args.includes("--unsafe-active-request");
const productClaim = args.includes("--claim-product-support");
function out(value) {
  console.log(JSON.stringify(value));
}
if (!hasExperimental || !hasProofOnly) {
  out({
    accepted: false,
    code: "node-proper-level5-cli-experimental-proof-only-required",
    message:
      "Translated continuation is experimental proof-only. Re-run with explicit experimental and proof-only flags.",
    targetStarted: false,
    productSupportClaimed: false,
  });
  process.exit(1);
}
if (productClaim) {
  out({
    accepted: false,
    code: "node-proper-level5-cli-product-claim-refused",
    message: "This proof path cannot claim product support.",
    targetStarted: false,
    productSupportClaimed: false,
  });
  process.exit(1);
}
if (unsafe) {
  out({
    accepted: false,
    code: "node-proper-level5-cli-active-request-refused",
    message:
      "Active HTTP request state is unsafe for translated continuation and was refused before target start.",
    targetStarted: false,
    productSupportClaimed: false,
  });
  process.exit(1);
}
out({
  accepted: true,
  code: "accepted-proof-only-dry-run",
  message: "Proof-only translated continuation dry-run accepted. This is not product support.",
  targetStarted: false,
  productSupportClaimed: false,
  plan: { verify: true, assemble: true, materialize: false },
});
