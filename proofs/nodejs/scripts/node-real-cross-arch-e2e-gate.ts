import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Direction = "arm64-to-amd64" | "amd64-to-arm64";

type EvidenceRow = {
  id: string;
  direction: Direction;
  accepted: boolean;
  sourceArch: "arm64" | "amd64";
  targetArch: "arm64" | "amd64";
  files: Record<string, string>;
  verifier: {
    expectedSha256: string;
    actualSha256: string;
    expectedBytes: number;
    actualBytes: number;
    passed: boolean;
  };
  productCommands: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <dir>"];
  prohibitedMechanisms: {
    sourceIsaEmulationUsed: false;
    sourceTextReplayAcceptedAsRestore: false;
    sidecarRuntimeUsed: false;
    appHooksRequired: false;
  };
  errors: string[];
};

type GateReport = {
  kind: "machinen.node-real-cross-arch-e2e-gate-report";
  version: 1;
  accepted: boolean;
  root: string;
  generatedAt: string;
  rowCount: number;
  rows: EvidenceRow[];
  claimUse: "seed-evidence-only";
  nodeProductSupportClaimed: 0;
  broadNodeProductSupportClaimed: 0;
  arbitraryProcessCrossArchRestoreClaimed: 0;
  unblocks: string[];
  stillRequiredBefore100: string[];
};

const directions: Array<{
  direction: Direction;
  sourceArch: "arm64" | "amd64";
  targetArch: "arm64" | "amd64";
}> = [
  { direction: "arm64-to-amd64", sourceArch: "arm64", targetArch: "amd64" },
  { direction: "amd64-to-arm64", sourceArch: "amd64", targetArch: "arm64" },
];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const report = buildNodeRealCrossArchE2eGateReport(args.root);
  if (args.out) {
    writeFileSync(args.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `node real cross-arch e2e gate: ${report.accepted ? "accepted" : "refused"} ${report.rows.filter((row) => row.accepted).length}/${report.rowCount} rows\n`,
    );
  }
  process.exit(report.accepted ? 0 : 1);
}

export function buildNodeRealCrossArchE2eGateReport(root: string): GateReport {
  const resolvedRoot = resolve(root);
  const rows = directions.map((entry) => validateDirection(resolvedRoot, entry));
  return {
    kind: "machinen.node-real-cross-arch-e2e-gate-report",
    version: 1,
    accepted: rows.every((row) => row.accepted),
    root: displayPath(resolvedRoot),
    generatedAt: new Date().toISOString(),
    rowCount: rows.length,
    rows,
    claimUse: "seed-evidence-only",
    nodeProductSupportClaimed: 0,
    broadNodeProductSupportClaimed: 0,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    unblocks: [
      "bidirectional clean Node HTTP service VM-first product snapshot/restore seed evidence",
    ],
    stillRequiredBefore100: [
      "row-by-row retained E2E artifact coverage for every supported Node support-matrix row",
      "retained refusal artifacts for unsupported workers, native addons, Wasm/external memory, TLS active state, active async work, and child process live state",
      "claim-level audit proving no raw CPU restore, source-ISA emulation, app hooks, sidecars, or metadata-only success",
    ],
  };
}

