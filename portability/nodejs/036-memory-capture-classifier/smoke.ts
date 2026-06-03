#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { boot, type VmHandle } from "../../../packages/runtime/src/index.ts";

const rowId = "036-memory-capture-classifier";
const rowDir = "portability/nodejs/036-memory-capture-classifier";
const anchors = {
  scalar: "machinen-memory-category-scalar-v1",
  string: "machinen-memory-category-string-v1",
  object: "machinen-memory-category-object-v1",
  array: "machinen-memory-category-array-v1",
  closure: "machinen-memory-category-closure-v1",
  buffer: "machinen-memory-category-buffer-v1",
  typedArray: "machinen-memory-category-typed-array-v1",
  pendingPromise: "machinen-memory-category-pending-promise-v1",
} as const;

type GuestArch = "arm64" | "amd64";

function parseArgs(): { arch: GuestArch; out: string } {
  let arch: GuestArch = process.arch === "x64" ? "amd64" : "arm64";
  let out = "portability/nodejs/retained/nodejs-portability-memory-capture-classifier-report.json";
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index]!;
    if (arg === "--arch") {
      const value = process.argv[++index];
      if (value !== "arm64" && value !== "amd64") {
        throw new Error(`invalid --arch ${value}`);
      }
      arch = value;
    } else if (arg === "--out") {
      out = process.argv[++index] ?? out;
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return { arch, out: resolve(out) };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const started = Date.now();
  const report = await runSmoke(args.arch);
  const finalReport: Record<string, unknown> & { accepted: boolean } = {
    ...report,
    accepted: report.accepted === true,
    elapsedMs: Date.now() - started,
  };
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(finalReport, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(finalReport, null, 2)}\n`);
  process.exit(finalReport.accepted ? 0 : 1);
}

async function runSmoke(arch: GuestArch): Promise<Record<string, unknown>> {
  const vm = await bootVm(arch);
  try {
    await installNode(vm);
    await vm.writeFile(
      "/tmp/machinen-memory-classifier-app.mjs",
      readFileSync(join(rowDir, "app.mjs")),
    );
    await vm.writeFile("/tmp/machinen-memory-classifier-capture.mjs", guestCaptureSource());
    const result = await vm.execRaw(sourceCaptureCommand(), { execTimeoutMs: 180_000 });
    if (result.exitCode !== 0) {
      return report(false, arch, {
        error: result.stderr || result.stdout,
        stdout: result.stdout,
        stderr: result.stderr,
      });
    }
    const capture = JSON.parse(result.stdout.trim()) as Record<string, unknown>;
    const categories = capture.categories as Record<string, { found: boolean }>;
    const accepted = Object.keys(anchors).every((key) => categories[key]?.found === true);
    return report(accepted, arch, capture);
  } finally {
    await killVm(vm);
  }
}

function report(
  accepted: boolean,
  arch: GuestArch,
  capture: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: "machinen.nodejs-portability-memory-capture-classifier-smoke-report",
    version: 1,
    accepted,
    corpus: `portability/nodejs/${rowId}`,
    portabilityRow: rowId,
    architectures: [arch],
    executeVm: true,
    memoryCapture: "real-guest-proc-maps-and-proc-mem",
    summary: { verifiedVmRows: accepted ? 1 : 0, memoryClassifierRows: 1, refusedRows: 0 },
    results: [
      { id: rowId, architecture: arch, state: accepted ? "verified" : "failed-classified" },
    ],
    capture,
    evidence: {
      appPath: `${rowDir}/app.mjs`,
      appSha256: sha256(readFileSync(join(rowDir, "app.mjs"))),
      smokePath: `${rowDir}/smoke.ts`,
    },
    claimBoundary: {
      claims: [
        "real Node guest process memory is captured and classified for seeded V8/Node memory categories",
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

async function bootVm(arch: GuestArch): Promise<VmHandle> {
  const previousArch = process.env.MACHINEN_GUEST_ARCH;
  process.env.MACHINEN_GUEST_ARCH = arch;
  try {
    return await boot({
      ...baseAssetsFor(arch),
      name: `node-memory-classifier-${arch}-${Date.now()}`,
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

function baseAssetsFor(arch: GuestArch): { image: string; kernel: string; dtb?: string } {
  const assetsDir = resolve(process.env.MACHINEN_ASSETS_DIR ?? "release-assets");
  if (arch === "amd64") {
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
node /tmp/machinen-memory-classifier-app.mjs >/tmp/machinen-memory-classifier.log 2>&1 &
pid=$!
for i in 1 2 3 4 5; do node -e "fetch('http://127.0.0.1:3000/state').then(r=>r.text()).then(t=>process.exit(t.trim()==='ok'?0:1)).catch(()=>process.exit(1))" && break || sleep 1; done
node /tmp/machinen-memory-classifier-capture.mjs "$pid"
status=$?
kill "$pid" 2>/dev/null || true
exit "$status"`;
}

