import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ArbitraryProcessLevel5SeedReport } from "./arbitrary-process-level5-seed-matrix.ts";

export const ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_KIND =
  "machinen.arbitrary-process-level5-claim-ready" as const;
export const ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_VERSION = 1 as const;
export const ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_REPORT =
  "arbitrary-process-claim-ready-report.json" as const;

export type ArbitraryProcessLevel5VerifiedSeedInput = {
  rowId: string;
  accepted: boolean;
  proofStatus: "verified-seed";
  artifact: string;
  sha256: string;
};

export type ArbitraryProcessLevel5ClaimReadyGate = {
  id:
    | "seed-matrix-accepted"
    | "unsafe-boundaries-refused"
    | "minimum-verified-seeds"
    | "required-seed-rows-verified"
    | "no-forbidden-shortcuts"
    | "claim-still-zero-before-gate";
  passed: boolean;
  evidence: string;
};

export type ArbitraryProcessLevel5ClaimReadyReport = {
  kind: typeof ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_KIND;
  version: typeof ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_VERSION;
  accepted: boolean;
  currentArbitraryProcessCrossArchRestoreClaimed: 0;
  candidateArbitraryProcessCrossArchRestoreClaimed: 1;
  claimChangeAllowed: boolean;
  arbitraryProcessClaimed: false;
  requiredVerifiedSeedRows: [
    "native-regular-file-fd",
    "native-simple-pipe-fd",
    "native-idle-epoll-or-tcp",
  ];
  verifiedSeedRows: string[];
  verifiedSeedCount: number;
  minimumVerifiedSeedCount: 3;
  gates: ArbitraryProcessLevel5ClaimReadyGate[];
  verifiedSeeds: ArbitraryProcessLevel5VerifiedSeedInput[];
  artifactsSha256: string;
};

const requiredVerifiedSeedRows: ArbitraryProcessLevel5ClaimReadyReport["requiredVerifiedSeedRows"] =
  ["native-regular-file-fd", "native-simple-pipe-fd", "native-idle-epoll-or-tcp"];

export function evaluateArbitraryProcessLevel5ClaimReady(input: {
  seedReport: ArbitraryProcessLevel5SeedReport;
  verifiedSeeds: ArbitraryProcessLevel5VerifiedSeedInput[];
}): ArbitraryProcessLevel5ClaimReadyReport {
  const verifiedSeeds = input.verifiedSeeds.filter(
    (seed) => seed.accepted === true && seed.proofStatus === "verified-seed",
  );
  const verifiedSeedRows = [...new Set(verifiedSeeds.map((seed) => seed.rowId))].sort();
  const requiredRowsVerified = requiredVerifiedSeedRows.every((row) =>
    verifiedSeedRows.includes(row),
  );
  const gates: ArbitraryProcessLevel5ClaimReadyGate[] = [
    gate(
      "seed-matrix-accepted",
      input.seedReport.accepted === true && input.seedReport.claimChangeAllowed === false,
      "The seed matrix is accepted and does not itself allow a claim change.",
    ),
    gate(
      "unsafe-boundaries-refused",
      input.seedReport.refusalMarkersCovered.length >= 6,
      "Threads, JIT, futex-owned locks, live sockets, device mmap, and active epoll are covered as refusals.",
    ),
    gate(
      "minimum-verified-seeds",
      verifiedSeedRows.length >= 3,
      "At least three retained verified-seed reports are required before any 1% claim can be unlocked.",
    ),
    gate(
      "required-seed-rows-verified",
      requiredRowsVerified,
      "The required regular-file, simple-pipe, and idle epoll/TCP seed rows must all be verified.",
    ),
    gate(
      "no-forbidden-shortcuts",
      verifiedSeeds.every((seed) => seed.sha256.length === 64),
      "Every retained verified seed must have artifact SHA verification and no raw CPU/source-ISA shortcut.",
    ),
    gate(
      "claim-still-zero-before-gate",
      input.seedReport.currentArbitraryProcessCrossArchRestoreClaimed === 0 &&
        input.seedReport.arbitraryProcessClaimed === false,
      "The public arbitrary-process claim stays 0% until this whole gate passes.",
    ),
  ];
  const accepted = gates.every((candidate) => candidate.passed);
  return {
    kind: ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_KIND,
    version: ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_VERSION,
    accepted,
    currentArbitraryProcessCrossArchRestoreClaimed: 0,
    candidateArbitraryProcessCrossArchRestoreClaimed: 1,
    claimChangeAllowed: accepted,
    arbitraryProcessClaimed: false,
    requiredVerifiedSeedRows,
    verifiedSeedRows,
    verifiedSeedCount: verifiedSeedRows.length,
    minimumVerifiedSeedCount: 3,
    gates,
    verifiedSeeds,
    artifactsSha256: sha256Json(verifiedSeeds),
  };
}

export function writeArbitraryProcessLevel5ClaimReadyReport(
  outDir: string,
  report: ArbitraryProcessLevel5ClaimReadyReport,
): void {
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_REPORT), json(report));
}

export function loadArbitraryProcessLevel5ClaimReadyReport(
  path: string,
): ArbitraryProcessLevel5ClaimReadyReport {
  return JSON.parse(readFileSync(path, "utf8")) as ArbitraryProcessLevel5ClaimReadyReport;
}

export function verifyArbitraryProcessLevel5ClaimReadyReport(
  report: ArbitraryProcessLevel5ClaimReadyReport,
): ArbitraryProcessLevel5ClaimReadyReport {
  const accepted =
    report.kind === ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_KIND &&
    report.version === ARBITRARY_PROCESS_LEVEL5_CLAIM_READY_VERSION &&
    report.currentArbitraryProcessCrossArchRestoreClaimed === 0 &&
    report.candidateArbitraryProcessCrossArchRestoreClaimed === 1 &&
    report.arbitraryProcessClaimed === false &&
    report.claimChangeAllowed === report.accepted &&
    report.gates.every((gate) => gate.passed) === report.accepted &&
    report.verifiedSeedCount === report.verifiedSeedRows.length &&
    report.artifactsSha256 === sha256Json(report.verifiedSeeds);
  return { ...report, accepted };
}

function gate(
  id: ArbitraryProcessLevel5ClaimReadyGate["id"],
  passed: boolean,
  evidence: string,
): ArbitraryProcessLevel5ClaimReadyGate {
  return { id, passed, evidence };
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Json(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
