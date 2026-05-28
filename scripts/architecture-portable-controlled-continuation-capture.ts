#!/usr/bin/env tsx
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import {
  buildArchitecturePortableControlledContinuationBundle,
  buildArchitecturePortableControlledContinuationRow,
  fileSize,
  normalizeControlledContinuationArch,
  oppositeControlledContinuationArch,
  sha256File,
  summarizeArchitecturePortableControlledContinuationRows,
  validateArchitecturePortableControlledContinuationBundle,
  writeArchitecturePortableControlledContinuationBundle,
  type ArchitecturePortableControlledContinuationArch,
  type ArchitecturePortableControlledContinuationRefusalCode,
  type ArchitecturePortableControlledContinuationRow,
} from "../packages/runtime/src/index.ts";

interface Args {
  json: boolean;
  live: boolean;
  summary?: string;
  workDir?: string;
  targetSsh: string;
  targetArch?: ArchitecturePortableControlledContinuationArch;
  counter: number;
  negative?: "sidecar-output" | "metadata-only";
  keep: boolean;
}

const repoRoot = resolve(import.meta.dirname, "..");
const loaderPath = join(
  repoRoot,
  "scripts/architecture-portable-controlled-continuation-target-loader.sh",
);

// fallow-ignore-next-line complexity
function parseArgs(): Args {
  const args: Args = {
    json: false,
    live: false,
    targetSsh:
      process.env.ARCH_PORTABLE_AMD64_SSH ?? process.env.PORTABLE_AMD64_SSH ?? "root@192.168.0.8",
    counter: 41,
    keep: false,
  };
  for (let i = 2; i < process.argv.length; i += 1) {
    const arg = process.argv[i];
    if (arg === "--") {
      continue;
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--live") {
      args.live = true;
    } else if (arg === "--summary") {
      args.summary = process.argv[++i];
    } else if (arg === "--work-dir") {
      args.workDir = process.argv[++i];
    } else if (arg === "--target-ssh") {
      args.targetSsh = process.argv[++i];
    } else if (arg === "--target-arch") {
      args.targetArch = requireArch(process.argv[++i]);
    } else if (arg === "--counter") {
      args.counter = Number(process.argv[++i]);
    } else if (arg === "--negative") {
      args.negative = requireNegative(process.argv[++i]);
    } else if (arg === "--keep") {
      args.keep = true;
    } else {
      throw new Error(`unknown arg ${arg}`);
    }
  }
  return args;
}

// fallow-ignore-next-line complexity
function main() {
  const args = parseArgs();
  const workDir = resolve(
    args.workDir ?? mkdtempSync(join(tmpdir(), "machinen-controlled-continuation.")),
  );
  mkdirSync(workDir, { recursive: true });
  const sourceArch = sourceArchFromHost();
  const targetArch = args.targetArch ?? oppositeControlledContinuationArch(sourceArch);
  const row = args.negative
    ? negativeRow(args, workDir, sourceArch, targetArch)
    : runProof(args, workDir, sourceArch, targetArch);
  const summary = summarizeArchitecturePortableControlledContinuationRows([row]);
  if (args.summary) {
    writeFileSync(args.summary, `${JSON.stringify(summary, null, 2)}\n`);
  }
  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(
      `architecture-portable-controlled-continuation: ${summary.state} classification=${row.classification} migrationCompleted=${row.migrationCompleted} work=${workDir}`,
    );
  }
  if (!args.keep && !args.workDir && !args.live) {
    rmSync(workDir, { recursive: true, force: true });
  }
  if (!summary.pass) {
    process.exitCode = 1;
  }
}