function validateDirection(
  root: string,
  entry: { direction: Direction; sourceArch: "arm64" | "amd64"; targetArch: "arm64" | "amd64" },
): EvidenceRow {
  const dir = join(root, entry.direction);
  const files = {
    snapshotSummary: join(dir, "source", "snapshot.json"),
    sourceProductCommand: join(dir, "source", "product-command.txt"),
    portableNodeManifest: join(dir, "source", "portable-node.json"),
    portableNodeAppTar: join(dir, "source", "portable-node-app.tar.gz"),
    restoreSummary: join(dir, "target", "restore.json"),
    targetProductCommand: join(dir, "target", "product-command.txt"),
    targetHttpBody: join(dir, "target", "target-http-body.txt"),
  };
  const errors: string[] = [];
  for (const [label, path] of Object.entries(files)) {
    if (!existsSync(path)) {
      errors.push(`${label} missing: ${path}`);
    }
  }
  const snapshot = readJsonIfPresent(files.snapshotSummary, errors, "snapshotSummary");
  const manifest = readJsonIfPresent(files.portableNodeManifest, errors, "portableNodeManifest");
  const restore = readJsonIfPresent(files.restoreSummary, errors, "restoreSummary");
  const sourceCommand = existsSync(files.sourceProductCommand)
    ? readFileSync(files.sourceProductCommand, "utf8")
    : "";
  const targetCommand = existsSync(files.targetProductCommand)
    ? readFileSync(files.targetProductCommand, "utf8")
    : "";
  const body = existsSync(files.targetHttpBody)
    ? readFileSync(files.targetHttpBody)
    : Buffer.alloc(0);
  const appTar = existsSync(files.portableNodeAppTar)
    ? readFileSync(files.portableNodeAppTar)
    : Buffer.alloc(0);

  if (!sourceCommand.includes("snapshot")) {
    errors.push("sourceProductCommand must record a machinen snapshot command");
  }
  if (!targetCommand.includes("restore")) {
    errors.push("targetProductCommand must record a machinen restore command");
  }
  expectEqual(errors, snapshot?.dry_run, false, "snapshotSummary.dry_run");
  expectEqual(
    errors,
    manifest?.kind,
    "machinen.portable-node-snapshot",
    "portableNodeManifest.kind",
  );
  expectEqual(errors, manifest?.sourceArch, entry.sourceArch, "portableNodeManifest.sourceArch");
  expectEqual(errors, manifest?.runtime, "node", "portableNodeManifest.runtime");
  expectEqual(errors, manifest?.subset, "node-http-clean-root-v1", "portableNodeManifest.subset");
  expectEqual(errors, sha256(appTar), manifest?.appTar?.sha256, "portable app tar sha256");
  expectEqual(errors, appTar.length, manifest?.appTar?.bytes, "portable app tar bytes");

  expectEqual(
    errors,
    restore?.kind,
    "machinen.portable-node-restore-summary",
    "restoreSummary.kind",
  );
  expectEqual(errors, restore?.state, "completed", "restoreSummary.state");
  expectEqual(errors, restore?.sourceArch, entry.sourceArch, "restoreSummary.sourceArch");
  expectEqual(errors, restore?.targetArch, entry.targetArch, "restoreSummary.targetArch");
  expectEqual(errors, restore?.migrationCompleted, true, "restoreSummary.migrationCompleted");
  expectEqual(
    errors,
    restore?.targetVerifierResult,
    "passed",
    "restoreSummary.targetVerifierResult",
  );
  expectEqual(
    errors,
    restore?.sourceIsaEmulationUsed,
    false,
    "restoreSummary.sourceIsaEmulationUsed",
  );
  expectEqual(
    errors,
    restore?.sourceTextReplayAcceptedAsRestore,
    false,
    "restoreSummary.sourceTextReplayAcceptedAsRestore",
  );
  expectEqual(errors, restore?.sidecarRuntimeUsed, false, "restoreSummary.sidecarRuntimeUsed");
  expectEqual(errors, restore?.appHooksRequired, false, "restoreSummary.appHooksRequired");

  const actualSha256 = sha256(body);
  const expectedSha256 = String(manifest?.verifier?.sha256 ?? "");
  const expectedBytes = Number(manifest?.verifier?.bytes ?? -1);
  expectEqual(errors, actualSha256, expectedSha256, "target HTTP body sha256");
  expectEqual(errors, body.length, expectedBytes, "target HTTP body bytes");

  return {
    id: `node-e2e-${entry.direction}`,
    direction: entry.direction,
    accepted: errors.length === 0,
    sourceArch: entry.sourceArch,
    targetArch: entry.targetArch,
    files: Object.fromEntries(
      Object.entries(files).map(([label, path]) => [label, displayPath(path)]),
    ),
    verifier: {
      expectedSha256,
      actualSha256,
      expectedBytes,
      actualBytes: body.length,
      passed:
        errors.length === 0 && actualSha256 === expectedSha256 && body.length === expectedBytes,
    },
    productCommands: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <dir>"],
    prohibitedMechanisms: {
      sourceIsaEmulationUsed: false,
      sourceTextReplayAcceptedAsRestore: false,
      sidecarRuntimeUsed: false,
      appHooksRequired: false,
    },
    errors,
  };
}

function readJsonIfPresent(path: string, errors: string[], label: string): any {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    errors.push(
      `${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
    return undefined;
  }
}

function expectEqual(errors: string[], actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    errors.push(`${label} expected ${JSON.stringify(expected)} got ${JSON.stringify(actual)}`);
  }
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function displayPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel.startsWith("..") ? path : rel;
}

function parseArgs(args: string[]): { root: string; out?: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "../../..");
  const parsed: { root: string; out?: string; json: boolean } = {
    root: join(repoRoot, "proofs/nodejs/real-cross-arch-e2e-gate/retained"),
    json: false,
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--root") {
      parsed.root = takeValue(args, ++index, arg);
      continue;
    }
    if (arg === "--out") {
      parsed.out = takeValue(args, ++index, arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
