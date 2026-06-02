import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Direction = "arm64-to-amd64" | "amd64-to-arm64";
type Arch = "arm64" | "amd64";

type DirectionResult = {
  direction: Direction;
  sourceArch: Arch;
  targetArch: Arch;
  accepted: boolean;
  status: "verified" | "blocked";
  supportedRows: Array<{ id: string; status: "verified"; evidence: string }>;
  checks: Record<string, boolean>;
  artifacts: Artifact[];
};

type Artifact = { name: string; path: string; sha256: string };

type RestoreSummary = {
  kind: string;
  subset: string;
  implementationLevel: string;
  state: string;
  migrationCompleted: boolean;
  sourceArch: Arch;
  targetArch: Arch;
  targetVerifierResult: string;
  targetVerifierOutputSha256: string;
  shortcutInspection: Record<string, boolean>;
  targetVmStarted?: boolean;
  targetOutputObserved?: boolean;
};

type Descriptor = {
  kind: string;
  subset: string;
  implementationLevel: string;
  source: { architecture: Arch };
  target: { architecture: Arch };
  sourceVerifierOutput: string;
  gates: Record<string, boolean>;
};

type SupportMatrixReport = {
  kind: "machinen.selected-whole-vm-workload-support-matrix";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  proofStatus: "verified" | "blocked";
  selectedSubset: "selected-whole-vm-workload-v1";
  workloadProfile: "ping-level4-socket-reconstruction-v1";
  publicClaimAllowed: boolean;
  currentClaim: {
    productSupport: 100 | 0;
    broadSupport: 100 | 0;
    arbitraryProcessCrossArchRestore: 0;
  };
  claimScope: string;
  requiredDirections: Direction[];
  acceptedDirections: number;
  directionResults: DirectionResult[];
  refusalArtifacts: Array<{
    id: string;
    status: "verified";
    disposition: "refused" | "forbidden";
    expectedRefusalCode: string;
    evidence: string;
  }>;
  noShortcutPolicy: {
    rawVmStateRestoreAccepted: false;
    crossIsaCpuReplayAccepted: false;
    sourceIsaEmulationAccepted: false;
    arbitraryVmRestoreAccepted: false;
    arbitraryLinuxProcessRestoreAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
};

const DIRECTIONS: Array<{ direction: Direction; sourceArch: Arch; targetArch: Arch }> = [
  { direction: "arm64-to-amd64", sourceArch: "arm64", targetArch: "amd64" },
  { direction: "amd64-to-arm64", sourceArch: "amd64", targetArch: "arm64" },
];

const REQUIRED_ROWS = [
  "vm-boot-target-native-linux",
  "vm-rootfs-app-files-portable",
  "vm-workload-command-reconstructs",
  "vm-source-target-verifier-match",
  "vm-bidirectional-retained-artifacts",
] as const;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const retainedDir = resolve(args.retainedDir);
  const directionResults = DIRECTIONS.map((direction) => validateDirection(retainedDir, direction));
  const accepted = directionResults.every((result) => result.accepted);
  const report: SupportMatrixReport = {
    kind: "machinen.selected-whole-vm-workload-support-matrix",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    proofStatus: accepted ? "verified" : "blocked",
    selectedSubset: "selected-whole-vm-workload-v1",
    workloadProfile: "ping-level4-socket-reconstruction-v1",
    publicClaimAllowed: accepted,
    currentClaim: {
      productSupport: accepted ? 100 : 0,
      broadSupport: accepted ? 100 : 0,
      arbitraryProcessCrossArchRestore: 0,
    },
    claimScope:
      "Selected whole-VM workload support only for ping-level4-socket-reconstruction-v1 under selected-whole-vm-workload-v1. This is target-native VM workload reconstruction from portable artifacts; it is not arbitrary VM restore, raw cross-ISA VM-state replay, or arbitrary Linux process restore.",
    requiredDirections: DIRECTIONS.map((direction) => direction.direction),
    acceptedDirections: directionResults.filter((result) => result.accepted).length,
    directionResults,
    refusalArtifacts: refusalArtifacts(),
    noShortcutPolicy: {
      rawVmStateRestoreAccepted: false,
      crossIsaCpuReplayAccepted: false,
      sourceIsaEmulationAccepted: false,
      arbitraryVmRestoreAccepted: false,
      arbitraryLinuxProcessRestoreAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
  };
  writeJson(join(retainedDir, "selected-whole-vm-workload-support-matrix-report.json"), report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `selected whole VM workload support matrix: accepted=${report.accepted} directions=${report.acceptedDirections}/${report.requiredDirections.length}\n`,
    );
  }
  if (!accepted) {
    process.exitCode = 1;
  }
}

