#!/usr/bin/env tsx
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { boot, type VmHandle } from "../../../packages/runtime/src/index.ts";

const KIND = "machinen.node-memory-scalar-reconstruction-proof";
const ANCHOR = "machinen-memory-scalar-count-anchor-v1";
const EXPECTED_SOURCE_VALUE = 41;
const EXPECTED_TARGET_INCREMENT = 42;

type GuestArch = "arm64" | "amd64";

interface SourceCapture {
  kind: `${typeof KIND}.source-capture`;
  accepted: boolean;
  sourceArch: GuestArch;
  anchor: string;
  variable: "count";
  capturedValue: number;
  captureMethod: "guest-proc-mem-v8-context-smi-scan";
  appHookUsedForCapture: false;
  rawV8HeapRestored: false;
  samePidRestored: false;
  evidence: Record<string, unknown>;
}

interface TargetResult {
  kind: `${typeof KIND}.target-result`;
  accepted: boolean;
  targetArch: GuestArch;
  sourceArch: GuestArch;
  capturedValue: number;
  reconstructedInitialValue: number;
  incrementedValue: number;
  targetNativeNode: true;
  appHookUsedForCapture: false;
  rawV8HeapRestored: false;
  samePidRestored: false;
}

interface CombinedReport {
  kind: typeof KIND;
  version: 1;
  accepted: boolean;
  scope: "single-memory-only-node-global-scalar-count";
  sourceArch: GuestArch;
  targetArch: GuestArch;
  migrationCompleted: boolean;
  sourceCapture: SourceCapture;
  targetResult: TargetResult;
  claimBoundary: {
    claims: string[];
    notClaimed: string[];
  };
  claimGuard: {
    arbitraryNodeProcessRestoreClaimed: false;
    arbitraryLinuxProcessRestoreClaimed: false;
    rawV8HeapRestoreUsed: false;
    rawCpuStateReplayUsed: false;
    sourceIsaEmulationUsed: false;
    samePidContinuationClaimed: false;
    activeRequestOrSocketContinuationClaimed: false;
  };
}

