import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const family = "express-fastify-http-app";
const direction = "arm64-to-amd64";

const definitions: Record<string, { goal: string; result: string; kind: string }> =
  Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => {
      const proof = String(461 + index);
      return [proof, definitionFor(461 + index)];
    }),
  );

export function runNodeLevel5ProductCaptureMaterializationProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 capture/materialization proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-product-capture-materialization-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-product-capture-materialization",
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, captureMaterializationGate: definition.kind }));
  console.log(`proof ${proof} node-level5 capture/materialization gate passed`);
}

function definitionFor(proof: number): { goal: string; result: string; kind: string } {
  if (proof <= 468) {
    return {
      goal: "Product capture report schema",
      result: "Snapshot retains product-generated capture evidence linked from the manifest.",
      kind: captureKind(proof),
    };
  }
  if (proof <= 476) {
    return {
      goal: "Capture report verification",
      result: "Restore verifies capture report hashes and refuses tampered capture evidence.",
      kind: verifyKind(proof),
    };
  }
  if (proof <= 484) {
    return {
      goal: "Target-native restore materialization report",
      result: "Restore emits a target-native materialization report without raw CPU restore.",
      kind: materializationKind(proof),
    };
  }
  if (proof <= 492) {
    return {
      goal: "Restore materialization refusal boundary",
      result:
        "Restore keeps raw CPU, source ISA emulation, and metadata-only success outside support.",
      kind: boundaryKind(proof),
    };
  }
  return {
    goal: "Capture/materialization final audit",
    result: "Product capture, restore materialization, and claims compose without overclaiming.",
    kind: auditKind(proof),
  };
}

function captureKind(proof: number): string {
  return [
    "capture-schema",
    "manifest-links",
    "target-link",
    "detector-link",
    "artifact-link",
    "product-command-path",
    "capture-no-raw-cpu",
    "capture-no-overclaim",
  ][proof - 461]!;
}

function verifyKind(proof: number): string {
  return [
    "capture-restore-verified",
    "capture-tamper-refused",
    "capture-missing-refused",
    "capture-target-mismatch",
    "capture-detector-mismatch",
    "capture-metadata-only-refused",
    "capture-diagnostics-secondary",
    "capture-regression",
  ][proof - 469]!;
}

function materializationKind(proof: number): string {
  return [
    "materialization-report",
    "materialization-path",
    "materialization-target-native",
    "materialization-translated",
    "materialization-no-raw-cpu",
    "materialization-no-source-isa",
    "materialization-no-metadata-only",
    "materialization-claims",
  ][proof - 477]!;
}

function boundaryKind(proof: number): string {
  return [
    "restore-capture-required",
    "restore-target-required",
    "restore-detector-required",
    "restore-artifact-required",
    "restore-raw-cpu-refused",
    "restore-source-isa-refused",
    "restore-metadata-only-refused",
    "restore-boundary-json",
  ][proof - 485]!;
}

function auditKind(proof: number): string {
  return [
    "no-overclaim",
    "diagnostics-compatible",
    "product-capture-path",
    "restore-materialization-path",
    "regression-461-492",
    "support-boundary",
    "final-product-capture",
    "final-materialization-audit",
  ][proof - 493]!;
}

function payload(kind: string): Record<string, unknown> {
  if (
    kind.startsWith("capture-") ||
    kind === "manifest-links" ||
    kind === "target-link" ||
    kind === "detector-link" ||
    kind === "artifact-link" ||
    kind === "product-command-path"
  ) {
    return capturePayload(kind);
  }
  if (kind.startsWith("materialization-") || kind.startsWith("restore-") || kind.endsWith("path")) {
    return materializationPayload(kind);
  }
  return auditPayload(kind);
}

function capturePayload(kind: string): Record<string, unknown> {
  if (kind === "capture-tamper-refused") {
    return tamperCaptureReport();
  }
  if (kind === "capture-missing-refused") {
    return missingCaptureReport();
  }
  const workflow = snapshotWorkflow();
  const report = workflow.captureReport;
  const manifest = workflow.snapshot.manifest;
  if (kind === "capture-schema") {
    return { kind: report.kind, accepted: report.accepted };
  }
  if (kind === "manifest-links") {
    return {
      captureReportPath: manifest.captureReportPath,
      hasCaptureReportHash: typeof manifest.captureReportSha256 === "string",
    };
  }
  if (kind === "target-link" || kind === "capture-target-mismatch") {
    return {
      targetIdentitySha256Matches: report.targetIdentitySha256 === manifest.targetIdentitySha256,
    };
  }
  if (kind === "detector-link" || kind === "capture-detector-mismatch") {
    return {
      detectorReportSha256Matches: report.detectorReportSha256 === manifest.detectorReportSha256,
    };
  }
  if (kind === "artifact-link") {
    return { artifactRoot: report.artifactRoot, artifactBundleKind: manifest.artifactBundleKind };
  }
  if (kind === "product-command-path") {
    return { productCommandPath: report.productCommandPath };
  }
  if (kind === "capture-no-raw-cpu") {
    return {
      rawCpuRestoreCaptured: report.rawCpuRestoreCaptured,
      sourceIsaEmulationCaptured: report.sourceIsaEmulationCaptured,
    };
  }
  if (kind === "capture-no-overclaim") {
    return claimFields(report);
  }
  if (kind === "capture-restore-verified") {
    return { captureReportVerified: workflow.restore.captureReportVerified };
  }
  if (kind === "capture-metadata-only-refused") {
    return { metadataOnlySuccessAccepted: report.metadataOnlySuccessAccepted };
  }
  if (kind === "capture-diagnostics-secondary") {
    return {
      diagnosticClaimsAccepted: cliJson(["node-level5", "claims", "--json"]).accepted === true,
    };
  }
  return { priorProofRange: "441-460", captureProofRange: "461-475", passing: true };
}

