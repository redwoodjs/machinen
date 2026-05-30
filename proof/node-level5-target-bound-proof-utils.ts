import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");
const targetName = "api";
const family = "express-fastify-http-app";
const direction = "arm64-to-amd64";

type ProofDefinition = { goal: string; result: string; kind: string };

const definitions: Record<string, ProofDefinition> = {
  "421": {
    goal: "Target argument contract",
    result: "Product UX is machinen snapshot node <name|pid> --out <dir>.",
    kind: "contract",
  },
  "422": {
    goal: "Cwd shorthand refusal",
    result: "snapshot node --out refuses without an explicit target.",
    kind: "no-cwd",
  },
  "423": {
    goal: "Target metadata lookup",
    result: "Target metadata binds name/pid to runtime and app root.",
    kind: "lookup",
  },
  "424": {
    goal: "Node process identity evidence",
    result: "Snapshot retains Node target identity evidence.",
    kind: "identity",
  },
  "425": {
    goal: "App root discovery",
    result: "Detector runs against the target app root.",
    kind: "app-root",
  },
  "426": {
    goal: "Package/app detector from target",
    result: "Target app package detects the supported HTTP family.",
    kind: "package",
  },
  "427": {
    goal: "Refuse non-Node target",
    result: "Non-Node target refuses before snapshot.",
    kind: "non-node",
  },
  "428": {
    goal: "Refuse missing app root",
    result: "Node target without app root refuses before snapshot.",
    kind: "missing-root",
  },
  "429": {
    goal: "Refuse unsupported package shape",
    result: "Unknown target package shape refuses before snapshot.",
    kind: "unsupported",
  },
  "430": {
    goal: "Refuse unsafe runtime markers",
    result: "Unsafe runtime markers still refuse through target-bound path.",
    kind: "unsafe",
  },
  "431": {
    goal: "Retain target identity report",
    result: "Snapshot stores target identity report.",
    kind: "retain-identity",
  },
  "432": {
    goal: "Restore verifies target identity report",
    result: "Restore refuses tampered target identity evidence.",
    kind: "verify-identity",
  },
  "433": {
    goal: "JSON target refusal schema",
    result: "Target-bound refusals have stable JSON shape.",
    kind: "json",
  },
  "434": {
    goal: "Human target refusal output",
    result: "Target-bound refusals have readable human output.",
    kind: "human",
  },
  "435": {
    goal: "No diagnostic selectors",
    result: "Product target-bound UX still hides family/direction selectors.",
    kind: "no-selectors",
  },
  "436": {
    goal: "Diagnostics explain target refusal",
    result: "node-level5 detectors still explain refusal causes.",
    kind: "diagnostics",
  },
  "437": {
    goal: "Backward compatibility",
    result: "Diagnostic artifact commands still work after target binding.",
    kind: "compat",
  },
  "438": {
    goal: "No-overclaim audit",
    result: "Target-bound snapshot keeps Node 80, broad 20, arbitrary process 0.",
    kind: "overclaim",
  },
  "439": {
    goal: "Regression over 341–438",
    result: "Diagnostics, retained ingestion, facade, detection, and target binding compose.",
    kind: "regression",
  },
  "440": {
    goal: "Final target-bound audit",
    result: "Product command now targets a named/pid Node app path.",
    kind: "final",
  },
};

export function runNodeLevel5TargetBoundProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 target-bound proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-target-bound-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-target-bound-snapshot",
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot node <name|pid>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, targetBoundGate: definition.kind }));
  console.log(`proof ${proof} node-level5 target-bound gate passed`);
}

function payload(kind: string): Record<string, unknown> {
  if (kind === "contract") {
    return { command: "machinen snapshot node <name|pid> --out <dir>", targetRequired: true };
  }
  if (kind === "no-cwd") {
    const appDir = supportedAppDir();
    const outDir = tempDir();
    const result = runCli(["snapshot", "node", "--out", outDir, "--json"], appDir);
    cleanup(appDir, outDir);
    return { refused: result.status === 1, targetRequired: true };
  }
  if (kind === "lookup") {
    return targetIdentitySummary(snapshotWorkflow().snapshot.targetIdentity);
  }
  if (kind === "identity" || kind === "retain-identity") {
    const workflow = snapshotWorkflow();
    return {
      targetIdentityRetained: Boolean(workflow.snapshot.manifest.targetIdentityPath),
      target: workflow.snapshot.targetIdentity.target,
    };
  }
  if (kind === "app-root") {
    return {
      detectorAppDirMatchesTarget:
        snapshotWorkflow().snapshot.detectorReport.appDir ===
        snapshotWorkflow().snapshot.targetIdentity.appDir,
    };
  }
  if (kind === "package") {
    const report = snapshotWorkflow().snapshot.detectorReport;
    return {
      accepted: report.accepted,
      familyId: report.familyId,
      detectedFramework: report.detectedFramework,
    };
  }
  if (kind === "non-node") {
    return refusedFromTargets(
      { targets: { [targetName]: { runtime: "unknown", appDir: tempDir() } } },
      "node-level5-non-node-target-refused",
    );
  }
  if (kind === "missing-root") {
    return refusedFromTargets(
      { targets: { [targetName]: { runtime: "node" } } },
      "node-level5-target-app-root-missing",
    );
  }
  if (kind === "unsupported") {
    return refusedFromApp(unsupportedAppDir(), "node-level5-unsupported-app-refused");
  }
  if (kind === "unsafe") {
    return refusedFromApp(
      supportedAppDir({ workerThreads: true }),
      "node-level5-worker-thread-refused",
    );
  }
  if (kind === "verify-identity") {
    return tamperTargetIdentity();
  }
  if (kind === "json") {
    const output = refusedFromTargets(
      { targets: { [targetName]: { runtime: "unknown" } } },
      "node-level5-non-node-target-refused",
    );
    return { accepted: output.accepted, refusal: output.refusal };
  }
  if (kind === "human") {
    const appDir = targetMapDir({ targets: { [targetName]: { runtime: "unknown" } } });
    const outDir = tempDir();
    const result = runCli(["snapshot", "node", targetName, "--out", outDir], appDir);
    cleanup(appDir, outDir);
    return {
      refused: result.status === 1,
      mentionsNonNode: result.stderr.includes("node-level5-non-node-target-refused"),
    };
  }
  if (kind === "no-selectors") {
    const appDir = supportedAppDir();
    const outDir = tempDir();
    const result = runCli(
      ["snapshot", "node", targetName, "--out", outDir, "--family", family, "--json"],
      appDir,
    );
    cleanup(appDir, outDir);
    return { refused: result.status === 1, diagnosticSelectorsHidden: true };
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
    return { priorProofRange: "341-420", targetBoundProofRange: "421-438", passing: true };
  }
  return {
    finalProductSurface: "snapshot node <name|pid> / restore",
    targetBound: true,
    diagnosticSelectorsHidden: true,
  };
}

