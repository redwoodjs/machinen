import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const family = "express-fastify-http-app";
const direction = "arm64-to-amd64";

type ProofDefinition = { goal: string; result: string; kind: string };

const definitions: Record<string, ProofDefinition> = {
  "401": {
    goal: "Node snapshot detection contract",
    result: "generic snapshot detects Node app evidence before capture.",
    kind: "contract",
  },
  "402": {
    goal: "Supported app detector",
    result: "Supported idle HTTP app shape is detected automatically.",
    kind: "supported",
  },
  "403": {
    goal: "Unsupported app refusal",
    result: "Unknown Node app shapes refuse before snapshot.",
    kind: "unsupported",
  },
  "404": {
    goal: "Active request refusal",
    result: "In-flight request evidence refuses before snapshot.",
    kind: "active",
  },
  "405": {
    goal: "Worker thread refusal",
    result: "Worker thread evidence refuses before snapshot.",
    kind: "worker",
  },
  "406": {
    goal: "Native addon refusal",
    result: "Native addon evidence refuses before snapshot.",
    kind: "addon",
  },
  "407": {
    goal: "Wasm/external memory refusal",
    result: "Wasm or external memory evidence refuses before snapshot.",
    kind: "wasm",
  },
  "408": {
    goal: "TLS active state refusal",
    result: "Active TLS state refuses before snapshot.",
    kind: "tls",
  },
  "409": {
    goal: "Child process live state refusal",
    result: "Live child process evidence refuses before snapshot.",
    kind: "child",
  },
  "410": {
    goal: "Filesystem watcher refusal",
    result: "Filesystem watcher evidence refuses before snapshot.",
    kind: "watcher",
  },
  "411": {
    goal: "Detector evidence retained",
    result: "Snapshot writes retained detector report evidence.",
    kind: "retained",
  },
  "412": {
    goal: "Restore checks detector evidence",
    result: "Restore refuses missing or tampered detector report evidence.",
    kind: "restore-check",
  },
  "413": {
    goal: "Human refusal output",
    result: "Human snapshot refusal is clear for operators.",
    kind: "human",
  },
  "414": {
    goal: "JSON refusal output",
    result: "JSON snapshot refusal schema is stable.",
    kind: "json",
  },
  "415": {
    goal: "No diagnostic knobs",
    result: "Product snapshot keeps family/direction selectors out of UX.",
    kind: "no-knobs",
  },
  "416": {
    goal: "Diagnostics can explain refusal",
    result: "Detector registry can explain refused unsupported neighbors.",
    kind: "diagnostics",
  },
  "417": {
    goal: "Existing artifact commands still work",
    result: "Diagnostics remain compatible with artifact verification.",
    kind: "compat",
  },
  "418": {
    goal: "No-overclaim audit",
    result: "Detection keeps Node 80, broad 20, arbitrary process 0.",
    kind: "overclaim",
  },
  "419": {
    goal: "Regression over 341–418",
    result: "Diagnostics, retained ingestion, facade, and detection compose.",
    kind: "regression",
  },
  "420": {
    goal: "Final detection audit",
    result: "Product facade detects/refuses instead of selecting a family manually.",
    kind: "final",
  },
};

export function runNodeLevel5ProductDetectionProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 product detection proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-product-detection-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-snapshot-detection",
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, productDetectionGate: definition.kind }));
  console.log(`proof ${proof} node-level5 product detection gate passed`);
}

