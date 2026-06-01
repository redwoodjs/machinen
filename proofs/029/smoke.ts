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
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-materializer."));
const sourceName = `node-proper-level5-materializer-source-${process.pid}`;
const targetName = `node-proper-level5-materializer-target-${process.pid}`;

process.env.MACHINEN_ASSETS_DIR ??= join(root, "release-assets");
process.env.MACHINEN_REGISTRY_DIR = join(work, "registry");
mkdirSync(work, { recursive: true });

interface CountResponse {
  count: number;
}

interface CaptureMarkers {
  pid: number;
  activeHttpRequestDetected: boolean;
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
  copyFileSync(join(proofDir, "source-app.mjs"), join(work, "native-materializer-counter.mjs"));
  execInVm(
    sourceName,
    "mkdir -p /opt/machinen-proof-029 && cp /mnt/work/native-materializer-counter.mjs /opt/machinen-proof-029/native-materializer-counter.mjs && cd /opt/machinen-proof-029 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc native-materializer-counter.mjs >/tmp/node-proof-029.log 2>&1 &",
  );
}

function curl(vmName: string): string {
  return execInVm(vmName, "curl -fsS http://127.0.0.1:3000/").replace(/\r/g, "").trim();
}

async function waitForHttp(vmName: string, logPath: string): Promise<string> {
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

function guestArchSuffix(vmName: string): "aarch64" | "x86_64" {
  return execInVm(vmName, "uname -m").trim() === "x86_64" ? "x86_64" : "aarch64";
}

function findSourcePid(): string {
  const pid = execInVm(
    sourceName,
    "for p in /proc/[0-9]*; do exe=$(readlink $p/exe 2>/dev/null || true); case $exe in */node) tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q native-materializer-counter.mjs && basename $p && break;; esac; done",
  ).trim();
  if (!pid) {
    process.stderr.write(
      execInVm(sourceName, "ps -ef || true; cat /tmp/node-proof-029.log || true"),
    );
    throw new Error("missing source node pid");
  }
  return pid;
}

function readMappings(): AcceptedMapping[] {
  return readFileSync(join(work, "source-state/accepted-mappings.tsv"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [index, start, end, size, bytesPath, mappingPath = ""] = line.split("\t");
      return { index: Number(index), start, end, size: Number(size), bytesPath, path: mappingPath };
    });
}

function buildSummary(): void {
  const captureRoot = join(work, "source-state");
  const markers = parseJson<CaptureMarkers>(
    readFileSync(join(captureRoot, "capture-markers.json"), "utf8"),
  );
  const acceptedMappings = readMappings();
  const failures = [
    markers.acceptedMappings < 1 && {
      code: "node-proper-level5-memory-evidence-missing",
      message: "no accepted writable memory mappings were captured",
    },
    !markers.counterAnchorFound && {
      code: "node-proper-level5-v8-context-anchor-missing",
      message: "counter anchor was not found in captured memory",
    },
    !markers.sourceCounterTextFound && {
      code: "node-proper-level5-counter-source-memory-evidence-missing",
      message: "source counter closure text was not found in captured memory",
    },
  ].filter(Boolean);
  const sourceClosureFragments = markers.sourceCounterTextFound
    ? [{ kind: "v8-heap-module-source-counter-closure-candidate" }]
    : [];
  const summary = {
    kind: "machinen.node-proper-level5-native-materializer-source-state-capture",
    goal: "proper-node-level5-native-v8-libuv-materializer-proof",
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
      acceptedMappingPolicy:
        "small readable+writable private anonymous/heap/stack mappings captured by proof-local Zig guest capture tool",
    },
    captured: {
      procMaps: true,
      memoryBytesForAcceptedMappings: acceptedMappings.length,
      fdTable: true,
      socketListenerState: true,
      auxvEnvCmdline: true,
      guestCaptureTool: "proofs/029/guest-capture.zig",
    },
    classification: {
      acceptedForFirstProof: failures.length === 0,
      failures,
      activeHttpRequestDetected: markers.activeHttpRequestDetected,
      acceptedMappings,
    },
    runtimeStateCandidates: {
      v8HeapPageCandidates: acceptedMappings,
      jsCounterClosureGlobalObjectCandidates: sourceClosureFragments,
      tcpServerHandleCandidates: [{ kind: "tcp-listener-state-from-proc-net" }],
    },
    portableIr: {
      kind: "machinen.node-proper-level5-source-state-ir",
      materializerTarget: "native-generated-node-trampoline",
      memoryObjectGraphFragments: sourceClosureFragments,
      fdListenerDescriptors: [{ kind: "tcp-listener-state-from-proc-net" }],
      refusalEvidence: failures,
    },
  };
  writeFileSync(join(captureRoot, "summary.json"), JSON.stringify(summary, null, 2));
  writeFileSync(join(work, "summary.json"), JSON.stringify(summary, null, 2));
}

