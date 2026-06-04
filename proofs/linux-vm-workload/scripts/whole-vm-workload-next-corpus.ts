import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type WorkloadDisposition = "not-started" | "refusal-defined";

type CorpusWorkloadRow = {
  id: string;
  label: string;
  category: string;
  disposition: WorkloadDisposition;
  claimUse: "future-corpus-only" | "refusal-boundary-only";
  supportRequires: string[];
  refusalRequires: string[];
  forbiddenShortcuts: string[];
  claimImpact: {
    productSupportDelta: 0;
    broadSupportDelta: 0;
    arbitraryProcessCrossArchRestoreDelta: 0;
    claimChangeAllowed: false;
  };
};

type NextCorpusReport = {
  kind: "machinen.whole-vm-workload-next-corpus";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  proofStatus: "defined" | "blocked";
  publicClaimAllowed: false;
  currentClaim: {
    productSupport: 100;
    broadSupport: 100;
    arbitraryProcessCrossArchRestore: 0;
  };
  currentClaimScope: "selected-whole-vm-workload-v1 only";
  nextCorpusClaimAllowed: false;
  nextCorpusRows: CorpusWorkloadRow[];
  requiredRows: number;
  definedRows: number;
  supportArtifactsCovered: 0;
  supportArtifactsRequiredBeforeClaimLift: number;
  refusalArtifactsCovered: 0;
  refusalArtifactsRequiredBeforeClaimLift: number;
  gates: Record<string, boolean>;
  priorArtifacts: Array<{ name: string; path: string; sha256: string }>;
};

const SUPPORT_ARTIFACT_REQUIREMENTS = [
  "source workload manifest",
  "source verifier output",
  "portable rootfs/app/data manifest with hashes",
  "capture transcript",
  "restore plan",
  "target verifier output",
  "target boot/workload transcript",
  "shortcut inspection record",
  "artifact integrity manifest",
  "arm64-to-amd64 retained product restore",
  "amd64-to-arm64 retained product restore",
];

const REFUSAL_ARTIFACT_REQUIREMENTS = [
  "refusal input manifest",
  "product command transcript",
  "stable expected refusal code",
  "evidence for boundary condition",
  "shortcut inspection record",
  "dashboard claim-impact record with zero deltas",
];

const FORBIDDEN_SHORTCUTS = [
  "raw vCPU replay",
  "source ISA emulation",
  "opaque VM/device metadata-only success",
  "app checkpoint hooks as the source of truth",
  "sidecar replay",
];

const ROWS: CorpusWorkloadRow[] = [
  workloadRow(
    "whole-vm-sqlite-clean-db-workload",
    "SQLite clean DB workload",
    "database workload",
    [
      "sqlite3 create/insert/select source verifier",
      "clean shutdown or explicit checkpoint before capture",
      "target-native sqlite3 verifier after restore",
      "dirty WAL/hot journal refusal neighbors",
    ],
  ),
  workloadRow(
    "whole-vm-postgresql-clean-workload",
    "PostgreSQL clean workload",
    "database workload",
    [
      "PostgreSQL start/readiness/query source verifier",
      "clean logical or filesystem-safe checkpoint boundary",
      "target-native PostgreSQL verifier after restore",
      "active transaction/dirty WAL/prepared session refusal neighbors",
    ],
  ),
  workloadRow("whole-vm-c-service-workload", "C service workload", "service workload", [
    "portable C source or target-native build manifest",
    "source service request/response verifier",
    "target-native service request/response verifier",
    "native shared library/kernel ABI mismatch refusals",
  ]),
  workloadRow("whole-vm-java-service-workload", "Java service workload", "service workload", [
    "portable Java source/JAR manifest",
    "JVM version/runtime manifest",
    "source service verifier",
    "target-native JVM service verifier",
    "JIT/runtime-private-state refusal neighbors",
  ]),
  workloadRow("whole-vm-filesystem-workload", "Filesystem workload", "filesystem workload", [
    "portable file tree manifest with hashes and modes",
    "source fs operation verifier",
    "target fs operation verifier",
    "unsynced append/partial rename/lock/watch refusal neighbors",
  ]),
  workloadRow(
    "whole-vm-network-listener-workload",
    "Network listener workload",
    "network workload",
    [
      "declared listener protocol and port manifest",
      "source request/response verifier",
      "target-native listener verifier",
      "active connection/TLS/session/in-flight packet refusal neighbors",
    ],
  ),
  workloadRow(
    "whole-vm-multi-process-workload",
    "Multi-process workload",
    "process topology workload",
    [
      "declared process topology manifest",
      "source IPC/order verifier",
      "target process topology and IPC verifier",
      "unmodeled scheduler/futex/shared-memory refusal neighbors",
    ],
  ),
  {
    id: "whole-vm-dirty-active-opaque-state-refusals",
    label: "Dirty/active/opaque state refusals",
    category: "refusal boundary",
    disposition: "refusal-defined",
    claimUse: "refusal-boundary-only",
    supportRequires: [],
    refusalRequires: [
      ...REFUSAL_ARTIFACT_REQUIREMENTS,
      "dirty database state refusal",
      "active network/session refusal",
      "opaque guest kernel/device state refusal",
      "runtime-private/JIT/native extension state refusal",
    ],
    forbiddenShortcuts: FORBIDDEN_SHORTCUTS,
    claimImpact: zeroClaimImpact(),
  },
];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const priorArtifacts = [
    artifactFor(args.taxonomy),
    artifactFor(args.selectedSupportMatrix),
    artifactFor(args.smokeMatrix),
  ];
  const gates = {
    priorSelectedMatrixAccepted: readJson(args.selectedSupportMatrix).accepted === true,
    rowsEnumerated: ROWS.length === 8,
    supportRowsDoNotClaim: ROWS.every((row) => row.claimImpact.claimChangeAllowed === false),
    dirtyActiveOpaqueRefusalPresent: ROWS.some(
      (row) => row.id === "whole-vm-dirty-active-opaque-state-refusals",
    ),
    forbiddenShortcutsPreserved: ROWS.every((row) =>
      FORBIDDEN_SHORTCUTS.every((shortcut) => row.forbiddenShortcuts.includes(shortcut)),
    ),
  };
  const accepted = Object.values(gates).every(Boolean);
  const report: NextCorpusReport = {
    kind: "machinen.whole-vm-workload-next-corpus",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    proofStatus: accepted ? "defined" : "blocked",
    publicClaimAllowed: false,
    currentClaim: {
      productSupport: 100,
      broadSupport: 100,
      arbitraryProcessCrossArchRestore: 0,
    },
    currentClaimScope: "selected-whole-vm-workload-v1 only",
    nextCorpusClaimAllowed: false,
    nextCorpusRows: ROWS,
    requiredRows: ROWS.length,
    definedRows: ROWS.length,
    supportArtifactsCovered: 0,
    supportArtifactsRequiredBeforeClaimLift:
      ROWS.filter((row) => row.disposition === "not-started").length *
      SUPPORT_ARTIFACT_REQUIREMENTS.length,
    refusalArtifactsCovered: 0,
    refusalArtifactsRequiredBeforeClaimLift: ROWS.reduce(
      (sum, row) => sum + row.refusalRequires.length,
      0,
    ),
    gates,
    priorArtifacts,
  };
  writeJson(join(args.outDir, "whole-vm-workload-next-corpus-report.json"), report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `whole VM next corpus: accepted=${report.accepted} rows=${report.definedRows}/${report.requiredRows} claimAllowed=${report.nextCorpusClaimAllowed}\n`,
    );
  }
  if (!accepted) {
    process.exitCode = 1;
  }
}