function parseArgs(argv: string[]): { mode: string; out: string; sourceCapture?: string } {
  const mode = argv[0] ?? "verify";
  let out =
    "proofs/nodejs/memory-scalar-reconstruction/retained/node-memory-scalar-reconstruction-report.json";
  let sourceCapture: string | undefined;
  for (let index = 1; index < argv.length; index++) {
    const arg = argv[index]!;
    if (arg === "--out") {
      out = argv[++index] ?? out;
    } else if (arg === "--source-capture") {
      sourceCapture = argv[++index];
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return { mode, out: resolve(out), sourceCapture: sourceCapture && resolve(sourceCapture) };
}

function hostArch(): GuestArch {
  return process.arch === "x64" ? "amd64" : "arm64";
}

function currentGuestArch(): GuestArch {
  const arch = process.env.MACHINEN_GUEST_ARCH;
  if (arch === "arm64" || arch === "amd64") {
    return arch;
  }
  return hostArch();
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(args.out), { recursive: true });
  if (args.mode === "source") {
    const sourceCapture = await captureSourceScalar(currentGuestArch());
    writeJson(args.out, sourceCapture);
    return;
  }
  if (args.mode === "target") {
    if (!args.sourceCapture) {
      throw new Error("target mode requires --source-capture <file>");
    }
    const sourceCapture = JSON.parse(readFileSync(args.sourceCapture, "utf8")) as SourceCapture;
    const target = await reconstructTargetScalar(sourceCapture, currentGuestArch());
    writeJson(args.out, target);
    return;
  }
  if (args.mode !== "verify") {
    throw new Error(`unknown mode ${args.mode}`);
  }
  const sourceCapture = await captureSourceScalar(currentGuestArch());
  const targetResult = await reconstructTargetScalar(sourceCapture, currentGuestArch());
  writeJson(args.out, combineReport(sourceCapture, targetResult));
}

async function captureSourceScalar(sourceArch: GuestArch): Promise<SourceCapture> {
  const vm = await bootVm(sourceArch, `node-memory-scalar-source-${Date.now()}`);
  try {
    await installNode(vm);
    await vm.writeFile("/tmp/machinen-memory-source-app.mjs", sourceAppSource());
    await vm.writeFile("/tmp/machinen-memory-capture.mjs", guestCaptureSource());
    const result = await vm.execRaw(sourceCaptureCommand(), { execTimeoutMs: 180_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "source scalar memory capture failed");
    }
    const captured = JSON.parse(result.stdout.trim()) as SourceCapture;
    return { ...captured, sourceArch };
  } finally {
    await killVm(vm);
  }
}

async function reconstructTargetScalar(
  sourceCapture: SourceCapture,
  targetArch: GuestArch,
): Promise<TargetResult> {
  const vm = await bootVm(targetArch, `node-memory-scalar-target-${Date.now()}`);
  try {
    await installNode(vm);
    await vm.writeFile(
      "/tmp/machinen-memory-target-app.mjs",
      targetAppSource(sourceCapture.capturedValue),
    );
    await vm.writeFile("/tmp/machinen-memory-target-verify.mjs", targetVerifierSource());
    const result = await vm.execRaw(targetVerifyCommand(), { execTimeoutMs: 120_000 });
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "target scalar reconstruction failed");
    }
    const verifier = JSON.parse(result.stdout.trim()) as {
      initial: number;
      incremented: number;
    };
    return {
      kind: `${KIND}.target-result`,
      accepted:
        verifier.initial === EXPECTED_SOURCE_VALUE &&
        verifier.incremented === EXPECTED_TARGET_INCREMENT,
      targetArch,
      sourceArch: sourceCapture.sourceArch,
      capturedValue: sourceCapture.capturedValue,
      reconstructedInitialValue: verifier.initial,
      incrementedValue: verifier.incremented,
      targetNativeNode: true,
      appHookUsedForCapture: false,
      rawV8HeapRestored: false,
      samePidRestored: false,
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
node /tmp/machinen-memory-source-app.mjs >/tmp/machinen-memory-source.log 2>&1 &
pid=$!
for i in 1 2 3 4 5; do node -e "fetch('http://127.0.0.1:3000/value').then(r=>r.text()).then(t=>process.exit(t.trim()==='41'?0:1)).catch(()=>process.exit(1))" && break || sleep 1; done
node /tmp/machinen-memory-capture.mjs "$pid" ${shellQuote(ANCHOR)} ${EXPECTED_SOURCE_VALUE}
status=$?
kill "$pid" 2>/dev/null || true
exit "$status"`;
}

function targetVerifyCommand(): string {
  return `. /tmp/machinen-node-env.sh
cd /tmp
node /tmp/machinen-memory-target-app.mjs >/tmp/machinen-memory-target.log 2>&1 &
pid=$!
for i in 1 2 3 4 5; do node /tmp/machinen-memory-target-verify.mjs && status=0 && break || status=$?; sleep 1; done
kill "$pid" 2>/dev/null || true
exit "\${status:-1}"`;
}

function sourceAppSource(): string {
  return `import http from "node:http";
const counter = (() => {
  const anchor = ${JSON.stringify(ANCHOR)};
  let count = ${EXPECTED_SOURCE_VALUE};
  return {
    anchor() { return anchor; },
    value() { return count; },
    inc() { count += 1; return count; }
  };
})();
globalThis.__machinenMemoryCounter = counter;
setInterval(() => globalThis.__machinenMemoryCounter.anchor(), 1000);
http.createServer((req, res) => {
  if (req.url === "/value") {
    res.end(String(counter.value()));
    return;
  }
  if (req.url === "/inc") {
    res.end(String(counter.inc()));
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(3000, "127.0.0.1");
`;
}

function targetAppSource(initialValue: number): string {
  return `import http from "node:http";
let count = ${JSON.stringify(initialValue)};
http.createServer((req, res) => {
  if (req.url === "/value") {
    res.end(String(count));
    return;
  }
  if (req.url === "/inc") {
    count += 1;
    res.end(String(count));
    return;
  }
  res.writeHead(404);
  res.end("not found");
}).listen(3000, "127.0.0.1");
`;
}

function targetVerifierSource(): string {
  return `const initial = await fetch("http://127.0.0.1:3000/value").then((res) => res.text()).then(Number);
const incremented = await fetch("http://127.0.0.1:3000/inc").then((res) => res.text()).then(Number);
console.log(JSON.stringify({ initial, incremented }));
process.exit(initial === ${EXPECTED_SOURCE_VALUE} && incremented === ${EXPECTED_TARGET_INCREMENT} ? 0 : 1);
`;
}

function guestCaptureSource(): string {
  return `import fs from "node:fs";
const pid = process.argv[2];
const anchor = process.argv[3];
const expected = Number(process.argv[4]);
const anchorBytes = Buffer.from(anchor);
const maps = fs.readFileSync(\`/proc/\${pid}/maps\`, "utf8").trim().split("\\n").map(parseMap).filter(Boolean);
const mem = fs.openSync(\`/proc/\${pid}/mem\`, "r");
try {
  const anchors = findAnchorPointers(mem, maps, anchorBytes);
  const recovered = findContextSmi(mem, maps, anchors, expected);
  if (!recovered) {
    console.error(JSON.stringify({ accepted: false, reason: "count Smi not found near anchor context", anchorCandidates: anchors.length }));
    process.exit(2);
  }
  console.log(JSON.stringify({
    kind: "${KIND}.source-capture",
    accepted: true,
    sourceArch: process.arch === "x64" ? "amd64" : "arm64",
    anchor,
    variable: "count",
    capturedValue: recovered.value,
    captureMethod: "guest-proc-mem-v8-context-smi-scan",
    appHookUsedForCapture: false,
    rawV8HeapRestored: false,
    samePidRestored: false,
    evidence: recovered,
  }));
} finally {
  fs.closeSync(mem);
}

function parseMap(line) {
  const match = /([0-9a-f]+)-([0-9a-f]+)\\s+(\\S+)\\s+/.exec(line);
  if (!match || !match[3].startsWith("r")) return undefined;
  const start = Number.parseInt(match[1], 16);
  const end = Number.parseInt(match[2], 16);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return undefined;
  return { start, end, perms: match[3], size: end - start };
}

function findAnchorPointers(mem, maps, needle) {
  const out = [];
  for (const map of maps) {
    for (const hit of scanMap(mem, map, needle)) {
      for (const headerBytes of [16, 24, 8, 0, 32]) {
        if (hit.absolute < headerBytes) continue;
        out.push({ tagged: hit.absolute - headerBytes + 1, anchorAddress: hit.absolute, mapStart: map.start, mapEnd: map.end });
      }
    }
  }
  return out;
}

function findContextSmi(mem, maps, anchors, expected) {
  for (const anchor of anchors) {
    const pointer = littleEndian64(BigInt(anchor.tagged));
    for (const map of maps.filter((candidate) => candidate.perms.includes("w"))) {
      for (const hit of scanMap(mem, map, pointer)) {
        const window = readWindow(mem, hit.absolute - 256, 512);
        for (let offset = 0; offset <= window.bytes.length - 8; offset += 8) {
          const value = decodeSmi(window.bytes, offset);
          if (value === expected) {
            return {
              value,
              anchorTaggedAddress: hex(anchor.tagged),
              anchorAddress: hex(anchor.anchorAddress),
              contextPointerAddress: hex(hit.absolute),
              contextSlotAddress: hex(window.start + offset),
              smiEncoding: "v8-pointer-compressed-or-tagged-smi",
            };
          }
        }
      }
    }
  }
  return undefined;
}

function scanMap(mem, map, needle) {
  const hits = [];
  const chunkSize = 1024 * 1024;
  let carry = Buffer.alloc(0);
  for (let address = map.start; address < map.end; address += chunkSize) {
    const size = Math.min(chunkSize, map.end - address);
    const chunk = Buffer.alloc(size);
    let bytesRead = 0;
    try {
      bytesRead = fs.readSync(mem, chunk, 0, size, address);
    } catch {
      carry = Buffer.alloc(0);
      continue;
    }
    const bytes = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
    let offset = bytes.indexOf(needle);
    while (offset !== -1) {
      const absolute = address - carry.length + offset;
      if (absolute >= map.start && absolute < map.end) hits.push({ absolute });
      offset = bytes.indexOf(needle, offset + 1);
    }
    carry = bytes.subarray(Math.max(0, bytes.length - needle.length + 1));
  }
  return hits;
}

function readWindow(mem, start, size) {
  const safeStart = Math.max(0, start);
  const bytes = Buffer.alloc(size);
  let bytesRead = 0;
  try {
    bytesRead = fs.readSync(mem, bytes, 0, size, safeStart);
  } catch {
    return { start: safeStart, bytes: Buffer.alloc(0) };
  }
  return { start: safeStart, bytes: bytes.subarray(0, bytesRead) };
}

function littleEndian64(value) {
  const out = Buffer.alloc(8);
  let rest = value;
  for (let index = 0; index < 8; index++) {
    out[index] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  return out;
}

function decodeSmi(bytes, offset) {
  let word = 0n;
  for (let index = 7; index >= 0; index--) word = (word << 8n) | BigInt(bytes[offset + index] ?? 0);
  if ((word & 0xffffffffn) === 0n) {
    const raw = Number((word >> 32n) & 0xffffffffn);
    return raw > 0x7fffffff ? raw - 0x100000000 : raw;
  }
  if ((word & 1n) === 0n) {
    const shifted = word >> 1n;
    if (shifted <= 1000000n) return Number(shifted);
  }
  return undefined;
}

function hex(value) { return \`0x\${Math.trunc(value).toString(16)}\`; }
`;
}

function combineReport(sourceCapture: SourceCapture, targetResult: TargetResult): CombinedReport {
  return {
    kind: KIND,
    version: 1,
    accepted: sourceCapture.accepted && targetResult.accepted,
    scope: "single-memory-only-node-global-scalar-count",
    sourceArch: sourceCapture.sourceArch,
    targetArch: targetResult.targetArch,
    migrationCompleted: sourceCapture.accepted && targetResult.accepted,
    sourceCapture,
    targetResult,
    claimBoundary: {
      claims: [
        "one controlled memory-only Node count scalar was captured from source process memory and reconstructed target-native",
      ],
      notClaimed: [
        "arbitrary Node process restore",
        "raw V8 heap restore",
        "same PID continuation",
        "active request/socket continuation",
        "worker/native-addon/child-process live-state transfer",
        "source ISA emulation",
        "arbitrary Linux process restore",
      ],
    },
    claimGuard: claimGuard(),
  };
}

function claimGuard(): CombinedReport["claimGuard"] {
  return {
    arbitraryNodeProcessRestoreClaimed: false,
    arbitraryLinuxProcessRestoreClaimed: false,
    rawV8HeapRestoreUsed: false,
    rawCpuStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
    samePidContinuationClaimed: false,
    activeRequestOrSocketContinuationClaimed: false,
  };
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

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
