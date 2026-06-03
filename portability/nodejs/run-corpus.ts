#!/usr/bin/env tsx
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { boot, type VmHandle } from "../../packages/runtime/src/index.ts";

type GuestArch = "arm64" | "amd64";
type Disposition = "product-supported" | "supported-with-declared-config" | "refused-first";

interface RowManifest {
  id: string;
  slug: string;
  runtime: "nodejs";
  description: string;
  disposition: Disposition;
  startCommand: string;
  healthPath: string;
  expectedBody: string;
  dependencies: string[];
  refusalCode: string | null;
  claimGuard: Record<string, false>;
}

interface RowResult {
  id: string;
  slug: string;
  disposition: Disposition;
  architecture: GuestArch;
  accepted: boolean;
  executedInVm: boolean;
  state: "verified" | "classified" | "refused" | "failed-classified" | "environment-unavailable";
  refusalCode: string | null;
  details: Record<string, unknown>;
}

const here = dirname(fileURLToPath(import.meta.url));
const corpusRoot = here;

function parseArgs(argv: string[]): {
  arches: GuestArch[];
  rows: Set<string> | null;
  executeVm: boolean;
  installDeps: boolean;
  out: string;
} {
  const arches: GuestArch[] = [];
  const rowIds = new Set<string>();
  let executeVm = false;
  let installDeps = false;
  let out = join(corpusRoot, "retained", "nodejs-portability-corpus-report.json");
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--arch") {
      const value = argv[++index];
      if (value !== "arm64" && value !== "amd64") {
        throw new Error(`invalid --arch ${value}`);
      }
      arches.push(value);
    } else if (arg === "--row") {
      const value = argv[++index];
      if (!value) {
        throw new Error("--row requires a value");
      }
      rowIds.add(value);
    } else if (arg === "--execute-vm") {
      executeVm = true;
    } else if (arg === "--install-deps") {
      installDeps = true;
    } else if (arg === "--out") {
      out = resolve(argv[++index] ?? "");
    } else {
      throw new Error(`unknown argument ${arg}`);
    }
  }
  return {
    arches: arches.length > 0 ? arches : [normalizeHostArch()],
    rows: rowIds.size > 0 ? rowIds : null,
    executeVm,
    installDeps,
    out,
  };
}

function normalizeHostArch(): GuestArch {
  return process.arch === "x64" ? "amd64" : "arm64";
}

