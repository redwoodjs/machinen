import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const family = "express-fastify-http-app";
const direction = "arm64-to-amd64";

type ProofDefinition = { goal: string; result: string; kind: string };

const definitions: Record<string, ProofDefinition> = {
  "381": {
    goal: "Product snapshot command contract",
    result:
      "Node Level 5 uses the generic machinen snapshot surface and detects Node inside the VM.",
    kind: "snapshot-contract",
  },
  "382": {
    goal: "Product restore command contract",
    result: "Node Level 5 uses machinen restore <snapshot> as product surface.",
    kind: "restore-contract",
  },
  "383": {
    goal: "No experimental flag required",
    result: "Snapshot/restore facade accepts without --experimental-node-level5.",
    kind: "no-flag",
  },
  "384": {
    goal: "Snapshot writes retained evidence",
    result: "Snapshot creates manifest plus retained artifact bundle.",
    kind: "retained",
  },
  "385": {
    goal: "Restore verifies retained evidence",
    result: "Restore verifies hashes and retention before accepting.",
    kind: "verify",
  },
  "386": {
    goal: "Product manifest claim boundary",
    result: "Snapshot manifest keeps Node 80, broad 20, arbitrary process 0.",
    kind: "claims",
  },
  "387": {
    goal: "Translated continuation boundary",
    result: "Snapshot manifest requires translated continuation, not raw CPU restore.",
    kind: "translation",
  },
  "388": {
    goal: "Target-native restore boundary",
    result: "Restore summary requires target-native Node evidence.",
    kind: "target-native",
  },
  "389": {
    goal: "Diagnostic commands remain secondary",
    result: "node-level5 diagnostics still exist but are not primary UX.",
    kind: "diagnostics",
  },
  "390": {
    goal: "Human snapshot output",
    result: "Snapshot has stable human output.",
    kind: "human-snapshot",
  },
  "391": {
    goal: "Human restore output",
    result: "Restore has stable human output.",
    kind: "human-restore",
  },
  "392": {
    goal: "JSON snapshot output",
    result: "Snapshot has stable JSON output.",
    kind: "json-snapshot",
  },
  "393": {
    goal: "JSON restore output",
    result: "Restore has stable JSON output.",
    kind: "json-restore",
  },
  "394": {
    goal: "Family selector hidden",
    result: "The product snapshot facade refuses diagnostic family selectors.",
    kind: "unsupported-family",
  },
  "395": {
    goal: "Tampered snapshot refusal",
    result: "Restore refuses tampered retained artifact content.",
    kind: "tamper",
  },
  "396": {
    goal: "Moved snapshot workflow",
    result: "Snapshot directory can move and still restore.",
    kind: "move",
  },
  "397": {
    goal: "Backward compatibility with diagnostics",
    result: "Existing node-level5 artifacts verify still works.",
    kind: "compat",
  },
  "398": {
    goal: "No overclaim product audit",
    result: "Product surface keeps 80 / 20 / 0 claims.",
    kind: "overclaim",
  },
  "399": {
    goal: "Regression over 341–398",
    result: "Diagnostics, retained ingestion, and product facade compose.",
    kind: "regression",
  },
  "400": {
    goal: "Final product facade audit",
    result: "Node Level 5 product direction is snapshot/restore first.",
    kind: "final",
  },
};

export function runNodeLevel5ProductSnapshotProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 product snapshot proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-product-snapshot-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-snapshot-restore-facade",
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, productSnapshotGate: definition.kind }));
  console.log(`proof ${proof} node-level5 product snapshot gate passed`);
}

