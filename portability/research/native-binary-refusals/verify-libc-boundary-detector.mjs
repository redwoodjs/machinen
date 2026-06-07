#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyLibcBoundary } from "./detectors/libc-boundary-detector.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const retainedDir = join(root, "retained");
const proofRoot = join(root, "..", "cross-arch-native-cpu-memory-final-jump", "retained");
const acceptanceInputs = [
  ["arm64-to-amd64", join(proofRoot, "arm64-to-amd64.ir.json")],
  ["amd64-to-arm64", join(proofRoot, "amd64-to-arm64.ir.json")],
];

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function refusalFixtures(base) {
  return [
    ["missing-safe-point", (ir) => void (ir.safePoint = "not_declared")],
    ["bad-entry-symbol", (ir) => void (ir.entrySymbol = "unknown_continuation")],
    ["same-architecture", (ir) => void (ir.targetArch = ir.sourceArch)],
    ["source-isa-emulation", (ir) => void (ir.claimGuard.sourceIsaEmulationUsed = true)],
    ["metadata-only", (ir) => void (ir.claimGuard.metadataOnlySuccess = true)],
    ["active-syscall", (ir) => void (ir.activeSyscall = true)],
    ["thread-state", (ir) => void (ir.hasThreads = true)],
    ["socket-state", (ir) => void (ir.hasSocket = true)],
  ].map(([name, mutate]) => {
    const ir = clone(base);
    mutate(ir);
    return [name, ir];
  });
}

function assertAccepted(label, ir) {
  const result = classifyLibcBoundary(ir);
  if (result.decision !== "accepted") {
    throw new Error(`${label} should be accepted, got ${result.refusalCode}: ${result.reason}`);
  }
  return result;
}

function assertRefused(label, ir) {
  const result = classifyLibcBoundary(ir);
  if (result.decision !== "refused") {
    throw new Error(`${label} should be refused`);
  }
  return result;
}

mkdirSync(retainedDir, { recursive: true });
const accepted = acceptanceInputs.map(([label, path]) => {
  const result = assertAccepted(label, readJson(path));
  writeJson(join(retainedDir, `libc-boundary-detector-accepted-${label}.json`), result);
  return { label, result };
});
const base = readJson(acceptanceInputs[0][1]);
const refused = refusalFixtures(base).map(([label, ir]) => {
  const result = assertRefused(label, ir);
  writeJson(join(retainedDir, `libc-boundary-detector-refused-${label}.json`), result);
  return { label, result };
});
const report = {
  kind: "machinen.research.native-binary-refusal.libc-boundary-detector-report",
  version: 1,
  row: "010-libc-boundary-fixture",
  lifecycleStage: "4-supported-subset",
  supportDecision: "supported-subset",
  supportScope:
    "declared-safe-point fixture that reconstructs target CPU/heap/stack state and calls target-native continuation code that crosses only into target-native libc after restore",
  accepted: accepted.map((entry) => ({
    label: entry.label,
    decision: entry.result.decision,
    supportStage: entry.result.supportStage,
  })),
  refused: refused.map((entry) => ({
    label: entry.label,
    decision: entry.result.decision,
    refusalCode: entry.result.refusalCode,
  })),
  claimGuard: {
    arbitraryProcessRestoreClaimed: false,
    rawVmReplayUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlySuccess: false,
  },
  status: "passed",
};
writeJson(join(retainedDir, "libc-boundary-detector-report.json"), report);
console.log(JSON.stringify(report, null, 2));
