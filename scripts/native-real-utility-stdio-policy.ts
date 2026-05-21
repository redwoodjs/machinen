#!/usr/bin/env tsx
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import type { NativeProcessResource } from "../packages/runtime/src/native-process-image.ts";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-real-utility-stdio-policy.ts [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-real-utility-stdio-policy", "stdio resource proof is Linux-only");
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-real-utility-stdio-policy-");
  try {
    emitResult(verifyInheritedStdioPolicy(), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyInheritedStdioPolicy() {
  const resources = proofResources();
  const withoutPolicy = translateNativeResources({
    resources: resources.outputOnly,
    inheritedStdio: { mode: "require-explicit" },
  });
  const withPolicy = translateNativeResources({
    resources: resources.all,
    inheritedStdio: { mode: "inherit-output" },
  });
  assert(
    withoutPolicy.refusals.every((refusal) => refusal.code === "inherited-stdio-policy-required"),
    "stdout/stderr were accepted without an explicit inherited stdio policy",
  );
  const recipes = Object.fromEntries(
    withPolicy.resources.flatMap((resource) =>
      resource.recipe ? [[resource.id, resource.recipe]] : [],
    ),
  );
  assert(recipes["fd:1"], "stdout did not receive an inherited recipe");
  assert(recipes["fd:2"], "stderr did not receive an inherited recipe");
  assert(recipes["fd:4"], "regular file did not keep its reopen recipe");
  return {
    formatVersion: 1,
    phase: "real-utility-stdio-policy",
    inheritedPolicy: "inherit-output",
    withoutPolicyRefusals: withoutPolicy.refusals,
    translatedResources: withPolicy.resources,
    refusalCodes: withPolicy.refusals.map((refusal) => refusal.code),
    stdoutRecipe: recipes["fd:1"],
    stderrRecipe: recipes["fd:2"],
    regularFileRecipe: recipes["fd:4"],
    migratedKernelBuffers: false,
    execution: "real-utility-inherited-stdio-policy-proved-with-precise-resource-refusals",
  };
}

function proofResources(): { outputOnly: NativeProcessResource[]; all: NativeProcessResource[] } {
  const outputOnly: NativeProcessResource[] = [
    { id: "fd:1", kind: "pipe", state: "captured", fd: 1, path: "pipe:[stdout]" },
    { id: "fd:2", kind: "socket", state: "captured", fd: 2, path: "socket:[stderr]" },
  ];
  return {
    outputOnly,
    all: [
      { id: "fd:0", kind: "pipe", state: "captured", fd: 0, path: "pipe:[stdin]" },
      ...outputOnly,
      { id: "fd:3", kind: "socket", state: "captured", fd: 3, path: "socket:[nonstdio]" },
      { id: "fd:4", kind: "file", state: "captured", fd: 4, path: "/tmp/stdio.txt", offset: 17 },
    ],
  };
}

function printSummary(
  summary: ReturnType<typeof verifyInheritedStdioPolicy> | { skipped: true; reason: string },
) {
  if ("skipped" in summary) {
    console.log(`native-real-utility-stdio-policy: skipped ${summary.reason}`);
    return;
  }
  console.log(
    `native-real-utility-stdio-policy: refusals=${summary.refusalCodes.join(",")} stdout=${JSON.stringify(summary.stdoutRecipe)}`,
  );
  console.log(`native-real-utility-stdio-policy: execution=${summary.execution}`);
}

main();