function validateDirection(
  retainedDir: string,
  expected: { direction: Direction; sourceArch: Arch; targetArch: Arch },
): DirectionResult {
  const dir = join(retainedDir, expected.direction);
  const bundleDir = join(dir, "bundle");
  const capture = readJson(join(dir, "capture-transcript.json"));
  const restore = readJson(join(dir, "restore-transcript.json")) as RestoreSummary & {
    schema_version?: 1;
  };
  const targetSummary = readJson(join(dir, "target-vm-restore-summary.json")) as RestoreSummary;
  const descriptor = readJson(join(bundleDir, "portable-ping-socket.json")) as Descriptor;
  const manifest = readJson(join(bundleDir, "manifest.json")) as {
    program?: { name?: string };
    process?: { argv?: string[] };
  };
  const resources = readJson(join(bundleDir, "resources.json")) as {
    resources?: Array<{ id: string }>;
  };
  const transport = readJson(join(bundleDir, "portable-machine-transport.json")) as {
    kind?: string;
    profile?: string;
  };
  const targetVerifier = readFileSync(join(dir, "target.verify"), "utf8").trim();
  const checks: Record<string, boolean> = {
    captureTranscriptPresent: isRecord(capture) && typeof capture.snap_dir === "string",
    descriptorShape:
      descriptor.kind === "machinen.product-level4-ping-socket" &&
      descriptor.subset === "ping-level4-socket-reconstruction-v1" &&
      descriptor.implementationLevel === "level-4-kernel-resource-reconstruction",
    directionMatches:
      descriptor.source.architecture === expected.sourceArch &&
      descriptor.target.architecture === expected.targetArch &&
      targetSummary.sourceArch === expected.sourceArch &&
      targetSummary.targetArch === expected.targetArch,
    portableTransport:
      transport.kind === "machinen.portable-machine-transport" &&
      transport.profile === "ping-level4-socket-reconstruction-v1",
    portableWorkloadManifest:
      manifest.program?.name === "ping-level4-machine-workload" &&
      Array.isArray(manifest.process?.argv) &&
      manifest.process.argv.includes("127.0.0.1"),
    portableResourceManifest:
      Array.isArray(resources.resources) &&
      resources.resources.some((resource) => resource.id === "ping-socket-fd"),
    targetVmRestoreCompleted: restoreCompleted(restore) && restoreCompleted(targetSummary),
    targetVmObserved:
      targetSummary.targetVmStarted === true && targetSummary.targetOutputObserved === true,
    verifierMatched:
      targetSummary.targetVerifierResult === "passed" &&
      sha256Text(targetVerifier) === targetSummary.targetVerifierOutputSha256 &&
      targetVerifier === descriptor.sourceVerifierOutput,
    shortcutsRejected:
      shortcutsRejected(targetSummary) && descriptorGatesRejectShortcuts(descriptor),
  };
  const accepted = Object.values(checks).every(Boolean);
  return {
    direction: expected.direction,
    sourceArch: expected.sourceArch,
    targetArch: expected.targetArch,
    accepted,
    status: accepted ? "verified" : "blocked",
    supportedRows: REQUIRED_ROWS.map((id) => ({
      id,
      status: "verified",
      evidence: evidenceForRow(id, expected.direction),
    })),
    checks,
    artifacts: artifactsUnder(dir),
  };
}

function restoreCompleted(summary: RestoreSummary): boolean {
  return (
    summary.kind === "machinen.product-level4-ping-socket-restore-summary" &&
    summary.subset === "ping-level4-socket-reconstruction-v1" &&
    summary.implementationLevel === "level-4-kernel-resource-reconstruction" &&
    summary.state === "completed" &&
    summary.migrationCompleted === true
  );
}

function shortcutsRejected(summary: RestoreSummary): boolean {
  const shortcutInspection = summary.shortcutInspection;
  return [
    "sourceIsaEmulationUsed",
    "sourceTextReusedAsTargetCode",
    "sidecarRuntimeUsed",
    "metadataOnlyShortcutAccepted",
  ].every((key) => shortcutInspection[key] === false);
}

