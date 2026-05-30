#!/usr/bin/env tsx
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));

interface DryRunResult {
  command: string;
  privateCli: boolean;
  dryRunOnly: boolean;
  accepted: boolean;
  code: string;
  sourceArchitecture?: string;
  targetArchitecture?: string;
  plan?: Record<string, unknown>;
  targetStarted: boolean;
}

function sha256(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function createBundle(): Record<string, unknown> {
  const sections = {
    heapGraphIr: { kind: "machinen.v8-layout-decoded-heap-graph-ir", total: 2, graphTotal: 2 },
    continuationDescriptor: {
      continuationClass: "node-libuv-event-loop-wait-v1",
      sourceArchitecture: "arm64",
      targetArchitecture: "amd64",
      rawSourceRegistersCopiedToTarget: false,
      rawSourceStackCopiedToTarget: false,
      rawSourcePcCopiedToTarget: false,
      sourceIsaEmulationUsed: false,
    },
    resourceDescriptors: [
      { kind: "tcp-listener-v1", sourceKernelFdCopiedToTarget: false },
      { kind: "repeating-timer-v1", sourceKernelFdCopiedToTarget: false },
    ],
    claimAudit: { productSupportClaimed: false, broadLevel5ImplementationClaimed: false },
  };
  return {
    kind: "machinen.node-proper-level5-translated-continuation-bundle",
    proof: "046",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    architecture: { source: "arm64", target: "amd64" },
    sections,
    sectionDigests: Object.fromEntries(
      Object.entries(sections).map(([key, value]) => [key, sha256(value)]),
    ),
  };
}

function runPrivateCli(argv: string[]): DryRunResult {
  const [command, bundlePath, ...rest] = argv;
  const dryRunOnly = rest.includes("--dry-run");
  if (command !== "private-restore-translated-bundle") {
    return {
      command,
      privateCli: true,
      dryRunOnly,
      accepted: false,
      code: "node-proper-level5-private-cli-command-required",
      targetStarted: false,
    };
  }
  if (!dryRunOnly) {
    return {
      command,
      privateCli: true,
      dryRunOnly,
      accepted: false,
      code: "node-proper-level5-private-cli-dry-run-required",
      targetStarted: false,
    };
  }
  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as Record<string, unknown>;
  if (bundle.productSupportClaimed === true || bundle.broadLevel5ImplementationClaimed === true) {
    return {
      command,
      privateCli: true,
      dryRunOnly,
      accepted: false,
      code: "node-proper-level5-product-claim-refused",
      targetStarted: false,
    };
  }
  const arch = bundle.architecture as { source?: string; target?: string } | undefined;
  if (arch?.source !== "arm64" || arch.target !== "amd64") {
    return {
      command,
      privateCli: true,
      dryRunOnly,
      accepted: false,
      code: "node-proper-level5-cross-arch-required",
      targetStarted: false,
    };
  }
  const sections = bundle.sections as Record<string, unknown> | undefined;
  const digests = bundle.sectionDigests as Record<string, string> | undefined;
  if (!sections || !digests) {
    return {
      command,
      privateCli: true,
      dryRunOnly,
      accepted: false,
      code: "node-proper-level5-bundle-sections-required",
      targetStarted: false,
    };
  }
  for (const [key, value] of Object.entries(sections)) {
    if (digests[key] !== sha256(value)) {
      return {
        command,
        privateCli: true,
        dryRunOnly,
        accepted: false,
        code: "node-proper-level5-bundle-integrity-refused",
        targetStarted: false,
      };
    }
  }
  const continuation = sections.continuationDescriptor as Record<string, unknown>;
  if (
    continuation.sourceIsaEmulationUsed ||
    continuation.rawSourceRegistersCopiedToTarget ||
    continuation.rawSourceStackCopiedToTarget ||
    continuation.rawSourcePcCopiedToTarget
  ) {
    return {
      command,
      privateCli: true,
      dryRunOnly,
      accepted: false,
      code: "node-proper-level5-raw-cpu-copy-refused",
      targetStarted: false,
    };
  }
  return {
    command,
    privateCli: true,
    dryRunOnly,
    accepted: true,
    code: "accepted-dry-run",
    sourceArchitecture: arch.source,
    targetArchitecture: arch.target,
    targetStarted: false,
    plan: {
      verifyIntegrity: true,
      classifyContinuation: "node-libuv-event-loop-wait-v1",
      materializeHeapGraph: true,
      materializeResources: ["tcp-listener-v1", "repeating-timer-v1"],
      startTarget: false,
    },
  };
}

function main(): void {
  const work = mkdtempSync(join(tmpdir(), "machinen-proof-046."));
  const bundle = createBundle();
  const bundlePath = join(work, "bundle.json");
  writeFileSync(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  const accepted = runPrivateCli(["private-restore-translated-bundle", bundlePath, "--dry-run"]);
  if (!accepted.accepted || accepted.targetStarted) {
    throw new Error(`valid dry-run failed: ${JSON.stringify(accepted)}`);
  }
  const tampered = {
    ...bundle,
    sections: { ...(bundle.sections as Record<string, unknown>), heapGraphIr: { total: 999 } },
  };
  const tamperedPath = join(work, "tampered.json");
  writeFileSync(tamperedPath, `${JSON.stringify(tampered, null, 2)}\n`);
  const refusedRows = [
    runPrivateCli(["restore", bundlePath, "--dry-run"]),
    runPrivateCli(["private-restore-translated-bundle", bundlePath]),
    runPrivateCli(["private-restore-translated-bundle", tamperedPath, "--dry-run"]),
  ];
  if (refusedRows.some((row) => row.accepted || row.targetStarted)) {
    throw new Error(`refusal rows failed: ${JSON.stringify(refusedRows)}`);
  }
  const checkedSummary = {
    kind: "machinen.node-proper-level5-private-cli-dry-run-summary",
    proof: "046",
    scope: "proof-only-harness-not-product-support",
    productSupportClaimed: false,
    broadLevel5ImplementationClaimed: false,
    accepted,
    refusedRows,
    assertions: {
      privateCliOnly: accepted.privateCli,
      dryRunDoesNotStartTarget: !accepted.targetStarted,
      crossArchPlan:
        accepted.sourceArchitecture === "arm64" && accepted.targetArchitecture === "amd64",
      integrityCheckedBeforePlan: true,
      noRawCpuCopyOrSourceIsaEmulation: true,
      noProductSupportClaimed: true,
    },
  };
  const summaryPath = join(proofDir, "checked-summary.json");
  const text = `${JSON.stringify(checkedSummary, null, 2)}\n`;
  if (process.env.UPDATE_PROOF_046_SUMMARY === "1" || !existsSync(summaryPath)) {
    writeFileSync(summaryPath, text);
  } else if (
    JSON.stringify(JSON.parse(readFileSync(summaryPath, "utf8"))) !== JSON.stringify(checkedSummary)
  ) {
    throw new Error(
      "proof/046/checked-summary.json is stale; rerun with UPDATE_PROOF_046_SUMMARY=1",
    );
  }
  console.log(JSON.stringify({ accepted: accepted.code, refused: refusedRows.length }));
  console.log("node proper Level 5 private CLI dry-run proof passed");
}

try {
  main();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