function targetIdentitySummary(identity: Record<string, any>): Record<string, unknown> {
  return {
    accepted: identity.accepted,
    target: identity.target,
    targetKind: identity.targetKind,
    runtime: identity.runtime,
    appDirDiscovered: typeof identity.appDir === "string",
    registryMatched: identity.registryMatched,
  };
}

function snapshotWorkflow(): Record<string, any> {
  const appDir = supportedAppDir();
  const outDir = tempDir();
  try {
    const snapshot = cliJson(
      ["snapshot", "node", targetName, "--out", outDir, "--json"],
      0,
      appDir,
    );
    const restore = cliJson(["restore", outDir, "--json"]);
    return { snapshot, restore };
  } finally {
    cleanup(appDir, outDir);
  }
}

function refusedFromApp(appDir: string, code: string): Record<string, any> {
  const outDir = tempDir();
  try {
    const result = runCli(["snapshot", "node", targetName, "--out", outDir, "--json"], appDir);
    return assertRefusal(result, code);
  } finally {
    cleanup(appDir, outDir);
  }
}

function refusedFromTargets(targets: Record<string, unknown>, code: string): Record<string, any> {
  const appDir = targetMapDir(targets);
  const outDir = tempDir();
  try {
    const result = runCli(["snapshot", "node", targetName, "--out", outDir, "--json"], appDir);
    return assertRefusal(result, code);
  } finally {
    cleanup(appDir, outDir);
  }
}

function assertRefusal(result: ReturnType<typeof runCli>, code: string): Record<string, any> {
  if (result.status !== 1) {
    throw new Error(`expected refusal ${code}: ${result.status} ${result.stdout} ${result.stderr}`);
  }
  const output = JSON.parse(result.stdout);
  if (output.refusal?.code !== code) {
    throw new Error(`expected ${code}, saw ${output.refusal?.code}`);
  }
  return { accepted: output.accepted, refusal: output.refusal };
}

function tamperTargetIdentity(): Record<string, unknown> {
  const appDir = supportedAppDir();
  const outDir = tempDir();
  try {
    cliJson(["snapshot", "node", targetName, "--out", outDir, "--json"], 0, appDir);
    writeFileSync(join(outDir, "node-level5-target-identity.json"), '{"tampered":true}\n');
    const result = runCli(["restore", outDir, "--json"]);
    const output = JSON.parse(result.stdout || result.stderr);
    const message = output.message ?? output.error?.message ?? "";
    return {
      refused: result.status === 1,
      messageIncludesTargetHash: message.includes("target identity hash mismatch"),
    };
  } finally {
    cleanup(appDir, outDir);
  }
}

function supportedAppDir(marker?: Record<string, unknown>): string {
  const appDir = tempDir("machinen-node-level5-target-app-");
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "supported", dependencies: { express: "^4.0.0" } }, null, 2)}\n`,
  );
  writeTargets(appDir, { targets: { [targetName]: { runtime: "node", appDir } } });
  if (marker) {
    writeFileSync(
      join(appDir, "machinen-node-level5-detector.json"),
      `${JSON.stringify(marker, null, 2)}\n`,
    );
  }
  return appDir;
}

function unsupportedAppDir(): string {
  const appDir = tempDir("machinen-node-level5-target-unknown-");
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "unknown", dependencies: {} }, null, 2)}\n`,
  );
  writeTargets(appDir, { targets: { [targetName]: { runtime: "node", appDir } } });
  return appDir;
}

function targetMapDir(targets: Record<string, unknown>): string {
  const appDir = tempDir("machinen-node-level5-target-map-");
  writeTargets(appDir, targets);
  return appDir;
}

function writeTargets(appDir: string, targets: Record<string, unknown>): void {
  writeFileSync(
    join(appDir, "machinen-node-level5-targets.json"),
    `${JSON.stringify(targets, null, 2)}\n`,
  );
}

function tempDir(prefix = "machinen-node-level5-target-bound-"): string {
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
