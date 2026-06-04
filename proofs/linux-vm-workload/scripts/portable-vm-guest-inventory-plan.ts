#!/usr/bin/env tsx
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  assertAcceptedPlan,
  buildPortableVmManifestPlan,
  type PortableVmManifestPlan,
  type RawInventoryItem,
  writeJson,
} from "./portable-vm-inventory-plan.ts";

type Args = { input: string; contract: string; outDir: string; json: boolean };
type InventorySection =
  | "filesystems"
  | "services"
  | "processes"
  | "network"
  | "databases"
  | "devices"
  | "kernelState";
type GuestInventoryItem = {
  id: string;
  component: RawInventoryItem["component"];
  observedState: string;
  attributes: RawInventoryItem["attributes"];
};
type GuestInventoryInput = {
  kind: "machinen.portable-vm-guest-inventory";
  version: 1;
  scope: "fixture-guest-inventory-portable-vm-plan-v1";
  sourceVm: {
    id: string;
    sourceArchitecture: "arm64" | "amd64";
    targetArchitecture: "arm64" | "amd64";
    guestOs: "linux";
    kernel: string;
    vmm: "machinen-vm";
    pauseMode: string;
  };
  pause: Record<string, boolean | string>;
  filesystems: GuestInventoryItem[];
  services: GuestInventoryItem[];
  processes: GuestInventoryItem[];
  network: GuestInventoryItem[];
  databases: GuestInventoryItem[];
  devices: GuestInventoryItem[];
  kernelState: GuestInventoryItem[];
};
type Contract = {
  kind: "machinen.portable-vm-guest-inventory-contract";
  version: 1;
  scope: "fixture-guest-inventory-portable-vm-plan-v1";
  requiredTopLevelFields: string[];
  claimGuard: Record<string, false>;
};
type Report = {
  kind: "machinen.portable-vm-guest-inventory-plan-proof";
  version: 1;
  accepted: true;
  proofStatus: "verified";
  scope: "fixture-guest-inventory-portable-vm-plan-v1";
  publicClaimAllowed: false;
  claimChangeAllowed: false;
  arbitraryVmRestoreClaimed: false;
  inputContract: string;
  inputInventory: string;
  generatedManifestPlan: string;
  summary: PortableVmManifestPlan["summary"] & {
    contractFieldsVerified: number;
    collectorInputRows: number;
    rawInventoryRowsFromGuestInput: number;
    onePlanRowPerInputRow: true;
    refusedRowsHaveCodes: true;
    unknownRowsAccepted: 0;
    productSupportRowsAdded: 0;
    arbitraryVmRestoreRowsAdded: 0;
  };
  artifacts: Array<{ name: string; path: string; sha256: string }>;
};

