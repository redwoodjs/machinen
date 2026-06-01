#!/usr/bin/env tsx
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(proofDir, "../../../..");
const cli = join(root, "packages/cli/dist/cli.js");
const work =
  process.env.WORK_DIR ??
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-cross-arch."));
const sourceName = `node-proper-level5-cross-arch-source-${process.pid}`;
const targetName = `node-proper-level5-cross-arch-target-${process.pid}`;
const targetContainer = `node-proper-level5-cross-arch-target-${process.pid}`;
const sourceArch = normalizeProofArch(process.env.MACHINEN_PROOF_028_SOURCE_ARCH ?? "arm64");
const targetArch = normalizeProofArch(
  process.env.MACHINEN_PROOF_028_TARGET_ARCH ?? opposite(sourceArch),
);

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

function normalizeProofArch(value: string): "arm64" | "amd64" {
  if (value === "arm64" || value === "aarch64") {
    return "arm64";
  }
  if (value === "amd64" || value === "x86_64" || value === "x64") {
    return "amd64";
  }
  throw new Error(`unsupported proof architecture: ${value}`);
}

function opposite(value: "arm64" | "amd64"): "arm64" | "amd64" {
  return value === "arm64" ? "amd64" : "arm64";
}

function archEnv(arch: "arm64" | "amd64"): NodeJS.ProcessEnv {
  return { ...process.env, MACHINEN_GUEST_ARCH: arch };
}

function runCli(
  args: string[],
  options: { stdio?: "inherit" | "ignore"; arch?: "arm64" | "amd64" } = {},
): void {
  execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: options.arch ? archEnv(options.arch) : process.env,
    stdio: options.stdio ?? "inherit",
  });
}

function outputCli(args: string[], arch?: "arm64" | "amd64"): string {
  return execFileSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    env: arch ? archEnv(arch) : process.env,
    maxBuffer: 128 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function execInVm(name: string, command: string, arch?: "arm64" | "amd64"): string {
  return outputCli(["exec", name, "--", command], arch);
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

function docker(args: string[], stdio: "inherit" | "ignore" = "inherit"): string {
  return execFileSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
    stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
  });
}

async function allocateHostPort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("could not allocate host port")));
        return;
      }
      const port = address.port;
      server.close(() => resolvePort(port));
    });
  });
}

function curlHost(port: number): string {
  return execFileSync("curl", ["-fs", `http://127.0.0.1:${port}/`], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  })
    .replace(/\r/g, "")
    .trim();
}

function stopVm(name: string): void {
  try {
    runCli(["stop", name], { stdio: "ignore" });
  } catch {
    // Best-effort cleanup.
  }
}

function cleanup(): void {
  stopVm(sourceName);
  stopVm(targetName);
  try {
    docker(["rm", "-f", targetContainer], "ignore");
  } catch {
    // Best-effort cleanup.
  }
}

process.on("exit", cleanup);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cleanup();
    process.exit(130);
  });
}

function compileGuestCapture(): void {
  for (const [target, binary] of [
    ["aarch64-linux-musl", "guest-capture-aarch64"],
    ["x86_64-linux-musl", "guest-capture-x86_64"],
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
        `-femit-bin=${join(work, binary)}`,
      ],
      { cwd: root, stdio: "inherit" },
    );
  }
}

function bootVm(name: string, arch: "arm64" | "amd64"): void {
  console.error(`booting ${name} (${arch})…`);
  runCli(
    [
      "boot",
      "--name",
      name,
      "--detach",
      "--mount-live",
      `${work}:/mnt/work:rw`,
      "--",
      "sleep",
      "100000",
    ],
    { arch },
  );
}

function installNodeAndCurl(name: string, arch: "arm64" | "amd64"): void {
  runCli(
    [
      "exec",
      name,
      "--",
      "export DEBIAN_FRONTEND=noninteractive; apt-get update >/dev/null && apt-get install -y --no-install-recommends nodejs curl ca-certificates >/dev/null",
    ],
    { arch },
  );
}

function curl(vmName: string, arch: "arm64" | "amd64"): string {
  return execInVm(vmName, "curl -fsS http://127.0.0.1:3000/", arch).replace(/\r/g, "").trim();
}

async function waitForHttp(
  vmName: string,
  arch: "arm64" | "amd64",
  logPath: string,
): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const body = curl(vmName, arch);
      if (body.length > 0) {
        return body;
      }
    } catch {
      // Service not ready yet.
    }
    await sleep(250);
  }
  process.stderr.write(execInVm(vmName, `cat ${logPath} || true`, arch));
  throw new Error(`timed out waiting for ${vmName}`);
}

function startSourceApp(): void {
  copyFileSync(join(proofDir, "source-app.mjs"), join(work, "cross-arch-counter.mjs"));
  execInVm(
    sourceName,
    "mkdir -p /opt/machinen-proof-028 && cp /mnt/work/cross-arch-counter.mjs /opt/machinen-proof-028/cross-arch-counter.mjs && cd /opt/machinen-proof-028 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc cross-arch-counter.mjs >/tmp/node-proof-028.log 2>&1 &",
    sourceArch,
  );
}

function findSourcePid(): string {
  const pid = execInVm(
    sourceName,
    "for p in /proc/[0-9]*; do exe=$(readlink $p/exe 2>/dev/null || true); case $exe in */node) tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q cross-arch-counter.mjs && basename $p && break;; esac; done",
    sourceArch,
  ).trim();
  if (!pid) {
    process.stderr.write(
      execInVm(sourceName, "ps -ef || true; cat /tmp/node-proof-028.log || true", sourceArch),
    );
    throw new Error("missing source node pid");
  }
  return pid;
}

