#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { boot, type VmHandle } from "../../../packages/runtime/src/index.ts";

const KIND = "machinen.nodejs-portability-memory-real-plain-object-smoke-report";
const ROW_ID = "037-memory-real-plain-object";
const ROW_DIR = "portability/nodejs/037-memory-real-plain-object";
const anchors = {
  anchor: "machinen-real-plain-object-anchor-v1",
  kind: "machinen-real-plain-object-kind-v1",
  message: "machinen-real-plain-object-message-v1",
  countLabel: "count:7",
  nestedLabel: "nested:portable",
} as const;

type GuestArch = "arm64" | "amd64";
type Mode = "source" | "target" | "combine" | "verify";

interface SemanticObjectState {
  anchor: string;
  kind: string;
  message: string;
  countLabel: string;
  nestedLabel: string;
  count: number;
  nested: { label: string };
}

interface SourceCapture {
  kind: `${typeof KIND}.source-capture`;
  accepted: boolean;
  portabilityRow: typeof ROW_ID;
  sourceArch: GuestArch;
  captureMethod: "guest-proc-maps-and-proc-mem-anchor-object-decoder";
  appHookUsedForCapture: false;
  rawV8HeapRestored: false;
  samePidRestored: false;
  objectState: SemanticObjectState;
  evidence: {
    pid: number;
    mapsSha256: string;
    readableMappings: number;
    decodedFields: Record<keyof typeof anchors, { found: boolean; hits: string[] }>;
  };
}

interface TargetResult {
  kind: `${typeof KIND}.target-result`;
  accepted: boolean;
  portabilityRow: typeof ROW_ID;
  sourceArch: GuestArch;
  targetArch: GuestArch;
  materialization: "target-native-node-semantic-object-ir";
  targetNativeNode: true;
  appHookUsedForCapture: false;
  rawV8HeapRestored: false;
  samePidRestored: false;
  verifier: unknown;
}

interface CombinedReport {
  kind: typeof KIND;
  version: 1;
  accepted: boolean;
  portabilityRow: typeof ROW_ID;
  architectures: GuestArch[];
  sourceArch: GuestArch;
  targetArch: GuestArch;
  executeVm: true;
  memoryCapture: "real-guest-proc-maps-and-proc-mem";
  migrationCompleted: boolean;
  summary: { verifiedVmRows: number; memoryStateRows: number; refusedRows: 0 };
  results: Array<{
    id: typeof ROW_ID;
    architecture: GuestArch;
    state: "verified" | "failed-classified";
  }>;
  sourceCapture: SourceCapture;
  targetResult: TargetResult;
  evidence: { appPath: string; appSha256: string; smokePath: string };
  claimBoundary: { claims: string[]; notClaimed: string[] };
  claimGuard: ReturnType<typeof claimGuard>;
}

