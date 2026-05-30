#!/usr/bin/env tsx
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(proofDir, "../..");
const cli = join(root, "packages/cli/dist/cli.js");
const work =
  process.env.WORK_DIR ??
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-timer."));
const runId = String(process.pid);
const sourceName = `node-proper-level5-timer-source-${runId}`;
const targetName = `node-proper-level5-timer-target-${runId}`;
const sourceTimerMin = 3;

process.env.MACHINEN_ASSETS_DIR ??= join(root, "release-assets");
process.env.MACHINEN_REGISTRY_DIR = join(work, "registry");
mkdirSync(work, { recursive: true });

const sourceAppPath = join(proofDir, "source-app.mjs");
const captureProgramPath = join(proofDir, "capture.pl");
const targetLoaderPath = join(proofDir, "target-loader.mjs");
interface CountResponse {
  count: number;
}

interface TimerResponse {
  timerTicks: number;
}

interface SmokeSummary {
  captured?: {
    procMaps?: boolean;
    fdTable?: boolean;
    auxvEnvCmdline?: boolean;
    memoryBytesForAcceptedMappings?: number;
  };
  classification?: {
    acceptedForFirstProof?: boolean;
    failures?: Array<{ code?: string }>;
  };
  externalQuiesce?: { appHookUsed?: boolean; checkpointApiUsed?: boolean };
  portableIr?: { kind?: string; timerDescriptors?: unknown[] };
  runtimeStateCandidates?: {
    nodeBinaryMappings?: unknown[];
    v8HeapPageCandidates?: unknown[];
    jsCounterClosureGlobalObjectCandidates?: unknown[];
    tcpServerHandleCandidates?: unknown[];
    libuvTimerHandleCandidates?: unknown[];
  };
}

interface MaterializationProof {
  targetNativeNodeStarted?: boolean;
  targetNativeObjectsMaterialized?: boolean;
  eventLoopEntered?: boolean;
  recoveredCounterFromMemory?: { value?: number; recoveryMode?: string };
  recoveredTimerFromMemory?: { value?: number };
  recoveredFromPriorResponseString?: boolean;
  rawV8ContextSmiDecoded?: boolean;
  timerMaterialized?: boolean;
  selectedStateCounterDescriptorUsed?: boolean;
  appExportImportUsed?: boolean;
  sourceIsaEmulationUsed?: boolean;
  sidecarOutputUsed?: boolean;
  metadataOnlySuccess?: boolean;
}

function runCli(args: string[], stdio: "inherit" | "ignore" = "inherit"): void {
  execFileSync(process.execPath, [cli, ...args], { cwd: root, env: process.env, stdio });
}

function outputCli(args: string[]): string {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: process.env,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function execInVm(name: string, command: string): string {
  return outputCli(["exec", name, "--", command]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseJson<T>(body: string): T {
  return JSON.parse(body) as T;
}

function assertCount(body: string, expected: number): void {
  const parsed = parseJson<CountResponse>(body);
  if (parsed.count !== expected) {
    throw new Error(`expected count ${expected}, got ${body}`);
  }
}

function assertTimerAtLeast(body: string, expectedMin: number): void {
  const parsed = parseJson<TimerResponse>(body);
  if (parsed.timerTicks < expectedMin) {
    throw new Error(`expected timerTicks >= ${expectedMin}, got ${body}`);
  }
}

function curl(vmName: string, path: string): string {
  return execInVm(vmName, `curl -fsS http://127.0.0.1:3000${path}`).replace(/\r/g, "").trim();
}

async function pollCurl(
  vmName: string,
  path: string,
  attempts: number,
  delayMs: number,
): Promise<string> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const body = curl(vmName, path);
      if (body.length > 0) {
        return body;
      }
    } catch {
      // Service not ready yet.
    }
    await sleep(delayMs);
  }
  throw new Error(`timed out waiting for ${vmName} ${path}`);
}

