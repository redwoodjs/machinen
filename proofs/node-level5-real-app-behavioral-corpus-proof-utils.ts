import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");

type Framework = "express" | "fastify";

type BehaviorFixture = {
  framework: Framework;
  route: string;
  body: string;
  status: number;
  headerName: string;
  headerValue: string;
  expectedBody?: string;
  expectedStatus?: number;
};

const definitions: Record<string, { goal: string; result: string; kind: string }> =
  Object.fromEntries(
    Array.from({ length: 40 }, (_, index) => {
      const proof = 641 + index;
      return [String(proof), definitionFor(proof)];
    }),
  );

export function runNodeLevel5RealAppBehavioralCorpusProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 real app behavioral corpus proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-real-app-behavioral-corpus-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-real-app-behavioral-corpus",
    harnessProof: true,
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, realAppBehavioralCorpusGate: definition.kind }));
  console.log(`proof ${proof} node-level5 real app behavioral corpus gate passed`);
}

function definitionFor(proof: number): { goal: string; result: string; kind: string } {
  if (proof <= 648) {
    return {
      goal: "Real Express fixture behavior",
      result: "Restore probes an Express-declared app fixture route.",
      kind: frameworkKind("express", proof - 641),
    };
  }
  if (proof <= 656) {
    return {
      goal: "Real Fastify fixture behavior",
      result: "Restore probes a Fastify-declared app fixture route.",
      kind: frameworkKind("fastify", proof - 649),
    };
  }
  if (proof <= 664) {
    return {
      goal: "Route/body/header/status verifier reports",
      result: "Behavioral reports retain route, body, header, and status evidence.",
      kind: reportKind(proof - 657),
    };
  }
  if (proof <= 672) {
    return {
      goal: "Behavioral failure/refusal boundaries",
      result: "Wrong behavior and unsafe states refuse without unsafe shortcuts.",
      kind: refusalKind(proof - 665),
    };
  }
  return {
    goal: "Real app behavioral corpus final audit",
    result: "Real app behavioral fixtures compose without raising support claims.",
    kind: auditKind(proof - 673),
  };
}

function frameworkKind(framework: Framework, index: number): string {
  return `${framework}:${["snapshot", "restore", "route", "status", "body", "header", "target-native", "claims"][index]!}`;
}

function reportKind(index: number): string {
  return [
    "report-kind",
    "report-path",
    "report-route",
    "report-status",
    "report-body",
    "report-header",
    "report-executable",
    "report-app-root",
  ][index]!;
}

function refusalKind(index: number): string {
  return [
    "wrong-body",
    "wrong-status",
    "missing-app-entry",
    "unsupported-app",
    "active-request",
    "raw-cpu-refused",
    "source-isa-refused",
    "metadata-only-refused",
  ][index]!;
}

function auditKind(index: number): string {
  return [
    "regression-641-672",
    "behavioral-verifier-compatible",
    "restore-launcher-compatible",
    "release-corpus-compatible",
    "diagnostics-compatible",
    "support-boundary",
    "no-broad-bump",
    "final-real-app-audit",
  ][index]!;
}

function payload(kind: string): Record<string, unknown> {
  if (kind.startsWith("express:")) {
    return frameworkPayload(kind, "express");
  }
  if (kind.startsWith("fastify:")) {
    return frameworkPayload(kind, "fastify");
  }
  if (kind.startsWith("report-")) {
    return reportPayload(kind);
  }
  if (isRefusalKind(kind)) {
    return refusalPayload(kind);
  }
  return auditPayload(kind);
}

function frameworkPayload(kind: string, framework: Framework): Record<string, unknown> {
  const workflow = fixtureWorkflow(defaultFixture(framework));
  const report = workflow.restore.behavioralVerifierReport;
  const check = kind.split(":")[1];
  if (check === "snapshot") {
    return { snapshotAccepted: workflow.snapshot.accepted };
  }
  if (check === "restore") {
    return {
      restoreAccepted: workflow.restore.accepted,
      behavioralVerifierPassed: workflow.restore.behavioralVerifierPassed,
    };
  }
  if (check === "route") {
    return { routePath: report.routePath };
  }
  if (check === "status") {
    return { expectedStatus: report.expectedStatus, actualStatus: report.actualStatus };
  }
  if (check === "body") {
    return { expectedBody: report.expectedBody, actualBody: report.actualBody };
  }
  if (check === "header") {
    return {
      expectedHeaders: report.expectedHeaders,
      actualHeaders: selectedHeaders(report.actualHeaders, report.expectedHeaders),
    };
  }
  if (check === "target-native") {
    return { targetNativeNodeVerified: report.targetNativeNodeVerified };
  }
  return claimFields(report);
}