function guestBinaryForArch(arch: "arm64" | "amd64"): string {
  return arch === "amd64" ? "guest-capture-x86_64" : "guest-capture-aarch64";
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

function buildSummary(actualSourceArch: "arm64" | "amd64"): void {
  const captureRoot = join(work, "source-state");
  const markers = parseJson<CaptureMarkers>(
    readFileSync(join(captureRoot, "capture-markers.json"), "utf8"),
  );
  const acceptedMappings = readMappings();
  const nodeVersions = parseJson<Record<string, string>>(
    execInVm(sourceName, "node -p 'JSON.stringify(process.versions)'", sourceArch).trim(),
  );
  const failures = [
    actualSourceArch === targetArch && {
      code: "node-proper-level5-cross-arch-source-target-match",
      message: "source and target architecture must differ",
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
    kind: "machinen.node-proper-level5-cross-arch-source-state-capture",
    goal: "proper-node-level5-cross-architecture-source-state-proof",
    pid: markers.pid,
    architecture: {
      source: actualSourceArch,
      target: targetArch,
      sourceUnameMachine: execInVm(sourceName, "uname -m", sourceArch).trim(),
      targetNativeRequired: true,
    },
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
      sourceIsaEmulationUsed: false,
      acceptedMappingPolicy:
        "small readable+writable private anonymous/heap/stack mappings captured by proof-local Zig guest capture tool",
    },
    captured: {
      procMaps: true,
      memoryBytesForAcceptedMappings: acceptedMappings.length,
      fdTable: true,
      socketListenerState: true,
      auxvEnvCmdline: true,
      guestCaptureTool: "proofs/by-id/028/guest-capture.zig",
    },
    classification: {
      acceptedForFirstProof: failures.length === 0,
      failures,
      acceptedMappings,
    },
    runtimeStateCandidates: {
      v8HeapPageCandidates: acceptedMappings,
      jsCounterClosureGlobalObjectCandidates: sourceClosureFragments,
      tcpServerHandleCandidates: [{ kind: "tcp-listener-state-from-proc-net" }],
    },
    portableIr: {
      kind: "machinen.node-proper-level5-source-state-ir",
      architectureNormalization: {
        source: actualSourceArch,
        target: targetArch,
        pointerEncoding: "v8-pointer-compressed-smi32-or-tagged-smi64-detected-from-memory",
        endian: "little",
      },
      memoryObjectGraphFragments: sourceClosureFragments,
      codeModuleIdentities: [{ exe: "node", nodeVersions }],
      fdListenerDescriptors: [{ kind: "tcp-listener-state-from-proc-net" }],
      refusalEvidence: failures,
    },
  };
  writeFileSync(join(captureRoot, "summary.json"), JSON.stringify(summary, null, 2));
}

function captureSourceState(): void {
  const binary = guestBinaryForArch(sourceArch);
  const pid = findSourcePid();
  execInVm(
    sourceName,
    `chmod +x /mnt/work/${binary} && /mnt/work/${binary} /mnt/work/source-state ${pid}`,
    sourceArch,
  );
  const actualSourceArch = normalizeProofArch(execInVm(sourceName, "uname -m", sourceArch).trim());
  buildSummary(actualSourceArch);
}

async function startTargetApp(): Promise<number> {
  copyFileSync(join(proofDir, "target-loader.mjs"), join(work, "target-loader.mjs"));
  const hostPort = await allocateHostPort();
  docker([
    "run",
    "-d",
    "--rm",
    "--name",
    targetContainer,
    "--platform",
    targetArch === "amd64" ? "linux/amd64" : "linux/arm64",
    "-v",
    `${work}:/mnt/work`,
    "-p",
    `127.0.0.1:${hostPort}:3000`,
    "node:22-bookworm-slim",
    "node",
    "/mnt/work/target-loader.mjs",
    "/mnt/work/source-state",
    "/mnt/work/proof-result.json",
  ]);
  return hostPort;
}

async function waitForTargetHttp(hostPort: number): Promise<string> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      const body = curlHost(hostPort);
      if (body.length > 0) {
        return body;
      }
    } catch {
      // Target container not ready yet.
    }
    await sleep(250);
  }
  try {
    process.stderr.write(docker(["logs", targetContainer], "ignore"));
  } catch {
    // Ignore log collection errors; the timeout below is clearer.
  }
  throw new Error("timed out waiting for target container");
}

function validateProof(sourceOne: string, sourceTwo: string, targetOne: string): void {
  assertCount(sourceOne, 1);
  assertCount(sourceTwo, 2);
  assertCount(targetOne, 3);
  const proof = parseJson<Record<string, unknown>>(
    readFileSync(join(work, "proof-result.json"), "utf8"),
  );
  if (proof.sourceArchitecture === proof.targetArchitecture) {
    throw new Error("source and target architecture did not differ");
  }
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
      sourceArchitecture: proof.sourceArchitecture,
      targetArchitecture: proof.targetArchitecture,
      source: [parseJson(sourceOne), parseJson(sourceTwo)],
      target: parseJson(targetOne),
      recovered: proof.recoveredCounterFromMemory,
    }),
  );
}

async function main(): Promise<void> {
  if (sourceArch === targetArch) {
    throw new Error("Proof 028 requires different source and target architectures");
  }
  compileGuestCapture();
  bootVm(sourceName, sourceArch);
  installNodeAndCurl(sourceName, sourceArch);
  startSourceApp();
  const sourceOne = await waitForHttp(sourceName, sourceArch, "/tmp/node-proof-028.log");
  const sourceTwo = curl(sourceName, sourceArch);
  captureSourceState();

  const targetPort = await startTargetApp();
  const targetOne = await waitForTargetHttp(targetPort);
  validateProof(sourceOne, sourceTwo, targetOne);
  console.log(`node proper Level 5 cross-arch proof passed: ${work}`);
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
