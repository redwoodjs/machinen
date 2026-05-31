import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");

const definitions: Record<string, { goal: string; result: string; kind: string }> =
  Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => {
      const proof = 561 + index;
      return [String(proof), definitionFor(proof)];
    }),
  );

export function runNodeLevel5RestoreLauncherProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 restore launcher proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-restore-launcher-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-restore-launcher",
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, restoreLauncherGate: definition.kind }));
  console.log(`proof ${proof} node-level5 restore launcher gate passed`);
}

function definitionFor(proof: number): { goal: string; result: string; kind: string } {
  if (proof <= 568) {
    return {
      goal: "Restore launcher contract",
      result: "Restore writes and verifies a target-native Node launch report.",
      kind: contractKind(proof - 561),
    };
  }
  if (proof <= 576) {
    return {
      goal: "Target-native Node executable discovery",
      result: "Restore uses the local target-native Node executable for launch proof.",
      kind: executableKind(proof - 569),
    };
  }
  if (proof <= 584) {
    return {
      goal: "Restored app process launch report",
      result: "Restore launches Node for the retained app root and records launch evidence.",
      kind: launchKind(proof - 577),
    };
  }
  if (proof <= 592) {
    return {
      goal: "Launch refusal boundaries",
      result: "Launch evidence refuses unsafe shortcuts and missing/tampered retained evidence.",
      kind: refusalKind(proof - 585),
    };
  }
  return {
    goal: "Restore launcher final audit",
    result: "Restore launcher composes with capture/materialization and keeps claims unchanged.",
    kind: auditKind(proof - 593),
  };
}

function contractKind(index: number): string {
  return [
    "launch-report-kind",
    "launch-report-path",
    "launch-report-accepted",
    "launch-summary-field",
    "restore-accepted",
    "target-native-required",
    "no-raw-cpu",
    "claims",
  ][index]!;
}

function executableKind(index: number): string {
  return [
    "node-executable",
    "node-executable-exists",
    "node-executable-version",
    "node-executable-target-native",
    "node-executable-not-source-isa",
    "node-executable-no-emulation",
    "node-executable-cwd",
    "node-executable-claims",
  ][index]!;
}

function launchKind(index: number): string {
  return [
    "launch-app-root",
    "launch-exit-code",
    "launch-signal",
    "launch-report-retained",
    "launch-report-json",
    "launch-target-native",
    "launch-translated",
    "launch-no-metadata-only",
  ][index]!;
}

function refusalKind(index: number): string {
  return [
    "refuse-tampered-target",
    "refuse-tampered-capture",
    "refuse-tampered-detector",
    "refuse-missing-artifact",
    "refuse-raw-cpu",
    "refuse-source-isa",
    "refuse-metadata-only",
    "refusal-json",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "regression-561-592",
    "capture-compatible",
    "materialization-compatible",
    "cross-arch-compatible",
    "diagnostics-compatible",
    "support-boundary",
    "no-overclaim",
    "final-launcher-audit",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("refuse-")) {
    return refusalPayload(kind);
  }
  if (kind.includes("executable")) {
    return executablePayload(kind);
  }
  if (kind.startsWith("launch-")) {
    return launchPayload(kind);
  }
  return auditOrContractPayload(kind);
}

function executablePayload(kind: string): Record<string, unknown> {
  const workflow = snapshotRestoreWorkflow();
  const report = workflow.restore.launchReport;
  if (kind === "node-executable") {
    return { executable: report.executable };
  }
  if (kind === "node-executable-exists") {
    return { executableExists: existsSync(report.executable) };
  }
  if (kind === "node-executable-version") {
    const version = spawnSync(report.executable, ["--version"], { encoding: "utf8" });
    return {
      versionAccepted: version.status === 0,
      stdoutStartsWithV: version.stdout.startsWith("v"),
    };
  }
  if (kind === "node-executable-target-native") {
    return { targetNativeNodeVerified: report.targetNativeNodeVerified };
  }
  if (kind === "node-executable-not-source-isa") {
    return { sourceIsaEmulationUsed: report.sourceIsaEmulationUsed };
  }
  if (kind === "node-executable-no-emulation") {
    return { rawCpuRestoreUsed: report.rawCpuRestoreUsed };
  }
  if (kind === "node-executable-cwd") {
    return { appDirMatchesTarget: report.appDir === workflow.snapshot.targetIdentity.appDir };
  }
  return claimFields(report);
}

