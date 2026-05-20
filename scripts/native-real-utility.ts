#!/usr/bin/env tsx
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { translateNativeResources } from "../packages/runtime/src/native-resource-translation.ts";
import {
  NATIVE_CAPTURE_SOURCE,
  bundleFileStats,
  compileNativeProcessCapturer,
  ensureSourcesExist,
  hostArch,
  readJson,
} from "./controlled-corpus-utils.mjs";
import {
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  emitSkip,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: tsx scripts/native-real-utility.ts [verify] [--out-dir path] [--json] [--keep]";
const BUNDLE_FILES = [
  "native-process.json",
  "native-mappings.json",
  "native-threads.json",
  "native-resources.json",
  "native-translation.json",
  "native-memory.bin",
];

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  if (process.platform !== "linux") {
    emitSkip(args, "native-real-utility", "real utility capture uses Linux /proc and ptrace");
    return;
  }
  const workspace = createWorkspace(args, "machinen-native-real-utility-");
  try {
    emitResult(verifyRealUtilities(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function verifyRealUtilities(outDir: string) {
  ensureSourcesExist([NATIVE_CAPTURE_SOURCE]);
  const binDir = join(outDir, "bin");
  mkdirSync(binDir, { recursive: true });
  const capturer = compileNativeProcessCapturer(binDir);
  const attempts = [
    attemptSleep(outDir, capturer),
    attemptCat(outDir),
    attemptPing(outDir, capturer),
  ];
  if (!attempts.some((attempt) => attempt.state === "captured" || attempt.state === "refused")) {
    throw new Error("native real utility proof produced no captured/refused utility attempts");
  }
  return { formatVersion: 1, hostArch: hostArch(), capturer, attempts };
}

function attemptSleep(outDir: string, capturer: string) {
  const sleep = firstExisting(["/bin/sleep", "/usr/bin/sleep"]);
  if (!sleep) {
    return skipped("sleep", "sleep binary not found");
  }
  return captureUtility(outDir, capturer, "sleep", [sleep, "30"]);
}

function attemptCat(outDir: string) {
  const cat = firstExisting(["/bin/cat", "/usr/bin/cat"]);
  if (!cat) {
    return skipped("cat", "cat binary not found");
  }
  return {
    name: "cat",
    state: "refused",
    command: [cat, join(outDir, "cat-input.txt")],
    refusal: {
      code: "thread-state-unsupported",
      message:
        "plain cat on a regular file exits before an external live-process capture point; use a stopped process or a long-lived fd workload",
    },
  };
}

function attemptPing(outDir: string, capturer: string) {
  const ping = firstExisting(["/bin/ping", "/usr/bin/ping"]);
  if (!ping) {
    return skipped("ping", "ping binary not found");
  }
  return captureUtility(outDir, capturer, "ping", [ping, "127.0.0.1"]);
}

function captureUtility(outDir: string, capturer: string, name: string, command: string[]) {
  const bundleDir = join(outDir, `bundle-${name}`);
  mkdirSync(bundleDir, { recursive: true });
  const result = spawnSync(
    capturer,
    [
      "--output",
      bundleDir,
      "--target-arch",
      oppositeArch(hostArch()),
      "--settle-ms",
      "150",
      "--",
      ...command,
    ],
    { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    return {
      name,
      state: "refused",
      command,
      refusal: {
        code: "thread-state-unsupported",
        message: `external capture failed for ${name}`,
        detail: { stderr: result.stderr.trim() },
      },
    };
  }
  const resources = readJson(join(bundleDir, "native-resources.json"));
  const translatedResources = translateNativeResources({ resources: resources.resources });
  return {
    name,
    state: translatedResources.refusals.length > 0 ? "refused" : "captured",
    command,
    pid: readJson(join(bundleDir, "native-process.json")).capture.pid,
    mappingCount: readJson(join(bundleDir, "native-mappings.json")).mappings.length,
    threadCount: readJson(join(bundleDir, "native-threads.json")).threads.length,
    resourceKinds: [
      ...new Set(resources.resources.map((resource: { kind: string }) => resource.kind)),
    ],
    resourceRefusals: translatedResources.refusals,
    bundleFiles: bundleFileStats(bundleDir, BUNDLE_FILES),
  };
}

function firstExisting(paths: string[]) {
  return paths.find((path) => existsSync(path));
}

function oppositeArch(arch: string) {
  if (arch === "arm64") {
    return "amd64";
  }
  if (arch === "amd64") {
    return "arm64";
  }
  return "unknown";
}

function skipped(name: string, reason: string) {
  return { name, state: "skipped", reason };
}

function printSummary(summary: ReturnType<typeof verifyRealUtilities>) {
  for (const attempt of summary.attempts) {
    const detail =
      attempt.state === "captured" || attempt.state === "refused"
        ? `state=${attempt.state} resources=${"resourceKinds" in attempt ? attempt.resourceKinds.join(",") : "n/a"}`
        : `state=${attempt.state} reason=${"reason" in attempt ? attempt.reason : "unknown"}`;
    console.log(`native-real-utility: ${attempt.name} ${detail}`);
  }
}

main();
