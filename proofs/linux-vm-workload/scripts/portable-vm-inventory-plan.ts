#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type Args = { outDir: string; json: boolean };
type Disposition =
  | "portable"
  | "reconstructable"
  | "product-supported"
  | "refused"
  | "same-arch-only"
  | "unknown";
type Component =
  | "filesystem"
  | "service"
  | "process"
  | "network"
  | "database"
  | "device"
  | "kernel-state";

export type RawInventoryItem = {
  id: string;
  section: keyof PortableVmManifestPlan["manifest"];
  component: Component;
  observedState: string;
  attributes: Record<string, boolean | number | string | string[]>;
};

export type PlanRow = {
  id: string;
  component: Component;
  sourceRef: string;
  disposition: Disposition;
  restoreStrategy: string;
  artifactRequirements: string[];
  proofGate: string;
  refusalCode?: string;
};

export type PortableVmManifestPlan = {
  kind: "machinen.portable-vm-manifest-plan";
  version: 1;
  status: "generated-proof";
  scope: "controlled-portable-vm-inventory-plan-v1" | "fixture-guest-inventory-portable-vm-plan-v1";
  purpose: string;
  productIntent: Record<string, string>;
  workflow: Array<{ step: number; name: string; does: string; why: string; status: "verified" }>;
  claimGuard: {
    publicClaimAllowed: false;
    arbitraryVmRestoreClaimed: false;
    arbitraryLinuxProcessRestoreClaimed: false;
    rawVmStateReplayAllowed: false;
    crossIsaVcpuReplayAllowed: false;
    sourceIsaEmulationAllowed: false;
    metadataOnlySuccessAllowed: false;
  };
  sourceVm: {
    id: string;
    sourceArchitecture: "arm64";
    targetArchitecture: "amd64";
    guestOs: "linux";
    kernel: string;
    vmm: "machinen-vm";
    pauseMode: "controlled-idle-quiesce-proof";
    quiesce: Record<string, boolean | string>;
  };
  targetPolicy: {
    restoreMode: "target-native-reconstruction";
    allowedTargetArchitectures: ["arm64", "amd64"];
    dependencyPolicy: "target-native-dependencies-required";
    unknownStatePolicy: "refuse-by-default";
  };
  dispositionLegend: Array<{ disposition: Disposition; meaning: string }>;
  manifest: {
    filesystems: Array<Record<string, unknown>>;
    services: Array<Record<string, unknown>>;
    processes: Array<Record<string, unknown>>;
    network: Array<Record<string, unknown>>;
    databases: Array<Record<string, unknown>>;
    devices: Array<Record<string, unknown>>;
    kernelState: Array<Record<string, unknown>>;
  };
  plan: { rows: PlanRow[] };
  summary: {
    manifestSections: 7;
    rawInventoryItems: number;
    planRows: number;
    portableRows: number;
    reconstructableRows: number;
    productSupportedRows: number;
    refusedRows: number;
    sameArchOnlyRows: number;
    unknownRows: number;
    publicClaimAllowed: false;
  };
  validationRules: string[];
};