const sections: InventorySection[] = [
  "filesystems",
  "services",
  "processes",
  "network",
  "databases",
  "devices",
  "kernelState",
];

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const outDir = resolve(args.outDir);
  mkdirSync(outDir, { recursive: true });

  const contract = readJson<Contract>(args.contract);
  const input = readJson<GuestInventoryInput>(args.input);
  validateContract(contract);
  validateInput(input, contract);

  const rawInventory = collectRawInventoryFromGuestInput(input);
  const collectorTranscript = buildCollectorTranscript(input, contract, rawInventory);
  const plan = buildGuestInventoryPlan(input, rawInventory);
  assertAcceptedPlan(plan);
  assertGuestPlan(input, rawInventory, plan);

  const artifacts = [
    writeJson(outDir, "portable-vm-guest-inventory-contract.json", contract),
    writeJson(outDir, "guest-inventory-input.json", input),
    writeJson(outDir, "guest-inventory-collector-transcript.json", collectorTranscript),
    writeJson(outDir, "guest-derived-raw-inventory.json", rawInventory),
    writeJson(outDir, "portable-vm-manifest-plan.generated.json", plan),
  ];
  const report: Report = {
    kind: "machinen.portable-vm-guest-inventory-plan-proof",
    version: 1,
    accepted: true,
    proofStatus: "verified",
    scope: "fixture-guest-inventory-portable-vm-plan-v1",
    publicClaimAllowed: false,
    claimChangeAllowed: false,
    arbitraryVmRestoreClaimed: false,
    inputContract: "portable-vm-guest-inventory-contract.json",
    inputInventory: "guest-inventory-input.json",
    generatedManifestPlan: "portable-vm-manifest-plan.generated.json",
    summary: {
      ...plan.summary,
      contractFieldsVerified: contract.requiredTopLevelFields.length,
      collectorInputRows: countInputRows(input),
      rawInventoryRowsFromGuestInput: rawInventory.length,
      onePlanRowPerInputRow: true,
      refusedRowsHaveCodes: true,
      unknownRowsAccepted: 0,
      productSupportRowsAdded: 0,
      arbitraryVmRestoreRowsAdded: 0,
    },
    artifacts,
  };
  writeJson(outDir, "portable-vm-guest-inventory-plan-report.json", report);
  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `portable VM guest inventory plan: accepted=true inputRows=${report.summary.collectorInputRows} planRows=${report.summary.planRows} refused=${report.summary.refusedRows} arbitraryVmRestoreClaimed=false\n`,
    );
  }
}

function buildGuestInventoryPlan(
  input: GuestInventoryInput,
  rawInventory: RawInventoryItem[],
): PortableVmManifestPlan {
  const plan = buildPortableVmManifestPlan(rawInventory);
  return {
    ...plan,
    scope: "fixture-guest-inventory-portable-vm-plan-v1" as PortableVmManifestPlan["scope"],
    purpose:
      "Generated proof artifact from a guest inventory input plus classifier/restore plan boundary.",
    productIntent: {
      ...plan.productIntent,
      nextImplementationStep:
        "Replace the fixture guest inventory input with an in-guest inventory agent and product command wiring.",
    },
    workflow: plan.workflow.map((row) => {
      if (row.name === "inventory VM") {
        return {
          ...row,
          does: "consume guest-inventory-input.json that represents guest-collected filesystems, services, processes, network, databases, devices, and kernel state",
        };
      }
      if (row.name === "retain proof artifacts") {
        return {
          ...row,
          does: "write contract, guest input, collector transcript, guest-derived raw inventory, generated manifest/plan, and report",
        };
      }
      return row;
    }),
    sourceVm: {
      ...plan.sourceVm,
      id: input.sourceVm.id,
      sourceArchitecture: input.sourceVm
        .sourceArchitecture as PortableVmManifestPlan["sourceVm"]["sourceArchitecture"],
      targetArchitecture: input.sourceVm
        .targetArchitecture as PortableVmManifestPlan["sourceVm"]["targetArchitecture"],
      guestOs: input.sourceVm.guestOs,
      kernel: input.sourceVm.kernel,
      vmm: input.sourceVm.vmm,
      pauseMode: "controlled-idle-quiesce-proof",
      quiesce: input.pause,
    },
  };
}

function collectRawInventoryFromGuestInput(input: GuestInventoryInput): RawInventoryItem[] {
  const rawInventory: RawInventoryItem[] = [];
  for (const section of sections) {
    for (const item of input[section]) {
      rawInventory.push({
        id: item.id,
        section,
        component: item.component,
        observedState: item.observedState,
        attributes: item.attributes,
      });
    }
  }
  return rawInventory;
}

