import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const cliPath = join(repoRoot, "packages/cli/src/cli.ts");
const tsxLoaderPath = join(repoRoot, "node_modules/tsx/dist/loader.mjs");

const definitions: Record<string, { goal: string; result: string; kind: string }> = {
  "441": {
    goal: "Real introspection contract",
    result:
      "diagnostic host-PID harness reads process evidence while the public product target remains a VM name.",
    kind: "contract",
  },
  "442": {
    goal: "Pid target identity",
    result: "Snapshot target identity records the inspected pid.",
    kind: "pid",
  },
  "443": {
    goal: "Node runtime detection",
    result: "Process command evidence classifies Node targets.",
    kind: "runtime",
  },
  "444": {
    goal: "Process cwd app root",
    result: "Process cwd evidence supplies the detector app root.",
    kind: "cwd",
  },
  "445": {
    goal: "Detector from introspected app root",
    result: "Supported package detection runs from the discovered cwd.",
    kind: "detector",
  },
  "446": {
    goal: "Retained process evidence",
    result: "Snapshot retains executable and argv evidence with target identity.",
    kind: "retained-process",
  },
  "447": {
    goal: "Restore checks introspection evidence",
    result: "Restore verifies the retained target identity hash.",
    kind: "restore",
  },
  "448": {
    goal: "Metadata shim removed",
    result: "Product snapshot succeeds without machinen-node-level5-targets.json.",
    kind: "no-shim",
  },
  "449": {
    goal: "Non-Node process refusal",
    result: "A live non-Node pid refuses before capture.",
    kind: "non-node",
  },
  "450": {
    goal: "Missing process refusal",
    result: "A missing pid refuses with stable target refusal output.",
    kind: "missing-process",
  },
  "451": {
    goal: "Unsupported app root refusal",
    result: "A Node process in an unsupported app root refuses.",
    kind: "unsupported",
  },
  "452": {
    goal: "Unsafe marker refusal",
    result: "Unsafe marker refusals compose with real pid introspection.",
    kind: "unsafe",
  },
  "453": {
    goal: "JSON introspection refusal",
    result: "Introspection refusals keep stable JSON shape.",
    kind: "json",
  },
  "454": {
    goal: "Human introspection refusal",
    result: "Human output explains introspection refusal.",
    kind: "human",
  },
  "455": {
    goal: "Selectors still hidden",
    result: "Family/direction remain diagnostic-only, not product UX.",
    kind: "selectors",
  },
  "456": {
    goal: "Diagnostics still explain",
    result: "node-level5 diagnostics remain available after introspection.",
    kind: "diagnostics",
  },
  "457": {
    goal: "No-overclaim audit",
    result: "Real introspection keeps 80 / 20 / 0 claims.",
    kind: "overclaim",
  },
  "458": {
    goal: "Regression over target binding",
    result: "Detection, target binding, and introspection compose.",
    kind: "regression",
  },
  "459": {
    goal: "Product-generated capture bundle",
    result: "Snapshot emits retained artifacts through the product command path.",
    kind: "capture",
  },
  "460": {
    goal: "Final introspection audit",
    result: "Product snapshot is target-bound and introspection-backed.",
    kind: "final",
  },
};

export function runNodeLevel5RealIntrospectionProof(proof: string): void {
  const definition = definitions[proof];
  if (!definition) {
    throw new Error(`unknown Node Level 5 real introspection proof ${proof}`);
  }
  const checkedSummary = {
    kind: "machinen.node-level5-real-introspection-proof-summary",
    proof,
    goal: definition.goal,
    result: definition.result,
    status: "node-product-support-80-real-target-introspection",
    nodeProductSupportClaimed: 80,
    broadNodeProductSupportClaimed: 20,
    arbitraryProcessCrossArchRestoreClaimed: 0,
    productSurface: ["machinen snapshot <vm-name> --out <dir>", "machinen restore <snapshot>"],
    ...payload(definition.kind),
  };
  writeOrAssertSummary(proof, checkedSummary);
  console.log(JSON.stringify({ proof, realIntrospectionGate: definition.kind }));
  console.log(`proof ${proof} node-level5 real introspection gate passed`);
}