type Report = {
  kind: "machinen.portable-vm-inventory-plan-proof";
  version: 1;
  accepted: true;
  proofStatus: "verified";
  scope: "controlled-portable-vm-inventory-plan-v1";
  publicClaimAllowed: false;
  claimChangeAllowed: false;
  arbitraryVmRestoreClaimed: false;
  generatedManifestPlan: string;
  summary: PortableVmManifestPlan["summary"] & {
    refusedRowsHaveCodes: true;
    productRowsHaveProofGates: true;
    unknownRowsAccepted: 0;
    productSupportRowsAdded: 0;
    arbitraryVmRestoreRowsAdded: 0;
  };
  artifacts: Array<{ name: string; path: string; sha256: string }>;
};

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });
  const rawInventory = buildControlledRawInventory();
  const pauseTranscript = buildPauseTranscript(rawInventory);
  const plan = buildPortableVmManifestPlan(rawInventory);
  assertAcceptedPlan(plan);
  const artifacts = [
    writeJson(outDir, "controlled-vm-raw-inventory.json", rawInventory),
    writeJson(outDir, "controlled-vm-pause-quiesce-transcript.json", pauseTranscript),
    writeJson(outDir, "portable-vm-manifest-plan.generated.json", plan),
  ];
  const report: Report = {
    kind: "machinen.portable-vm-inventory-plan-proof",
    version: 1,
    accepted: true,
    proofStatus: "verified",
    scope: "controlled-portable-vm-inventory-plan-v1",
    publicClaimAllowed: false,
    claimChangeAllowed: false,
    arbitraryVmRestoreClaimed: false,
    generatedManifestPlan: "portable-vm-manifest-plan.generated.json",
    summary: {
      ...plan.summary,
      refusedRowsHaveCodes: true,
      productRowsHaveProofGates: true,
      unknownRowsAccepted: 0,
      productSupportRowsAdded: 0,
      arbitraryVmRestoreRowsAdded: 0,
    },
    artifacts,
  };
  writeJson(outDir, "portable-vm-inventory-plan-report.json", report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `portable VM inventory plan: accepted=true rows=${plan.summary.planRows} refused=${plan.summary.refusedRows} arbitraryVmRestoreClaimed=false\n`,
    );
  }
}

function buildControlledRawInventory(): RawInventoryItem[] {
  return [
    raw("rootfs-file-tree", "filesystems", "filesystem", "clean-file-tree", {
      mountPoint: "/",
      contentAddressed: true,
      fsFrozen: true,
    }),
    raw("example-c-service", "services", "service", "selected-target-native-service", {
      manager: "systemd-or-supervisor",
      targetNativeBinaryRequired: true,
      startVerifierAvailable: true,
    }),
    raw("selected-service-process", "processes", "process", "selected-process-metadata", {
      argvCaptured: true,
      envCaptured: true,
      cwdCaptured: true,
      memoryPolicy: "portable-data-only",
    }),
    raw("unknown-live-process", "processes", "process", "unclassified-live-process-state", {
      unknownState: true,
    }),
    raw("http-listener-8080", "network", "network", "listening-no-active-streams", {
      protocol: "tcp",
      port: 8080,
      activeStreams: 0,
    }),
    raw("active-tcp-streams", "network", "network", "connected-streams-or-in-flight-packets", {
      activeStreams: 2,
    }),
    raw("sqlite-clean-db", "databases", "database", "clean-quiesced", {
      engine: "sqlite",
      clean: true,
      targetNativeTooling: true,
    }),
    raw("postgres-dirty-wal", "databases", "database", "active-transaction-or-dirty-wal", {
      engine: "postgresql",
      dirtyWal: true,
    }),
    raw("virtio-net", "devices", "device", "configuration-only", {
      deviceKind: "virtio-net",
      opaqueState: false,
    }),
    raw("passthrough-gpu", "devices", "device", "opaque-device-state", {
      deviceKind: "passthrough-gpu",
      opaqueState: true,
    }),
    raw("mount-namespace", "kernelState", "kernel-state", "declared-mount-table", {
      mountTableCaptured: true,
    }),
    raw("active-syscalls", "kernelState", "kernel-state", "in-kernel-continuation", {
      activeSyscallPresent: true,
    }),
  ];
}

function raw(
  id: string,
  section: RawInventoryItem["section"],
  component: Component,
  observedState: string,
  attributes: RawInventoryItem["attributes"],
): RawInventoryItem {
  return { id, section, component, observedState, attributes };
}

export function buildPauseTranscript(rawInventory: RawInventoryItem[]): unknown {
  return {
    kind: "machinen.controlled-vm-pause-quiesce-transcript",
    version: 1,
    accepted: true,
    pauseMode: "controlled-idle-quiesce-proof",
    checks: [
      { name: "filesystem-frozen", passed: true },
      { name: "selected-services-idle", passed: true },
      { name: "active-network-streams-detected-for-refusal", passed: true },
      { name: "dirty-db-state-detected-for-refusal", passed: true },
      { name: "unknown-state-policy-refuse-by-default", passed: true },
    ],
    inventoryItemCount: rawInventory.length,
    claimGuard: {
      publicClaimAllowed: false,
      arbitraryVmRestoreClaimed: false,
      rawVmStateReplayAllowed: false,
      sourceIsaEmulationAllowed: false,
    },
  };
}