function buildCollectorTranscript(
  input: GuestInventoryInput,
  contract: Contract,
  rawInventory: RawInventoryItem[],
): unknown {
  const refusedCandidates = rawInventory.filter((item) =>
    [
      "unknown-live-process",
      "active-tcp-streams",
      "postgres-dirty-wal",
      "passthrough-gpu",
      "active-syscalls",
    ].includes(item.id),
  );
  return {
    kind: "machinen.portable-vm-guest-inventory-collector-transcript",
    version: 1,
    accepted: true,
    scope: input.scope,
    contract: contract.scope,
    sourceVm: input.sourceVm.id,
    inputRows: countInputRows(input),
    rawInventoryRows: rawInventory.length,
    refusedCandidates: refusedCandidates.map((item) => item.id),
    checks: [
      { name: "contract-loaded", passed: true },
      { name: "required-fields-present", passed: true },
      { name: "one-raw-row-per-guest-input-row", passed: true },
      { name: "unknown-state-policy-refuse-by-default", passed: true },
      { name: "claim-guard-public-claim-disabled", passed: true },
    ],
    claimGuard: contract.claimGuard,
  };
}

function validateContract(contract: Contract): void {
  if (contract.kind !== "machinen.portable-vm-guest-inventory-contract") {
    throw new Error("unexpected guest inventory contract kind");
  }
  if (contract.version !== 1) {
    throw new Error("unexpected guest inventory contract version");
  }
  for (const [key, value] of Object.entries(contract.claimGuard)) {
    if (value !== false) {
      throw new Error(`contract claim guard drifted: ${key}`);
    }
  }
}

function validateInput(input: GuestInventoryInput, contract: Contract): void {
  if (input.kind !== "machinen.portable-vm-guest-inventory") {
    throw new Error("unexpected guest inventory kind");
  }
  if (input.scope !== contract.scope) {
    throw new Error("guest inventory scope does not match contract");
  }
  for (const field of contract.requiredTopLevelFields) {
    if (!(field in input)) {
      throw new Error(`guest inventory missing required field: ${field}`);
    }
  }
  for (const section of sections) {
    if (!Array.isArray(input[section])) {
      throw new Error(`guest inventory section is not an array: ${section}`);
    }
    for (const item of input[section]) {
      if (!item.id || !item.component || !item.observedState || !item.attributes) {
        throw new Error(`guest inventory item is incomplete in ${section}`);
      }
    }
  }
  if (input.pause.unknownStatePolicy !== "refuse-by-default") {
    throw new Error("guest inventory must declare refuse-by-default unknown state policy");
  }
}

function assertGuestPlan(
  input: GuestInventoryInput,
  rawInventory: RawInventoryItem[],
  plan: PortableVmManifestPlan,
): void {
  if (countInputRows(input) !== rawInventory.length) {
    throw new Error("guest input to raw inventory row count drifted");
  }
  if (rawInventory.length !== plan.plan.rows.length) {
    throw new Error("guest raw inventory to plan row count drifted");
  }
  if (plan.scope !== "fixture-guest-inventory-portable-vm-plan-v1") {
    throw new Error("guest inventory plan scope drifted");
  }
  if (plan.summary.refusedRows !== 5 || plan.summary.unknownRows !== 0) {
    throw new Error("guest inventory refusal coverage drifted");
  }
  for (const row of plan.plan.rows.filter((row) => row.disposition === "refused")) {
    if (!row.refusalCode?.startsWith("portable-vm-")) {
      throw new Error(`refused guest plan row missing stable code: ${row.id}`);
    }
  }
}

function countInputRows(input: GuestInventoryInput): number {
  return sections.reduce((count, section) => count + input[section].length, 0);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    input:
      "proofs/linux-vm-workload/portable-vm-guest-inventory-plan/fixtures/guest-inventory-input.json",
    contract: "docs/snapshot/portable-vm-guest-inventory-contract.json",
    outDir: "proofs/linux-vm-workload/portable-vm-guest-inventory-plan/retained",
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--input") {
      args.input = argv[++index] ?? args.input;
    } else if (arg === "--contract") {
      args.contract = argv[++index] ?? args.contract;
    } else if (arg === "--out") {
      args.outDir = argv[++index] ?? args.outDir;
    } else if (arg === "--json") {
      args.json = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

main();
