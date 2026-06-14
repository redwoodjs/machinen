#!/usr/bin/env node

import { readFileSync } from "node:fs";

const contract = JSON.parse(
  readFileSync("docs/snapshot/cross-arch-cli-next-binaries-contract.json", "utf8"),
);
const docs = [
  "docs/snapshot/cross-arch-cli-next-binaries-contract.json",
  "docs/snapshot/cross-arch-cli-next-binaries.md",
  "docs/snapshot/README.md",
  "docs/snapshot/generic-resource-graph-move.md",
  "packages/runtime/API.md",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const source = [
  "packages/runtime/src/cross-arch-cli-next-binaries.ts",
  "packages/cli/src/move-cross-arch-cli-next-binaries.ts",
  "packages/runtime/src/move-pid-graph.ts",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const tests = [
  "packages/runtime/src/__tests__/cross-arch-cli-next-binaries.test.ts",
  "packages/cli/src/__tests__/move-rendezvous.test.ts",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const errors = [];

if (contract.name !== "cross-arch-cli-next-binaries-contract") {
  errors.push("contract name mismatch");
}
if (
  contract.globalRule?.productSuccess !==
  "cross-ISA target-native semantic continuation from captured live state, or refusal"
) {
  errors.push("global product success rule mismatch");
}
if (
  pkg.scripts?.["cross-arch-cli-next-binaries-coverage"] !==
  "node scripts/cross-arch-cli-next-binaries-coverage.mjs"
) {
  errors.push("package script cross-arch-cli-next-binaries-coverage missing");
}
if ((contract.globalRefusals ?? []).length < 15) {
  errors.push("global refusal coverage too small");
}

for (const phrase of [
  "cross-ISA target-native semantic continuation from captured live state, or refusal",
  "cat",
  "dd",
  "wc -l",
  "seq",
  "grep -F",
  "same-arch product success",
  "argv restart",
  "target execve from argv",
  "output replay",
  "descriptor-only success",
  "source-ISA emulation",
  "source-fd teleportation",
  "metadata-only success",
  "broad grep",
  "broad wc",
  "unsafe dd",
  "services",
  "databases",
  "shells",
  "CrossArchCatContinuationRequest",
  "CrossArchDdContinuationRequest",
  "CrossArchWcLineContinuationRequest",
  "CrossArchSeqContinuationRequest",
  "CrossArchFixedStringGrepContinuationRequest",
]) {
  if (!`${docs}\n${source}`.includes(phrase)) {
    errors.push(`missing docs/API/source phrase: ${phrase}`);
  }
}

for (const phrase of [
  "classifyCrossArchCatContinuationCapture",
  "planCrossArchCatContinuationTarget",
  "classifyCrossArchDdContinuationCapture",
  "planCrossArchDdContinuationTarget",
  "classifyCrossArchWcLineContinuationCapture",
  "planCrossArchWcLineContinuationTarget",
  "classifyCrossArchSeqContinuationCapture",
  "planCrossArchSeqContinuationTarget",
  "classifyCrossArchFixedStringGrepContinuationCapture",
  "planCrossArchFixedStringGrepContinuationTarget",
  "moveDescriptorHasCrossArchCliNextBinariesRoute",
]) {
  if (!source.includes(phrase)) {
    errors.push(`missing source route/export phrase: ${phrase}`);
  }
}

for (const phrase of [
  "targetFirstByteOffset: 32",
  "recopiedInputOffsets: []",
  "targetFinalLineCount: 12",
  'targetFirstEmittedValue: "5"',
  "targetFirstMatchedLineNumber: 9",
  "commands).toEqual([])",
  "refuses shells and services without explicit semantic models before VM exec",
  "broadWcByteModeRefused",
  "directIoRefused",
  "regexModeRefused",
  "markerRematchesPriorLines",
]) {
  if (!tests.includes(phrase)) {
    errors.push(`missing test proof phrase: ${phrase}`);
  }
}

for (const phrase of [
  "argvRestartUsed: false",
  "execveFromArgvUsed: false",
  "reexecUsed: false",
  "outputReplayUsed: false",
  "descriptorOnlySuccessUsed: false",
  "sourceIsaEmulationUsed: false",
  "sourceFdTeleportationUsed: false",
  "metadataOnlySuccessUsed: false",
  "targetProcessStarted: false",
]) {
  if (!source.includes(phrase)) {
    errors.push(`missing source guard phrase: ${phrase}`);
  }
}

for (const phrase of [
  "argvRestartUsed: true",
  "execveFromArgvUsed: true",
  "outputReplayUsed: true",
  "descriptorOnlySuccessUsed: true",
  "sourceIsaEmulationUsed: true",
  "sourceFdTeleportationUsed: true",
  "metadataOnlySuccessUsed: true",
]) {
  if (source.includes(phrase)) {
    errors.push(`banned source phrase present: ${phrase}`);
  }
}

const output = {
  contract: contract.name,
  ladderPriority: contract.ladderPriority?.map((row) => row.binary) ?? [],
  globalRefusals: contract.globalRefusals?.length ?? 0,
  productRoutes: Object.keys(contract.requiredProofRows ?? {}).filter((key) =>
    key.endsWith("HappyPath"),
  ),
  errors,
};
console.log(JSON.stringify(output, null, 2));
if (errors.length > 0) {
  process.exit(1);
}