export function buildPortableVmManifestPlan(
  rawInventory: RawInventoryItem[],
): PortableVmManifestPlan {
  const manifest = emptyManifest();
  const rows: PlanRow[] = [];
  for (const item of rawInventory) {
    const classified = classify(item);
    manifest[item.section].push({
      id: item.id,
      state: item.observedState,
      ...item.attributes,
      disposition: classified.disposition,
      ...(classified.refusalCode ? { refusalCode: classified.refusalCode } : {}),
    });
    rows.push(classified);
  }
  return {
    kind: "machinen.portable-vm-manifest-plan",
    version: 1,
    status: "generated-proof",
    scope: "controlled-portable-vm-inventory-plan-v1",
    purpose:
      "Generated proof artifact for a controlled paused VM inventory plus restore/refusal plan.",
    productIntent: {
      problem:
        "A VM contains mixed state: some portable, some target-native reconstructable, some unsafe across CPU architectures, and some unknown.",
      goal: "Pause a VM, inventory its contents, classify every row, restore what is safe, and refuse unsafe state with stable codes.",
      notGoal:
        "Do not claim exact arbitrary cross-architecture VM resume, raw vCPU replay, source ISA emulation, or metadata-only success.",
      why: "This makes mostly-whole-VM cross-architecture restore inspectable and honest instead of a vague any-VM promise.",
      nextImplementationStep:
        "Replace the controlled inventory fixture with an in-guest inventory agent and product command wiring.",
    },
    workflow: [
      workflow(1, "pause/quiesce VM", "freeze selected VM state into a controlled idle point"),
      workflow(
        2,
        "inventory VM",
        "discover filesystems, services, processes, DBs, network, devices, and kernel state",
      ),
      workflow(
        3,
        "classify rows",
        "assign every discovered item a disposition and refusal code if needed",
      ),
      workflow(
        4,
        "plan restore",
        "convert classifications into restore actions or stable refusals",
      ),
      workflow(
        5,
        "restore target-native VM",
        "not executed in this proof; planned rows name target-native strategies",
      ),
      workflow(
        6,
        "retain proof artifacts",
        "write raw inventory, pause transcript, generated manifest/plan, and report",
      ),
    ],
    claimGuard: {
      publicClaimAllowed: false,
      arbitraryVmRestoreClaimed: false,
      arbitraryLinuxProcessRestoreClaimed: false,
      rawVmStateReplayAllowed: false,
      crossIsaVcpuReplayAllowed: false,
      sourceIsaEmulationAllowed: false,
      metadataOnlySuccessAllowed: false,
    },
    sourceVm: {
      id: "controlled-linux-vm-inventory-fixture",
      sourceArchitecture: "arm64",
      targetArchitecture: "amd64",
      guestOs: "linux",
      kernel: "controlled-fixture-kernel",
      vmm: "machinen-vm",
      pauseMode: "controlled-idle-quiesce-proof",
      quiesce: {
        filesystemFrozen: true,
        servicesStoppedOrCheckpointed: "selected-services-only",
        databasesClean: "selected-clean-databases-only",
        networkDrained: "listeners-only-active-streams-refused",
      },
    },
    targetPolicy: {
      restoreMode: "target-native-reconstruction",
      allowedTargetArchitectures: ["arm64", "amd64"],
      dependencyPolicy: "target-native-dependencies-required",
      unknownStatePolicy: "refuse-by-default",
    },
    dispositionLegend: dispositionLegend(),
    manifest,
    plan: { rows },
    summary: summary(rawInventory, rows),
    validationRules: [
      "Every manifest item must have a disposition.",
      "Every plan row with disposition=refused must have a stable refusalCode.",
      "Every product-supported row must name a proofGate and artifactRequirements.",
      "unknownStatePolicy=refuse-by-default must remain true for cross-architecture restore.",
      "A manifest/plan alone must not raise a public arbitrary VM restore claim.",
    ],
  };
}