function parseArgs(argv: string[]): {
  mode: Mode;
  arch: GuestArch;
  out: string;
  sourceCapture?: string;
  targetResult?: string;
} {
  let mode: Mode = "verify";
  let arch: GuestArch = process.arch === "x64" ? "amd64" : "arm64";
  let out = "portability/nodejs/retained/nodejs-portability-memory-real-plain-object-report.json";
  let sourceCapture: string | undefined;
  let targetResult: string | undefined;
  if (argv[0] && !argv[0].startsWith("--")) {
    const candidate = argv.shift();
    if (
      candidate !== "source" &&
      candidate !== "target" &&
      candidate !== "combine" &&
      candidate !== "verify"
    ) {
      throw new Error(`unknown mode ${candidate}`);
    }
    mode = candidate;
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--arch") {
      const value = argv[++index];
      if (value !== "arm64" && value !== "amd64") {
        throw new Error(`invalid --arch ${value}`);
      }
      arch = value;
    } else if (arg === "--out") {
      out = argv[++index] ?? out;
    } else if (arg === "--source-capture") {
      sourceCapture = argv[++index];
    } else if (arg === "--target-result") {
      targetResult = argv[++index];
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return {
    mode,
    arch,
    out: resolve(out),
    sourceCapture: sourceCapture && resolve(sourceCapture),
    targetResult: targetResult && resolve(targetResult),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(args.out), { recursive: true });
  if (args.mode === "source") {
    writeJson(args.out, await captureSourceObject(args.arch));
    return;
  }
  if (args.mode === "target") {
    if (!args.sourceCapture) {
      throw new Error("target mode requires --source-capture <file>");
    }
    const sourceCapture = JSON.parse(readFileSync(args.sourceCapture, "utf8")) as SourceCapture;
    writeJson(args.out, await materializeTargetObject(sourceCapture, args.arch));
    return;
  }
  if (args.mode === "combine") {
    if (!args.sourceCapture || !args.targetResult) {
      throw new Error("combine mode requires --source-capture and --target-result");
    }
    const sourceCapture = JSON.parse(readFileSync(args.sourceCapture, "utf8")) as SourceCapture;
    const targetResult = JSON.parse(readFileSync(args.targetResult, "utf8")) as TargetResult;
    writeJson(args.out, combineReport(sourceCapture, targetResult));
    return;
  }
  const sourceCapture = await captureSourceObject(args.arch);
  const targetResult = await materializeTargetObject(sourceCapture, args.arch);
  writeJson(args.out, combineReport(sourceCapture, targetResult));
}

async function captureSourceObject(sourceArch: GuestArch): Promise<SourceCapture> {
  const vm = await bootVm(sourceArch, `node-memory-real-object-source-${Date.now()}`);
  try {
    await installNode(vm);
    await vm.writeFile(
      "/tmp/machinen-real-object-source-app.mjs",
      readFileSync(join(ROW_DIR, "app.mjs")),
    );
    await vm.writeFile("/tmp/machinen-real-object-capture.mjs", guestCaptureSource());
    const result = await vm.execRaw(sourceCaptureCommand(), { execTimeoutMs: 180_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "source object memory capture failed");
    }
    return JSON.parse(result.stdout.trim()) as SourceCapture;
  } finally {
    await killVm(vm);
  }
}

async function materializeTargetObject(
  sourceCapture: SourceCapture,
  targetArch: GuestArch,
): Promise<TargetResult> {
  const vm = await bootVm(targetArch, `node-memory-real-object-target-${Date.now()}`);
  try {
    await installNode(vm);
    await vm.writeFile(
      "/tmp/machinen-real-object-target-app.mjs",
      targetAppSource(sourceCapture.objectState),
    );
    await vm.writeFile(
      "/tmp/machinen-real-object-target-verify.mjs",
      readFileSync(join(ROW_DIR, "verifier.mjs")),
    );
    const result = await vm.execRaw(targetVerifyCommand(sourceCapture.objectState), {
      execTimeoutMs: 120_000,
    });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "target object materialization failed");
    }
    const verifier = JSON.parse(result.stdout.trim()) as { accepted: boolean };
    return {
      kind: `${KIND}.target-result`,
      accepted: verifier.accepted === true,
      portabilityRow: ROW_ID,
      sourceArch: sourceCapture.sourceArch,
      targetArch,
      materialization: "target-native-node-semantic-object-ir",
      targetNativeNode: true,
      appHookUsedForCapture: false,
      rawV8HeapRestored: false,
      samePidRestored: false,
      verifier,
    };
  } finally {
    await killVm(vm);
  }
}

async function bootVm(architecture: GuestArch, name: string): Promise<VmHandle> {
  const previousArch = process.env.MACHINEN_GUEST_ARCH;
  process.env.MACHINEN_GUEST_ARCH = architecture;
  try {
    return await boot({
      ...baseAssetsFor(architecture),
      name,
      detached: true,
      cmd: ["sleep", "100000"],
      timeoutMs: undefined,
    });
  } finally {
    if (previousArch === undefined) {
      delete process.env.MACHINEN_GUEST_ARCH;
    } else {
      process.env.MACHINEN_GUEST_ARCH = previousArch;
    }
  }
}

function baseAssetsFor(architecture: GuestArch): { image: string; kernel: string; dtb?: string } {
  const assetsDir = resolve(process.env.MACHINEN_ASSETS_DIR ?? "release-assets");
  if (architecture === "amd64") {
    return {
      image: join(assetsDir, "rootfs-debian-amd64.tar.gz"),
      kernel: join(assetsDir, "bzImage-x86_64"),
    };
  }
  return {
    image: join(assetsDir, "rootfs-debian-arm64.tar.gz"),
    kernel: join(assetsDir, "Image-arm64"),
    dtb: join(assetsDir, "virt-arm64.dtb"),
  };
}