function captureSourceState(): void {
  const suffix = guestArchSuffix(sourceName);
  const pid = findSourcePid();
  execInVm(
    sourceName,
    `chmod +x /mnt/work/guest-capture-${suffix} && /mnt/work/guest-capture-${suffix} /mnt/work/source-state ${pid}`,
  );
  buildSummary();
}

function runNativeMaterializer(): void {
  const suffix = guestArchSuffix(targetName);
  execInVm(
    targetName,
    `chmod +x /mnt/work/native-materializer-${suffix} && /mnt/work/native-materializer-${suffix} /mnt/work/source-state /mnt/work/proof-result.json /mnt/work/native-target-entrypoint.mjs`,
  );
  execInVm(
    targetName,
    "nohup node /mnt/work/native-target-entrypoint.mjs >/tmp/node-proof-029-target.log 2>&1 &",
  );
}

function validateProof(sourceOne: string, sourceTwo: string, targetOne: string): void {
  assertCount(sourceOne, 1);
  assertCount(sourceTwo, 2);
  assertCount(targetOne, 3);

  const proof = parseJson<NativeMaterializerResult>(
    readFileSync(join(work, "proof-result.json"), "utf8"),
  );
  const summary = parseJson<{ classification?: { acceptedForFirstProof?: boolean } }>(
    readFileSync(join(work, "summary.json"), "utf8"),
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
  ].some(Boolean);

  const checks: Array<[boolean, string]> = [
    [summary.classification?.acceptedForFirstProof === true, "source capture was not accepted"],
    [proof.kind === "machinen.node-proper-level5-native-materializer-proof", "wrong proof kind"],
    [proof.nativeMaterializerBinaryUsed, "native materializer binary was not used"],
    [proof.targetEntrypointKind === "native-generated-node-trampoline", "wrong target entrypoint"],
    [proof.targetNativeMaterializerStarted, "native materializer did not start"],
    [proof.targetNativeObjectsMaterialized, "target-native objects were not materialized"],
    [proof.eventLoopEntered, "target event loop was not entered"],
    [proof.accepted, "native materializer did not accept the source-state IR"],
    [proof.recoveredCounterFromMemory?.value === 2, "counter was not recovered as 2"],
    [
      proof.recoveredCounterFromMemory?.recoveryMode ===
        "native-raw-v8-context-smi-near-closure-anchor",
      "counter was not recovered by native raw V8 Smi recovery",
    ],
    [proof.rawV8ContextSmiDecoded, "raw V8 context Smi was not decoded"],
    [!forbiddenShortcut, "forbidden proof shortcut detected"],
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
      recovered: proof.recoveredCounterFromMemory,
      targetEntrypointKind: proof.targetEntrypointKind,
    }),
  );
}

async function main(): Promise<void> {
  compileProofBinaries();
  bootVm(sourceName);
  installNodeAndCurl(sourceName);
  startSourceApp();
  const sourceOne = await waitForHttp(sourceName, "/tmp/node-proof-029.log");
  const sourceTwo = curl(sourceName);
  captureSourceState();

  bootVm(targetName);
  installNodeAndCurl(targetName);
  runNativeMaterializer();
  const targetOne = await waitForHttp(targetName, "/tmp/node-proof-029-target.log");
  validateProof(sourceOne, sourceTwo, targetOne);
  console.log(`node proper Level 5 native materializer proof passed: ${work}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