function runProof(
  args: Args,
  workDir: string,
  sourceArch: ArchitecturePortableControlledContinuationArch,
  targetArch: ArchitecturePortableControlledContinuationArch,
): ArchitecturePortableControlledContinuationRow {
  const bundleDir = buildBundle(workDir, sourceArch, targetArch, args.counter);
  const bundleFailures = validateArchitecturePortableControlledContinuationBundle(bundleDir);
  if (bundleFailures.length > 0) {
    return refusedRow(sourceArch, targetArch, "bundle-invalid", bundleFailures.join("; "), {
      workDir,
      bundleDir,
    });
  }
  if (!args.live) {
    return buildArchitecturePortableControlledContinuationRow({
      classification: "proof-only-feasibility",
      sourceArch,
      targetArch,
      hostArch: sourceArch,
      providerMode: "local-fixture-bundle-validation",
      targetExecution: "not-applicable",
      verifierCommand: "pnpm run architecture-portable-controlled-continuation -- --json",
      verifierOutput: "fixture bundle validated; live opposite-ISA target not requested",
      artifactDigests: artifactDigests(bundleDir),
      provenance: { mode: "fixture", bundleDir, liveTargetRequiredForMigrationCompleted: true },
      migrationCompleted: false,
    });
  }
  return runLiveRestore(args, workDir, bundleDir, sourceArch, targetArch);
}

function buildBundle(
  workDir: string,
  sourceArch: ArchitecturePortableControlledContinuationArch,
  targetArch: ArchitecturePortableControlledContinuationArch,
  counter: number,
): string {
  const bundleDir = join(workDir, "bundle");
  const targetDir = join(bundleDir, "target");
  mkdirSync(targetDir, { recursive: true });
  const sourcePath = join(workDir, "controlled-counter.c");
  writeFileSync(sourcePath, controlledCounterSource());
  const sourceBinary = join(workDir, "source-counter");
  execFileSync("cc", [sourcePath, "-O2", "-o", sourceBinary], { stdio: "pipe" });
  const sourceVerifierOutput = execFileSync(
    sourceBinary,
    [String(counter), "safe-counter-v1", sourceArch, sourceArch],
    {
      encoding: "utf8",
    },
  ).trim();
  const targetBinaryRel = `target/controlled-counter-${targetArch}`;
  const targetBinary = join(bundleDir, targetBinaryRel);
  execFileSync(
    "zig",
    [
      "cc",
      "-target",
      zigTarget(targetArch),
      "-static",
      "-O2",
      "-s",
      sourcePath,
      "-o",
      targetBinary,
    ],
    {
      stdio: "pipe",
    },
  );
  const bundle = buildArchitecturePortableControlledContinuationBundle({
    sourceArch,
    targetArch,
    capturedCounter: counter,
    continuationLabel: "safe-counter-v1",
    sourceVerifierOutput,
    targetBinaryRelativePath: targetBinaryRel,
    targetBinarySha256: sha256File(targetBinary),
    targetBinaryProvenance: {
      compiler: `zig ${execFileSync("zig", ["version"], { encoding: "utf8" }).trim()}`,
      target: zigTarget(targetArch),
      sourceSha256: sha256File(sourcePath),
      targetBinaryBytes: fileSize(targetBinary),
    },
    verifierCommand: "architecture-portable-controlled-continuation-target-loader.sh bundle",
  });
  writeArchitecturePortableControlledContinuationBundle(bundleDir, bundle);
  copyFileSync(sourcePath, join(bundleDir, "controlled-counter.c"));
  return bundleDir;
}

