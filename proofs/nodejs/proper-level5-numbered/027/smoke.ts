#!/usr/bin/env tsx
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(proofDir, "../../../..");
const cli = join(root, "packages/cli/dist/cli.js");
const work =
  process.env.WORK_DIR ??
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-http-state."));
const activeSource = `node-proper-level5-http-active-source-${process.pid}`;
const idleSource = `node-proper-level5-http-idle-source-${process.pid}`;
const targetName = `node-proper-level5-http-target-${process.pid}`;

process.env.MACHINEN_ASSETS_DIR ??= join(root, "release-assets");
process.env.MACHINEN_REGISTRY_DIR = join(work, "registry");
mkdirSync(work, { recursive: true });

type VmName = typeof activeSource | typeof idleSource | typeof targetName;

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

function assertCount(body: string, expected: number): void {
  const parsed = parseJson<CountResponse>(body);
  if (parsed.count !== expected) {
    throw new Error(`expected count ${expected}, got ${body}`);
  }
}

function stopVm(name: VmName): void {
  try {
    runCli(["stop", name], "ignore");
  } catch {
    // Best-effort cleanup.
  }
}

function cleanup(): void {
  stopVm(activeSource);
  stopVm(idleSource);
  stopVm(targetName);
}

process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

function compileGuestCapture(): void {
  execFileSync(
    "zig",
    [
      "build-exe",
      join(proofDir, "guest-capture.zig"),
      "-target",
      "aarch64-linux-musl",
      "-O",
      "ReleaseFast",
      `-femit-bin=${join(work, "guest-capture-aarch64")}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
  execFileSync(
    "zig",
    [
      "build-exe",
      join(proofDir, "guest-capture.zig"),
      "-target",
      "x86_64-linux-musl",
      "-O",
      "ReleaseFast",
      `-femit-bin=${join(work, "guest-capture-x86_64")}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
}

function bootSource(name: VmName): void {
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
  runCli([
    "exec",
    name,
    "--",
    "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null",
  ]);
  copyFileSync(join(proofDir, "source-app.mjs"), join(work, "server-027.mjs"));
  execInVm(
    name,
    `mkdir -p /opt/machinen-proof-027 && cp /mnt/work/server-027.mjs /opt/machinen-proof-027/server-027.mjs && cd /opt/machinen-proof-027 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc server-027.mjs >/tmp/node-proof-027.log 2>&1 & echo $! >/mnt/work/${name}.pid`,
  );
}

function curl(vmName: VmName, path = "/"): string {
  return execInVm(vmName, `curl -fsS http://127.0.0.1:3000${path}`).replace(/\r/g, "").trim();
}

async function waitForHttp(vmName: VmName): Promise<string> {
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
  process.stderr.write(execInVm(vmName, "cat /tmp/node-proof-027.log || true"));
  throw new Error(`timed out waiting for ${vmName}`);
}

function runGuestCapture(vmName: VmName, label: string): void {
  const arch = execInVm(vmName, "uname -m").trim() === "x86_64" ? "x86_64" : "aarch64";
  const pid = execInVm(
    vmName,
    "for p in /proc/[0-9]*; do exe=$(readlink $p/exe 2>/dev/null || true); case $exe in */node) tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q server-027.mjs && basename $p && break;; esac; done",
  ).trim();
  if (!pid) {
    process.stderr.write(execInVm(vmName, "ps -ef || true; cat /tmp/node-proof-027.log || true"));
    throw new Error("missing source node pid");
  }
  console.error(`${label} capture pid ${pid}`);
  execInVm(
    vmName,
    `chmod +x /mnt/work/guest-capture-${arch} && /mnt/work/guest-capture-${arch} /mnt/work/${label}-state ${pid}`,
  );
  buildSummary(label);
}

function readMappings(label: string): AcceptedMapping[] {
  const path = join(work, `${label}-state/accepted-mappings.tsv`);
  return readFileSync(path, "utf8")
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
  const failures = markers.activeHttpRequestDetected
    ? [
        {
          code: "node-proper-level5-http-active-request-unsupported",
          message: "active HTTP request state was detected in captured V8 memory",
        },
      ]
    : [];
  const summary = {
    kind: "machinen.node-proper-level5-http-state-capture",
    goal: "proper-node-level5-http-request-state-policy-proof",
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
      guestCaptureTool: "proofs/by-id/027/guest-capture.zig",
    },
    classification: {
      acceptedForFirstProof: failures.length === 0,
      failures,
      activeHttpRequestDetected: markers.activeHttpRequestDetected,
      acceptedMappings,
    },
    runtimeStateCandidates: {
      v8HeapPageCandidates: acceptedMappings,
      jsCounterClosureGlobalObjectCandidates: markers.sourceCounterTextFound
        ? [{ kind: "v8-heap-module-source-counter-closure-candidate" }]
        : [],
      tcpServerHandleCandidates: [{ kind: "tcp-listener-state-from-proc-net" }],
    },
    httpStatePolicy: {
      activeRequestPolicy: markers.activeHttpRequestDetected
        ? "refuse-active-request"
        : "no-active-request-detected",
      idleKeepAlivePolicy: "safe-close-and-recreate-idle-connections-on-target",
      listenerPolicy: "materialize-target-native-listener-without-response-replay",
    },
    portableIr: {
      kind: "machinen.node-proper-level5-source-state-ir",
      memoryObjectGraphFragments: markers.sourceCounterTextFound
        ? [{ kind: "v8-heap-module-source-counter-closure-candidate" }]
        : [],
      fdListenerDescriptors: [{ kind: "tcp-listener-state-from-proc-net" }],
      idleConnectionDescriptors: [],
      refusalEvidence: failures,
    },
  };
  writeFileSync(join(captureRoot, "summary.json"), JSON.stringify(summary, null, 2));
}

async function proveActiveRequestRefusal(): Promise<void> {
  bootSource(activeSource);
  await waitForHttp(activeSource);
  execInVm(
    activeSource,
    "nohup curl -fsS http://127.0.0.1:3000/hold >/tmp/node-proof-027-hold.out 2>&1 &",
  );
  let activeRequestObserved = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    const active = parseJson<{ active: boolean }>(
      execInVm(activeSource, "curl -fsS http://127.0.0.1:3000/active").replace(/\r/g, "").trim(),
    );
    if (active.active) {
      activeRequestObserved = true;
      break;
    }
    await sleep(100);
  }
  if (!activeRequestObserved) {
    throw new Error("active /hold request was not observed before capture");
  }
  runGuestCapture(activeSource, "active");
  const summary = parseJson<{
    classification: { acceptedForFirstProof: boolean; failures: Array<{ code: string }> };
  }>(readFileSync(join(work, "active-state/summary.json"), "utf8"));
  if (summary.classification.acceptedForFirstProof) {
    throw new Error("active request capture should refuse");
  }
  if (
    !summary.classification.failures.some(
      (failure) => failure.code === "node-proper-level5-http-active-request-unsupported",
    )
  ) {
    throw new Error("active request refusal code missing");
  }
}

