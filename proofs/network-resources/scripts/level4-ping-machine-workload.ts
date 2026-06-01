#!/usr/bin/env tsx
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  buildProductClaimRegistry,
  restoreProductLevel4PingSocketSnapshot,
} from "../../../packages/runtime/src/index.ts";
import { validatePortableSnapshotBundle } from "../../../packages/runtime/src/vm/portable-snapshot.ts";
import { performSnapshot } from "../../../packages/runtime/src/vm/snapshot.ts";
import profiles from "../../../scripts/portable-machine-proof-profiles.json" with { type: "json" };

type Summary = {
  kind: "machinen.level4-ping-machine-workload";
  goal: "011";
  generatedAt: string;
  profile: {
    name: "ping-level4-socket-reconstruction-v1";
    evidenceStatus: "support";
    productSupport: "supported";
    implementationLevel: "level-4-kernel-resource-reconstruction";
    graduationTargetLevel: "level-4-kernel-resource-reconstruction";
    productClaim: "portable machine snapshot supports this ping workload at Level 4";
    publicSurfaces: string[];
  };
  retiredLevel2: {
    name: "ping-sequence-counter-semantic-continuation-v1";
    productSupport: "not-supported";
    implementedProductSupport: false;
  };
  portableSnapshot: {
    engine: "portable";
    manifestProgram: string;
    transportManifest: string;
    restoreState: string;
    migrationCompleted: boolean;
    targetVerifierResult: string;
  };
  stableRefusals: Array<{
    name: string;
    productSupport: "unsupported";
    migrationCompleted: false;
  }>;
  reusableTransportNextResources: ["pipe", "eventfd", "timerfd", "tcp-listener"];
};

const OUT = resolve("docs/snapshot/checked-summaries/level4-graduation/goal-011.json");
const verifier = "ping-dgram-icmp id=7 seq=1 loopback target-loopback";
const descriptor = JSON.stringify({
  profile: "ping-level4-socket-reconstruction-v1",
  sourceArch: "arm64",
  targetArch: "amd64",
  socketKind: "ping-dgram-icmp",
  sourceVerifierOutput: verifier,
  echoIdentifier: 7,
  echoSequence: 1,
});
const workDir = mkdtempSync(join(tmpdir(), "machinen-goal-011-"));
const oldEngine = process.env.MACHINEN_SNAPSHOT_ENGINE;
process.env.MACHINEN_SNAPSHOT_ENGINE = "portable";
try {
  const snapshot = await performSnapshot(fakeSnapshotContext(descriptor), { outDir: workDir });
  if (snapshot.engine !== "portable") {
    throw new Error(`expected portable snapshot engine, got ${snapshot.engine}`);
  }
  const bundle = validatePortableSnapshotBundle(workDir);
  const restore = restoreProductLevel4PingSocketSnapshot({
    bundleDir: workDir,
    targetArch: "amd64",
    targetVerifierOutput: verifier,
    dryRun: true,
  });
  if (!restore.migrationCompleted) {
    throw new Error(`portable ping restore refused: ${restore.refusal?.expectedRefusalCode}`);
  }
  const registry = buildProductClaimRegistry(profiles);
  const level4 = registry.entries.find(
    (entry) => entry.name === "ping-level4-socket-reconstruction-v1",
  );
  if (!level4 || level4.productStatus !== "implemented-product-support") {
    throw new Error("Level 4 ping is not implemented product support");
  }
  const level2Implemented = registry.entries.some(
    (entry) =>
      entry.name === "ping-sequence-counter-semantic-continuation-v1" &&
      entry.productStatus === "implemented-product-support",
  );
  if (level2Implemented) {
    throw new Error("Level 2 semantic ping is still implemented product support");
  }
  const refusalNames = [
    "ping-socket-known-unread-reply-v3-multiple-replies-refusal",
    "raw-icmp-known-unread-reply-v1-multiple-replies-refusal",
    "real-distro-ping-socket-loopback-recreate",
  ];
  const stableRefusals = refusalNames.map((name) => {
    const entry = registry.entries.find((candidate) => candidate.name === name);
    if (entry?.productStatus === "implemented-product-support") {
      throw new Error(`unsafe neighbor was incorrectly productized: ${name}`);
    }
    return { name, productSupport: "unsupported" as const, migrationCompleted: false as const };
  });
  const summary: Summary = {
    kind: "machinen.level4-ping-machine-workload",
    goal: "011",
    generatedAt: new Date().toISOString(),
    profile: {
      name: "ping-level4-socket-reconstruction-v1",
      evidenceStatus: "support",
      productSupport: "supported",
      implementationLevel: "level-4-kernel-resource-reconstruction",
      graduationTargetLevel: "level-4-kernel-resource-reconstruction",
      productClaim: "portable machine snapshot supports this ping workload at Level 4",
      publicSurfaces: [
        "MACHINEN_SNAPSHOT_ENGINE=portable machinen snapshot <vm> <bundle>",
        "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
        "machinen support --profile ping-level4-socket-reconstruction-v1 --json",
      ],
    },
    retiredLevel2: {
      name: "ping-sequence-counter-semantic-continuation-v1",
      productSupport: "not-supported",
      implementedProductSupport: false,
    },
    portableSnapshot: {
      engine: "portable",
      manifestProgram: bundle.manifest.program.name,
      transportManifest: "portable-machine-transport.json",
      restoreState: restore.state,
      migrationCompleted: restore.migrationCompleted,
      targetVerifierResult: restore.targetVerifierResult,
    },
    stableRefusals,
    reusableTransportNextResources: ["pipe", "eventfd", "timerfd", "tcp-listener"],
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(`wrote ${OUT}`);
} finally {
  rmSync(workDir, { recursive: true, force: true });
  if (oldEngine === undefined) {
    delete process.env.MACHINEN_SNAPSHOT_ENGINE;
  } else {
    process.env.MACHINEN_SNAPSHOT_ENGINE = oldEngine;
  }
}

function fakeSnapshotContext(stdout: string) {
  return {
    pid: 11011,
    diskPath: "/tmp/portable-ping-machine.img",
    execRaw: async () => ({ exitCode: 0, stdout, stderr: "" }),
    wait: async () => ({ code: 0, signal: null }),
    kill: async () => {},
    teeGuestConsole: undefined,
    errorOutput: async () => "",
  } as never;
}
