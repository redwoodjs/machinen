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
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-object."));
const sourceName = `node-proper-level5-object-source-${process.pid}`;
const targetName = `node-proper-level5-object-target-${process.pid}`;

process.env.MACHINEN_ASSETS_DIR ??= join(root, "release-assets");
process.env.MACHINEN_REGISTRY_DIR = join(work, "registry");
mkdirSync(work, { recursive: true });

interface ObjectResponse {
  total: number;
  history: number[];
}

interface SmokeSummary {
  captured?: {
    procMaps?: boolean;
    fdTable?: boolean;
    auxvEnvCmdline?: boolean;
    memoryBytesForAcceptedMappings?: number;
  };
  classification?: { acceptedForFirstProof?: boolean; failures?: Array<{ code?: string }> };
  externalQuiesce?: { appHookUsed?: boolean; checkpointApiUsed?: boolean };
  portableIr?: { kind?: string; objectStateDescriptors?: unknown[] };
  runtimeStateCandidates?: {
    nodeBinaryMappings?: unknown[];
    v8HeapPageCandidates?: unknown[];
    jsObjectStateCandidates?: unknown[];
    tcpServerHandleCandidates?: unknown[];
  };
}

interface MaterializationProof {
  targetNativeNodeStarted?: boolean;
  targetNativeObjectsMaterialized?: boolean;
  eventLoopEntered?: boolean;
  recoveredObjectFromMemory?: {
    total?: number;
    history?: number[];
    recoveryMode?: string;
    objectProperties?: {
      total?: unknown;
      history?: { arrayLength?: number; elements?: unknown[] };
    };
  };
  recoveredFromPriorResponseString?: boolean;
  rawV8ObjectDecoded?: boolean;
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

function assertObject(body: string, total: number, history: number[]): void {
  const parsed = parseJson<ObjectResponse>(body);
  const expected = JSON.stringify({ total, history });
  if (JSON.stringify(parsed) !== expected) {
    throw new Error(`expected ${expected}, got ${body}`);
  }
}

function curl(vmName: string): string {
  return execInVm(vmName, "curl -fsS http://127.0.0.1:3000/").replace(/\r/g, "").trim();
}

async function pollCurl(vmName: string, logPath: string): Promise<string> {
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
  copyFileSync(join(proofDir, "source-app.mjs"), join(work, "object-state.mjs"));
  execInVm(
    sourceName,
    "mkdir -p /opt/machinen-proper-level5 && cp /mnt/work/object-state.mjs /opt/machinen-proper-level5/object-state.mjs && cd /opt/machinen-proper-level5 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc object-state.mjs >/tmp/node-proper-level5-object.log 2>&1 &",
  );
}

function captureSourceState(): void {
  copyFileSync(join(proofDir, "capture.pl"), join(work, "capture.pl"));
  const encodedSourceState = execInVm(sourceName, "perl /mnt/work/capture.pl");
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
  copyFileSync(join(proofDir, "target-loader.mjs"), join(work, "target-loader.mjs"));
  execInVm(
    targetName,
    "nohup node /mnt/work/target-loader.mjs /mnt/work/machinen-proper-level5-source-state /mnt/work/proof-result.json >/tmp/node-proper-level5-target.log 2>&1 &",
  );
}

function validateProof(sourceOne: string, sourceTwo: string, targetOne: string): void {
  assertObject(sourceOne, 1, [1]);
  assertObject(sourceTwo, 2, [1, 2]);
  assertObject(targetOne, 3, [1, 2, 3]);

  const summary = parseJson<SmokeSummary>(readFileSync(join(work, "summary.json"), "utf8"));
  const proof = parseJson<MaterializationProof>(
    readFileSync(join(work, "proof-result.json"), "utf8"),
  );
  const object = proof.recoveredObjectFromMemory;
  const forbiddenShortcut = [
    proof.recoveredFromPriorResponseString,
    proof.selectedStateCounterDescriptorUsed,
    proof.appExportImportUsed,
    proof.sourceIsaEmulationUsed,
    proof.sidecarOutputUsed,
    proof.metadataOnlySuccess,
  ].some(Boolean);

  const checks: Array<[boolean, string]> = [
    [
      !summary.externalQuiesce?.appHookUsed && !summary.externalQuiesce?.checkpointApiUsed,
      "capture used app hook/checkpoint API",
    ],
    [
      Boolean(
        summary.captured?.procMaps && summary.captured.fdTable && summary.captured.auxvEnvCmdline,
      ),
      "missing required proc capture",
    ],
    [(summary.captured?.memoryBytesForAcceptedMappings ?? 0) > 0, "no memory bytes captured"],
    [
      summary.portableIr?.kind === "machinen.node-proper-level5-source-state-ir",
      "missing portable IR",
    ],
    [Boolean(summary.portableIr?.objectStateDescriptors?.length), "missing object descriptors"],
    [
      Boolean(summary.runtimeStateCandidates?.nodeBinaryMappings?.length),
      "missing Node binary mapping evidence",
    ],
    [
      Boolean(summary.runtimeStateCandidates?.v8HeapPageCandidates?.length),
      "missing V8 heap page candidates",
    ],
    [
      Boolean(summary.runtimeStateCandidates?.jsObjectStateCandidates?.length),
      "missing object-state candidates",
    ],
    [
      Boolean(summary.runtimeStateCandidates?.tcpServerHandleCandidates?.length),
      "missing TCP listener candidate",
    ],
    [
      Boolean(
        proof.targetNativeNodeStarted &&
        proof.targetNativeObjectsMaterialized &&
        proof.eventLoopEntered,
      ),
      "target native materialization did not complete",
    ],
    [
      object?.total === 2 && JSON.stringify(object.history) === "[1,2]",
      "object state was not recovered from memory",
    ],
    [
      object?.recoveryMode === "raw-v8-object-smi-slots-near-state-anchor",
      "object state did not use raw V8 object recovery",
    ],
    [
      Boolean(
        object?.objectProperties?.total && object.objectProperties.history?.arrayLength === 2,
      ),
      "object properties/array length were not decoded",
    ],
    [
      Boolean(object?.objectProperties?.history?.elements?.length === 2),
      "array elements were not decoded",
    ],
    [Boolean(proof.rawV8ObjectDecoded) && !forbiddenShortcut, "forbidden proof shortcut detected"],
  ];
  for (const [passed, message] of checks) {
    if (!passed) {
      throw new Error(message);
    }
  }

  console.log(
    JSON.stringify({
      acceptedForFirstProof: summary.classification?.acceptedForFirstProof,
      failures: summary.classification?.failures?.map((failure) => failure.code) ?? [],
      memoryMappings: summary.captured?.memoryBytesForAcceptedMappings,
      recoveredObject: object,
      target: parseJson<ObjectResponse>(targetOne),
    }),
  );
}

async function main(): Promise<void> {
  bootVm(sourceName);
  installNodeAndCurl(sourceName);
  startSourceApp();
  const sourceOne = await pollCurl(sourceName, "/tmp/node-proper-level5-object.log");
  const sourceTwo = curl(sourceName);
  captureSourceState();

  bootVm(targetName);
  installNodeAndCurl(targetName);
  startTargetApp();
  const targetOne = await pollCurl(targetName, "/tmp/node-proper-level5-target.log");
  validateProof(sourceOne, sourceTwo, targetOne);
  console.log(
    `node proper Level 5 object proof passed: ${work} source=${sourceOne},${sourceTwo} target=${targetOne}`,
  );
}

try {
  await main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