function guestCaptureSource(): string {
  return `import crypto from "node:crypto";
import fs from "node:fs";
const pid = process.argv[2];
const anchors = ${JSON.stringify(anchors)};
const mapsText = fs.readFileSync(\`/proc/\${pid}/maps\`, "utf8");
const maps = mapsText.trim().split("\\n").map(parseMap).filter(Boolean);
const mem = fs.openSync(\`/proc/\${pid}/mem\`, "r");
try {
  const categories = Object.fromEntries(Object.entries(anchors).map(([key, value]) => [key, { anchor: value, found: false, hits: [] }]));
  let readableBytesScanned = 0;
  let readableMappings = 0;
  for (const map of maps) {
    if (!map.perms.startsWith("r")) continue;
    readableMappings += 1;
    for (const [key, value] of Object.entries(anchors)) {
      const hits = scanMap(mem, map, Buffer.from(value));
      if (hits.length > 0) {
        categories[key].found = true;
        categories[key].hits.push(...hits.slice(0, 4).map((hit) => ({ address: hex(hit.absolute), mapping: hex(map.start) + "-" + hex(map.end), perms: map.perms })));
      }
    }
    readableBytesScanned += Math.min(map.size, 1024 * 1024);
  }
  const fragmentHashes = maps.filter((map) => map.perms.startsWith("r")).slice(0, 8).map((map) => hashFragment(mem, map));
  console.log(JSON.stringify({
    accepted: Object.values(categories).every((category) => category.found),
    pid: Number(pid),
    nodeArch: process.arch === "x64" ? "amd64" : "arm64",
    mapsSha256: crypto.createHash("sha256").update(mapsText).digest("hex"),
    mappingCount: maps.length,
    readableMappings,
    readableBytesScanned,
    categories,
    fragmentHashes,
    captureMethod: "guest-proc-maps-and-proc-mem-anchor-classifier",
    appHookUsedForCapture: false,
    rawV8HeapRestored: false,
    samePidRestored: false,
  }));
} finally {
  fs.closeSync(mem);
}
function parseMap(line) {
  const match = /([0-9a-f]+)-([0-9a-f]+)\\s+(\\S+)\\s+([0-9a-f]+)\\s+(\\S+)\\s+(\\d+)\\s*(.*)/u.exec(line);
  if (!match) return undefined;
  const start = Number.parseInt(match[1], 16);
  const end = Number.parseInt(match[2], 16);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start) return undefined;
  return { start, end, perms: match[3], size: end - start, path: match[7] ?? "" };
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
function hashFragment(mem, map) {
  const size = Math.min(map.size, 4096);
  const bytes = Buffer.alloc(size);
  let bytesRead = 0;
  try { bytesRead = fs.readSync(mem, bytes, 0, size, map.start); } catch { return { mapping: hex(map.start) + "-" + hex(map.end), readable: false }; }
  return { mapping: hex(map.start) + "-" + hex(map.end), readable: true, bytesRead, sha256: crypto.createHash("sha256").update(bytes.subarray(0, bytesRead)).digest("hex") };
}
function hex(value) { return "0x" + Math.trunc(value).toString(16); }
`;
}

async function killVm(vm: VmHandle): Promise<void> {
  await Promise.race([
    vm.kill().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
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
  };
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