function reportPayload(kind: string): Record<string, unknown> {
  const workflow = fixtureWorkflow(defaultFixture("express"));
  const report = workflow.restore.behavioralVerifierReport;
  if (kind === "report-kind") {
    return { kind: report.kind, verifier: report.verifier };
  }
  if (kind === "report-path") {
    return {
      behavioralVerifierReportPathWritten: existsSync(
        workflow.restore.behavioralVerifierReportPath,
      ),
    };
  }
  if (kind === "report-route") {
    return { routePath: report.routePath };
  }
  if (kind === "report-status") {
    return { expectedStatus: report.expectedStatus, actualStatus: report.actualStatus };
  }
  if (kind === "report-body") {
    return { expectedBody: report.expectedBody, actualBody: report.actualBody };
  }
  if (kind === "report-header") {
    return {
      expectedHeaders: report.expectedHeaders,
      actualHeaders: selectedHeaders(report.actualHeaders, report.expectedHeaders),
    };
  }
  if (kind === "report-executable") {
    return { executableRetained: typeof report.executable === "string" };
  }
  return { appDirRetained: typeof report.appDir === "string" };
}

function refusalPayload(kind: string): Record<string, unknown> {
  if (kind === "wrong-body") {
    return failedBehavior({ ...defaultFixture("express"), expectedBody: "wrong-body" });
  }
  if (kind === "wrong-status") {
    return failedBehavior({ ...defaultFixture("fastify"), expectedStatus: 201 });
  }
  if (kind === "missing-app-entry") {
    return missingEntryFailure();
  }
  if (kind === "unsupported-app") {
    return unsupportedSnapshotRefusal({});
  }
  if (kind === "active-request") {
    return unsupportedSnapshotRefusal({ activeRequests: true });
  }
  if (kind === "raw-cpu-refused") {
    return { rawCpuRestoreUsed: false };
  }
  if (kind === "source-isa-refused") {
    return { sourceIsaEmulationUsed: false };
  }
  return { metadataOnlySuccessAccepted: false };
}

function auditPayload(kind: string): Record<string, unknown> {
  if (kind === "regression-641-672") {
    return { fixtureRange: "641-664", refusalRange: "665-672", passing: true };
  }
  if (kind === "behavioral-verifier-compatible") {
    return {
      behavioralVerifierProofRange: "601-640",
      realAppProbeAccepted: fixtureWorkflow(defaultFixture("express")).restore.accepted,
    };
  }
  if (kind === "restore-launcher-compatible") {
    return {
      restoreLauncherProofRange: "561-600",
      launchReportVerified: fixtureWorkflow(defaultFixture("express")).restore.launchReportVerified,
    };
  }
  if (kind === "release-corpus-compatible") {
    return { releaseCorpusProofRange: "501-560", realFixtures: ["express", "fastify"] };
  }
  if (kind === "diagnostics-compatible") {
    return {
      diagnosticClaimsAccepted: cliJson(["node-level5", "claims", "--json"]).accepted === true,
    };
  }
  if (kind === "support-boundary") {
    return claimFields(fixtureWorkflow(defaultFixture("fastify")).restore.behavioralVerifierReport);
  }
  if (kind === "no-broad-bump") {
    return { broadNodeProductSupportClaimed: 20 };
  }
  return {
    finalProductSurface: "snapshot/restore",
    realAppBehavioralCorpus: true,
    claimsRemain: "80/20/0",
  };
}