async function proveQuiescentContinuation(): Promise<void> {
  bootSource(idleSource);
  const sourceOne = await waitForHttp(idleSource);
  const sourceTwo = curl(idleSource);
  assertCount(sourceOne, 1);
  assertCount(sourceTwo, 2);
  runGuestCapture(idleSource, "idle");

  console.error(`booting ${targetName}…`);
  runCli([
    "boot",
    "--name",
    targetName,
    "--detach",
    "--mount-live",
    `${work}:/mnt/work:rw`,
    "--",
    "sleep",
    "100000",
  ]);
  runCli([
    "exec",
    targetName,
    "--",
    "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null",
  ]);
  copyFileSync(join(proofDir, "target-loader.mjs"), join(work, "target-loader.mjs"));
  execInVm(
    targetName,
    "nohup node /mnt/work/target-loader.mjs /mnt/work/idle-state /mnt/work/proof-result.json >/tmp/node-proof-027-target.log 2>&1 &",
  );

  let targetOne = "";
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      targetOne = curl(targetName);
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!targetOne) {
    process.stderr.write(execInVm(targetName, "cat /tmp/node-proof-027-target.log || true"));
    throw new Error("target did not start");
  }
  assertCount(targetOne, 3);
  const proof = parseJson<Record<string, unknown>>(
    readFileSync(join(work, "proof-result.json"), "utf8"),
  );
  for (const key of [
    "selectedStateCounterDescriptorUsed",
    "appExportImportUsed",
    "sourceIsaEmulationUsed",
    "sidecarOutputUsed",
    "metadataOnlySuccess",
  ]) {
    if (proof[key]) {
      throw new Error(`forbidden proof shortcut detected: ${key}`);
    }
  }
  console.log(
    JSON.stringify({
      activeRefused: true,
      source: [parseJson(sourceOne), parseJson(sourceTwo)],
      target: parseJson(targetOne),
      listenerPolicy: proof.listenerPolicy,
    }),
  );
}

try {
  compileGuestCapture();
  await proveActiveRequestRefusal();
  await proveQuiescentContinuation();
  console.log(`node proper Level 5 HTTP state policy proof passed: ${work}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