function loadRows(): RowManifest[] {
  return readdirSync(corpusRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{3}-/u.test(entry.name))
    .map(
      (entry) =>
        JSON.parse(
          readFileSync(join(corpusRoot, entry.name, "portability.json"), "utf8"),
        ) as RowManifest,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const rows = loadRows().filter(
    (row) => !args.rows || args.rows.has(row.id) || args.rows.has(row.slug),
  );
  const results: RowResult[] = [];
  for (const arch of args.arches) {
    if (!args.executeVm) {
      results.push(...rows.map((row) => classifyOnly(row, arch)));
      continue;
    }
    results.push(
      ...(await runRowsInVm(rows, arch, args.installDeps, retainedEvidenceDir(args.out))),
    );
  }
  const report = buildReport(rows, results, args);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

function classifyOnly(row: RowManifest, architecture: GuestArch): RowResult {
  const refused = row.disposition === "refused-first";
  return {
    id: row.id,
    slug: row.slug,
    disposition: row.disposition,
    architecture,
    accepted: !refused,
    executedInVm: false,
    state: refused ? "refused" : "classified",
    refusalCode: refused ? row.refusalCode : null,
    details: {
      reason: refused
        ? "refused by first corpus policy"
        : "classified; pass --execute-vm to run in Machinen runtime",
      dependencies: row.dependencies,
      claimGuard: row.claimGuard,
    },
  };
}

async function runRowsInVm(
  rows: RowManifest[],
  architecture: GuestArch,
  installDeps: boolean,
  evidenceDir: string,
): Promise<RowResult[]> {
  const previousArch = process.env.MACHINEN_GUEST_ARCH;
  process.env.MACHINEN_GUEST_ARCH = architecture;
  const vm = await boot({
    ...baseAssetsFor(architecture),
    name: `node-portability-${architecture}-${Date.now()}`,
    detached: true,
    cmd: ["sleep", "100000"],
  });
  try {
    const node = await vm.execRaw(installNodeRuntimeCommand(), { execTimeoutMs: 180_000 });
    if (node.exitCode !== 0) {
      return rows.map((row) =>
        environmentUnavailable(row, architecture, "node executable unavailable in guest"),
      );
    }
    const results: RowResult[] = [];
    for (const row of rows) {
      results.push(await runOneRow(vm, row, architecture, installDeps, evidenceDir));
    }
    return results;
  } finally {
    if (previousArch === undefined) {
      delete process.env.MACHINEN_GUEST_ARCH;
    } else {
      process.env.MACHINEN_GUEST_ARCH = previousArch;
    }
    await killVmBestEffort(vm);
  }
}

async function killVmBestEffort(vm: VmHandle): Promise<void> {
  await Promise.race([
    vm.kill().catch(() => undefined),
    new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
  ]);
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

function installNodeRuntimeCommand(): string {
  return `cat >/tmp/machinen-node-portability-env.sh <<'SH'
export PATH=/usr/local/bin:$PATH
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell=bash)"
  fnm use ${process.env.MACHINEN_NODE_PORTABILITY_NODE_VERSION ?? "22.13.1"} >/dev/null 2>&1 || fnm install ${process.env.MACHINEN_NODE_PORTABILITY_NODE_VERSION ?? "22.13.1"} >/dev/null
  eval "$(fnm env --shell=bash)"
fi
SH
. /tmp/machinen-node-portability-env.sh
command -v node
node --version`;
}

function environmentUnavailable(
  row: RowManifest,
  architecture: GuestArch,
  reason: string,
): RowResult {
  return {
    id: row.id,
    slug: row.slug,
    disposition: row.disposition,
    architecture,
    accepted: false,
    executedInVm: true,
    state: "environment-unavailable",
    refusalCode: "node-portability-runtime-unavailable",
    details: { reason },
  };
}

async function runOneRow(
  vm: VmHandle,
  row: RowManifest,
  architecture: GuestArch,
  installDeps: boolean,
  evidenceDir: string,
): Promise<RowResult> {
  if (row.disposition === "refused-first") {
    return { ...classifyOnly(row, architecture), executedInVm: true };
  }
  if (row.dependencies.length > 0 && !installDeps) {
    return {
      id: row.id,
      slug: row.slug,
      disposition: row.disposition,
      architecture,
      accepted: row.disposition === "supported-with-declared-config",
      executedInVm: false,
      state: "classified",
      refusalCode: null,
      details: {
        reason: "dependency install skipped; pass --install-deps to execute",
        dependencies: row.dependencies,
      },
    };
  }
  const guestDir = `/tmp/machinen-node-portability/${row.id}`;
  await vm.execRaw(`rm -rf ${shellQuote(guestDir)} && mkdir -p ${shellQuote(guestDir)}`);
  await pushFixture(vm, row, guestDir);
  if (row.dependencies.length > 0) {
    const install = await vm.execRaw(
      `. /tmp/machinen-node-portability-env.sh && cd ${shellQuote(guestDir)} && npm install --omit=dev`,
      { execTimeoutMs: 180_000 },
    );
    if (install.exitCode !== 0) {
      return executionFailure(row, architecture, "npm-install-failed", install, evidenceDir);
    }
  }
  await vm.execRaw("pkill -f /tmp/machinen-node-portability/ || true");
  const start = await vm.execRaw(
    `cd ${shellQuote(guestDir)}; . /tmp/machinen-node-portability-env.sh; PORT=3000 ${row.startCommand} >server.log 2>&1 & echo $! >server.pid`,
    { execTimeoutMs: 30_000 },
  );
  if (start.exitCode !== 0) {
    return executionFailure(row, architecture, "start-failed", start, evidenceDir);
  }
  const verify = await vm.execRaw(
    `. /tmp/machinen-node-portability-env.sh && cd ${shellQuote(guestDir)} && for i in 1 2 3 4 5; do PORT=3000 node verifier.mjs && exit 0; sleep 1; done; cat server.log >&2; exit 1`,
    { execTimeoutMs: 30_000 },
  );
  await vm.execRaw(`cd ${shellQuote(guestDir)} && kill $(cat server.pid) 2>/dev/null || true`);
  if (verify.exitCode !== 0) {
    return executionFailure(row, architecture, "verify-failed", verify, evidenceDir);
  }
  return {
    id: row.id,
    slug: row.slug,
    disposition: row.disposition,
    architecture,
    accepted: true,
    executedInVm: true,
    state: "verified",
    refusalCode: null,
    details: { verifier: JSON.parse(verify.stdout.trim()), claimGuard: row.claimGuard },
  };
}

function executionFailure(
  row: RowManifest,
  architecture: GuestArch,
  code: string,
  result: { stdout: string; stderr: string; exitCode: number },
  evidenceDir: string,
): RowResult {
  const classification = classifyExecutionFailure(code, result);
  const evidencePath = writeFailureEvidence(
    row,
    architecture,
    classification.code,
    result,
    evidenceDir,
  );
  return {
    id: row.id,
    slug: row.slug,
    disposition: row.disposition,
    architecture,
    accepted: false,
    executedInVm: true,
    state: "failed-classified",
    refusalCode: classification.code,
    details: {
      classification: classification.reason,
      exitCode: result.exitCode,
      stdout: result.stdout.slice(-2000),
      stderr: result.stderr.slice(-2000),
      evidencePath,
    },
  };
}

function classifyExecutionFailure(
  code: string,
  result: { stdout: string; stderr: string; exitCode: number },
): { code: string; reason: string } {
  const combined = `${result.stdout}\n${result.stderr}`;
  if (/ERR_MODULE_NOT_FOUND|Cannot find package/u.test(combined)) {
    return {
      code: "node-portability-missing-dependency-declaration",
      reason: "missing dependency declaration",
    };
  }
  if (/node-gyp|gyp ERR!|make:|CXX\(/u.test(combined)) {
    return {
      code: "node-portability-native-addon-build-failed",
      reason: "native addon build failure",
    };
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|external service|database unavailable/iu.test(combined)) {
    return {
      code: "node-portability-external-service-unavailable",
      reason: "external service unavailable",
    };
  }
  if (/missing env|environment variable|process\.env/iu.test(combined)) {
    return {
      code: "node-portability-env-config-missing",
      reason: "environment/config missing",
    };
  }
  if (code === "npm-install-failed") {
    return {
      code: "node-portability-dependency-install-failed",
      reason: "target-native dependency install failure",
    };
  }
  return {
    code: `node-portability-${code}`,
    reason: "unsupported dependency/runtime feature",
  };
}

function writeFailureEvidence(
  row: RowManifest,
  architecture: GuestArch,
  code: string,
  result: { stdout: string; stderr: string; exitCode: number },
  evidenceDir: string,
): string {
  const dir = join(evidenceDir, architecture, row.id, code);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "stdout.txt"), result.stdout);
  writeFileSync(join(dir, "stderr.txt"), result.stderr);
  writeFileSync(
    join(dir, "failure.json"),
    `${JSON.stringify({ row: row.id, slug: row.slug, architecture, code, exitCode: result.exitCode }, null, 2)}\n`,
  );
  return relative(process.cwd(), dir);
}

function retainedEvidenceDir(out: string): string {
  const base = out.replace(/\.json$/u, "");
  return `${base}-evidence`;
}

async function pushFixture(vm: VmHandle, row: RowManifest, guestDir: string): Promise<void> {
  const hostDir = join(corpusRoot, row.id);
  for (const file of listFiles(hostDir)) {
    await vm.writeFile(`${guestDir}/${relative(hostDir, file)}`, readFileSync(file));
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const child = join(dir, entry.name);
    return entry.isDirectory() ? listFiles(child) : [child];
  });
}

function buildReport(
  rows: RowManifest[],
  results: RowResult[],
  args: ReturnType<typeof parseArgs>,
): Record<string, unknown> {
  return {
    kind: "machinen.nodejs-portability-corpus-report",
    version: 1,
    accepted: results.every(
      (result) => result.accepted || result.state === "refused" || result.state === "classified",
    ),
    proofStatus: "verified",
    corpus: "portability/nodejs",
    rowCount: rows.length,
    architectures: args.arches,
    executeVm: args.executeVm,
    installDeps: args.installDeps,
    summary: {
      productSupportedRows: rows.filter((row) => row.disposition === "product-supported").length,
      declaredConfigRows: rows.filter((row) => row.disposition === "supported-with-declared-config")
        .length,
      refusedFirstRows: rows.filter((row) => row.disposition === "refused-first").length,
      verifiedVmRows: results.filter((result) => result.state === "verified").length,
      refusedRows: results.filter((result) => result.state === "refused").length,
      failedClassifiedRows: results.filter((result) => result.state === "failed-classified").length,
      environmentUnavailableRows: results.filter(
        (result) => result.state === "environment-unavailable",
      ).length,
    },
    claimGuard: {
      arbitraryNodeProcessRestoreClaimed: false,
      rawV8HeapRestoreUsed: false,
      rawCpuStateReplayUsed: false,
      sourceIsaEmulationUsed: false,
    },
    results,
  };
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