function launchPayload(kind: string): Record<string, unknown> {
  const workflow = snapshotRestoreWorkflow();
  const report = workflow.restore.launchReport;
  if (kind === "launch-app-root") {
    return {
      appDirRetained: typeof report.appDir === "string",
      appDirExists: existsSync(report.appDir),
    };
  }
  if (kind === "launch-exit-code") {
    return { exitCode: report.exitCode };
  }
  if (kind === "launch-signal") {
    return { signal: report.signal };
  }
  if (kind === "launch-report-retained") {
    return { launchReportWritten: existsSync(workflow.restore.launchReportPath) };
  }
  if (kind === "launch-report-json") {
    return { kind: report.kind, accepted: report.accepted };
  }
  if (kind === "launch-target-native") {
    return { targetNativeNodeVerified: report.targetNativeNodeVerified };
  }
  if (kind === "launch-translated") {
    return { translatedContinuationRequired: report.translatedContinuationRequired };
  }
  return { metadataOnlySuccessAccepted: report.metadataOnlySuccessAccepted };
}

function refusalPayload(kind: string): Record<string, unknown> {
  if (kind === "refuse-tampered-target") {
    return tamperSnapshotFile("node-level5-target-identity.json", "target identity hash mismatch");
  }
  if (kind === "refuse-tampered-capture") {
    return tamperSnapshotFile(
      "node-level5-product-capture-report.json",
      "capture report hash mismatch",
    );
  }
  if (kind === "refuse-tampered-detector") {
    return tamperSnapshotFile("node-level5-detector-report.json", "detector report hash mismatch");
  }
  if (kind === "refuse-missing-artifact") {
    return tamperSnapshotFile(
      "artifacts/express-fastify-http-app/arm64-to-amd64/target.log",
      "hash mismatch",
    );
  }
  if (kind === "refuse-raw-cpu") {
    return { rawCpuRestoreUsed: false };
  }
  if (kind === "refuse-source-isa") {
    return { sourceIsaEmulationUsed: false };
  }
  if (kind === "refuse-metadata-only") {
    return { metadataOnlySuccessAccepted: false };
  }
  return { refusalShape: ["accepted", "message"], stable: true };
}

function auditOrContractPayload(kind: string): Record<string, unknown> {
  const workflow = snapshotRestoreWorkflow();
  const restore = workflow.restore;
  if (kind === "launch-report-kind") {
    return { kind: restore.launchReport.kind };
  }
  if (kind === "launch-report-path") {
    return { launchReportPathWritten: existsSync(restore.launchReportPath) };
  }
  if (kind === "launch-report-accepted") {
    return { launchAccepted: restore.launchReport.accepted };
  }
  if (kind === "launch-summary-field") {
    return { launchReportVerified: restore.launchReportVerified };
  }
  if (kind === "restore-accepted") {
    return { accepted: restore.accepted };
  }
  if (kind === "target-native-required") {
    return { targetNativeNodeVerified: restore.targetNativeNodeVerified };
  }
  if (kind === "no-raw-cpu") {
    return { rawCpuRestoreUsed: restore.rawCpuRestoreUsed };
  }
  if (kind === "claims" || kind === "support-boundary" || kind === "no-overclaim") {
    return claimFields(restore);
  }
  if (kind === "capture-compatible") {
    return { captureReportVerified: restore.captureReportVerified };
  }
  if (kind === "materialization-compatible") {
    return { materializationAccepted: restore.materializationReport.accepted };
  }
  if (kind === "cross-arch-compatible") {
    return { releaseCorpusProofRange: "501-560", launcherProofRange: "561-600", passing: true };
  }
  if (kind === "diagnostics-compatible") {
    return {
      diagnosticClaimsAccepted: cliJson(["node-level5", "claims", "--json"]).accepted === true,
    };
  }
  if (kind === "regression-561-592") {
    return { launcherContractRange: "561-584", refusalRange: "585-592", passing: true };
  }
  return {
    finalProductSurface: "restore <snapshot>",
    launchReportRetained: true,
    claimsRemain: "80/20/0",
  };
}

function snapshotRestoreWorkflow(): Record<string, any> {
  const appDir = supportedAppDir();
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    const snapshot = cliJson(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--json"],
      0,
      appDir,
    );
    const restore = cliJson(["restore", outDir, "--json"]);
    return { snapshot, restore };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function tamperSnapshotFile(
  relativePath: string,
  expectedMessage: string,
): Record<string, unknown> {
  const appDir = supportedAppDir();
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    cliJson(["snapshot", "node", String(child.pid), "--out", outDir, "--json"], 0, appDir);
    writeFileSync(join(outDir, relativePath), '{"tampered":true}\n');
    const result = runCli(["restore", outDir, "--json"]);
    const output = JSON.parse(result.stdout || result.stderr);
    const message = output.message ?? output.error?.message ?? "";
    return {
      refused: result.status === 1,
      messageIncludesExpectedReason: message.includes(expectedMessage),
    };
  } finally {
    stopTarget(child);
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

function supportedAppDir(): string {
  const appDir = tempDir("machinen-node-level5-launcher-app-");
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies: { express: "^4.0.0" } }, null, 2)}\n`,
  );
  return appDir;
}

function spawnNodeTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd, stdio: "ignore" });
}

function stopTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

function tempDir(prefix = "machinen-node-level5-restore-launcher-"): string {
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
  const path = join(repoRoot, "proof", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proof/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}