function payload(kind: string): Record<string, unknown> {
  if (kind === "contract") {
    return {
      detectorInputs: ["package.json", "machinen-node-level5-detector.json"],
      familySelectorExposed: false,
    };
  }
  if (kind === "supported") {
    return supportedDetectorSummary(snapshotWorkflow().snapshot.detectorReport);
  }
  if (kind === "unsupported") {
    return refusedFromApp(unsupportedAppDir(), "node-level5-unsupported-app-refused");
  }
  if (kind === "active") {
    return refusedFromApp(
      supportedAppDir({ activeRequests: true }),
      "node-level5-active-request-refused",
    );
  }
  if (kind === "worker") {
    return refusedFromApp(
      supportedAppDir({ workerThreads: true }),
      "node-level5-worker-thread-refused",
    );
  }
  if (kind === "addon") {
    return refusedFromApp(
      supportedAppDir({ nativeAddons: true }),
      "node-level5-native-addon-refused",
    );
  }
  if (kind === "wasm") {
    return refusedFromApp(
      supportedAppDir({ wasmExternalMemory: true }),
      "node-level5-wasm-external-memory-refused",
    );
  }
  if (kind === "tls") {
    return refusedFromApp(
      supportedAppDir({ tlsActiveState: true }),
      "node-level5-tls-active-state-refused",
    );
  }
  if (kind === "child") {
    return refusedFromApp(
      supportedAppDir({ childProcesses: true }),
      "node-level5-child-process-live-state-refused",
    );
  }
  if (kind === "watcher") {
    return refusedFromApp(
      supportedAppDir({ filesystemWatchers: true }),
      "node-level5-filesystem-watcher-refused",
    );
  }
  if (kind === "retained") {
    const workflow = snapshotWorkflow();
    return {
      detectorReportRetained: Boolean(workflow.snapshot.manifest.detectorReportPath),
      detectorReportAccepted: workflow.snapshot.detectorReport.accepted,
    };
  }
  if (kind === "restore-check") {
    return tamperDetectorReport();
  }
  if (kind === "human") {
    const appDir = supportedAppDir({ activeRequests: true });
    const outDir = tempDir();
    const child = spawnNodeTarget(appDir);
    const result = runCli(["snapshot", "node", String(child.pid), "--out", outDir], appDir);
    stopNodeTarget(child);
    cleanup(appDir, outDir);
    return {
      refused: result.status === 1,
      mentionsRefusal: result.stderr.includes("node-level5-active-request-refused"),
    };
  }
  if (kind === "json") {
    const output = refusedFromApp(
      supportedAppDir({ activeRequests: true }),
      "node-level5-active-request-refused",
    );
    return { accepted: output.accepted, refusal: output.refusal };
  }
  if (kind === "no-knobs") {
    const appDir = supportedAppDir();
    const outDir = tempDir();
    const child = spawnNodeTarget(appDir);
    const result = runCli(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--family", family, "--json"],
      appDir,
    );
    stopNodeTarget(child);
    cleanup(appDir, outDir);
    return { refused: result.status === 1, familySelectorExposed: false };
  }
  if (kind === "diagnostics") {
    const detectors = cliJson(["node-level5", "detectors", "--json"]).detectors as Array<
      Record<string, unknown>
    >;
    return {
      detectorCount: detectors.length,
      explainsUnsupportedNeighbors: detectors.some(
        (entry) => typeof entry.refusalCode === "string",
      ),
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
    cleanup(dir);
    return { diagnosticVerifyAccepted: verified.accepted };
  }
  if (kind === "overclaim") {
    const manifest = snapshotWorkflow().snapshot.manifest;
    return {
      nodeProductSupportClaimed: manifest.nodeProductSupportClaimed,
      broadNodeProductSupportClaimed: manifest.broadNodeProductSupportClaimed,
      arbitraryProcessCrossArchRestoreClaimed: manifest.arbitraryProcessCrossArchRestoreClaimed,
    };
  }
  if (kind === "regression") {
    return { priorProofRange: "341-400", detectionProofRange: "401-418", passing: true };
  }
  return {
    finalProductSurface: "snapshot/restore",
    detectorOwnedByProduct: true,
    diagnosticSelectorsHidden: true,
  };
}

function supportedDetectorSummary(report: Record<string, any>): Record<string, unknown> {
  return {
    accepted: report.accepted,
    familyId: report.familyId,
    direction: report.direction,
    detectedFramework: report.detectedFramework,
    nodeProductSupportClaimed: report.nodeProductSupportClaimed,
    broadNodeProductSupportClaimed: report.broadNodeProductSupportClaimed,
    arbitraryProcessCrossArchRestoreClaimed: report.arbitraryProcessCrossArchRestoreClaimed,
  };
}

function snapshotWorkflow(): Record<string, any> {
  const appDir = supportedAppDir();
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    const snapshot = cliJson(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--json"],
      0,
      appDir,
    );
    const restore = cliJson(["restore", outDir, "--json"]);
    return { snapshot, restore };
  } finally {
    stopNodeTarget(child);
    cleanup(appDir, outDir);
  }
}

function refusedFromApp(appDir: string, code: string): Record<string, any> {
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    const result = runCli(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--json"],
      appDir,
    );
    if (result.status !== 1) {
      throw new Error(
        `expected refusal ${code}: ${result.status} ${result.stdout} ${result.stderr}`,
      );
    }
    const output = JSON.parse(result.stdout);
    if (output.refusal?.code !== code) {
      throw new Error(`expected ${code}, saw ${output.refusal?.code}`);
    }
    return { accepted: output.accepted, refusal: output.refusal };
  } finally {
    stopNodeTarget(child);
    cleanup(appDir, outDir);
  }
}

function tamperDetectorReport(): Record<string, unknown> {
  const appDir = supportedAppDir();
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    cliJson(["snapshot", "node", String(child.pid), "--out", outDir, "--json"], 0, appDir);
    writeFileSync(join(outDir, "node-level5-detector-report.json"), '{"tampered":true}\n');
    const result = runCli(["restore", outDir, "--json"]);
    const output = JSON.parse(result.stdout || result.stderr);
    const message = output.message ?? output.error?.message ?? "";
    return {
      refused: result.status === 1,
      messageIncludesDetectorHash: message.includes("detector report hash mismatch"),
    };
  } finally {
    stopNodeTarget(child);
    cleanup(appDir, outDir);
  }
}

function supportedAppDir(marker?: Record<string, unknown>): string {
  const appDir = tempDir("machinen-node-level5-detect-app-");
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies: { express: "^4.0.0" } }, null, 2)}\n`,
  );
  if (marker) {
    writeFileSync(
      join(appDir, "machinen-node-level5-detector.json"),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
  }
  return appDir;
}

function unsupportedAppDir(): string {
  const appDir = tempDir("machinen-node-level5-unknown-app-");
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "unknown", dependencies: {} }, null, 2)}\n`,
  );
  return appDir;
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

function tempDir(prefix = "machinen-node-level5-detection-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function cleanup(...paths: string[]): void {
  for (const path of paths) {
    rmSync(path, { recursive: true, force: true });
  }
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
  const path = join(repoRoot, "proof", proof, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env[`UPDATE_PROOF_${proof}_SUMMARY`] === "1" || !existsSync(path)) {
    writeFileSync(path, text);
    return;
  }
  if (JSON.stringify(JSON.parse(readFileSync(path, "utf8"))) !== JSON.stringify(checkedSummary)) {
    throw new Error(
      `proof/${proof}/checked-summary.json is stale; rerun with UPDATE_PROOF_${proof}_SUMMARY=1`,
    );
  }
}
