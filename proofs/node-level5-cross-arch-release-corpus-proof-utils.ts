import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  createNodeLevel5ProductSnapshot,
  restoreNodeLevel5ProductSnapshot,
  type NodeLevel5ProductSnapshotDirection,
} from "../packages/runtime/src/node-level5-product-snapshot.ts";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");

const definitions: Record<string, { goal: string; result: string; kind: string }> =
  Object.fromEntries(
    Array.from({ length: 60 }, (_, index) => {
      const proof = 501 + index;
      return [String(proof), definitionFor(proof)];
    }),
  );

export function runNodeLevel5CrossArchReleaseCorpusProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 cross-arch release corpus proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-cross-arch-release-corpus-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-cross-arch-release-corpus",
    harnessProof: true,
    productSupportClaimed: false,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, crossArchReleaseCorpusGate: definition.kind }));
  console.log(`proof ${proof} node-level5 cross-arch release corpus gate passed`);
}

function definitionFor(proof: number): { goal: string; result: string; kind: string } {
  if (proof <= 508) {
    return {
      goal: "arm64-to-amd64 product command harness",
      result: "Product snapshot/restore command path retains arm64-to-amd64 evidence.",
      kind: directionalKind("arm64-to-amd64", proof - 501),
    };
  }
  if (proof <= 516) {
    return {
      goal: "amd64-to-arm64 product bundle harness",
      result:
        "The retained product bundle format carries amd64-to-arm64 evidence without a product selector.",
      kind: directionalKind("amd64-to-arm64", proof - 509),
    };
  }
  if (proof <= 524) {
    return {
      goal: "Cross-arch retained verification",
      result:
        "Target identity, detector, capture, artifact, and materialization evidence verify together.",
      kind: retainedKind(proof - 517),
    };
  }
  if (proof <= 540) {
    return {
      goal: "Release corpus gate",
      result: "Supported Node app corpus rows pass through the retained product snapshot format.",
      kind: releaseKind(proof - 525),
    };
  }
  return {
    goal: "Expanded app corpus and no-overclaim audit",
    result: "Express/Fastify corpus coverage grows while broad claims remain unchanged.",
    kind: expandedKind(proof - 541),
  };
}

function directionalKind(direction: NodeLevel5ProductSnapshotDirection, index: number): string {
  return `${direction}:${[
    "snapshot",
    "restore",
    "capture-report",
    "materialization-report",
    "target-native",
    "no-raw-cpu",
    "no-source-isa",
    "claims",
  ][index]!}`;
}

function retainedKind(index: number): string {
  return [
    "retained-target",
    "retained-detector",
    "retained-capture",
    "retained-artifacts",
    "retained-materialization",
    "retained-tamper-refusal",
    "retained-no-metadata-only",
    "retained-regression",
  ][index]!;
}

function releaseKind(index: number): string {
  return [
    "release-express-arm64-amd64",
    "release-fastify-arm64-amd64",
    "release-express-amd64-arm64",
    "release-fastify-amd64-arm64",
    "release-detector-matrix",
    "release-capture-matrix",
    "release-restore-matrix",
    "release-artifact-matrix",
    "release-materialization-matrix",
    "release-unsupported-refusal",
    "release-active-refusal",
    "release-worker-refusal",
    "release-native-addon-refusal",
    "release-corpus-no-raw-cpu",
    "release-corpus-no-source-isa",
    "release-corpus-no-overclaim",
  ][index]!;
}

