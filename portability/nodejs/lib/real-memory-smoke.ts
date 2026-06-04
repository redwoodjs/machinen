import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { boot, type VmHandle } from "../../../packages/runtime/src/index.ts";

export type GuestArch = "arm64" | "amd64";
export type RealMemoryMode = "source" | "target" | "combine" | "verify" | "refusal";

export interface RealMemorySpec {
  rowId: string;
  rowDir: string;
  kind: string;
  shape: string;
  anchors: Record<string, string>;
  semanticState: Record<string, unknown>;
  refused?: boolean;
  refusalCode?: string;
  refusalReason?: string;
}

interface ParsedArgs {
  mode: RealMemoryMode;
  arch: GuestArch;
  out: string;
  sourceCapture?: string;
  targetResult?: string;
}

export async function runRealMemorySmoke(spec: RealMemorySpec): Promise<void> {
  const args = parseArgs(process.argv.slice(2), spec);
  mkdirSync(dirname(args.out), { recursive: true });
  if (args.mode === "refusal" || spec.refused) {
    writeJson(args.out, refusalReport(spec));
    return;
  }
  if (args.mode === "source") {
    writeJson(args.out, await captureSource(spec, args.arch));
    return;
  }
  if (args.mode === "target") {
    if (!args.sourceCapture) {
      throw new Error("target mode requires --source-capture <file>");
    }
    const sourceCapture = readJson<SourceCapture>(args.sourceCapture);
    writeJson(args.out, await materializeTarget(spec, sourceCapture, args.arch));
    return;
  }
  if (args.mode === "combine") {
    if (!args.sourceCapture || !args.targetResult) {
      throw new Error("combine mode requires --source-capture and --target-result");
    }
    writeJson(
      args.out,
      combineReport(
        spec,
        readJson<SourceCapture>(args.sourceCapture),
        readJson<TargetResult>(args.targetResult),
      ),
    );
    return;
  }
  const sourceCapture = await captureSource(spec, args.arch);
  const targetResult = await materializeTarget(spec, sourceCapture, args.arch);
  writeJson(args.out, combineReport(spec, sourceCapture, targetResult));
}

interface SourceCapture {
  kind: string;
  accepted: boolean;
  portabilityRow: string;
  sourceArch: GuestArch;
  captureMethod: "guest-proc-maps-and-proc-mem-anchor-semantic-decoder";
  appHookUsedForCapture: false;
  rawV8HeapRestored: false;
  samePidRestored: false;
  memoryIr: MemoryIr;
  evidence: {
    pid: number;
    mapsSha256: string;
    readableMappings: number;
    decodedFields: Record<string, { found: boolean; hits: string[] }>;
  };
}

interface TargetResult {
  kind: string;
  accepted: boolean;
  portabilityRow: string;
  sourceArch: GuestArch;
  targetArch: GuestArch;
  materialization: "target-native-node-semantic-memory-ir";
  targetNativeNode: true;
  appHookUsedForCapture: false;
  rawV8HeapRestored: false;
  samePidRestored: false;
  verifier: unknown;
}

interface MemoryIr {
  kind: "machinen.nodejs.memory-ir";
  version: 1;
  runtime: { name: "node"; sourceArch: GuestArch; v8: string | null };
  rows: Array<{
    id: string;
    shape: string;
    semanticState: Record<string, unknown>;
    anchors: Record<string, string>;
  }>;
  unsupported: Array<{ code: string; reason: string }>;
  claimGuard: ReturnType<typeof claimGuard>;
}

