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
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-native-libuv."));
const idleSource = `node-proper-level5-native-libuv-idle-source-${process.pid}`;
const activeSource = `node-proper-level5-native-libuv-active-source-${process.pid}`;
const partialSource = `node-proper-level5-native-libuv-partial-source-${process.pid}`;
const targetName = `node-proper-level5-native-libuv-target-${process.pid}`;

process.env.MACHINEN_ASSETS_DIR ??= join(root, "release-assets");
process.env.MACHINEN_REGISTRY_DIR = join(work, "registry");
mkdirSync(work, { recursive: true });

type VmName = typeof idleSource | typeof activeSource | typeof partialSource | typeof targetName;

interface ResponseBody {
  count: number;
  timerTicks: number;
  listenerOpen: boolean;
  timerRepeatMs: number;
}

interface CaptureMarkers {
  pid: number;
  activeHttpRequestDetected: boolean;
  partialSocketStateDetected: boolean;
  listenerMarkerFound: boolean;
  timerMarkerFound: boolean;
  counterAnchorFound: boolean;
  sourceCounterTextFound: boolean;
  acceptedMappings: number;
}

interface AcceptedMapping {
  index: number;
  start: string;
  end: string;
  size: number;
  bytesPath: string;
  path: string;
}

interface NativeMaterializerResult {
  kind: string;
  targetNativeMaterializerStarted: boolean;
  targetNativeObjectsMaterialized: boolean;
  nativeMaterializerBinaryUsed: boolean;
  targetEntrypointKind: string;
  controlledJsLoaderUsed: boolean;
  fixtureSpecificJsTargetLoaderUsed: boolean;
  accepted: boolean;
  eventLoopEntered: boolean;
  recoveredCounterFromMemory?: { value?: number; recoveryMode?: string };
  targetNativeListenerHandleMaterialized: boolean;
  targetNativeTimerHandleMaterialized: boolean;
  sourceKernelFdReusedOnTarget: boolean;
  sourceLibuvHandleCopiedToTarget: boolean;
  recoveredFromPriorResponseString: boolean;
  rawV8ContextSmiDecoded: boolean;
  selectedStateCounterDescriptorUsed: boolean;
  appExportImportUsed: boolean;
  sourceIsaEmulationUsed: boolean;
  sidecarOutputUsed: boolean;
  metadataOnlySuccess: boolean;
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

function execInVm(name: VmName, command: string): string {
  return outputCli(["exec", name, "--", command]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function parseJson<T>(body: string): T {
  return JSON.parse(body) as T;
}

function assertResponse(body: string, expectedCount: number): ResponseBody {
  const parsed = parseJson<ResponseBody>(body);
  if (parsed.count !== expectedCount) {
    throw new Error(`expected count ${expectedCount}, got ${body}`);
  }
  if (!parsed.listenerOpen || parsed.timerRepeatMs !== 100) {
    throw new Error(`expected listener/timer evidence, got ${body}`);
  }
  return parsed;
}

function stopVm(name: VmName): void {
  try {
    runCli(["stop", name], "ignore");
  } catch {
    // Best-effort cleanup.
  }
}

function cleanup(): void {
  stopVm(idleSource);
  stopVm(activeSource);
  stopVm(partialSource);
  stopVm(targetName);
}

process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

function compileProofBinaries(): void {
  for (const [target, captureBinary, materializerBinary] of [
    ["aarch64-linux-musl", "guest-capture-aarch64", "native-materializer-aarch64"],
    ["x86_64-linux-musl", "guest-capture-x86_64", "native-materializer-x86_64"],
  ] as const) {
    execFileSync(
      "zig",
      [
        "build-exe",
        join(proofDir, "guest-capture.zig"),
        "-target",
        target,
        "-O",
        "ReleaseFast",
        `-femit-bin=${join(work, captureBinary)}`,
      ],
      { cwd: root, stdio: "inherit" },
    );
    execFileSync(
      "zig",
      [
        "build-exe",
        join(proofDir, "native-materializer.zig"),
        "-target",
        target,
        "-O",
        "ReleaseFast",
        `-femit-bin=${join(work, materializerBinary)}`,
      ],
      { cwd: root, stdio: "inherit" },
    );
  }
}

function bootVm(name: VmName): void {
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

function installNodeAndCurl(name: VmName): void {
  runCli([
    "exec",
    name,
    "--",
    "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null",
  ]);
}

function startSourceApp(name: VmName): void {
  copyFileSync(join(proofDir, "source-app.mjs"), join(work, "native-libuv-resource-counter.mjs"));
  execInVm(
    name,
    "mkdir -p /opt/machinen-proof-035 && cp /mnt/work/native-libuv-resource-counter.mjs /opt/machinen-proof-035/native-libuv-resource-counter.mjs && cd /opt/machinen-proof-035 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc native-libuv-resource-counter.mjs >/tmp/node-proof-035.log 2>&1 &",
  );
}

function curl(vmName: VmName, path = "/"): string {
  return execInVm(vmName, `curl -fsS http://127.0.0.1:3000${path}`).replace(/\r/g, "").trim();
}

async function waitForHttp(vmName: VmName, logPath: string): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const body = curl(vmName);
      if (body.length > 0) {
        return body;
      }
    } catch {
      // Service not ready yet.
    }
    await sleep(250);
  }
  process.stderr.write(execInVm(vmName, `cat ${logPath} || true`));
  throw new Error(`timed out waiting for ${vmName}`);
}

function guestArchSuffix(vmName: VmName): "aarch64" | "x86_64" {
  return execInVm(vmName, "uname -m").trim() === "x86_64" ? "x86_64" : "aarch64";
}

function findSourcePid(name: VmName): string {
  const pid = execInVm(
    name,
    "for p in /proc/[0-9]*; do exe=$(readlink $p/exe 2>/dev/null || true); case $exe in */node) tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q native-libuv-resource-counter.mjs && basename $p && break;; esac; done",
  ).trim();
  if (!pid) {
    process.stderr.write(execInVm(name, "ps -ef || true; cat /tmp/node-proof-035.log || true"));
    throw new Error("missing source node pid");
  }
  return pid;
}

function readMappings(label: string): AcceptedMapping[] {
  return readFileSync(join(work, `${label}-state/accepted-mappings.tsv`), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, start, end, size, bytesPath, mappingPath = ""] = line.split("\t");
      return { index: Number(index), start, end, size: Number(size), bytesPath, path: mappingPath };
    });
}