// fallow-ignore-next-line complexity
function runLiveRestore(
  args: Args,
  workDir: string,
  bundleDir: string,
  sourceArch: ArchitecturePortableControlledContinuationArch,
  targetArch: ArchitecturePortableControlledContinuationArch,
): ArchitecturePortableControlledContinuationRow {
  const remoteRoot = `/tmp/machinen-controlled-continuation-${Date.now()}-${process.pid}`;
  const remoteBundle = `${remoteRoot}/bundle`;
  const remoteLoader = `${remoteRoot}/${basename(loaderPath)}`;
  const preflight = spawnSync(
    "ssh",
    ["-o", "BatchMode=yes", "-o", "ConnectTimeout=10", args.targetSsh, "uname -m"],
    {
      encoding: "utf8",
    },
  );
  if (preflight.status !== 0) {
    return skippedRow(
      sourceArch,
      targetArch,
      args.targetSsh,
      preflight.stderr || preflight.stdout || "ssh preflight failed",
    );
  }
  const remoteArch = normalizeControlledContinuationArch(preflight.stdout.trim());
  if (remoteArch !== targetArch) {
    return refusedRow(
      sourceArch,
      targetArch,
      "target-arch-mismatch",
      `remote ${args.targetSsh} reported ${preflight.stdout.trim()}, expected ${targetArch}`,
      { targetSsh: args.targetSsh },
    );
  }
  execFileSync("ssh", [args.targetSsh, "mkdir", "-p", remoteRoot]);
  execFileSync("scp", ["-q", "-r", bundleDir, `${args.targetSsh}:${remoteBundle}`]);
  execFileSync("scp", ["-q", loaderPath, `${args.targetSsh}:${remoteLoader}`]);
  const restore = spawnSync("ssh", [args.targetSsh, "sh", remoteLoader, remoteBundle], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  execFileSync("ssh", [args.targetSsh, "rm", "-rf", remoteRoot]);
  const verifierOutput = `${restore.stdout ?? ""}${restore.stderr ?? ""}`.trim();
  if (restore.status !== 0 || !verifierOutput.includes("target-native-continuation-ok")) {
    return refusedRow(sourceArch, targetArch, "target-verifier-failed", verifierOutput, {
      targetSsh: args.targetSsh,
      status: restore.status,
    });
  }
  return buildArchitecturePortableControlledContinuationRow({
    classification: "proof-only-feasibility",
    sourceArch,
    targetArch,
    hostArch: sourceArch,
    providerMode: `ssh-real-target:${args.targetSsh}`,
    targetExecution: "native",
    verifierCommand: `ssh ${args.targetSsh} sh ${remoteLoader} ${remoteBundle}`,
    verifierOutput,
    artifactDigests: artifactDigests(bundleDir),
    provenance: { mode: "live", targetSsh: args.targetSsh, workDir, remoteArch },
    migrationCompleted: true,
  });
}

function negativeRow(
  args: Args,
  workDir: string,
  sourceArch: ArchitecturePortableControlledContinuationArch,
  targetArch: ArchitecturePortableControlledContinuationArch,
): ArchitecturePortableControlledContinuationRow {
  const code: ArchitecturePortableControlledContinuationRefusalCode =
    args.negative === "sidecar-output"
      ? "sidecar-output-refused"
      : "metadata-only-continuation-refused";
  const verifierOutput =
    args.negative === "sidecar-output"
      ? "host-sidecar-output attempted to stand in for target verifier"
      : "metadata-only continuation attempted without target process execution";
  return buildArchitecturePortableControlledContinuationRow({
    classification: "refused",
    sourceArch,
    targetArch,
    hostArch: sourceArch,
    providerMode: "negative-fixture",
    targetExecution: "not-applicable",
    verifierCommand: `pnpm run architecture-portable-controlled-continuation -- --negative ${args.negative}`,
    verifierOutput,
    artifactDigests: { negativeFixture: args.negative ?? "unknown" },
    provenance: { mode: "negative", workDir },
    migrationCompleted: false,
    refusalCode: code,
    remediation:
      "Run the target restore loader on the opposite ISA and require target-native verifier output.",
  });
}

function skippedRow(
  sourceArch: ArchitecturePortableControlledContinuationArch,
  targetArch: ArchitecturePortableControlledContinuationArch,
  targetSsh: string,
  reason: string,
): ArchitecturePortableControlledContinuationRow {
  return buildArchitecturePortableControlledContinuationRow({
    classification: "skipped",
    sourceArch,
    targetArch,
    hostArch: sourceArch,
    providerMode: `ssh-real-target:${targetSsh}`,
    targetExecution: "not-applicable",
    verifierCommand: `ssh ${targetSsh} uname -m`,
    verifierOutput: reason,
    artifactDigests: { preflight: "not-run" },
    provenance: { mode: "live", targetSsh },
    migrationCompleted: false,
    refusalCode: "target-unavailable",
    remediation: "Provide a reachable real opposite-ISA target over SSH.",
  });
}

function refusedRow(
  sourceArch: ArchitecturePortableControlledContinuationArch,
  targetArch: ArchitecturePortableControlledContinuationArch,
  code: ArchitecturePortableControlledContinuationRefusalCode,
  verifierOutput: string,
  provenance: Record<string, unknown>,
): ArchitecturePortableControlledContinuationRow {
  return buildArchitecturePortableControlledContinuationRow({
    classification: "refused",
    sourceArch,
    targetArch,
    hostArch: sourceArch,
    providerMode: "controlled-continuation-refusal",
    targetExecution: "not-applicable",
    verifierCommand: "architecture-portable-controlled-continuation",
    verifierOutput,
    artifactDigests: { refusal: code },
    provenance,
    migrationCompleted: false,
    refusalCode: code,
    remediation: remediationFor(code),
  });
}

function artifactDigests(bundleDir: string): Record<string, string> {
  return {
    manifest: sha256File(join(bundleDir, "manifest.json")),
    state: sha256File(join(bundleDir, "state.json")),
    refusals: sha256File(join(bundleDir, "refusals.json")),
    targetEnv: sha256File(join(bundleDir, "target.env")),
    targetBinary: sha256File(
      join(bundleDir, "target", `controlled-counter-${readTargetArch(bundleDir)}`),
    ),
  };
}

function readTargetArch(bundleDir: string): string {
  const manifest = JSON.parse(readFileSync(join(bundleDir, "manifest.json"), "utf8"));
  return manifest.targetArch;
}

function sourceArchFromHost(): ArchitecturePortableControlledContinuationArch {
  const arch = normalizeControlledContinuationArch(process.arch);
  if (arch === "unknown") {
    throw new Error(`unsupported source arch ${process.arch}`);
  }
  return arch;
}

function zigTarget(arch: ArchitecturePortableControlledContinuationArch): string {
  return arch === "amd64" ? "x86_64-linux-musl" : "aarch64-linux-musl";
}

function requireArch(value: string): ArchitecturePortableControlledContinuationArch {
  const arch = normalizeControlledContinuationArch(value);
  if (arch === "unknown") {
    throw new Error(`unsupported arch ${value}`);
  }
  return arch;
}

function requireNegative(value: string): "sidecar-output" | "metadata-only" {
  if (value === "sidecar-output" || value === "metadata-only") {
    return value;
  }
  throw new Error(`unsupported negative fixture ${value}`);
}

// fallow-ignore-next-line complexity
function remediationFor(code: ArchitecturePortableControlledContinuationRefusalCode): string {
  switch (code) {
    case "bundle-invalid":
      return "Rebuild the architecture-portable snapshot bundle and validate its manifest, state, refusals, and target artifact digest.";
    case "target-arch-mismatch":
      return "Run the target restore loader on the requested opposite-ISA host.";
    case "target-artifact-digest-mismatch":
      return "Transfer the provenance-checked target artifact without modification.";
    case "target-verifier-failed":
      return "Inspect target loader output and require target-native continuation verifier success.";
    case "sidecar-output-refused":
    case "metadata-only-continuation-refused":
      return "Use target-native process execution; sidecar or metadata-only output cannot complete migration.";
    case "unsupported-state":
      return "Remove or explicitly model unsupported live state before capture.";
    case "target-unavailable":
      return "Provide a reachable real opposite-ISA target over SSH.";
  }
}

function controlledCounterSource(): string {
  return `#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static long parse_counter(const char *value) {
  char *end = NULL;
  errno = 0;
  long parsed = strtol(value, &end, 10);
  if (errno != 0 || end == value || *end != '\\0') {
    fprintf(stderr, "invalid counter: %s\\n", value);
    exit(2);
  }
  return parsed;
}

int main(int argc, char **argv) {
  if (argc != 5) {
    fprintf(stderr, "usage: %s captured-counter continuation-label source-arch target-arch\\n", argv[0]);
    return 2;
  }
  long captured = parse_counter(argv[1]);
  long restored = captured + 1;
  const char *label = argv[2];
  const char *source_arch = argv[3];
  const char *target_arch = argv[4];
  printf("controlled-c-continuation\\n");
  printf("sourceArch=%s\\n", source_arch);
  printf("targetArch=%s\\n", target_arch);
  printf("capturedCounter=%ld\\n", captured);
  printf("restoredCounter=%ld\\n", restored);
  printf("continuationLabel=%s\\n", label);
  if (strcmp(source_arch, target_arch) == 0) {
    printf("source-capture-ok\\n");
  } else {
    printf("target-native-continuation-ok\\n");
  }
  return 0;
}
`;
}

main();