function stopVm(name: string): void {
  try {
    runCli(["stop", name], "ignore");
  } catch {
    // Best-effort cleanup.
  }
}

function cleanup(): void {
  stopVm(sourceName);
  stopVm(targetName);
}

process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

function assertSmoke(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function hasItems(items: unknown[] | undefined): boolean {
  return (items?.length ?? 0) > 0;
}

function loadSummary(): SmokeSummary {
  return parseJson<SmokeSummary>(readFileSync(join(work, "summary.json"), "utf8"));
}

function loadProof(): MaterializationProof {
  return parseJson<MaterializationProof>(readFileSync(join(work, "proof-result.json"), "utf8"));
}

function allTruthy(values: unknown[]): boolean {
  return values.every(Boolean);
}

function noTruthy(values: unknown[]): boolean {
  return !values.some(Boolean);
}

function isExternalCapture(summary: SmokeSummary): boolean {
  return noTruthy([
    summary.externalQuiesce?.appHookUsed,
    summary.externalQuiesce?.checkpointApiUsed,
  ]);
}

function hasRequiredProcCapture(summary: SmokeSummary): boolean {
  return allTruthy([
    summary.captured?.procMaps,
    summary.captured?.fdTable,
    summary.captured?.auxvEnvCmdline,
  ]);
}

function hasAcceptedMemory(summary: SmokeSummary): boolean {
  return (summary.captured?.memoryBytesForAcceptedMappings ?? 0) >= 1;
}

function hasPortableIr(summary: SmokeSummary): boolean {
  return summary.portableIr?.kind === "machinen.node-proper-level5-source-state-ir";
}

function sourceCaptureChecks(summary: SmokeSummary): Array<[boolean, string]> {
  return [
    [isExternalCapture(summary), "capture used app hook/checkpoint API"],
    [hasRequiredProcCapture(summary), "missing required proc capture"],
    [hasAcceptedMemory(summary), "no memory bytes captured"],
    [hasPortableIr(summary), "missing portable IR"],
    [hasItems(summary.portableIr?.timerDescriptors), "missing timer descriptor in portable IR"],
  ];
}

type RuntimeStateKey = keyof NonNullable<SmokeSummary["runtimeStateCandidates"]>;

function hasRuntimeItems(
  runtime: SmokeSummary["runtimeStateCandidates"],
  key: RuntimeStateKey,
): boolean {
  return hasItems(runtime?.[key]);
}

function sourceRuntimeChecks(
  runtime: SmokeSummary["runtimeStateCandidates"],
): Array<[boolean, string]> {
  return [
    [hasRuntimeItems(runtime, "nodeBinaryMappings"), "missing Node binary mapping evidence"],
    [hasRuntimeItems(runtime, "v8HeapPageCandidates"), "missing V8 heap page candidates"],
    [
      hasRuntimeItems(runtime, "jsCounterClosureGlobalObjectCandidates"),
      "missing JS counter closure/global candidates",
    ],
    [hasRuntimeItems(runtime, "tcpServerHandleCandidates"), "missing TCP server handle candidate"],
    [
      hasRuntimeItems(runtime, "libuvTimerHandleCandidates"),
      "missing libuv timer handle candidate",
    ],
  ];
}

function validateChecks(checks: Array<[boolean, string]>): void {
  for (const [passed, message] of checks) {
    assertSmoke(passed, message);
  }
}

function validateSourceCapture(summary: SmokeSummary): void {
  validateChecks(sourceCaptureChecks(summary));
  validateChecks(sourceRuntimeChecks(summary.runtimeStateCandidates));
}

function targetStarted(proof: MaterializationProof): boolean {
  return allTruthy([
    proof.targetNativeNodeStarted,
    proof.targetNativeObjectsMaterialized,
    proof.eventLoopEntered,
  ]);
}

function counterRecovered(proof: MaterializationProof): boolean {
  return proof.recoveredCounterFromMemory?.value === 2;
}

function counterRecoveryModeIsRawV8(proof: MaterializationProof): boolean {
  return (
    proof.recoveredCounterFromMemory?.recoveryMode === "raw-v8-context-smi-near-closure-anchor"
  );
}

function noResponseStringShortcut(proof: MaterializationProof): boolean {
  return noTruthy([proof.recoveredFromPriorResponseString, !proof.rawV8ContextSmiDecoded]);
}

function timerRecovered(proof: MaterializationProof): boolean {
  return (
    allTruthy([proof.timerMaterialized]) &&
    (proof.recoveredTimerFromMemory?.value ?? 0) >= sourceTimerMin
  );
}

function timerCloseToSource(proof: MaterializationProof, sourceTimer: TimerResponse): boolean {
  return (proof.recoveredTimerFromMemory?.value ?? 0) <= sourceTimer.timerTicks + 20;
}

function noForbiddenShortcut(proof: MaterializationProof): boolean {
  return noTruthy([
    proof.selectedStateCounterDescriptorUsed,
    proof.appExportImportUsed,
    proof.sourceIsaEmulationUsed,
    proof.sidecarOutputUsed,
    proof.metadataOnlySuccess,
  ]);
}

function targetEvidenceChecks(
  proof: MaterializationProof,
  sourceTimer: TimerResponse,
): Array<[boolean, string]> {
  return [
    [targetStarted(proof), "target native materialization did not complete"],
    [counterRecovered(proof), "counter was not recovered from memory as 2"],
    [counterRecoveryModeIsRawV8(proof), "counter was not recovered from a raw V8 context Smi slot"],
    [noResponseStringShortcut(proof), "response-string recovery shortcut detected"],
    [timerRecovered(proof), "timer state was not recovered/materialized"],
    [
      timerCloseToSource(proof, sourceTimer),
      "recovered timer state is not close to observed source timer state",
    ],
    [noForbiddenShortcut(proof), "forbidden proof shortcut detected"],
  ];
}

function validateTargetProof(proof: MaterializationProof, sourceTimer: TimerResponse): void {
  validateChecks(targetEvidenceChecks(proof, sourceTimer));
}

function validateTargetTimer(targetTimerOne: string, targetTimerTwo: string): TimerResponse[] {
  const timerOne = parseJson<TimerResponse>(targetTimerOne);
  const timerTwo = parseJson<TimerResponse>(targetTimerTwo);
  assertSmoke(
    timerTwo.timerTicks > timerOne.timerTicks,
    `target timer did not continue: ${targetTimerOne} -> ${targetTimerTwo}`,
  );
  return [timerOne, timerTwo];
}

function validateProof(
  sourceTimer: string,
  targetOne: string,
  targetTimerOne: string,
  targetTimerTwo: string,
): void {
  const summary = loadSummary();
  const proof = loadProof();
  const sourceTimerParsed = parseJson<TimerResponse>(sourceTimer);
  validateSourceCapture(summary);
  validateTargetProof(proof, sourceTimerParsed);
  const [timerOne, timerTwo] = validateTargetTimer(targetTimerOne, targetTimerTwo);
  console.log(
    JSON.stringify({
      acceptedForFirstProof: summary.classification?.acceptedForFirstProof,
      failures: summary.classification?.failures?.map((failure) => failure.code) ?? [],
      memoryMappings: summary.captured?.memoryBytesForAcceptedMappings,
      recovered: proof.recoveredCounterFromMemory,
      recoveredTimer: proof.recoveredTimerFromMemory,
      target: parseJson<CountResponse>(targetOne),
      targetTimer: { before: timerOne, after: timerTwo },
    }),
  );
}

function bootVm(name: string): void {
  console.error(`booting ${name}…`);
  runCli([
    "boot",
    "--name",
    name,
    "--detach",
    "--mount-live",
    `${work}:/mnt/work:rw`,
    "--",
    "sleep",
    "100000",
  ]);
}

function installNodeAndCurl(name: string): void {
  runCli([
    "exec",
    name,
    "--",
    "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null",
  ]);
}

function startSourceApp(): void {
  copyFileSync(sourceAppPath, join(work, "counter.mjs"));
  execInVm(
    sourceName,
    "mkdir -p /opt/machinen-proper-level5 && cp /mnt/work/counter.mjs /opt/machinen-proper-level5/counter.mjs && cd /opt/machinen-proper-level5 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc counter.mjs >/tmp/node-proper-level5-counter.log 2>&1 &",
  );
}

async function waitForVmHttp(vmName: string, logPath: string): Promise<string> {
  try {
    return await pollCurl(vmName, "/", 120, 250);
  } catch (error) {
    process.stderr.write(execInVm(vmName, `cat ${logPath} || true`));
    throw error;
  }
}

async function readSourceResponses(): Promise<{
  sourceOne: string;
  sourceTwo: string;
  sourceTimer: string;
}> {
  const sourceOne = await waitForVmHttp(sourceName, "/tmp/node-proper-level5-counter.log");
  const sourceTwo = curl(sourceName, "/");
  assertCount(sourceOne, 1);
  assertCount(sourceTwo, 2);
  const sourceTimer = await waitForSourceTimer();
  return { sourceOne, sourceTwo, sourceTimer };
}

async function waitForSourceTimer(): Promise<string> {
  let sourceTimer = "";
  for (let attempt = 0; attempt < 80; attempt++) {
    sourceTimer = curl(sourceName, "/timer");
    if (parseJson<TimerResponse>(sourceTimer).timerTicks >= sourceTimerMin) {
      break;
    }
    await sleep(100);
  }
  assertTimerAtLeast(sourceTimer, sourceTimerMin);
  return sourceTimer;
}

function captureSourceState(): void {
  copyFileSync(captureProgramPath, join(work, "capture.pl"));
  const encodedSourceState = execInVm(sourceName, "perl /mnt/work/capture.pl");
  writeFileSync(join(work, "source-state.tar.gz.b64"), encodedSourceState);
  writeFileSync(
    join(work, "source-state.tar.gz"),
    Buffer.from(encodedSourceState.replace(/\s/g, ""), "base64"),
  );
  execFileSync("tar", ["-C", work, "-xzf", join(work, "source-state.tar.gz")], {
    cwd: root,
    stdio: "inherit",
  });
  copyFileSync(
    join(work, "machinen-proper-level5-source-state/summary.json"),
    join(work, "summary.json"),
  );
}

function startTargetApp(): void {
  copyFileSync(targetLoaderPath, join(work, "target-loader.mjs"));
  execInVm(
    targetName,
    "nohup node /mnt/work/target-loader.mjs /mnt/work/machinen-proper-level5-source-state /mnt/work/proof-result.json >/tmp/node-proper-level5-target.log 2>&1 &",
  );
}

async function readTargetResponses(): Promise<{
  targetOne: string;
  targetTimerOne: string;
  targetTimerTwo: string;
}> {
  const targetOne = await waitForVmHttp(targetName, "/tmp/node-proper-level5-target.log");
  assertCount(targetOne, 3);
  const targetTimerOne = curl(targetName, "/timer");
  await sleep(350);
  const targetTimerTwo = curl(targetName, "/timer");
  return { targetOne, targetTimerOne, targetTimerTwo };
}

async function main(): Promise<void> {
  bootVm(sourceName);
  installNodeAndCurl(sourceName);
  startSourceApp();
  const source = await readSourceResponses();
  captureSourceState();
  bootVm(targetName);
  installNodeAndCurl(targetName);
  startTargetApp();
  const target = await readTargetResponses();
  validateProof(source.sourceTimer, target.targetOne, target.targetTimerOne, target.targetTimerTwo);
  console.log(
    `node proper Level 5 timer proof passed: ${work} source=${source.sourceOne},${source.sourceTwo} sourceTimer=${source.sourceTimer} target=${target.targetOne} targetTimer=${target.targetTimerOne},${target.targetTimerTwo}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