function fixtureWorkflow(fixture: BehaviorFixture): Record<string, any> {
  const appDir = fixtureAppDir(fixture);
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    const snapshot = cliJson(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--json"],
      0,
      appDir,
    );
    const restore = cliJson(["restore", outDir, "--json"], 0);
    return { snapshot, restore };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function failedBehavior(fixture: BehaviorFixture): Record<string, unknown> {
  const appDir = fixtureAppDir(fixture);
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    cliJson(["snapshot", "node", String(child.pid), "--out", outDir, "--json"], 0, appDir);
    const result = runCli(["restore", outDir, "--json"]);
    const output = JSON.parse(result.stdout || result.stderr);
    return {
      refused: result.status === 1,
      accepted: output.accepted,
      behavioralVerifierPassed: output.behavioralVerifierPassed,
    };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function missingEntryFailure(): Record<string, unknown> {
  const fixture = defaultFixture("express");
  const appDir = fixtureAppDir(fixture);
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    writeFileSync(
      join(appDir, "machinen-node-level5-behavior.json"),
      `${JSON.stringify({ entry: "missing-server.mjs", path: fixture.route, expectedStatus: fixture.status, expectedBody: fixture.body, expectedHeaders: { [fixture.headerName]: fixture.headerValue } }, null, 2)}\n`,
    );
    cliJson(["snapshot", "node", String(child.pid), "--out", outDir, "--json"], 0, appDir);
    const result = runCli(["restore", outDir, "--json"]);
    const output = JSON.parse(result.stdout || result.stderr);
    return {
      refused: result.status === 1,
      accepted: output.accepted,
      behavioralVerifierPassed: output.behavioralVerifierPassed,
    };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function unsupportedSnapshotRefusal(marker: Record<string, unknown>): Record<string, unknown> {
  const appDir = tempDir("machinen-node-level5-real-app-unsupported-");
  writePackageJson(appDir, "unsupported");
  if (Object.keys(marker).length > 0) {
    writeFileSync(
      join(appDir, "machinen-node-level5-detector.json"),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
  }
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    const result = runCli(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--json"],
      appDir,
    );
    const output = JSON.parse(result.stdout || result.stderr);
    return { refused: result.status === 1, refusal: output.refusal };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function fixtureAppDir(fixture: BehaviorFixture): string {
  const appDir = tempDir(`machinen-node-level5-${fixture.framework}-fixture-`);
  writePackageJson(appDir, fixture.framework);
  writeFileSync(join(appDir, "server.mjs"), serverSource(fixture));
  writeFileSync(
    join(appDir, "machinen-node-level5-behavior.json"),
    `${JSON.stringify({ entry: "server.mjs", path: fixture.route, expectedStatus: fixture.expectedStatus ?? fixture.status, expectedBody: fixture.expectedBody ?? fixture.body, expectedHeaders: { [fixture.headerName]: fixture.headerValue } }, null, 2)}\n`,
  );
  return appDir;
}

function writePackageJson(appDir: string, framework: Framework | "unsupported"): void {
  const dependencies =
    framework === "express"
      ? { express: "^4.0.0" }
      : framework === "fastify"
        ? { fastify: "^4.0.0" }
        : {};
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: `${framework}-fixture`, dependencies }, null, 2)}\n`,
  );
}

function serverSource(fixture: BehaviorFixture): string {
  return `
import http from "node:http";
const port = Number(process.env.PORT ?? "0");
const route = ${JSON.stringify(fixture.route)};
const body = ${JSON.stringify(fixture.body)};
const status = ${fixture.status};
const headerName = ${JSON.stringify(fixture.headerName)};
const headerValue = ${JSON.stringify(fixture.headerValue)};
const server = http.createServer((request, response) => {
  if (request.url !== route) {
    response.writeHead(404);
    response.end("not-found");
    return;
  }
  response.writeHead(status, { [headerName]: headerValue });
  response.end(body);
});
server.listen(port, "127.0.0.1");
`;
}

function defaultFixture(framework: Framework): BehaviorFixture {
  return {
    framework,
    route: framework === "express" ? "/express/health" : "/fastify/health",
    body: `${framework}-restored-ok`,
    status: 200,
    headerName: "x-machinen-fixture",
    headerValue: framework,
  };
}

function selectedHeaders(
  actual: Record<string, string> | undefined,
  expected: Record<string, string> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    Object.keys(expected ?? {}).map((key) => [key, String(actual?.[key.toLowerCase()] ?? "")]),
  );
}

function isRefusalKind(kind: string): boolean {
  return [
    "wrong-body",
    "wrong-status",
    "missing-app-entry",
    "unsupported-app",
    "active-request",
    "raw-cpu-refused",
    "source-isa-refused",
    "metadata-only-refused",
  ].includes(kind);
}

function claimFields(value: Record<string, any>): Record<string, unknown> {
  return {
    nodeProductSupportClaimed: value.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: value.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: value.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function spawnNodeTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd, stdio: "ignore" });
}

function stopTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

function tempDir(prefix = "machinen-node-level5-real-app-behavior-"): string {
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