function buildSummary(label: string): void {
  const captureRoot = join(work, `${label}-state`);
  const markers = parseJson<CaptureMarkers>(
    readFileSync(join(captureRoot, "capture-markers.json"), "utf8"),
  );
  const acceptedMappings = readMappings(label);
  const failures = [
    markers.activeHttpRequestDetected && {
      code: "node-proper-level5-http-active-request-unsupported",
      message: "active HTTP request state is not safe for native libuv materialization",
    },
    markers.partialSocketStateDetected && {
      code: "node-proper-level5-partial-socket-unsupported",
      message: "partial socket/unread bytes state is not modeled",
    },
    !markers.listenerMarkerFound && {
      code: "node-proper-level5-tcp-listener-descriptor-missing",
      message: "source listener descriptor evidence was not found",
    },
    !markers.timerMarkerFound && {
      code: "node-proper-level5-repeating-timer-descriptor-missing",
      message: "source repeating timer descriptor evidence was not found",
    },
    !markers.counterAnchorFound && {
      code: "node-proper-level5-v8-context-anchor-missing",
      message: "counter anchor was not found in captured memory",
    },
  ].filter(Boolean);
  const resourceDescriptors = [
    {
      kind: "tcp-listener-v1",
      host: "127.0.0.1",
      port: 3000,
      protocol: "tcp",
      sourceEvidence: ["fd-table.tsv", "proc-net-tcp.txt"],
      targetMaterialization: "create-target-native-node-http-listener",
      sourceKernelFdCopiedToTarget: false,
    },
    {
      kind: "repeating-timer-v1",
      repeatMs: 100,
      sourceEvidence: "machinen-level5-libuv-repeating-timer-v1 marker in captured V8 memory",
      tickStatePolicy: "target-native-modeled-offset",
      targetMaterialization: "create-target-native-libuv-repeating-timer",
      sourceKernelTimerCopiedToTarget: false,
    },
  ];
  const summary = {
    kind: "machinen.node-proper-level5-native-libuv-resource-source-state-capture",
    goal: "proper-node-level5-native-libuv-resource-materialization-proof",
    pid: markers.pid,
    externalQuiesce: {
      method: "SIGSTOP",
      appHookUsed: false,
      checkpointApiUsed: false,
      vmStoppedExternally: true,
    },
    capturePolicy: {
      selectedStateCounterDescriptorUsed: false,
      sourceRequestBodiesIncludedInIr: false,
      sidecarOutputIncludedInIr: false,
      sourceKernelFdCopiedToTarget: false,
      acceptedMappingPolicy:
        "proof-local Zig guest capture records source memory evidence, fd table, and proc TCP tables while source Node is stopped",
    },
    captured: {
      procMaps: true,
      memoryBytesForAcceptedMappings: acceptedMappings.length,
      fdTable: true,
      socketListenerState: true,
      timerMarkerState: markers.timerMarkerFound,
      auxvEnvCmdline: true,
      guestCaptureTool: "proofs/035/guest-capture.zig",
    },
    classification: {
      acceptedForFirstProof: failures.length === 0,
      failures,
      activeHttpRequestDetected: markers.activeHttpRequestDetected,
      partialSocketStateDetected: markers.partialSocketStateDetected,
      listenerMarkerFound: markers.listenerMarkerFound,
      timerMarkerFound: markers.timerMarkerFound,
      acceptedMappings,
    },
    portableIr: {
      kind: "machinen.node-proper-level5-source-state-ir",
      materializerTarget: "native-generated-node-trampoline",
      memoryObjectGraphFragments: [{ kind: "v8-heap-module-source-counter-closure-candidate" }],
      resourceDescriptors,
      fdListenerDescriptors: [resourceDescriptors[0]],
      timerDescriptors: [resourceDescriptors[1]],
      refusalEvidence: failures,
    },
  };
  writeFileSync(join(captureRoot, "summary.json"), JSON.stringify(summary, null, 2));
}