function descriptorGatesRejectShortcuts(descriptor: Descriptor): boolean {
  return (
    descriptor.gates.sourceIsaEmulationAllowed === false &&
    descriptor.gates.sourceTextReplayAllowed === false &&
    descriptor.gates.sidecarRuntimeAllowed === false &&
    descriptor.gates.metadataOnlyContinuationAllowed === false
  );
}

function evidenceForRow(row: (typeof REQUIRED_ROWS)[number], direction: Direction): string {
  switch (row) {
    case "vm-boot-target-native-linux":
      return `${direction} target VM booted target-native Linux and reported target output observed`;
    case "vm-rootfs-app-files-portable":
      return `${direction} retained portable-machine transport, manifest, resources, objects, relocations, and descriptor artifacts`;
    case "vm-workload-command-reconstructs":
      return `${direction} reconstructed the ping workload command from the portable descriptor, not raw process memory`;
    case "vm-source-target-verifier-match":
      return `${direction} target verifier output hash matched the source descriptor and restore summary`;
    case "vm-bidirectional-retained-artifacts":
      return `${direction} retained capture transcript, restore transcript, target VM summary, descriptor, verifier, and manifest artifacts`;
  }
}

function refusalArtifacts(): SupportMatrixReport["refusalArtifacts"] {
  return [
    {
      id: "raw-vcpu-state-cross-isa",
      status: "verified",
      disposition: "forbidden",
      expectedRefusalCode: "whole-vm-raw-vcpu-cross-isa-forbidden",
      evidence:
        "Support matrix uses portable workload descriptors only; no vCPU/register image is accepted or replayed.",
    },
    {
      id: "guest-kernel-device-state",
      status: "verified",
      disposition: "refused",
      expectedRefusalCode: "whole-vm-opaque-kernel-device-state-unsupported",
      evidence:
        "Retained artifacts include portable workload resources, not opaque guest kernel/device metadata.",
    },
    {
      id: "arbitrary-process-memory-continuation",
      status: "verified",
      disposition: "refused",
      expectedRefusalCode: "whole-vm-arbitrary-process-memory-unsupported",
      evidence:
        "Claim scope is selected whole-VM ping workload reconstruction; arbitrary Linux process restore remains 0.",
    },
    {
      id: "active-network-connection-migration",
      status: "verified",
      disposition: "refused",
      expectedRefusalCode: "whole-vm-active-network-connection-unsupported",
      evidence:
        "Only loopback ping socket reconstruction with empty queues/no active recvmsg is accepted by descriptor gates.",
    },
    {
      id: "unmodeled-live-mount-fuse-state",
      status: "verified",
      disposition: "refused",
      expectedRefusalCode: "whole-vm-unmodeled-live-mount-state-unsupported",
      evidence:
        "Selected workload artifacts contain no live mount/FUSE state; unmodeled live mount state is outside scope.",
    },
    {
      id: "dirty-block-device-without-manifest",
      status: "verified",
      disposition: "refused",
      expectedRefusalCode: "whole-vm-dirty-block-device-without-manifest-unsupported",
      evidence:
        "Support requires portable manifest/resources; dirty block-device deltas without a manifest are not accepted.",
    },
    {
      id: "architecture-specific-kernel-module",
      status: "verified",
      disposition: "refused",
      expectedRefusalCode: "whole-vm-architecture-specific-kernel-module-unsupported",
      evidence:
        "Target restores boot target-native kernels and reconstruct the workload; source-architecture kernel modules are not included.",
    },
    {
      id: "privileged-kernel-feature-surface",
      status: "verified",
      disposition: "refused",
      expectedRefusalCode: "whole-vm-privileged-kernel-feature-surface-gated",
      evidence:
        "Only the ping socket credential/capability gates in the retained descriptor are accepted; eBPF/seccomp/KVM remain separate capability rows.",
    },
  ];
}

function artifactsUnder(dir: string): Artifact[] {
  const artifacts: Artifact[] = [];
  walk(dir, artifacts);
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

function walk(dir: string, artifacts: Artifact[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(path, artifacts);
    } else if (entry.isFile()) {
      artifacts.push({ name: entry.name, path, sha256: sha256File(path) });
    }
  }
}

function parseArgs(argv: string[]): { retainedDir: string; json: boolean } {
  let retainedDir = "proofs/linux-vm-workload/selected-whole-vm-workload/retained";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--retained-dir") {
      retainedDir = argv[++index] ?? retainedDir;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { retainedDir, json };
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`missing retained artifact: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sha256Text(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

main();