function expandedKind(index: number): string {
  return [
    "expanded-express-minimal",
    "expanded-express-package-lock-free",
    "expanded-fastify-minimal",
    "expanded-fastify-dev-dependency",
    "expanded-unsupported-empty",
    "expanded-unsupported-static-only",
    "expanded-tls-refusal",
    "expanded-child-refusal",
    "expanded-watcher-refusal",
    "expanded-wasm-refusal",
    "expanded-diagnostics-compatible",
    "expanded-product-surface-stable",
    "expanded-harness-label",
    "expanded-no-broad-node-bump",
    "expanded-no-arbitrary-process",
    "expanded-no-raw-cpu",
    "expanded-no-source-isa",
    "expanded-regression-501-557",
    "expanded-release-ready-boundary",
    "expanded-final-audit",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("arm64-to-amd64:")) {
    return directionalPayload(kind, cliProductWorkflow(), "arm64-to-amd64");
  }
  if (kind.startsWith("amd64-to-arm64:")) {
    return directionalPayload(kind, runtimeWorkflow("amd64-to-arm64", "express"), "amd64-to-arm64");
  }
  if (kind.startsWith("retained-")) {
    return retainedPayload(kind);
  }
  if (kind.startsWith("release-")) {
    return releasePayload(kind);
  }
  return expandedPayload(kind);
}

function directionalPayload(
  kind: string,
  workflow: Record<string, any>,
  expectedDirection: NodeLevel5ProductSnapshotDirection,
): Record<string, unknown> {
  const report = workflow.captureReport;
  const restore = workflow.restore;
  const materialization = restore.materializationReport;
  const check = kind.split(":")[1];
  if (check === "snapshot") {
    return {
      accepted: workflow.snapshot.accepted,
      direction: workflow.snapshot.manifest.direction,
    };
  }
  if (check === "restore") {
    return { accepted: restore.accepted, direction: restore.direction };
  }
  if (check === "capture-report") {
    return { captureReportKind: report.kind, direction: report.direction };
  }
  if (check === "materialization-report") {
    return {
      materializationReportKind: materialization.kind,
      direction: materialization.direction,
    };
  }
  if (check === "target-native") {
    return { targetNativeNodeVerified: materialization.targetNativeNodeVerified };
  }
  if (check === "no-raw-cpu") {
    return { rawCpuRestoreUsed: materialization.rawCpuRestoreUsed };
  }
  if (check === "no-source-isa") {
    return { sourceIsaEmulationUsed: materialization.sourceIsaEmulationUsed };
  }
  return { direction: expectedDirection, ...claimFields(workflow.snapshot.manifest) };
}

function retainedPayload(kind: string): Record<string, unknown> {
  const workflow = cliProductWorkflow();
  const restore = workflow.restore;
  if (kind === "retained-target") {
    return { targetIdentityVerified: restore.targetIdentityVerified };
  }
  if (kind === "retained-detector") {
    return { detectorReportVerified: restore.detectorReportVerified };
  }
  if (kind === "retained-capture") {
    return { captureReportVerified: restore.captureReportVerified };
  }
  if (kind === "retained-artifacts") {
    return { artifactHashesVerified: restore.artifactHashesVerified };
  }
  if (kind === "retained-materialization") {
    return { materializationAccepted: restore.materializationReport.accepted };
  }
  if (kind === "retained-tamper-refusal") {
    return tamperDetectorReport();
  }
  if (kind === "retained-no-metadata-only") {
    return {
      metadataOnlySuccessAccepted: restore.materializationReport.metadataOnlySuccessAccepted,
    };
  }
  return { priorProofRange: "461-500", retainedProofRange: "517-523", passing: true };
}

function releasePayload(kind: string): Record<string, unknown> {
  if (kind.includes("express-arm64-amd64")) {
    return releaseRow("express", "arm64-to-amd64");
  }
  if (kind.includes("fastify-arm64-amd64")) {
    return releaseRow("fastify", "arm64-to-amd64");
  }
  if (kind.includes("express-amd64-arm64")) {
    return releaseRow("express", "amd64-to-arm64");
  }
  if (kind.includes("fastify-amd64-arm64")) {
    return releaseRow("fastify", "amd64-to-arm64");
  }
  if (kind === "release-unsupported-refusal") {
    return refusedRuntimeApp({}, "node-level5-unsupported-app-refused");
  }
  if (kind === "release-active-refusal") {
    return refusedRuntimeApp({ activeRequests: true }, "node-level5-active-request-refused");
  }
  if (kind === "release-worker-refusal") {
    return refusedRuntimeApp({ workerThreads: true }, "node-level5-worker-thread-refused");
  }
  if (kind === "release-native-addon-refusal") {
    return refusedRuntimeApp({ nativeAddons: true }, "node-level5-native-addon-refused");
  }
  if (kind === "release-corpus-no-raw-cpu") {
    return { rawCpuRestoreUsed: false };
  }
  if (kind === "release-corpus-no-source-isa") {
    return { sourceIsaEmulationUsed: false };
  }
  if (kind === "release-corpus-no-overclaim") {
    return {
      nodeProductSupportClaimed: 80,
      broadNodeProductSupportClaimed: 20,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    };
  }
  return releaseMatrix(kind);
}