function workloadRow(
  id: string,
  label: string,
  category: string,
  extraSupportRequires: string[],
): CorpusWorkloadRow {
  return {
    id,
    label,
    category,
    disposition: "not-started",
    claimUse: "future-corpus-only",
    supportRequires: [...SUPPORT_ARTIFACT_REQUIREMENTS, ...extraSupportRequires],
    refusalRequires: REFUSAL_ARTIFACT_REQUIREMENTS,
    forbiddenShortcuts: FORBIDDEN_SHORTCUTS,
    claimImpact: zeroClaimImpact(),
  };
}

function zeroClaimImpact(): CorpusWorkloadRow["claimImpact"] {
  return {
    productSupportDelta: 0,
    broadSupportDelta: 0,
    arbitraryProcessCrossArchRestoreDelta: 0,
    claimChangeAllowed: false,
  };
}

function parseArgs(argv: string[]): {
  outDir: string;
  taxonomy: string;
  selectedSupportMatrix: string;
  smokeMatrix: string;
  json: boolean;
} {
  let outDir = "proofs/linux-vm-workload/next-corpus/retained";
  let taxonomy = "docs/snapshot/whole-linux-vm-workload-taxonomy.json";
  let selectedSupportMatrix =
    "proofs/linux-vm-workload/selected-whole-vm-workload/retained/selected-whole-vm-workload-support-matrix-report.json";
  let smokeMatrix =
    "proofs/linux-vm-workload/smoke-matrix/retained/whole-vm-workload-smoke-matrix-report.json";
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--out-dir") {
      outDir = argv[++index] ?? outDir;
    } else if (arg === "--taxonomy") {
      taxonomy = argv[++index] ?? taxonomy;
    } else if (arg === "--selected-support-matrix") {
      selectedSupportMatrix = argv[++index] ?? selectedSupportMatrix;
    } else if (arg === "--smoke-matrix") {
      smokeMatrix = argv[++index] ?? smokeMatrix;
    } else if (arg === "--json") {
      json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { outDir, taxonomy, selectedSupportMatrix, smokeMatrix, json };
}

function readJson(path: string): Record<string, unknown> {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    throw new Error(`missing artifact: ${path}`);
  }
  return JSON.parse(readFileSync(absolute, "utf8")) as Record<string, unknown>;
}

function artifactFor(path: string): { name: string; path: string; sha256: string } {
  return { name: path.split("/").pop() ?? path, path, sha256: sha256File(path) };
}

function sha256File(path: string): string {
  return createHash("sha256")
    .update(readFileSync(resolve(path)))
    .digest("hex");
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

main();