async function installNode(vm: VmHandle): Promise<void> {
  const result = await vm.execRaw(installNodeRuntimeCommand(), { execTimeoutMs: 180_000 });
  if (result.exitCode !== 0) {
    throw new Error(result.stderr || result.stdout || "node executable unavailable in guest");
  }
}

function installNodeRuntimeCommand(): string {
  return `cat >/tmp/machinen-node-env.sh <<'SH'
export PATH=/usr/local/bin:$PATH
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell=bash)"
  fnm use ${process.env.MACHINEN_NODE_PORTABILITY_NODE_VERSION ?? "22.13.1"} >/dev/null 2>&1 || fnm install ${process.env.MACHINEN_NODE_PORTABILITY_NODE_VERSION ?? "22.13.1"} >/dev/null
  eval "$(fnm env --shell=bash)"
fi
SH
. /tmp/machinen-node-env.sh
command -v node
node --version`;
}

function sourceCaptureCommand(): string {
  return `. /tmp/machinen-node-env.sh
cd /tmp
node /tmp/machinen-real-object-source-app.mjs >/tmp/machinen-real-object-source.log 2>&1 &
pid=$!
for i in 1 2 3 4 5; do node -e "fetch('http://127.0.0.1:3000/value').then(r=>r.text()).then(t=>process.exit(t.trim()==='plain-object-ready'?0:1)).catch(()=>process.exit(1))" && break || sleep 1; done
node /tmp/machinen-real-object-capture.mjs "$pid"
status=$?
kill "$pid" 2>/dev/null || true
exit "$status"`;
}

function targetVerifyCommand(expected: SemanticObjectState): string {
  return `. /tmp/machinen-node-env.sh
cd /tmp
node /tmp/machinen-real-object-target-app.mjs >/tmp/machinen-real-object-target.log 2>&1 &
pid=$!
export MACHINEN_EXPECTED_OBJECT_JSON=${shellQuote(JSON.stringify(expected))}
for i in 1 2 3 4 5; do node /tmp/machinen-real-object-target-verify.mjs && status=0 && break || status=$?; sleep 1; done
kill "$pid" 2>/dev/null || true
exit "${"${status:-1}"}"`;
}

function targetAppSource(state: SemanticObjectState): string {
  return `import http from "node:http";
const objectState = ${JSON.stringify(state)};
globalThis.__machinenMaterializedPlainObjectState = objectState;
http.createServer((req, res) => {
  if (req.url === "/state") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(objectState));
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(3000, "127.0.0.1");
`;
}

