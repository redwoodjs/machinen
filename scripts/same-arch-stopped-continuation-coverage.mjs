#!/usr/bin/env node
import { readFileSync } from "node:fs";

const contractPath =
  process.env.SAME_ARCH_STOPPED_CONTINUATION_CONTRACT ??
  "docs/snapshot/same-arch-stopped-continuation-primitive-contract.json";
const sourcePath =
  process.env.SAME_ARCH_STOPPED_CONTINUATION_SOURCE ??
  "packages/runtime/src/same-arch-stopped-continuation.ts";
const testPath =
  process.env.SAME_ARCH_STOPPED_CONTINUATION_TEST ??
  "packages/runtime/src/__tests__/same-arch-stopped-continuation.test.ts";

const contract = JSON.parse(readFileSync(contractPath, "utf8"));
const source = readFileSync(sourcePath, "utf8");
const test = readFileSync(testPath, "utf8");
const errors = [...validateContract(contract), ...validateSource(source), ...validateTests(test)];

const report = {
  contract: contract.name,
  productStatus: contract.productStatus?.current,
  refusalClasses: contract.refusalClasses?.length ?? 0,
  happyPathProof: contract.requiredProofRows?.happyPath,
  refusalProofRows: contract.requiredProofRows?.refusals?.length ?? 0,
  errors,
};
console.log(JSON.stringify(report, null, 2));
if (errors.length > 0) {
  process.exit(1);
}

// fallow-ignore-next-line complexity
function validateContract(contract) {
  const errors = [];
  if (contract.name !== "same-arch-stopped-continuation-primitive-contract") {
    errors.push("contract name mismatch");
  }
  if (contract.productStatus?.current !== "contract-only-not-promoted") {
    errors.push("contract must remain not promoted until proof evidence is complete");
  }
  if (contract.targetContinuationStep?.mustNotExecArgv !== true) {
    errors.push("target continuation step must ban fresh argv exec");
  }
  for (const banned of [
    "reexec",
    "restart",
    "output replay",
    "descriptor-only equivalence",
    "source-ISA emulation",
    "source-fd teleportation",
    "metadata-only success",
  ]) {
    if (!contract.hardBans?.includes(banned)) {
      errors.push(`contract missing hard ban ${banned}`);
    }
  }
  if (!contract.requiredProofRows?.happyPath) {
    errors.push("contract missing happy-path proof row name");
  }
  if ((contract.requiredProofRows?.refusals?.length ?? 0) < 10) {
    errors.push("contract must list at least 10 refusal proof rows");
  }
  return errors;
}

function validateSource(source) {
  const errors = [];
  for (const phrase of [
    "classifySameArchStoppedContinuationCapture",
    "materializeSameArchStoppedContinuationTarget",
    "reexecUsed: false",
    "restartUsed: false",
    "resourceReconstructionUsed: false",
    "targetProcessStarted: false",
    "targetProcessKilledOnRefusal",
    "metadataOnlySuccessRefused",
  ]) {
    if (!source.includes(phrase)) {
      errors.push(`source missing guard phrase ${phrase}`);
    }
  }
  return errors;
}

function validateTests(test) {
  const errors = [];
  for (const phrase of [
    "marks only the exact stopped single-thread same-arch source shape eligible",
    "materializes a target-native resume only when the marker depends on captured live state",
    "refuses target materialization on %s without leaving a target process",
    "refuses target materialization when capture classification already refused",
    "source-ISA mismatch",
    "multiple threads",
    "running source",
    "active syscall",
    "missing text identity",
    "pc outside verified text",
    "uncaptured private memory",
    "unsupported mapping",
    "non-stdio fd",
    "socket",
    "timer",
    "signal",
    "terminal session",
    "metadata-only marker",
    "fresh-start-equivalent marker",
  ]) {
    if (!test.includes(phrase)) {
      errors.push(`test missing proof phrase ${phrase}`);
    }
  }
  return errors;
}