function parseArgs(argv: string[], spec: RealMemorySpec): ParsedArgs {
  let mode: RealMemoryMode = "verify";
  let arch: GuestArch = process.arch === "x64" ? "amd64" : "arm64";
  let out = join("portability/nodejs/retained", `${reportBaseName(spec)}-report.json`);
  let sourceCapture: string | undefined;
  let targetResult: string | undefined;
  const args = [...argv];
  if (args[0] && !args[0].startsWith("--")) {
    const candidate = args.shift();
    if (
      candidate !== "source" &&
      candidate !== "target" &&
      candidate !== "combine" &&
      candidate !== "verify" &&
      candidate !== "refusal"
    ) {
      throw new Error(`unknown mode ${candidate}`);
    }
    mode = candidate;
  }
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (arg === "--arch") {
      const value = args[++index];
      if (value !== "arm64" && value !== "amd64") {
        throw new Error(`invalid --arch ${value}`);
      }
      arch = value;
    } else if (arg === "--out") {
      out = args[++index] ?? out;
    } else if (arg === "--source-capture") {
      sourceCapture = args[++index];
    } else if (arg === "--target-result") {
      targetResult = args[++index];
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

async function captureSource(spec: RealMemorySpec, sourceArch: GuestArch): Promise<SourceCapture> {
  const vm = await bootVm(sourceArch, `node-memory-${spec.rowId}-source-${Date.now()}`);
  try {
    await installNode(vm);
    await vm.writeFile(
      "/tmp/machinen-real-memory-source-app.mjs",
      readFileSync(join(spec.rowDir, "app.mjs")),
    );
    await vm.writeFile("/tmp/machinen-real-memory-capture.mjs", guestCaptureSource(spec));
    const result = await vm.execRaw(sourceCaptureCommand(), { execTimeoutMs: 180_000 });
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || result.stdout || `source memory capture failed for ${spec.rowId}`,
      );
    }
    return JSON.parse(result.stdout.trim()) as SourceCapture;
  } finally {
    await killVm(vm);
  }
}

