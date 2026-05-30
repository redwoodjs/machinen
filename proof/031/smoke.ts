#!/usr/bin/env tsx
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(proofDir, "../..");
const cli = join(root, "packages/cli/dist/cli.js");
const work =
  process.env.WORK_DIR ??
  mkdtempSync(
    join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-full-process-image."),
  );
const activeSource = `node-proper-level5-full-process-image-active-source-${process.pid}`;
const idleSource = `node-proper-level5-full-process-image-idle-source-${process.pid}`;
const targetName = `node-proper-level5-full-process-image-target-${process.pid}`;

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

interface MapInventoryRow {
  index: number;
  start: string;
  end: string;
  perms: string;
  offset: string;
  dev: string;
  inode: string;
  path: string;
  policy: string;
  bytesPath?: string;
  refusalCode?: string;
}

interface ProcessImageInventory {
  kind: "machinen.node-proper-level5-process-image-inventory";
  mappings: MapInventoryRow[];
  threads: Array<Record<string, unknown>>;
  fds: Array<Record<string, unknown>>;
  process: Record<string, unknown>;
  refusalCodes: string[];
}

interface VmListEntry {
  pid: number;
  name?: string;
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
  copyFileSync(join(proofDir, "source-app.mjs"), join(work, "server-031.mjs"));
  execInVm(
    name,
    "mkdir -p /opt/machinen-proof-031 && cp /mnt/work/server-031.mjs /opt/machinen-proof-031/server-031.mjs && cd /opt/machinen-proof-031 && nohup node --v8-pool-size=0 --single-threaded --single-threaded-gc server-031.mjs >/tmp/node-proof-031.log 2>&1 &",
  );
}

function bootTarget(): void {
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
  process.stderr.write(execInVm(vmName, "cat /tmp/node-proof-031.log || true"));
  throw new Error(`timed out waiting for ${vmName}`);
}

function findSourcePid(vmName: VmName): string {
  const pid = execInVm(
    vmName,
    "for p in /proc/[0-9]*; do exe=$(readlink $p/exe 2>/dev/null || true); case $exe in */node) tr '\\0' ' ' < $p/cmdline 2>/dev/null | grep -q server-031.mjs && basename $p && break;; esac; done",
  ).trim();
  if (!pid) {
    process.stderr.write(execInVm(vmName, "ps -ef || true; cat /tmp/node-proof-031.log || true"));
    throw new Error("missing source node pid");
  }
  return pid;
}

function vmPid(vmName: VmName): number {
  const payload = parseJson<{ vms: VmListEntry[] }>(outputCli(["ls", "--json"]));
  const entry = payload.vms.find((vm) => vm.name === vmName);
  if (!entry) {
    throw new Error(`missing registry entry for ${vmName}`);
  }
  return entry.pid;
}

function processState(pid: number): string {
  return execFileSync("ps", ["-o", "state=", "-p", String(pid)], { encoding: "utf8" }).trim();
}