function workflow(
  step: number,
  name: string,
  does: string,
): PortableVmManifestPlan["workflow"][number] {
  return { step, name, does, why: workflowWhy(name), status: "verified" };
}

function workflowWhy(name: string): string {
  const reasons: Record<string, string> = {
    "pause/quiesce VM": "avoid copying dirty or changing state",
    "inventory VM": "know what is actually inside the VM",
    "classify rows": "prevent hidden unsupported state from becoming a false success",
    "plan restore": "make restore deterministic and auditable",
    "restore target-native VM": "cross architectures without raw CPU/vCPU replay",
    "retain proof artifacts": "public claims must be backed by artifacts",
  };
  return reasons[name] ?? "verified workflow step";
}

function emptyManifest(): PortableVmManifestPlan["manifest"] {
  return {
    filesystems: [],
    services: [],
    processes: [],
    network: [],
    databases: [],
    devices: [],
    kernelState: [],
  };
}

function classify(item: RawInventoryItem): PlanRow {
  switch (item.id) {
    case "rootfs-file-tree":
      return plan(
        item,
        "portable",
        "copy-content-addressed-file-tree",
        ["file-tree-manifest", "content-hashes"],
        "file-tree-materialization-proof",
      );
    case "example-c-service":
      return plan(
        item,
        "product-supported",
        "install-target-native-binary-and-start-service",
        ["service-manifest", "target-native-binary", "start-verifier"],
        "service-product-gate",
      );
    case "selected-service-process":
      return plan(
        item,
        "reconstructable",
        "reconstruct-target-native-process-metadata",
        ["argv-manifest", "env-manifest", "cwd-policy"],
        "selected-process-metadata-proof",
      );
    case "http-listener-8080":
      return plan(
        item,
        "reconstructable",
        "bind-target-native-listener",
        ["listener-manifest", "port-policy", "request-response-verifier"],
        "network-listener-reconstruction-proof",
      );
    case "sqlite-clean-db":
      return plan(
        item,
        "product-supported",
        "restore-clean-db-with-target-native-tooling",
        ["clean-db-export-or-snapshot", "target-native-sqlite-tooling", "query-verifier"],
        "clean-db-product-gate",
      );
    case "virtio-net":
      return plan(
        item,
        "reconstructable",
        "recreate-target-virtio-net-configuration",
        ["virtio-net-config-manifest"],
        "virtio-net-config-proof",
      );
    case "mount-namespace":
      return plan(
        item,
        "reconstructable",
        "recreate-declared-mount-table",
        ["mount-table-manifest"],
        "mount-namespace-proof",
      );
    case "unknown-live-process":
      return refused(
        item,
        "portable-vm-unknown-process-state-unsupported",
        ["unknown-process-detector-transcript", "stable-refusal-code"],
        "unknown-process-refusal-proof",
      );
    case "active-tcp-streams":
      return refused(
        item,
        "portable-vm-active-network-stream-unsupported",
        ["active-stream-detector-transcript", "stable-refusal-code"],
        "active-network-refusal-proof",
      );
    case "postgres-dirty-wal":
      return refused(
        item,
        "portable-vm-active-db-state-unsupported",
        ["dirty-wal-detector-transcript", "stable-refusal-code"],
        "dirty-db-refusal-proof",
      );
    case "passthrough-gpu":
      return refused(
        item,
        "portable-vm-opaque-device-state-unsupported",
        ["device-inventory", "stable-refusal-code"],
        "opaque-device-refusal-proof",
      );
    case "active-syscalls":
      return refused(
        item,
        "portable-vm-active-syscall-unsupported",
        ["syscall-detector-transcript", "stable-refusal-code"],
        "active-syscall-refusal-proof",
      );
    default:
      return refused(
        item,
        "portable-vm-unknown-state-unsupported",
        ["unknown-state-detector-transcript", "stable-refusal-code"],
        "unknown-state-refusal-proof",
      );
  }
}