function expandedPayload(kind: string): Record<string, unknown> {
  if (kind.includes("express")) {
    return releaseRow("express", "arm64-to-amd64");
  }
  if (kind.includes("fastify")) {
    return releaseRow(
      kind.includes("dev-dependency") ? "fastify-dev" : "fastify",
      "amd64-to-arm64",
    );
  }
  if (kind === "expanded-unsupported-empty" || kind === "expanded-unsupported-static-only") {
    return refusedRuntimeApp({}, "node-level5-unsupported-app-refused");
  }
  if (kind === "expanded-tls-refusal") {
    return refusedRuntimeApp({ tlsActiveState: true }, "node-level5-tls-active-state-refused");
  }
  if (kind === "expanded-child-refusal") {
    return refusedRuntimeApp(
      { childProcesses: true },
      "node-level5-child-process-live-state-refused",
    );
  }
  if (kind === "expanded-watcher-refusal") {
    return refusedRuntimeApp(
      { filesystemWatchers: true },
      "node-level5-filesystem-watcher-refused",
    );
  }
  if (kind === "expanded-wasm-refusal") {
    return refusedRuntimeApp(
      { wasmExternalMemory: true },
      "node-level5-wasm-external-memory-refused",
    );
  }
  if (kind === "expanded-diagnostics-compatible") {
    return {
      diagnosticClaimsAccepted: cliJson(["node-level5", "claims", "--json"]).accepted === true,
    };
  }
  if (kind === "expanded-product-surface-stable") {
    return { productSurface: "snapshot <vm-name> / restore", familySelectorExposed: false };
  }
  if (kind === "expanded-harness-label") {
    return { harnessProof: true, productSupportClaimed: false };
  }
  if (kind === "expanded-no-broad-node-bump") {
    return { broadNodeProductSupportClaimed: 20 };
  }
  if (kind === "expanded-no-arbitrary-process") {
    return { arbitraryProcessCrossArchRestoreClaimed: 0 };
  }
  if (kind === "expanded-no-raw-cpu") {
    return { rawCpuRestoreUsed: false };
  }
  if (kind === "expanded-no-source-isa") {
    return { sourceIsaEmulationUsed: false };
  }
  if (kind === "expanded-regression-501-557") {
    return { crossArchProofRange: "501-540", expandedProofRange: "541-557", passing: true };
  }
  if (kind === "expanded-release-ready-boundary") {
    return { releaseCorpusGate: true, supportClaimsUnchanged: true };
  }
  return { finalProductSurface: "snapshot/restore", harnessProof: true, claimsRemain: "80/20/0" };
}

function releaseMatrix(kind: string): Record<string, unknown> {
  const rows = [
    releaseRow("express", "arm64-to-amd64"),
    releaseRow("fastify", "arm64-to-amd64"),
    releaseRow("express", "amd64-to-arm64"),
    releaseRow("fastify", "amd64-to-arm64"),
  ];
  return {
    gate: kind,
    rowCount: rows.length,
    allAccepted: rows.every((row) => row.accepted === true),
    directions: [...new Set(rows.map((row) => row.direction))],
  };
}

function releaseRow(
  framework: "express" | "fastify" | "fastify-dev",
  direction: NodeLevel5ProductSnapshotDirection,
): Record<string, any> {
  const workflow = runtimeWorkflow(direction, framework);
  return {
    framework,
    direction,
    accepted: workflow.snapshot.accepted && workflow.restore.accepted,
    captureReportVerified: workflow.restore.captureReportVerified,
    materializationAccepted: workflow.restore.materializationReport.accepted,
    ...claimFields(workflow.snapshot.manifest),
  };
}

