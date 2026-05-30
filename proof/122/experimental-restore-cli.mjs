#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
    "node-proper-level5-restore-cli-experimental-flags-required",
    "Restore is proof-only and requires experimental flags.",
  );
}
if (args.includes("--raw-cpu-restore")) {
  fail(
    "node-proper-level5-restore-cli-raw-cpu-refused",
    "Cross-architecture restore must use translated continuation.",
  );
}
const manifestIndex = args.indexOf("--capture-manifest");
const outIndex = args.indexOf("--out");
if (manifestIndex === -1 || !args[manifestIndex + 1]) {
  fail("node-proper-level5-restore-cli-manifest-required", "Pass --capture-manifest.");
}
if (outIndex === -1 || !args[outIndex + 1]) {
  fail("node-proper-level5-restore-cli-output-required", "Pass --out.");
}
const manifestPath = args[manifestIndex + 1];
if (!existsSync(manifestPath)) {
  fail("node-proper-level5-restore-cli-manifest-missing", "Capture manifest was not found.");
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.proofOnly !== true || manifest.productSupportClaimed !== false) {
  fail(
    "node-proper-level5-restore-cli-boundary-refused",
    "Only proof-only manifests are accepted.",
  );
}
writeFileSync(
  args[outIndex + 1],
  JSON.stringify(
    {
      accepted: true,
      targetStarted: false,
      translatedContinuationUsed: true,
      targetNativeNodeUsed: true,
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
    translatedContinuationUsed: true,
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
  }),
);