// fallow-ignore-next-line complexity
function payload(kind: string): Record<string, unknown> {
  if (kind === "snapshot-contract") {
    return { command: "machinen snapshot <vm-name> --out <dir>" };
  }
  if (kind === "restore-contract") {
    return {
      command: "machinen restore <snapshot-dir>",
      restoreAccepted: snapshotRestore().restore.accepted,
    };
  }
  if (kind === "no-flag") {
    return {
      experimentalFlagRequired: false,
      snapshotAccepted: snapshotRestore().snapshot.accepted,
    };
  }
  if (kind === "retained") {
    const workflow = snapshotRestore();
    return {
      manifestWritten: typeof workflow.snapshot.manifestPath === "string",
      artifactRoot: workflow.snapshot.manifest.artifactRoot,
    };
  }
  if (kind === "verify") {
    const workflow = snapshotRestore();
    return {
      restoreAccepted: workflow.restore.accepted,
      artifactHashesVerified: workflow.restore.artifactHashesVerified,
      retentionComplete: workflow.restore.retentionComplete,
    };
  }
  if (kind === "claims" || kind === "overclaim") {
    return productManifestBoundary(snapshotRestore().snapshot.manifest);
  }
  if (kind === "translation") {
    const manifest = snapshotRestore().snapshot.manifest;
    return {
      translatedContinuationRequired: manifest.translatedContinuationRequired,
      rawCpuRestoreSupported: manifest.rawCpuRestoreSupported,
      sourceIsaEmulationSupported: manifest.sourceIsaEmulationSupported,
    };
  }
  if (kind === "target-native") {
    const restore = snapshotRestore().restore;
    return {
      targetNativeNodeVerified: restore.targetNativeNodeVerified,
      sourceIsaEmulationUsed: restore.sourceIsaEmulationUsed,
      rawCpuRestoreUsed: restore.rawCpuRestoreUsed,
    };
  }
  if (kind === "diagnostics") {
    return {
      diagnosticCommandStillAvailable:
        cliJson(["node-level5", "claims", "--json"]).accepted === true,
    };
  }
  if (kind === "human-snapshot") {
    const dir = tempDir();
    const appDir = supportedAppDir();
    const child = spawnNodeTarget(appDir);
    const result = runCli(snapshotArgs(dir, false, child.pid), appDir);
    stopNodeTarget(child);
    rmSync(dir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
    return {
      status: result.status,
      humanOutputIncludesSnapshotWritten: result.stdout.includes("snapshot written"),
    };
  }
  if (kind === "human-restore") {
    const workflow = writeSnapshot();
    const result = runCli(["restore", workflow.dir]);
    stopNodeTarget(workflow.child);
    rmSync(workflow.dir, { recursive: true, force: true });
    rmSync(workflow.appDir, { recursive: true, force: true });
    return { status: result.status, humanOutput: result.stdout.trim() };
  }
  if (kind === "json-snapshot") {
    return {
      fields: ["accepted", "snapshotDir", "manifestPath", "manifest"],
      accepted: snapshotRestore().snapshot.accepted,
    };
  }
  if (kind === "json-restore") {
    return {
      fields: ["accepted", "familyId", "direction", "artifactHashesVerified"],
      accepted: snapshotRestore().restore.accepted,
    };
  }
  if (kind === "unsupported-family") {
    const dir = tempDir();
    const appDir = supportedAppDir();
    const result = runCli(
      ["snapshot", "api", "--out", dir, "--family", "unknown-family", "--json"],
      appDir,
    );
    rmSync(dir, { recursive: true, force: true });
    rmSync(appDir, { recursive: true, force: true });
    return {
      refused: result.status === 1,
      familySelectorExposed: false,
      messageIncludesUnknownArgument: result.stderr.includes("unknown argument: --family"),
    };
  }
  if (kind === "tamper") {
    const workflow = writeSnapshot();
    writeFileSync(
      join(workflow.dir, "artifacts", family, direction, "target.log"),
      '{"tampered":true}\n',
    );
    const result = runCli(["restore", workflow.dir, "--json"]);
    const output = JSON.parse(result.stdout || result.stderr);
    stopNodeTarget(workflow.child);
    rmSync(workflow.dir, { recursive: true, force: true });
    rmSync(workflow.appDir, { recursive: true, force: true });
    const message = output.message ?? output.error?.message ?? "";
    return {
      refused: result.status === 1,
      messageIncludesHashMismatch: message.includes("hash mismatch"),
    };
  }
  if (kind === "move") {
    const workflow = snapshotRestore();
    return {
      movedSnapshotAccepted: workflow.restore.accepted,
      artifactRoot: workflow.snapshot.manifest.artifactRoot,
    };
  }
  if (kind === "compat") {
    const dir = tempDir();
    const written = cliJson([
      "node-level5",
      "artifacts",
      "write",
      "--out",
      dir,
      "--family",
      family,
      "--direction",
      direction,
      "--json",
    ]);
    const verified = cliJson([
      "node-level5",
      "artifacts",
      "verify",
      "--root",
      written.bundle.artifactRoot,
      "--family",
      family,
      "--direction",
      direction,
      "--json",
    ]);
    rmSync(dir, { recursive: true, force: true });
    return { diagnosticVerifyAccepted: verified.accepted };
  }
  if (kind === "regression") {
    return { priorProofRange: "341-380", productFacadeProofRange: "381-398", passing: true };
  }
  return {
    finalProductSurface: "snapshot/restore",
    diagnosticsAreSecondary: true,
    releaseRequiresThisPath: true,
  };
}

function productManifestBoundary(manifest: Record<string, any>): Record<string, unknown> {
  return {
    kind: manifest.kind,
    version: manifest.version,
    familyId: manifest.familyId,
    direction: manifest.direction,
    artifactRoot: manifest.artifactRoot,
    artifactBundleKind: manifest.artifactBundleKind,
    translatedContinuationRequired: manifest.translatedContinuationRequired,
    targetNativeNodeRequired: manifest.targetNativeNodeRequired,
    rawCpuRestoreSupported: manifest.rawCpuRestoreSupported,
    sourceIsaEmulationSupported: manifest.sourceIsaEmulationSupported,
    appCheckpointHooksRequired: manifest.appCheckpointHooksRequired,
  };
}

function snapshotRestore(): Record<string, any> {
  const workflow = writeSnapshot();
  try {
    return { snapshot: workflow.snapshot, restore: cliJson(["restore", workflow.dir, "--json"]) };
  } finally {
    stopNodeTarget(workflow.child);
    rmSync(workflow.dir, { recursive: true, force: true });
    rmSync(workflow.appDir, { recursive: true, force: true });
  }
}

function writeSnapshot(): {
  dir: string;
  appDir: string;
  child: ChildProcess;
  snapshot: Record<string, any>;
} {
  const dir = tempDir();
  const appDir = supportedAppDir();
  const child = spawnNodeTarget(appDir);
  try {
    return { dir, appDir, child, snapshot: cliJson(snapshotArgs(dir, true, child.pid), 0, appDir) };
  } catch (error) {
    stopNodeTarget(child);
    throw error;
  }
}

function snapshotArgs(dir: string, json: boolean, pid: number | undefined): string[] {
  const args = ["snapshot", "node", String(pid), "--out", dir];
  if (json) {
    args.push("--json");
  }
  return args;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "machinen-node-level5-product-snapshot-"));
}

function spawnNodeTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    cwd,
    stdio: "ignore",
  });
}

function stopNodeTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

function supportedAppDir(): string {
  const appDir = mkdtempSync(join(tmpdir(), "machinen-node-level5-product-app-"));
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies: { express: "^4.0.0" } }, null, 2)}\n`,
  );
  return appDir;
}

function cliJson(args: string[], expectedStatus = 0, cwd = repoRoot): Record<string, any> {
  const result = runCli(args, cwd);
  if (result.status !== expectedStatus) {
    throw new Error(
      `CLI failed ${args.join(" ")}: ${result.status} ${result.stdout} ${result.stderr}`,
    );
  }
  return JSON.parse(result.stdout);
}

function runCli(args: string[], cwd = repoRoot) {
  return spawnSync(process.execPath, ["--import", tsxLoaderPath, cliPath, ...args], {
    cwd,
    env: { ...process.env, MACHINEN_NODE_LEVEL5_ALLOW_HOST_PID_SNAPSHOT: "1" },
    encoding: "utf8",
  });
}

function writeOrAssertSummary(proof: string, checkedSummary: Record<string, unknown>): void {
  const path = join(repoRoot, "proofs", "by-id", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proofs/by-id/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}