function captureSourceState(name: VmName, label: string): void {
  const suffix = guestArchSuffix(name);
  const pid = findSourcePid(name);
  execInVm(
    name,
    `rm -rf /mnt/work/${label}-state && chmod +x /mnt/work/guest-capture-${suffix} && /mnt/work/guest-capture-${suffix} /mnt/work/${label}-state ${pid}`,
  );
  buildSummary(label);
}

function bootSource(name: VmName): void {
  bootVm(name);
  installNodeAndCurl(name);
  startSourceApp(name);
}

async function assertRefusal(
  name: VmName,
  label: string,
  path: string,
  expectedCode: string,
): Promise<void> {
  bootSource(name);
  await waitForHttp(name, "/tmp/node-proof-035.log");
  execInVm(
    name,
    `nohup curl --max-time 45 -fsS http://127.0.0.1:3000${path} >/tmp/node-proof-035-${label}.out 2>&1 &`,
  );
  await sleep(500);
  captureSourceState(name, label);
  const summary = parseJson<{
    classification: { acceptedForFirstProof: boolean; failures: Array<{ code: string }> };
  }>(readFileSync(join(work, `${label}-state/summary.json`), "utf8"));
  if (summary.classification.acceptedForFirstProof) {
    throw new Error(`${label} capture should refuse`);
  }
  if (!summary.classification.failures.some((failure) => failure.code === expectedCode)) {
    throw new Error(`${label} refusal code missing: ${expectedCode}`);
  }
}

function runNativeMaterializer(): void {
  const suffix = guestArchSuffix(targetName);
  execInVm(
    targetName,
    `chmod +x /mnt/work/native-materializer-${suffix} && /mnt/work/native-materializer-${suffix} /mnt/work/idle-state /mnt/work/proof-result.json /mnt/work/native-target-entrypoint.mjs`,
  );
  execInVm(
    targetName,
    "nohup node /mnt/work/native-target-entrypoint.mjs >/tmp/node-proof-035-target.log 2>&1 &",
  );
}

