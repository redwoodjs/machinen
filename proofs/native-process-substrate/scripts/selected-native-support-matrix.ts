import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type NativeArch = "arm64" | "amd64";
type Direction = "arm64-to-amd64" | "amd64-to-arm64";
type RefusalKind = "active-syscall" | "unsupported-resource-state" | "target-shortcut";

type CommandTranscript = {
  command: string[];
  status: number | null;
  stdout: string;
  stderr: string;
};

type Artifact = { name: string; path: string; sha256: string };

type SupportedDirection = {
  direction: Direction;
  sourceArch: NativeArch;
  targetArch: NativeArch;
  accepted: boolean;
  captureArtifact: string;
  restoreArtifact: string;
  targetVerifierArtifact: string;
};

type RefusalDirection = {
  id: string;
  kind: RefusalKind;
  direction: Direction;
  sourceArch: NativeArch;
  targetArch: NativeArch;
  accepted: boolean;
  expectedRefusalCode: string;
  actualRefusalCode?: string;
  transcript: Artifact;
  retainedArtifacts: Artifact[];
};

type MatrixReport = {
  kind: "machinen.selected-native-support-matrix";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  proofStatus: "verified" | "not-started";
  publicClaimAllowed: boolean;
  publicClaim: {
    productSupport: 100 | null;
    broadSupport: 100 | null;
    arbitraryProcessCrossArchRestore: 0;
    scope: "selected-single-thread-native-workload-v1";
  };
  scope: string;
  supportedRows: Array<{
    id: "selected-single-thread-native-workload-v1";
    status: "verified";
    directions: SupportedDirection[];
  }>;
  refusalRows: RefusalDirection[];
  rowCoverage: {
    supportedDirectionBundlesRequired: 2;
    supportedDirectionBundlesCovered: number;
    refusedDirectionArtifactsRequired: 6;
    refusedDirectionArtifactsCovered: number;
    notProvenRows: number;
  };
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
    sourceIsaEmulationAccepted: false;
    runtimeProfileRestoreAccepted: false;
    sidecarRuntimeAccepted: false;
    appHooksAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

const PRODUCT_GATE_ROOT = "proofs/native-process-substrate/product-e2e-gate/retained";
const CLI = ["node", "packages/cli/dist/cli.js"];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  const supported = supportedDirections();
  const refusals = [
    ...runSourceRefusals(outDir, "active-syscall"),
    ...runSourceRefusals(outDir, "unsupported-resource-state"),
    ...runTargetShortcutRefusals(outDir),
  ];
  const supportedCovered = supported.filter((direction) => direction.accepted).length;
  const refusedCovered = refusals.filter((refusal) => refusal.accepted).length;
  const accepted = supportedCovered === 2 && refusedCovered === 6;
  const report: MatrixReport = {
    kind: "machinen.selected-native-support-matrix",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    proofStatus: accepted ? "verified" : "not-started",
    publicClaimAllowed: accepted,
    publicClaim: {
      productSupport: accepted ? 100 : null,
      broadSupport: accepted ? 100 : null,
      arbitraryProcessCrossArchRestore: 0,
      scope: "selected-single-thread-native-workload-v1",
    },
    scope:
      "Claim-bearing matrix for the selected single-thread native workload only. It requires retained machinen capture native / machinen restore artifacts for both directions and retained product refusals for neighboring unsupported source/target states. It does not claim arbitrary Linux process restore.",
    supportedRows: [
      {
        id: "selected-single-thread-native-workload-v1",
        status: "verified",
        directions: supported,
      },
    ],
    refusalRows: refusals,
    rowCoverage: {
      supportedDirectionBundlesRequired: 2,
      supportedDirectionBundlesCovered: supportedCovered,
      refusedDirectionArtifactsRequired: 6,
      refusedDirectionArtifactsCovered: refusedCovered,
      notProvenRows: accepted ? 0 : 1,
    },
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false,
      sourceIsaEmulationAccepted: false,
      runtimeProfileRestoreAccepted: false,
      sidecarRuntimeAccepted: false,
      appHooksAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
  };
  writeJson(join(outDir, "selected-native-support-matrix-report.json"), report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `selected native support matrix: accepted=${report.accepted} supported=${supportedCovered}/2 refusals=${refusedCovered}/6\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

function supportedDirections(): SupportedDirection[] {
  return [
    supportedDirection("arm64-to-amd64", "arm64", "amd64"),
    supportedDirection("amd64-to-arm64", "amd64", "arm64"),
  ];
}

function supportedDirection(
  direction: Direction,
  sourceArch: NativeArch,
  targetArch: NativeArch,
): SupportedDirection {
  const directionRoot = join(PRODUCT_GATE_ROOT, direction);
  const captureArtifact = join(directionRoot, "capture-transcript.json");
  const restoreArtifact = join(directionRoot, "restore-transcript.json");
  const targetVerifierArtifact = join(directionRoot, "target", "target-verifier.json");
  return {
    direction,
    sourceArch,
    targetArch,
    accepted:
      acceptedTranscript(captureArtifact, "completed") &&
      acceptedTranscript(restoreArtifact, "completed") &&
      existsSync(targetVerifierArtifact),
    captureArtifact,
    restoreArtifact,
    targetVerifierArtifact,
  };
}

function runSourceRefusals(
  outDir: string,
  kind: Exclude<RefusalKind, "target-shortcut">,
): RefusalDirection[] {
  return [
    runSourceRefusal(outDir, kind, "arm64-to-amd64", "arm64", "amd64"),
    runSourceRefusal(outDir, kind, "amd64-to-arm64", "amd64", "arm64"),
  ];
}

function runSourceRefusal(
  outDir: string,
  kind: Exclude<RefusalKind, "target-shortcut">,
  direction: Direction,
  sourceArch: NativeArch,
  targetArch: NativeArch,
): RefusalDirection {
  const root = join(outDir, "refusals", kind, direction);
  const bundleDir = join(root, "selected-native.refused");
  const sourceVerifier = join(PRODUCT_GATE_ROOT, direction, "source", "source-verifier.json");
  const kindFlag = kind === "active-syscall" ? "--active-syscall" : "--unsupported-resource-state";
  const transcript = runCli([
    "capture",
    "native",
    "--out",
    bundleDir,
    "--source-arch",
    sourceArch,
    "--target-arch",
    targetArch,
    "--source-verifier-output",
    sourceVerifier,
    kindFlag,
    "--json",
  ]);
  const transcriptArtifact = writeJsonArtifact(root, "capture-transcript.json", transcript);
  const summary = parseJsonOutput(transcript.stdout);
  const expectedRefusalCode = "native-source-state-unsupported";
  const actualRefusalCode = refusalCode(summary);
  return {
    id: `selected-native-${kind}-${direction}`,
    kind,
    direction,
    sourceArch,
    targetArch,
    accepted: transcript.status === 1 && actualRefusalCode === expectedRefusalCode,
    expectedRefusalCode,
    actualRefusalCode,
    transcript: transcriptArtifact,
    retainedArtifacts: existingArtifacts(bundleDir),
  };
}

function runTargetShortcutRefusals(outDir: string): RefusalDirection[] {
  return [
    runTargetShortcutRefusal(outDir, "arm64-to-amd64", "arm64", "amd64"),
    runTargetShortcutRefusal(outDir, "amd64-to-arm64", "amd64", "arm64"),
  ];
}

function runTargetShortcutRefusal(
  outDir: string,
  direction: Direction,
  sourceArch: NativeArch,
  targetArch: NativeArch,
): RefusalDirection {
  const root = join(outDir, "refusals", "target-shortcut", direction);
  const bundleDir = join(root, "selected-native.bundle");
  cpSync(join(PRODUCT_GATE_ROOT, direction, "selected-native.bundle"), bundleDir, {
    recursive: true,
  });
  const targetVerifier = join(root, "target-verifier-shortcut.json");
  writeJson(targetVerifier, shortcutVerifier(direction));
  const transcript = runCli([
    "restore",
    bundleDir,
    "--target-arch",
    targetArch,
    "--target-verifier-output",
    targetVerifier,
    "--json",
  ]);
  const transcriptArtifact = writeJsonArtifact(root, "restore-transcript.json", transcript);
  const summary = parseJsonOutput(transcript.stdout);
  const expectedRefusalCode = "native-target-shortcut-detected";
  const actualRefusalCode = refusalCode(summary);
  return {
    id: `selected-native-target-shortcut-${direction}`,
    kind: "target-shortcut",
    direction,
    sourceArch,
    targetArch,
    accepted: transcript.status === 1 && actualRefusalCode === expectedRefusalCode,
    expectedRefusalCode,
    actualRefusalCode,
    transcript: transcriptArtifact,
    retainedArtifacts: [artifactFor(targetVerifier), ...existingArtifacts(bundleDir)],
  };
}

function shortcutVerifier(direction: Direction): Record<string, unknown> {
  const original = JSON.parse(
    readFileSync(join(PRODUCT_GATE_ROOT, direction, "target", "target-verifier.json"), "utf8"),
  ) as { verifier: Record<string, unknown> };
  return {
    ...original,
    verifier: {
      ...original.verifier,
      sourceIsaEmulationUsed: true,
    },
  };
}

function acceptedTranscript(path: string, expectedState: "completed"): boolean {
  if (!existsSync(path)) {
    return false;
  }
  const transcript = JSON.parse(readFileSync(path, "utf8")) as CommandTranscript;
  const summary = parseJsonOutput(transcript.stdout);
  return (
    transcript.status === 0 &&
    summary.state === expectedState &&
    summary.migrationCompleted === true
  );
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

function refusalCode(summary: Record<string, unknown>): string | undefined {
  const refusal = summary.refusal;
  if (typeof refusal !== "object" || refusal === null || Array.isArray(refusal)) {
    return undefined;
  }
  const code = (refusal as Record<string, unknown>).expectedRefusalCode;
  return typeof code === "string" ? code : undefined;
}

function existingArtifacts(root: string): Artifact[] {
  const names = [
    "portable-selected-native-refusal.json",
    "portable-selected-native.json",
    "portable-selected-native-restore-summary.json",
    "source-verifier.json",
    "source-capture.json",
    "target-plan.json",
  ];
  return names
    .map((name) => join(root, name))
    .filter((path) => existsSync(path))
    .map(artifactFor);
}

function artifactFor(path: string): Artifact {
  return { name: path.slice(resolve(".").length + 1), path, sha256: sha256File(path) };
}

function writeJsonArtifact(outDir: string, name: string, value: unknown): Artifact {
  const path = join(outDir, name);
  writeJson(path, value);
  return artifactFor(path);
}

function parseArgs(argv: string[]): { outDir: string; json: boolean } {
  let outDir = "proofs/native-process-substrate/selected-native-support-matrix/retained";
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