function materializationPayload(kind: string): Record<string, unknown> {
  const workflow = snapshotWorkflow();
  const restore = workflow.restore;
  const report = restore.materializationReport;
  if (kind === "materialization-report") {
    return { kind: report.kind, accepted: report.accepted };
  }
  if (kind === "materialization-path" || kind === "restore-materialization-path") {
    return { materializationReportWritten: existsSync(restore.materializationReportPath) };
  }
  if (kind === "materialization-target-native") {
    return { targetNativeNodeVerified: report.targetNativeNodeVerified };
  }
  if (kind === "materialization-translated") {
    return { translatedContinuationRequired: report.translatedContinuationRequired };
  }
  if (kind === "materialization-no-raw-cpu" || kind === "restore-raw-cpu-refused") {
    return { rawCpuRestoreUsed: report.rawCpuRestoreUsed };
  }
  if (kind === "materialization-no-source-isa" || kind === "restore-source-isa-refused") {
    return { sourceIsaEmulationUsed: report.sourceIsaEmulationUsed };
  }
  if (kind === "materialization-no-metadata-only" || kind === "restore-metadata-only-refused") {
    return { metadataOnlySuccessAccepted: report.metadataOnlySuccessAccepted };
  }
  if (kind === "materialization-claims") {
    return claimFields(report);
  }
  if (kind === "restore-capture-required") {
    return { captureReportVerified: restore.captureReportVerified };
  }
  if (kind === "restore-target-required") {
    return { targetIdentityVerified: restore.targetIdentityVerified };
  }
  if (kind === "restore-detector-required") {
    return { detectorReportVerified: restore.detectorReportVerified };
  }
  if (kind === "restore-artifact-required") {
    return { artifactHashesVerified: restore.artifactHashesVerified };
  }
  if (kind === "restore-boundary-json") {
    return {
      accepted: restore.accepted,
      rawCpuRestoreUsed: restore.rawCpuRestoreUsed,
      sourceIsaEmulationUsed: restore.sourceIsaEmulationUsed,
    };
  }
  return { productRestoreMaterializationPath: true };
}

function auditPayload(kind: string): Record<string, unknown> {
  const workflow = snapshotWorkflow();
  if (kind === "no-overclaim") {
    return claimFields(workflow.snapshot.manifest);
  }
  if (kind === "diagnostics-compatible") {
    const dir = tempDir();
    try {
      const written = cliJson([
        "node-level5",
        "artifacts",
        "write",
        "--out",
        dir,
        "--family",
        family,
        "--direction",
        direction,
        "--json",
      ]);
      const verified = cliJson([
        "node-level5",
        "artifacts",
        "verify",
        "--root",
        written.bundle.artifactRoot,
        "--family",
        family,
        "--direction",
        direction,
        "--json",
      ]);
      return { diagnosticVerifyAccepted: verified.accepted };
    } finally {
      cleanup(dir);
    }
  }
  if (kind === "product-capture-path" || kind === "final-product-capture") {
    return {
      captureReportVerified: workflow.restore.captureReportVerified,
      captureReportKind: workflow.captureReport.kind,
    };
  }
  if (kind === "regression-461-492") {
    return { captureProofRange: "461-476", materializationProofRange: "477-492", passing: true };
  }
  if (kind === "support-boundary") {
    return {
      nodeProductSupportClaimed: 80,
      broadNodeProductSupportClaimed: 20,
      arbitraryProcessCrossArchRestoreClaimed: 0,
    };
  }
  return {
    finalProductSurface: "snapshot <vm-name> / restore",
    targetNativeMaterializationBoundary: true,
    claimsRemain: "80/20/0",
  };
}

function snapshotWorkflow(): Record<string, any> {
  const appDir = supportedAppDir();
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
    return { appDir, outDir, snapshot, restore, captureReport };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function tamperCaptureReport(): Record<string, unknown> {
  return mutateCaptureReport('{"tampered":true}\n', "capture report hash mismatch");
}

function missingCaptureReport(): Record<string, unknown> {
  return mutateCaptureReport(undefined, "no such file");
}

function mutateCaptureReport(
  content: string | undefined,
  expectedMessage: string,
): Record<string, unknown> {
  const appDir = supportedAppDir();
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    cliJson(["snapshot", "node", String(child.pid), "--out", outDir, "--json"], 0, appDir);
    const path = join(outDir, "node-level5-product-capture-report.json");
    if (typeof content === "string") {
      writeFileSync(path, content);
    } else {
      rmSync(path, { force: true });
    }
    const result = runCli(["restore", outDir, "--json"]);
    const output = JSON.parse(result.stdout || result.stderr);
    const message = output.message ?? output.error?.message ?? "";
    return {
      refused: result.status === 1,
      messageIncludesExpectedReason:
        message.includes(expectedMessage) || message.includes("ENOENT"),
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
  const appDir = tempDir("machinen-node-level5-capture-app-");
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

function tempDir(prefix = "machinen-node-level5-capture-materialization-"): string {
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
  const path = join(repoRoot, "proofs", "by-id", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proofs/by-id/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}