function validateProof(
  sourceOne: string,
  sourceTwo: string,
  targetOne: string,
  timerBefore: string,
  timerAfter: string,
): void {
  const first = assertResponse(sourceOne, 1);
  const second = assertResponse(sourceTwo, 2);
  if (second.timerTicks < first.timerTicks) {
    throw new Error("source timer did not remain monotonic before capture");
  }
  const target = assertResponse(targetOne, 3);
  const before = parseJson<ResponseBody>(timerBefore);
  const after = parseJson<ResponseBody>(timerAfter);
  if (after.timerTicks <= before.timerTicks) {
    throw new Error(`target timer did not continue: before=${timerBefore}, after=${timerAfter}`);
  }
  const proof = parseJson<NativeMaterializerResult>(
    readFileSync(join(work, "proof-result.json"), "utf8"),
  );
  const forbiddenShortcut = [
    proof.controlledJsLoaderUsed,
    proof.fixtureSpecificJsTargetLoaderUsed,
    proof.recoveredFromPriorResponseString,
    proof.selectedStateCounterDescriptorUsed,
    proof.appExportImportUsed,
    proof.sourceIsaEmulationUsed,
    proof.sidecarOutputUsed,
    proof.metadataOnlySuccess,
    proof.sourceKernelFdReusedOnTarget,
    proof.sourceLibuvHandleCopiedToTarget,
  ].some(Boolean);
  const checks: Array<[boolean, string]> = [
    [proof.kind === "machinen.node-proper-level5-native-libuv-resource-proof", "wrong proof kind"],
    [proof.nativeMaterializerBinaryUsed, "native materializer binary was not used"],
    [proof.targetEntrypointKind === "native-generated-node-trampoline", "wrong target entrypoint"],
    [proof.targetNativeMaterializerStarted, "native materializer did not start"],
    [proof.targetNativeObjectsMaterialized, "target-native objects were not materialized"],
    [proof.targetNativeListenerHandleMaterialized, "target-native listener was not materialized"],
    [proof.targetNativeTimerHandleMaterialized, "target-native timer was not materialized"],
    [proof.eventLoopEntered, "target event loop was not entered"],
    [proof.accepted, "native materializer did not accept the source-state IR"],
    [proof.recoveredCounterFromMemory?.value === 2, "counter was not recovered as 2"],
    [proof.rawV8ContextSmiDecoded, "raw V8 context Smi was not decoded"],
    [!forbiddenShortcut, "forbidden proof shortcut detected"],
    [target.listenerOpen && target.timerRepeatMs === 100, "target resource evidence missing"],
  ];
  for (const [passed, message] of checks) {
    if (!passed) {
      throw new Error(message);
    }
  }
  console.log(
    JSON.stringify({
      source: [parseJson(sourceOne), parseJson(sourceTwo)],
      target: parseJson(targetOne),
      timerBefore: before,
      timerAfter: after,
      recovered: proof.recoveredCounterFromMemory,
      targetEntrypointKind: proof.targetEntrypointKind,
    }),
  );
}

async function main(): Promise<void> {
  compileProofBinaries();

  await assertRefusal(
    activeSource,
    "active",
    "/hold",
    "node-proper-level5-http-active-request-unsupported",
  );
  await assertRefusal(
    partialSource,
    "partial",
    "/partial-socket",
    "node-proper-level5-partial-socket-unsupported",
  );

  bootSource(idleSource);
  const sourceOne = await waitForHttp(idleSource, "/tmp/node-proof-035.log");
  const sourceTwo = curl(idleSource);
  captureSourceState(idleSource, "idle");

  bootVm(targetName);
  installNodeAndCurl(targetName);
  runNativeMaterializer();
  const targetOne = await waitForHttp(targetName, "/tmp/node-proof-035-target.log");
  const timerBefore = curl(targetName, "/timer");
  await sleep(350);
  const timerAfter = curl(targetName, "/timer");
  validateProof(sourceOne, sourceTwo, targetOne, timerBefore, timerAfter);
  console.log(`node proper Level 5 native libuv resource materialization proof passed: ${work}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