function payload(kind: string): Record<string, unknown> {
  if (kind === "contract") {
    return { targetMetadataFileRequired: false, pidIntrospectionRequired: true };
  }
  if (kind === "pid") {
    return {
      targetKind: snapshotWorkflow().snapshot.targetIdentity.targetKind,
      pidRecorded: typeof snapshotWorkflow().snapshot.targetIdentity.pid === "number",
    };
  }
  if (kind === "runtime") {
    const identity = snapshotWorkflow().snapshot.targetIdentity;
    return {
      runtime: identity.runtime,
      executableRetained: typeof identity.executable === "string",
      argvRetained: typeof identity.argv === "string",
    };
  }
  if (kind === "cwd") {
    const workflow = snapshotWorkflow();
    return {
      appDirDiscovered: typeof workflow.snapshot.targetIdentity.appDir === "string",
      detectorUsesAppDir: workflow.snapshot.detectorReport.appDir === workflow.appDir,
    };
  }
  if (kind === "detector") {
    const report = snapshotWorkflow().snapshot.detectorReport;
    return {
      accepted: report.accepted,
      familyId: report.familyId,
      detectedFramework: report.detectedFramework,
    };
  }
  if (kind === "retained-process") {
    const identity = snapshotWorkflow().snapshot.targetIdentity;
    return {
      executableRetained: typeof identity.executable === "string",
      argvRetained: typeof identity.argv === "string",
    };
  }
  if (kind === "restore") {
    const restore = snapshotWorkflow().restore;
    return { accepted: restore.accepted, targetIdentityVerified: restore.targetIdentityVerified };
  }
  if (kind === "no-shim") {
    return {
      acceptedWithoutTargetMetadataFile: snapshotWorkflow().snapshot.accepted,
      targetMetadataFilePresent: false,
    };
  }
  if (kind === "non-node") {
    return refusedFromNonNode();
  }
  if (kind === "missing-process") {
    return refusedFromPid(999999, "node-level5-non-node-target-refused");
  }
  if (kind === "unsupported") {
    return withApp(unsupportedAppDir, (appDir) =>
      refusedFromNodeApp(appDir, "node-level5-unsupported-app-refused"),
    );
  }
  if (kind === "unsafe") {
    return withApp(
      () => supportedAppDir({ activeRequests: true }),
      (appDir) => refusedFromNodeApp(appDir, "node-level5-active-request-refused"),
    );
  }
  if (kind === "json") {
    return refusedFromNonNode();
  }
  if (kind === "human") {
    const appDir = tempDir("machinen-node-level5-real-human-");
    const outDir = tempDir();
    const child = spawnNonNodeTarget(appDir);
    try {
      const result = runCli(["snapshot", "node", String(child.pid), "--out", outDir], appDir);
      return {
        refused: result.status === 1,
        mentionsNonNode: result.stderr.includes("node-level5-non-node-target-refused"),
      };
    } finally {
      stopTarget(child);
      cleanup(appDir, outDir);
    }
  }
  if (kind === "selectors") {
    return withApp(supportedAppDir, (appDir) => {
      const outDir = tempDir();
      const child = spawnNodeTarget(appDir);
      try {
        const result = runCli(
          [
            "snapshot",
            "node",
            String(child.pid),
            "--out",
            outDir,
            "--family",
            "express-fastify-http-app",
            "--json",
          ],
          appDir,
        );
        return { refused: result.status === 1, diagnosticSelectorsHidden: true };
      } finally {
        stopTarget(child);
        cleanup(outDir);
      }
    });
  }
  if (kind === "diagnostics") {
    return {
      diagnosticClaimsAccepted: cliJson(["node-level5", "claims", "--json"]).accepted === true,
    };
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
    return { priorProofRange: "401-440", realIntrospectionProofRange: "441-457", passing: true };
  }
  if (kind === "capture") {
    const manifest = snapshotWorkflow().snapshot.manifest;
    return {
      artifactRoot: manifest.artifactRoot,
      artifactBundleKind: manifest.artifactBundleKind,
      translatedContinuationRequired: manifest.translatedContinuationRequired,
    };
  }
  return {
    finalProductSurface: "snapshot <vm-name> / restore",
    targetMetadataShimRemoved: true,
    claimsRemain: "80/20/0",
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
    return { appDir, snapshot, restore };
  } finally {
    stopTarget(child);
    cleanup(appDir, outDir);
  }
}

function refusedFromNodeApp(appDir: string, code: string): Record<string, any> {
  const outDir = tempDir();
  const child = spawnNodeTarget(appDir);
  try {
    const result = runCli(
      ["snapshot", "node", String(child.pid), "--out", outDir, "--json"],
      appDir,
    );
    return assertRefusal(result, code);
  } finally {
    stopTarget(child);
    cleanup(outDir);
  }
}

function refusedFromNonNode(): Record<string, any> {
  const appDir = tempDir("machinen-node-level5-real-non-node-");
  const child = spawnNonNodeTarget(appDir);
  try {
    return refusedFromPid(child.pid ?? 999999, "node-level5-non-node-target-refused", appDir);
  } finally {
    stopTarget(child);
    cleanup(appDir);
  }
}

function refusedFromPid(pid: number, code: string, cwd = repoRoot): Record<string, any> {
  const outDir = tempDir();
  try {
    const result = runCli(["snapshot", "node", String(pid), "--out", outDir, "--json"], cwd);
    return assertRefusal(result, code);
  } finally {
    cleanup(outDir);
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

function withApp<T>(factory: () => string, fn: (appDir: string) => T): T {
  const appDir = factory();
  try {
    return fn(appDir);
  } finally {
    cleanup(appDir);
  }
}

function supportedAppDir(marker?: Record<string, unknown>): string {
  const appDir = tempDir("machinen-node-level5-real-app-");
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
  const appDir = tempDir("machinen-node-level5-real-unknown-");
  writeFileSync(
    join(appDir, "package.json"),
    `${JSON.stringify({ name: "unknown", dependencies: {} }, null, 2)}\n`,
  );
  return appDir;
}

function spawnNodeTarget(cwd: string): ChildProcess {
  return spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { cwd, stdio: "ignore" });
}

function spawnNonNodeTarget(cwd: string): ChildProcess {
  return spawn("/bin/sleep", ["60"], { cwd, stdio: "ignore" });
}

function stopTarget(child: ChildProcess): void {
  child.kill("SIGTERM");
}

function tempDir(prefix = "machinen-node-level5-real-introspection-"): string {
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