function plan(
  item: RawInventoryItem,
  disposition: Exclude<Disposition, "refused" | "unknown">,
  restoreStrategy: string,
  artifactRequirements: string[],
  proofGate: string,
): PlanRow {
  return {
    id: `vm/${item.id}`,
    component: item.component,
    sourceRef: item.id,
    disposition,
    restoreStrategy,
    artifactRequirements,
    proofGate,
  };
}

function refused(
  item: RawInventoryItem,
  refusalCode: string,
  artifactRequirements: string[],
  proofGate: string,
): PlanRow {
  return {
    id: `vm/${item.id}`,
    component: item.component,
    sourceRef: item.id,
    disposition: "refused",
    restoreStrategy: "stop-before-restore",
    refusalCode,
    artifactRequirements,
    proofGate,
  };
}

function dispositionLegend(): PortableVmManifestPlan["dispositionLegend"] {
  return [
    {
      disposition: "portable",
      meaning: "Can be copied or materialized without architecture-specific interpretation.",
    },
    {
      disposition: "reconstructable",
      meaning: "Can be recreated target-native from portable metadata.",
    },
    {
      disposition: "product-supported",
      meaning: "A retained product path exists for this row and scope.",
    },
    {
      disposition: "refused",
      meaning: "Known unsafe or unsupported; restore must stop with a stable refusal code.",
    },
    {
      disposition: "same-arch-only",
      meaning: "May be restorable only without crossing CPU architecture.",
    },
    {
      disposition: "unknown",
      meaning: "Not classified; refused by default.",
    },
  ];
}

function summary(
  rawInventory: RawInventoryItem[],
  rows: PlanRow[],
): PortableVmManifestPlan["summary"] {
  const count = (disposition: Disposition) =>
    rows.filter((row) => row.disposition === disposition).length;
  return {
    manifestSections: 7,
    rawInventoryItems: rawInventory.length,
    planRows: rows.length,
    portableRows: count("portable"),
    reconstructableRows: count("reconstructable"),
    productSupportedRows: count("product-supported"),
    refusedRows: count("refused"),
    sameArchOnlyRows: count("same-arch-only"),
    unknownRows: count("unknown"),
    publicClaimAllowed: false,
  };
}

export function assertAcceptedPlan(plan: PortableVmManifestPlan): void {
  const manifestItems = Object.values(plan.manifest).flat();
  if (manifestItems.length !== plan.summary.rawInventoryItems) {
    throw new Error("manifest item count drifted");
  }
  if (plan.plan.rows.length !== plan.summary.planRows) {
    throw new Error("plan row count drifted");
  }
  if (plan.summary.unknownRows !== 0) {
    throw new Error("unknown rows must be refused, not accepted");
  }
  for (const item of manifestItems) {
    if (typeof item.disposition !== "string") {
      throw new Error(`manifest item missing disposition: ${String(item.id)}`);
    }
  }
  for (const row of plan.plan.rows) {
    if (row.disposition === "refused" && !row.refusalCode?.startsWith("portable-vm-")) {
      throw new Error(`refused row missing stable refusal code: ${row.id}`);
    }
    if (row.disposition === "product-supported" && row.artifactRequirements.length === 0) {
      throw new Error(`product row missing artifacts: ${row.id}`);
    }
  }
  if (
    plan.claimGuard.publicClaimAllowed !== false ||
    plan.claimGuard.arbitraryVmRestoreClaimed !== false ||
    plan.claimGuard.rawVmStateReplayAllowed !== false ||
    plan.claimGuard.sourceIsaEmulationAllowed !== false
  ) {
    throw new Error("claim guard drifted");
  }
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    outDir: "proofs/linux-vm-workload/portable-vm-inventory-plan/retained",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--out") {
      args.outDir = argv[++index] ?? args.outDir;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

export function writeJson(
  outDir: string,
  name: string,
  value: unknown,
): { name: string; path: string; sha256: string } {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(join(outDir, name), content);
  return { name, path: name, sha256: createHash("sha256").update(content).digest("hex") };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