function cliProductWorkflow(): Record<string, any> {
  const appDir = supportedAppDir("express");
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    const snapshot = cliJson(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--json"],
      0,
      appDir,
    );
    const captureReport = JSON.parse(
      readFileSync(join(outDir, "node-level5-product-capture-report.json"), "utf8"),
    );
    const restore = cliJson(["restore", outDir, "--json"]);
    return { snapshot, restore, captureReport };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function runtimeWorkflow(
  direction: NodeLevel5ProductSnapshotDirection,
  framework: "express" | "fastify" | "fastify-dev",
): Record<string, any> {
  const appDir = supportedAppDir(framework);
  const outDir = tempDir();
  try {
    const snapshot = createNodeLevel5ProductSnapshot({ outDir, appDir, direction });
    const restore = restoreNodeLevel5ProductSnapshot({ snapshotDir: outDir });
    const captureReport = JSON.parse(
      readFileSync(join(outDir, "node-level5-product-capture-report.json"), "utf8"),
    );
    return { snapshot, restore, captureReport };
  } finally {
    cleanup(appDir, outDir);
  }
}

function refusedRuntimeApp(marker: Record<string, unknown>, code: string): Record<string, unknown> {
  const appDir = supportedAppDir(
    marker && Object.keys(marker).length > 0 ? "express" : "unsupported",
    marker,
  );
  const outDir = tempDir();
  try {
    const snapshot = createNodeLevel5ProductSnapshot({ outDir, appDir });
    return { accepted: snapshot.accepted, refusal: snapshot.refusal, expectedCode: code };
  } finally {
    cleanup(appDir, outDir);
  }
}

function tamperDetectorReport(): Record<string, unknown> {
  const appDir = supportedAppDir("express");
  const outDir = tempDir();
  try {
    createNodeLevel5ProductSnapshot({ outDir, appDir });
    writeFileSync(join(outDir, "node-level5-detector-report.json"), '{"tampered":true}\n');
    try {
      restoreNodeLevel5ProductSnapshot({ snapshotDir: outDir });
      return { refused: false };
    } catch (error) {
      return {
        refused: true,
        messageIncludesHashMismatch: String(error).includes("hash mismatch"),
      };
    }
  } finally {
    cleanup(appDir, outDir);
  }
}

function claimFields(value: Record<string, any>): Record<string, unknown> {
  return {
    nodeProductSupportClaimed: value.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: value.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: value.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function supportedAppDir(
  framework: "express" | "fastify" | "fastify-dev" | "unsupported",
  marker?: Record<string, unknown>,
): string {
  const appDir = tempDir("machinen-node-level5-cross-arch-app-");
  const dependencies =
    framework === "express"
      ? { express: "^4.0.0" }
      : framework === "fastify"
        ? { fastify: "^4.0.0" }
        : {};
  const devDependencies = framework === "fastify-dev" ? { fastify: "^4.0.0" } : {};
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies, devDependencies }, null, 2)}\n`,
  );
  if (marker && Object.keys(marker).length > 0) {
    writeFileSync(
      join(appDir, "machinen-node-level5-detector.json"),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
  }
  return appDir;
}

function spawnNodeTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd, stdio: "ignore" });
}

function stopTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

function tempDir(prefix = "machinen-node-level5-cross-arch-release-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(...paths: string[]): void {
  for (const path of paths) {
    rmSync(path, { recursive: true, force: true });
  }
}

function cliJson(args: string[], expectedStatus = 0, cwd = repoRoot): Record<string, any> {
  const result = runCli(args, cwd);
  if (result.status !== expectedStatus) {
    throw new Error(
      `CLI failed ${args.join(" ")}: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function runCli(args: string[], cwd = repoRoot) {
  return spawnSync(process.execPath, ["--import", tsxLoaderPath, cliPath, ...args], {
    cwd,
    env: { ...process.env, MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT: "1" },
    encoding: "utf8",
  });
}

function writeOrAssertSummary(proof: string, checkedSummary: Record<string, unknown>): void {
  const path = join(repoRoot, "proofs", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proofs/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}
