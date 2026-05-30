#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
if (!args.includes("--experimental-node-level5") || !args.includes("--proof-only")) {
  fail(
    "node-proper-level5-capture-cli-experimental-flags-required",
    "Capture is proof-only and requires experimental flags.",
  );
}
if (args.includes("--claim-product-support")) {
  fail("node-proper-level5-capture-cli-product-claim-refused", "This path is not product support.");
}
const outIndex = args.indexOf("--out");
if (outIndex === -1 || !args[outIndex + 1]) {
  fail("node-proper-level5-capture-cli-output-required", "Pass --out for capture records.");
}
const out = args[outIndex + 1];
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, "capture-manifest.json"),
  JSON.stringify(
    {
      kind: "machinen.experimental-node-level5-capture-manifest",
      proofOnly: true,
      records: ["process", "threads", "resources", "v8-graph"],
      productSupportClaimed: false,
      broadLevel5ImplementationClaimed: false,
    },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    accepted: true,
    targetStarted: false,
    out,
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  }),
);