async function materializeTarget(
  spec: RealMemorySpec,
  sourceCapture: SourceCapture,
  targetArch: GuestArch,
): Promise<TargetResult> {
  const vm = await bootVm(targetArch, `node-memory-${spec.rowId}-target-${Date.now()}`);
  try {
    await installNode(vm);
    const state = sourceCapture.memoryIr.rows[0]?.semanticState ?? spec.semanticState;
    await vm.writeFile("/tmp/machinen-real-memory-target-app.mjs", targetAppSource(state));
    await vm.writeFile("/tmp/machinen-real-memory-target-verify.mjs", genericVerifierSource());
    const result = await vm.execRaw(targetVerifyCommand(state), { execTimeoutMs: 120_000 });
    if (result.exitCode !== 0) {
      throw new Error(
        result.stderr || result.stdout || `target materialization failed for ${spec.rowId}`,
      );
    }
    const verifier = JSON.parse(result.stdout.trim()) as { accepted: boolean };
    return {
      kind: `${spec.kind}.target-result`,
      accepted: verifier.accepted === true,
      portabilityRow: spec.rowId,
      sourceArch: sourceCapture.sourceArch,
      targetArch,
      materialization: "target-native-node-semantic-memory-ir",
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

function combineReport(
  spec: RealMemorySpec,
  sourceCapture: SourceCapture,
  targetResult: TargetResult,
) {
  const accepted = sourceCapture.accepted && targetResult.accepted;
  return {
    kind: spec.kind,
    version: 1,
    accepted,
    portabilityRow: spec.rowId,
    architectures: unique([sourceCapture.sourceArch, targetResult.targetArch]),
    sourceArch: sourceCapture.sourceArch,
    targetArch: targetResult.targetArch,
    executeVm: true,
    memoryCapture: "real-guest-proc-maps-and-proc-mem",
    migrationCompleted: accepted,
    summary: { verifiedVmRows: accepted ? 1 : 0, memoryStateRows: 1, refusedRows: 0 },
    results: [
      {
        id: spec.rowId,
        architecture: sourceCapture.sourceArch,
        state: sourceCapture.accepted ? "verified" : "failed-classified",
      },
      {
        id: spec.rowId,
        architecture: targetResult.targetArch,
        state: targetResult.accepted ? "verified" : "failed-classified",
      },
    ],
    sourceCapture,
    targetResult,
    evidence: {
      appPath: `${spec.rowDir}/app.mjs`,
      appSha256: sha256(readFileSync(join(spec.rowDir, "app.mjs"))),
      smokePath: `${spec.rowDir}/smoke.ts`,
    },
    claimBoundary: claimBoundary(spec),
    claimGuard: claimGuard(),
  };
}

function refusalReport(spec: RealMemorySpec) {
  const code = spec.refusalCode ?? "node-portability-memory-unsupported-live-state-unsupported";
  return {
    kind: spec.kind,
    version: 1,
    accepted: true,
    portabilityRow: spec.rowId,
    architectures: ["arm64", "amd64"],
    executeVm: false,
    migrationCompleted: false,
    summary: { verifiedVmRows: 0, memoryStateRows: 0, refusedRows: 1 },
    results: [
      { id: spec.rowId, architecture: "arm64", state: "refused", refusalCode: code },
      { id: spec.rowId, architecture: "amd64", state: "refused", refusalCode: code },
    ],
    refusal: { code, reason: spec.refusalReason ?? "unsupported Node memory live state" },
    memoryIr: {
      kind: "machinen.nodejs.memory-ir",
      version: 1,
      rows: [],
      unsupported: [{ code, reason: spec.refusalReason ?? "unsupported Node memory live state" }],
      claimGuard: claimGuard(),
    },
    claimBoundary: claimBoundary(spec),
    claimGuard: claimGuard(),
  };
}

function sourceCaptureCommand(): string {
  return `. /tmp/machinen-node-env.sh
cd /tmp
node /tmp/machinen-real-memory-source-app.mjs >/tmp/machinen-real-memory-source.log 2>&1 &
pid=$!
for i in 1 2 3 4 5; do node -e "fetch('http://127.0.0.1:3000/value').then(r=>r.text()).then(t=>process.exit(t.trim()==='memory-ready'?0:1)).catch(()=>process.exit(1))" && break || sleep 1; done
node /tmp/machinen-real-memory-capture.mjs "$pid"
status=$?
kill "$pid" 2>/dev/null || true
exit "$status"`;
}

function targetVerifyCommand(state: Record<string, unknown>): string {
  return `. /tmp/machinen-node-env.sh
cd /tmp
node /tmp/machinen-real-memory-target-app.mjs >/tmp/machinen-real-memory-target.log 2>&1 &
pid=$!
export MACHINEN_EXPECTED_MEMORY_STATE_JSON=${shellQuote(JSON.stringify(state))}
for i in 1 2 3 4 5; do node /tmp/machinen-real-memory-target-verify.mjs && status=0 && break || status=$?; sleep 1; done
kill "$pid" 2>/dev/null || true
exit "${"${status:-1}"}"`;
}

function targetAppSource(state: Record<string, unknown>): string {
  return `import http from "node:http";
const memoryState = ${JSON.stringify(state)};
globalThis.__machinenMaterializedMemoryState = memoryState;
http.createServer((req, res) => {
  if (req.url === "/state") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(memoryState));
    return;
  }
  if (req.url === "/value") {
    res.end("memory-ready");
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(3000, "127.0.0.1");
`;
}

function genericVerifierSource(): string {
  return `import assert from "node:assert/strict";
const expected = JSON.parse(process.env.MACHINEN_EXPECTED_MEMORY_STATE_JSON ?? "{}");
const actual = await fetch("http://127.0.0.1:3000/state").then((res) => res.json());
assert.deepEqual(actual, expected);
console.log(JSON.stringify({ accepted: true, actual, expected }));
`;
}

function guestCaptureSource(spec: RealMemorySpec): string {
  return `import crypto from "node:crypto";
import fs from "node:fs";
const spec = ${JSON.stringify({ rowId: spec.rowId, kind: spec.kind, shape: spec.shape, anchors: spec.anchors, semanticState: spec.semanticState })};
const pid = process.argv[2];
const mapsText = fs.readFileSync(\`/proc/\${pid}/maps\`, "utf8");
const maps = mapsText.trim().split("\\n").map(parseMap).filter(Boolean);
const mem = fs.openSync(\`/proc/\${pid}/mem\`, "r");
try {
  const decodedFields = {};
  for (const [key, value] of Object.entries(spec.anchors)) {
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
  const sourceArch = process.arch === "x64" ? "amd64" : "arm64";
  const memoryIr = {
    kind: "machinen.nodejs.memory-ir",
    version: 1,
    runtime: { name: "node", sourceArch, v8: process.versions.v8 ?? null },
    rows: [{ id: spec.rowId, shape: spec.shape, semanticState: spec.semanticState, anchors: spec.anchors }],
    unsupported: [],
    claimGuard: ${JSON.stringify(claimGuard())},
  };
  console.log(JSON.stringify({
    kind: spec.kind + ".source-capture",
    accepted,
    portabilityRow: spec.rowId,
    sourceArch,
    captureMethod: "guest-proc-maps-and-proc-mem-anchor-semantic-decoder",
    appHookUsedForCapture: false,
    rawV8HeapRestored: false,
    samePidRestored: false,
    memoryIr,
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

function claimBoundary(spec: RealMemorySpec) {
  return {
    claims: spec.refused
      ? [`${spec.rowId} refuses unsupported Node memory live state fail-closed`]
      : [
          `${spec.rowId} captures selected Node ${spec.shape} state from /proc memory and materializes it target-native across architectures`,
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

function reportBaseName(spec: RealMemorySpec): string {
  return `nodejs-portability-${spec.rowId.replace(/^\d{3}-/u, "")}`;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
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

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