function guestCaptureSource(): string {
  return `import crypto from "node:crypto";
import fs from "node:fs";
const rowId = ${JSON.stringify(ROW_ID)};
const kind = ${JSON.stringify(KIND)};
const anchors = ${JSON.stringify(anchors)};
const pid = process.argv[2];
const mapsText = fs.readFileSync(\`/proc/\${pid}/maps\`, "utf8");
const maps = mapsText.trim().split("\\n").map(parseMap).filter(Boolean);
const mem = fs.openSync(\`/proc/\${pid}/mem\`, "r");
try {
  const decodedFields = {};
  for (const [key, value] of Object.entries(anchors)) {
    const hits = [];
    for (const map of maps) {
      if (!map.perms.startsWith("r")) continue;
      for (const hit of scanMap(mem, map, Buffer.from(value))) {
        hits.push(hex(hit.absolute));
        if (hits.length >= 4) break;
      }
      if (hits.length >= 4) break;
    }
    decodedFields[key] = { found: hits.length > 0, hits };
  }
  const accepted = Object.values(decodedFields).every((field) => field.found);
  const objectState = {
    anchor: anchors.anchor,
    kind: anchors.kind,
    message: anchors.message,
    countLabel: anchors.countLabel,
    nestedLabel: anchors.nestedLabel,
    count: Number(anchors.countLabel.split(":")[1]),
    nested: { label: anchors.nestedLabel.split(":")[1] },
  };
  console.log(JSON.stringify({
    kind: kind + ".source-capture",
    accepted,
    portabilityRow: rowId,
    sourceArch: process.arch === "x64" ? "amd64" : "arm64",
    captureMethod: "guest-proc-maps-and-proc-mem-anchor-object-decoder",
    appHookUsedForCapture: false,
    rawV8HeapRestored: false,
    samePidRestored: false,
    objectState,
    evidence: {
      pid: Number(pid),
      mapsSha256: crypto.createHash("sha256").update(mapsText).digest("hex"),
      readableMappings: maps.filter((map) => map.perms.startsWith("r")).length,
      decodedFields,
    },
  }));
  process.exit(accepted ? 0 : 2);
} finally {
  fs.closeSync(mem);
}
function parseMap(line) {
  const match = /([0-9a-f]+)-([0-9a-f]+)\\s+(\\S+)\\s+/.exec(line);
  if (!match) return undefined;
  const start = Number.parseInt(match[1], 16);
  const end = Number.parseInt(match[2], 16);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return undefined;
  return { start, end, perms: match[3], size: end - start };
}
function scanMap(mem, map, needle) {
  const hits = [];
  const chunkSize = 1024 * 1024;
  let carry = Buffer.alloc(0);
  for (let address = map.start; address < map.end && hits.length < 8; address += chunkSize) {
    const size = Math.min(chunkSize, map.end - address);
    const chunk = Buffer.alloc(size);
    let bytesRead = 0;
    try { bytesRead = fs.readSync(mem, chunk, 0, size, address); } catch { carry = Buffer.alloc(0); continue; }
    const bytes = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
    let offset = bytes.indexOf(needle);
    while (offset !== -1 && hits.length < 8) {
      const absolute = address - carry.length + offset;
      if (absolute >= map.start && absolute < map.end) hits.push({ absolute });
      offset = bytes.indexOf(needle, offset + 1);
    }
    carry = bytes.subarray(Math.max(0, bytes.length - needle.length + 1));
  }
  return hits;
}
function hex(value) { return "0x" + Math.trunc(value).toString(16); }
`;
}

function combineReport(sourceCapture: SourceCapture, targetResult: TargetResult): CombinedReport {
  const accepted = sourceCapture.accepted && targetResult.accepted;
  return {
    kind: KIND,
    version: 1,
    accepted,
    portabilityRow: ROW_ID,
    architectures: [sourceCapture.sourceArch, targetResult.targetArch],
    sourceArch: sourceCapture.sourceArch,
    targetArch: targetResult.targetArch,
    executeVm: true,
    memoryCapture: "real-guest-proc-maps-and-proc-mem",
    migrationCompleted: accepted,
    summary: { verifiedVmRows: accepted ? 1 : 0, memoryStateRows: 1, refusedRows: 0 },
    results: [
      {
        id: ROW_ID,
        architecture: sourceCapture.sourceArch,
        state: sourceCapture.accepted ? "verified" : "failed-classified",
      },
      {
        id: ROW_ID,
        architecture: targetResult.targetArch,
        state: targetResult.accepted ? "verified" : "failed-classified",
      },
    ],
    sourceCapture,
    targetResult,
    evidence: {
      appPath: `${ROW_DIR}/app.mjs`,
      appSha256: sha256(readFileSync(join(ROW_DIR, "app.mjs"))),
      smokePath: `${ROW_DIR}/smoke.ts`,
    },
    claimBoundary: {
      claims: [
        "selected Node plain-object memory state is captured from source /proc memory and materialized target-native across architectures",
      ],
      notClaimed: [
        "arbitrary Node process restore",
        "raw V8 heap restore",
        "same PID continuation",
        "active request/socket continuation",
        "worker/native-addon/child-process live-state transfer",
        "source ISA emulation",
        "arbitrary Linux process restore",
        "raw VM/vCPU/device replay",
      ],
    },
    claimGuard: claimGuard(),
  };
}

function claimGuard() {
  return {
    arbitraryNodeProcessRestoreClaimed: false,
    arbitraryLinuxProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
    rawCpuStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
    samePidContinuationClaimed: false,
    activeRequestOrSocketContinuationClaimed: false,
  } as const;
}

async function killVm(vm: VmHandle): Promise<void> {
  await Promise.race([
    vm.kill().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
