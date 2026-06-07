#!/usr/bin/env tsx
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  buildProductClaimRegistry,
  createProductLevel4PingSocketSnapshot,
  restoreProductLevel4PingSocketSnapshot,
} from "../../../packages/runtime/src/index.ts";
import profiles from "../../../scripts/portable-machine-proof-profiles.json" with { type: "json" };

type Summary = {
  kind: "machinen.level4-ping-socket-product";
  goal: "010";
  generatedAt: string;
  profile: {
    name: string;
    evidenceStatus: "support";
    productSupport: "deprecated";
    implementationLevel: "deprecated-level-4-kernel-resource-reconstruction";
    graduationTargetLevel: "level-5-cross-arch-process-continuation";
    migrationCompleted: false;
    publicSurfaces: string[];
  };
  productRegistry: {
    productStatus: string;
    supportLevel: string;
    migrationCompleted: boolean;
    proofOnly: boolean;
    descriptorRequired: boolean;
    targetNativeVerifierRequired: boolean;
  };
  captureRestoreProof: {
    captureState: string;
    restoreState: string;
    targetVerifierResult: string;
    shortcutInspection: Record<string, false>;
  };
  stableRefusals: Array<{
    name: string;
    evidenceStatus: "refusal";
    productSupport: "unsupported";
    migrationCompleted: false;
    expectedRefusalCode: string;
  }>;
};

const OUT = resolve("docs/snapshot/checked-summaries/level4-graduation/goal-010.json");
const verifier = "ping-dgram-icmp id=7 seq=1 loopback target-loopback";
const workDir = mkdtempSync(join(tmpdir(), "machinen-goal-010-"));
const capture = createProductLevel4PingSocketSnapshot({
  outDir: workDir,
  sourceArch: "arm64",
  targetArch: "amd64",
  socketKind: "ping-dgram-icmp",
  sourceVerifierOutput: verifier,
  echoIdentifier: 7,
  echoSequence: 1,
  route: "loopback",
  namespace: "target-loopback",
});
if (capture.state !== "completed") {
  throw new Error(`expected supported capture, got ${capture.state}`);
}
const restore = restoreProductLevel4PingSocketSnapshot({
  bundleDir: capture.bundleDir,
  targetArch: "amd64",
  targetVerifierOutput: verifier,
  dryRun: true,
});
if (!restore.migrationCompleted) {
  throw new Error(`expected supported restore, got ${restore.refusal?.expectedRefusalCode}`);
}
const registry = buildProductClaimRegistry(profiles);
const entry = registry.entries.find((item) => item.name === "ping-level4-socket-reconstruction-v1");
if (!entry) {
  throw new Error("missing ping-level4-socket-reconstruction-v1 registry entry");
}
if (entry.productStatus !== "deprecated-legacy-support") {
  throw new Error(`ping Level 4 registry entry is not deprecated: ${entry.productStatus}`);
}
if (entry.supportLevel !== "deprecated-cross-isa-level") {
  throw new Error(`deprecated ping Level 4 registry entry has wrong level: ${entry.supportLevel}`);
}
const refusalNames = [
  "ping-socket-known-unread-reply-v3-multiple-replies-refusal",
  "raw-icmp-known-unread-reply-v1-multiple-replies-refusal",
  "real-distro-ping-socket-loopback-recreate",
];
const stableRefusals = refusalNames.map((name) => {
  const item = registry.entries.find((candidate) => candidate.name === name);
  if (!item) {
    throw new Error(`missing registry refusal/proof neighbor: ${name}`);
  }
  if (item.productStatus === "implemented-product-support") {
    throw new Error(`unsafe neighbor was incorrectly productized: ${name}`);
  }
  return {
    name,
    evidenceStatus: "refusal" as const,
    productSupport: "unsupported" as const,
    migrationCompleted: false as const,
    expectedRefusalCode: item.productRefusalCode ?? "product-surface-not-implemented",
  };
});
const summary: Summary = {
  kind: "machinen.level4-ping-socket-product",
  goal: "010",
  generatedAt: new Date().toISOString(),
  profile: {
    name: "ping-level4-socket-reconstruction-v1",
    evidenceStatus: "support",
    productSupport: "deprecated",
    implementationLevel: "deprecated-level-4-kernel-resource-reconstruction",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: false,
    publicSurfaces: [
      "machinen capture ping-socket",
      "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
      "machinen support --profile ping-level4-socket-reconstruction-v1 --json",
    ],
  },
  productRegistry: {
    productStatus: entry.productStatus,
    supportLevel: entry.supportLevel,
    migrationCompleted: entry.migrationCompleted,
    proofOnly: entry.proofOnly,
    descriptorRequired: entry.descriptorRequired,
    targetNativeVerifierRequired: entry.targetNativeVerifierRequired,
  },
  captureRestoreProof: {
    captureState: capture.state,
    restoreState: restore.state,
    targetVerifierResult: restore.targetVerifierResult,
    shortcutInspection: restore.shortcutInspection,
  },
  stableRefusals,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
rmSync(workDir, { recursive: true, force: true });
console.log(`wrote ${OUT}`);