async function waitForFile(path: string, description: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (existsSync(path)) {
      return;
    }
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${description}: ${path}`);
}

async function hostVmPauseBarrier(
  vmName: VmName,
  barrierRoot: string,
): Promise<Record<string, unknown>> {
  const pid = vmPid(vmName);
  await waitForFile(join(barrierRoot, "ready"), "guest capture pause barrier");
  const beforeState = processState(pid);
  process.kill(pid, "SIGSTOP");
  let pausedState = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    pausedState = processState(pid);
    if (pausedState.includes("T")) {
      break;
    }
    await sleep(25);
  }
  if (!pausedState.includes("T")) {
    throw new Error(`VMM did not enter stopped state; state=${pausedState}`);
  }
  await sleep(250);
  process.kill(pid, "SIGCONT");
  let resumedState = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    resumedState = processState(pid);
    if (!resumedState.includes("T")) {
      break;
    }
    await sleep(25);
  }
  if (resumedState.includes("T")) {
    throw new Error(`VMM did not resume; state=${resumedState}`);
  }
  return {
    vmmPid: pid,
    beforeState,
    pausedState,
    resumedState,
    hostSignalPause: "SIGSTOP",
    hostSignalResume: "SIGCONT",
    pausedWhileGuestCaptureHeldSourceProcessStopped: true,
  };
}

function guestBinary(vmName: VmName): string {
  return execInVm(vmName, "uname -m").trim() === "x86_64"
    ? "guest-capture-x86_64"
    : "guest-capture-aarch64";
}

async function runGuestCaptureWithVmPauseBarrier(
  vmName: VmName,
  label: string,
): Promise<Record<string, unknown>> {
  const pid = findSourcePid(vmName);
  const binary = guestBinary(vmName);
  const barrierRoot = join(work, `${label}-barrier`);
  mkdirSync(barrierRoot, { recursive: true });
  execInVm(
    vmName,
    `rm -rf /mnt/work/${label}-state /mnt/work/${label}-barrier && mkdir -p /mnt/work/${label}-barrier && chmod +x /mnt/work/${binary} && sh -c '(/mnt/work/${binary} /mnt/work/${label}-state ${pid} /mnt/work/${label}-barrier >/tmp/node-proof-031-${label}-capture.log 2>&1; echo $? >/mnt/work/${label}-barrier/status) &'`,
  );
  const pauseEvidence = await hostVmPauseBarrier(vmName, barrierRoot);
  await waitForFile(join(barrierRoot, "status"), "guest capture status");
  const status = readFileSync(join(barrierRoot, "status"), "utf8").trim();
  if (status !== "0") {
    process.stderr.write(execInVm(vmName, `cat /tmp/node-proof-031-${label}-capture.log || true`));
    throw new Error(`guest capture failed with status ${status}`);
  }
  buildSummary(label, pauseEvidence);
  return pauseEvidence;
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

function readTsv(path: string): string[][] {
  if (!existsSync(path)) {
    return [];
  }
  return readFileSync(path, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

function classifyMapping(
  row: Omit<MapInventoryRow, "policy">,
  accepted?: AcceptedMapping,
): Pick<MapInventoryRow, "policy" | "bytesPath" | "refusalCode"> {
  if (accepted) {
    return { policy: "captured-bytes", bytesPath: accepted.bytesPath };
  }
  if (!row.perms.includes("r")) {
    return { policy: "refused", refusalCode: "mapping-not-readable" };
  }
  if (row.path.startsWith("[")) {
    return { policy: "guard-or-special-mapping", refusalCode: "special-kernel-mapping" };
  }
  if (row.path) {
    return { policy: "file-backed-identity" };
  }
  return { policy: "recreated-target-anonymous-mapping" };
}

function buildProcessImageInventory(
  captureRoot: string,
  acceptedMappings: AcceptedMapping[],
): ProcessImageInventory {
  const acceptedByIndex = new Map(acceptedMappings.map((mapping) => [mapping.index, mapping]));
  const maps = readFileSync(join(captureRoot, "maps.txt"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line, index): MapInventoryRow => {
      const match =
        /^(?<start>[0-9a-f]+)-(?<end>[0-9a-f]+)\s+(?<perms>\S+)\s+(?<offset>\S+)\s+(?<dev>\S+)\s+(?<inode>\S+)\s*(?<path>.*)$/.exec(
          line,
        );
      if (!match?.groups) {
        throw new Error(`could not parse maps row: ${line}`);
      }
      const base = {
        index,
        start: `0x${match.groups.start}`,
        end: `0x${match.groups.end}`,
        perms: match.groups.perms,
        offset: match.groups.offset,
        dev: match.groups.dev,
        inode: match.groups.inode,
        path: match.groups.path.trim(),
      };
      return { ...base, ...classifyMapping(base, acceptedByIndex.get(index)) };
    });
  const threads = readTsv(join(captureRoot, "threads.tsv")).map(
    ([tid, statusPath, statPath, syscallPath, syscallAvailable]) => ({
      tid: Number(tid),
      statusPath,
      statPath,
      syscallPath,
      stackRangePolicy: "from-proc-task-status-and-process-maps-evidence",
      registerEvidence: syscallAvailable === "true" ? "proc-task-syscall" : "unavailable",
      refusalCode: syscallAvailable === "true" ? undefined : "thread-register-evidence-unavailable",
    }),
  );
  const fds = readTsv(join(captureRoot, "fd-table.tsv")).map(([fd, target, resourceClass]) => ({
    fd: Number(fd),
    target,
    resourceClass,
    policy:
      resourceClass === "socket"
        ? "recreate-supported-listener-or-refuse-active-stream"
        : "inventory-only-not-materialized",
    refusalCode: resourceClass === "unknown" ? "fd-resource-class-unknown" : undefined,
  }));
  const processLinks = Object.fromEntries(readTsv(join(captureRoot, "proc-links.tsv")));
  const namespaceLinks = Object.fromEntries(readTsv(join(captureRoot, "namespace-links.tsv")));
  const refusalCodes = [
    ...new Set(
      [
        ...maps.map((mapping) => mapping.refusalCode),
        ...threads.map((thread) => thread.refusalCode as string | undefined),
        ...fds.map((fd) => fd.refusalCode as string | undefined),
      ].filter((code): code is string => Boolean(code)),
    ),
  ];
  const inventory: ProcessImageInventory = {
    kind: "machinen.node-proper-level5-process-image-inventory",
    mappings: maps,
    threads,
    fds,
    process: {
      statusPath: "proc-status",
      statPath: "proc-stat",
      auxvPath: "proc-auxv",
      cmdlinePath: "proc-cmdline",
      environPath: "proc-environ",
      signalMasksSource: "proc-status",
      credentialsSource: "proc-status",
      links: processLinks,
      namespaces: namespaceLinks,
    },
    refusalCodes,
  };
  writeFileSync(
    join(captureRoot, "process-image-inventory.json"),
    JSON.stringify(inventory, null, 2),
  );
  return inventory;
}

function assertProcessImageInventory(captureRoot: string, inventory: ProcessImageInventory): void {
  const mapRows = readFileSync(join(captureRoot, "maps.txt"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean).length;
  if (inventory.mappings.length !== mapRows) {
    throw new Error(
      `inventory mapping count mismatch: ${inventory.mappings.length} !== ${mapRows}`,
    );
  }
  if (inventory.mappings.some((mapping) => !mapping.policy)) {
    throw new Error("inventory mapping missing policy");
  }
  const threadRows = readTsv(join(captureRoot, "threads.tsv")).length;
  if (inventory.threads.length !== threadRows || inventory.threads.length === 0) {
    throw new Error("inventory missing thread-state rows");
  }
  const fdRows = readTsv(join(captureRoot, "fd-table.tsv")).length;
  if (inventory.fds.length !== fdRows || inventory.fds.some((fd) => !fd.resourceClass)) {
    throw new Error("inventory missing fd resource classifications");
  }
}

function buildSummary(label: string, pauseEvidence: Record<string, unknown>): void {
  const captureRoot = join(work, `${label}-state`);
  const markers = parseJson<CaptureMarkers>(
    readFileSync(join(captureRoot, "capture-markers.json"), "utf8"),
  );
  const acceptedMappings = readMappings(label);
  const processImageInventory = buildProcessImageInventory(captureRoot, acceptedMappings);
  assertProcessImageInventory(captureRoot, processImageInventory);
  const failures = markers.activeHttpRequestDetected
    ? [
        {
          code: "node-proper-level5-http-active-request-unsupported",
          message: "active HTTP request state was detected in captured V8 memory",
        },
      ]
    : [];
  const summary = {
    kind: "machinen.node-proper-level5-full-process-image-source-state-capture",
    goal: "proper-node-level5-full-process-image-atomic-source-capture-proof",
    pid: markers.pid,
    externalQuiesce: {
      method: "full-process-image-barrier+process-freeze",
      appHookUsed: false,
      checkpointApiUsed: false,
      vmStoppedExternally: true,
      vmPauseEvidence: pauseEvidence,
    },
    capturePolicy: {
      selectedStateCounterDescriptorUsed: false,
      sourceRequestBodiesIncludedInIr: false,
      sidecarOutputIncludedInIr: false,
      acceptedMappingPolicy:
        "host SIGSTOP/SIGCONT VM pause barrier, then proof-local Zig guest capture reads small private writable mappings while the source Node process is SIGSTOPed",
    },
    captured: {
      procMaps: true,
      memoryBytesForAcceptedMappings: acceptedMappings.length,
      fdTable: true,
      socketListenerState: true,
      auxvEnvCmdline: true,
      processImageInventory: true,
      threadInventory: processImageInventory.threads.length,
      mappingInventory: processImageInventory.mappings.length,
      fdResourceInventory: processImageInventory.fds.length,
      guestCaptureTool: "proof/031/guest-capture.zig",
    },
    classification: {
      acceptedForFirstProof: failures.length === 0,
      failures,
      activeHttpRequestDetected: markers.activeHttpRequestDetected,
      acceptedMappings,
      processImageInventoryPath: "process-image-inventory.json",
      processImageInventory,
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
      listenerPolicy: "materialize-target-native-listener-without-response-replay",
    },
    portableIr: {
      kind: "machinen.node-proper-level5-source-state-ir",
      vmPauseCaptureBoundary: pauseEvidence,
      memoryObjectGraphFragments: markers.sourceCounterTextFound
        ? [{ kind: "v8-heap-module-source-counter-closure-candidate" }]
        : [],
      fdListenerDescriptors: [{ kind: "tcp-listener-state-from-proc-net" }],
      processImageInventory,
      refusalEvidence: [
        ...failures,
        ...processImageInventory.refusalCodes.map((code) => ({ code })),
      ],
    },
  };
  writeFileSync(join(captureRoot, "summary.json"), JSON.stringify(summary, null, 2));
}

async function proveActiveRequestRefusal(): Promise<void> {
  bootSource(activeSource);
  await waitForHttp(activeSource);
  execInVm(
    activeSource,
    "nohup curl -fsS http://127.0.0.1:3000/hold >/tmp/node-proof-031-hold.out 2>&1 &",
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
  await runGuestCaptureWithVmPauseBarrier(activeSource, "active");
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

async function proveIdleContinuation(): Promise<void> {
  bootSource(idleSource);
  const sourceOne = await waitForHttp(idleSource);
  const sourceTwo = curl(idleSource);
  assertCount(sourceOne, 1);
  assertCount(sourceTwo, 2);
  const pauseEvidence = await runGuestCaptureWithVmPauseBarrier(idleSource, "idle");
  const resumedState = curl(idleSource, "/state");
  assertCount(resumedState, 2);

  bootTarget();
  copyFileSync(join(proofDir, "target-loader.mjs"), join(work, "target-loader.mjs"));
  execInVm(
    targetName,
    "nohup node /mnt/work/target-loader.mjs /mnt/work/idle-state /mnt/work/proof-result.json >/tmp/node-proof-031-target.log 2>&1 &",
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
    process.stderr.write(execInVm(targetName, "cat /tmp/node-proof-031-target.log || true"));
    throw new Error("target did not start");
  }
  assertCount(targetOne, 3);
  const proof = parseJson<Record<string, unknown>>(
    readFileSync(join(work, "proof-result.json"), "utf8"),
  );
  const inventory = parseJson<ProcessImageInventory>(
    readFileSync(join(work, "idle-state/process-image-inventory.json"), "utf8"),
  );
  assertProcessImageInventory(join(work, "idle-state"), inventory);
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
      vmPauseBarrier: pauseEvidence,
      source: [parseJson(sourceOne), parseJson(sourceTwo)],
      sourceAfterResume: parseJson(resumedState),
      target: parseJson(targetOne),
      recovered: proof.recoveredCounterFromMemory,
      inventory: {
        mappings: inventory.mappings.length,
        threads: inventory.threads.length,
        fds: inventory.fds.length,
        refusalCodes: inventory.refusalCodes,
      },
    }),
  );
}

try {
  compileGuestCapture();
  await proveActiveRequestRefusal();
  await proveIdleContinuation();
  console.log(`node proper Level 5 process-image capture proof passed: ${work}`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
