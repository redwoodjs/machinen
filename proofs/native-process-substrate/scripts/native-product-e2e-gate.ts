import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type NativeArch = "arm64" | "amd64";
type Direction = "arm64-to-amd64" | "amd64-to-arm64";

type CommandTranscript = {
  command: string[];
  status: number | null;
  stdout: string;
  stderr: string;
};

type DirectionReport = {
  direction: Direction;
  sourceArch: NativeArch;
  targetArch: NativeArch;
  accepted: boolean;
  productCommands: {
    capture: "machinen capture native";
    restore: "machinen restore";
  };
  sourceArtifacts: Array<{ name: string; path: string; sha256: string }>;
  targetArtifacts: Array<{ name: string; path: string; sha256: string }>;
  captureSummary: Record<string, unknown>;
  restoreSummary: Record<string, unknown>;
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
    sourceIsaEmulationAccepted: false;
    runtimeProfileRestoreAccepted: false;
    sidecarRuntimeAccepted: false;
    appHooksAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

type GateReport = {
  kind: "machinen.native-product-e2e-gate";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  proofStatus: "verified" | "not-started";
  publicClaimAllowed: false;
  publicClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  scope: string;
  directions: DirectionReport[];
  acceptedDirections: number;
  requiredDirections: 2;
  requiredPriorGates: Array<{ id: string; accepted: boolean; artifact: string }>;
};

const HARNESS_ROOT = "proofs/native-process-substrate/selected-workload-e2e/retained";
const CLI = ["node", "packages/cli/dist/cli.js"];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const directions = [
    runDirection({
      direction: "arm64-to-amd64",
      sourceArch: "arm64",
      targetArch: "amd64",
      sourceVerifierFromDirection: "amd64-to-arm64",
      outDir,
    }),
    runDirection({
      direction: "amd64-to-arm64",
      sourceArch: "amd64",
      targetArch: "arm64",
      sourceVerifierFromDirection: "arm64-to-amd64",
      outDir,
    }),
  ];
  const requiredPriorGates = priorGates();
  const accepted =
    directions.every((direction) => direction.accepted) &&
    requiredPriorGates.every((gate) => gate.accepted);
  const report: GateReport = {
    kind: "machinen.native-product-e2e-gate",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    proofStatus: accepted ? "verified" : "not-started",
    publicClaimAllowed: false,
    publicClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0,
    },
    scope:
      "Retained product-path gate for machinen capture native and machinen restore on the selected single-thread native workload. It reuses retained target-native source/target verifier artifacts from the bidirectional native workload harness and remains proof-only: no arbitrary Linux process restore or public selected-native product claim is raised.",
    directions,
    acceptedDirections: directions.filter((direction) => direction.accepted).length,
    requiredDirections: 2,
    requiredPriorGates,
  };
  writeJson(join(outDir, "native-product-e2e-gate-report.json"), report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `native product e2e gate: accepted=${report.accepted} directions=${report.acceptedDirections}/${report.requiredDirections}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

function runDirection(input: {
  direction: Direction;
  sourceArch: NativeArch;
  targetArch: NativeArch;
  sourceVerifierFromDirection: Direction;
  outDir: string;
}): DirectionReport {
  const directionDir = join(input.outDir, input.direction);
  const sourceDir = join(directionDir, "source");
  const targetDir = join(directionDir, "target");
  const bundleDir = join(directionDir, "selected-native.bundle");
  mkdirSync(sourceDir, { recursive: true });
  mkdirSync(targetDir, { recursive: true });
  const sourceVerifier = copyArtifact(
    harnessArtifact(input.sourceVerifierFromDirection, "target-verifier.json"),
    join(sourceDir, "source-verifier.json"),
  );
  const sourceCapture = copyArtifact(
    harnessArtifact(input.direction, "source-capture.json"),
    join(sourceDir, "source-capture.json"),
  );
  const targetPlan = copyArtifact(
    harnessArtifact(input.direction, "target-plan.json"),
    join(sourceDir, "target-plan.json"),
  );
  const targetVerifier = copyArtifact(
    harnessArtifact(input.direction, "target-verifier.json"),
    join(targetDir, "target-verifier.json"),
  );
  const captureTranscript = runCli([
    "capture",
    "native",
    "--out",
    bundleDir,
    "--source-arch",
    input.sourceArch,
    "--target-arch",
    input.targetArch,
    "--source-verifier-output",
    sourceVerifier.path,
    "--source-capture",
    sourceCapture.path,
    "--target-plan",
    targetPlan.path,
    "--json",
  ]);
  writeJson(join(directionDir, "capture-transcript.json"), captureTranscript);
  const restoreTranscript = runCli([
    "restore",
    bundleDir,
    "--target-arch",
    input.targetArch,
    "--target-verifier-output",
    targetVerifier.path,
    "--json",
  ]);
  writeJson(join(directionDir, "restore-transcript.json"), restoreTranscript);
  const captureSummary = parseJsonOutput(captureTranscript.stdout);
  const restoreSummary = parseJsonOutput(restoreTranscript.stdout);
  const productBundleArtifacts = existingBundleArtifacts(bundleDir).map((path) => ({
    name: path.slice(bundleDir.length + 1),
    path,
    sha256: sha256File(path),
  }));
  const targetArtifacts = [targetVerifier, ...productBundleArtifacts];
  const accepted = verifyDirection(
    captureTranscript,
    restoreTranscript,
    captureSummary,
    restoreSummary,
  );
  const report: DirectionReport = {
    direction: input.direction,
    sourceArch: input.sourceArch,
    targetArch: input.targetArch,
    accepted,
    productCommands: {
      capture: "machinen capture native",
      restore: "machinen restore",
    },
    sourceArtifacts: [sourceVerifier, sourceCapture, targetPlan],
    targetArtifacts,
    captureSummary,
    restoreSummary,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false,
      sourceIsaEmulationAccepted: false,
      runtimeProfileRestoreAccepted: false,
      sidecarRuntimeAccepted: false,
      appHooksAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
  };
  writeJson(join(directionDir, "direction-report.json"), report);
  return report;
}

function verifyDirection(
  captureTranscript: CommandTranscript,
  restoreTranscript: CommandTranscript,
  captureSummary: Record<string, unknown>,
  restoreSummary: Record<string, unknown>,
): boolean {
  return [
    captureTranscript.status === 0,
    restoreTranscript.status === 0,
    captureSummary.state === "completed",
    captureSummary.migrationCompleted === true,
    restoreSummary.state === "completed",
    restoreSummary.migrationCompleted === true,
    restoreSummary.publicClaimAllowed === false,
    (restoreSummary.publicClaim as Record<string, unknown> | undefined)
      ?.arbitraryProcessCrossArchRestore === 0,
    (restoreSummary.shortcutInspection as Record<string, unknown> | undefined)
      ?.rawCpuRestoreUsed === false,
    (restoreSummary.shortcutInspection as Record<string, unknown> | undefined)
      ?.sourceIsaEmulationUsed === false,
    (restoreSummary.shortcutInspection as Record<string, unknown> | undefined)
      ?.metadataOnlyShortcutAccepted === false,
  ].every(Boolean);
}

function runCli(args: string[]): CommandTranscript {
  const command = [...CLI, ...args];
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: resolve("."),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    command,
    status: result.status,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function parseJsonOutput(stdout: string): Record<string, unknown> {
  const line = stdout
    .split(/\r?\n/)
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith("{"));
  if (!line) {
    return { parseError: "missing-json-output", stdout };
  }
  return JSON.parse(line) as Record<string, unknown>;
}

function harnessArtifact(direction: Direction, name: string): string {
  return join(HARNESS_ROOT, direction, name);
}

function copyArtifact(
  source: string,
  target: string,
): { name: string; path: string; sha256: string } {
  if (!existsSync(source)) {
    throw new Error(`missing retained harness artifact: ${source}`);
  }
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, readFileSync(source));
  return { name: target.slice(resolve(".").length + 1), path: target, sha256: sha256File(target) };
}

function existingBundleArtifacts(bundleDir: string): string[] {
  return [
    "portable-selected-native.json",
    "source-verifier.json",
    "source-capture.json",
    "target-plan.json",
    "portable-selected-native-restore-summary.json",
  ]
    .map((name) => join(bundleDir, name))
    .filter((path) => existsSync(path));
}

function priorGates(): Array<{ id: string; accepted: boolean; artifact: string }> {
  return [
    priorGate(
      "native-selected-workload-e2e",
      "proofs/native-process-substrate/selected-workload-e2e/retained/native-selected-workload-e2e-report.json",
    ),
    priorGate(
      "native-resource-coverage-matrix",
      "proofs/native-process-substrate/resource-coverage/retained/native-resource-coverage-matrix-report.json",
    ),
  ];
}

function priorGate(
  id: string,
  artifact: string,
): { id: string; accepted: boolean; artifact: string } {
  if (!existsSync(artifact)) {
    return { id, accepted: false, artifact };
  }
  const report = JSON.parse(readFileSync(artifact, "utf8")) as {
    accepted?: boolean;
    publicClaimAllowed?: boolean;
  };
  return {
    id,
    accepted: report.accepted === true && report.publicClaimAllowed === false,
    artifact,
  };
}

function parseArgs(argv: string[]): { outDir: string; json: boolean } {
  let outDir = "proofs/native-process-substrate/product-e2e-gate/retained";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--out-dir") {
      outDir = argv[++index] ?? outDir;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { outDir, json };
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

main();
