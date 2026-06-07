#!/usr/bin/env node
import { readFileSync } from "node:fs";

const allowedArchitectures = new Set(["arm64", "amd64"]);
const expected = {
  kind: "machinen.research.track-a.cpu-memory-final-jump-ir",
  safePoint: "captured_state_ready",
  entrySymbol: "continue_from_safepoint",
  regionId: "heap:captured-state",
  counterValue: 41,
  stateSizeBytes: 80,
  relocationOffset: 8,
  messageOffset: 16,
};

function fail(code, reason) {
  return {
    shape: "001-counter-cli",
    decision: "refused",
    supportStage: "1-refused",
    refusalCode: code,
    reason,
  };
}

function accepted(ir, facts) {
  return {
    shape: "001-counter-cli",
    decision: "accepted",
    supportStage: "4-supported-subset",
    supportScope:
      "single-threaded declared-safe-point counter fixture with source pc/sp/arg0, one declared heap state region, one in-region pointer relocation, target-native final jump, and no live kernel resources",
    sourceArch: ir.sourceArch,
    targetArch: ir.targetArch,
    facts,
  };
}

function isHex(value) {
  return typeof value === "string" && /^0x[0-9a-f]+$/iu.test(value);
}

function parseHex(value) {
  if (!isHex(value)) {
    return null;
  }
  return BigInt(value);
}

function guardFalse(ir, key) {
  return ir.claimGuard?.[key] === false;
}

function readCounter(bytesHex) {
  if (typeof bytesHex !== "string" || bytesHex.length < 8) {
    return null;
  }
  const bytes = bytesHex.slice(0, 8).match(/../gu);
  if (!bytes || bytes.length !== 4) {
    return null;
  }
  return bytes.reduce(
    (value, byte, index) => value + (Number.parseInt(byte, 16) << (index * 8)),
    0,
  );
}

function hasUnsupportedLiveState(ir) {
  return ir.activeSyscall === true || ir.hasThreads === true || ir.hasSocket === true;
}

export function classifyCounterCli(ir) {
  if (ir.kind !== expected.kind) {
    return fail(
      "counter-cli-wrong-ir-kind",
      "IR kind is not the retained CPU/memory/final-jump IR",
    );
  }
  if (!allowedArchitectures.has(ir.sourceArch) || !allowedArchitectures.has(ir.targetArch)) {
    return fail("counter-cli-unknown-architecture", "source or target architecture is unknown");
  }
  if (ir.sourceArch === ir.targetArch) {
    return fail(
      "counter-cli-not-cross-architecture",
      "source and target architectures must differ",
    );
  }
  if (ir.safePoint !== expected.safePoint) {
    return fail(
      "counter-cli-missing-safe-point",
      "safe point is not the declared counter safe point",
    );
  }
  if (
    ir.entrySymbol !== expected.entrySymbol ||
    ir.targetCpuPlan?.pcSymbol !== expected.entrySymbol
  ) {
    return fail(
      "counter-cli-unsupported-entry-symbol",
      "entry symbol is not the proven target-native counter continuation",
    );
  }

  const sourcePc = parseHex(ir.sourceCpu?.pc);
  const sourceSp = parseHex(ir.sourceCpu?.sp);
  const sourceArg0 = parseHex(ir.sourceCpu?.arg0);
  const sourceBase = parseHex(ir.memory?.sourceBase);
  const sourcePointer = parseHex(ir.memory?.sourcePointer);
  if (!sourcePc || !sourceSp || !sourceArg0 || !sourceBase || !sourcePointer) {
    return fail(
      "counter-cli-missing-cpu-or-memory-address",
      "CPU registers and memory addresses must be captured as nonzero hex values",
    );
  }
  if (sourceArg0 !== sourceBase) {
    return fail(
      "counter-cli-arg0-not-state-base",
      "source argument register must point at the declared state region",
    );
  }

  const targetRegister = ir.targetArch === "amd64" ? "rdi" : "x0";
  if (ir.targetCpuPlan?.argumentRegister !== targetRegister) {
    return fail(
      "counter-cli-wrong-target-argument-register",
      "target argument register does not match the target architecture ABI",
    );
  }
  if (ir.targetCpuPlan?.stackBytes !== 65536) {
    return fail(
      "counter-cli-wrong-target-stack-plan",
      "target stack plan does not match the retained proof",
    );
  }

  if (
    ir.memory?.regionId !== expected.regionId ||
    ir.memory?.sizeBytes !== expected.stateSizeBytes
  ) {
    return fail(
      "counter-cli-wrong-memory-region",
      "memory region does not match the proven counter state layout",
    );
  }
  if (
    ir.memory?.relocationOffset !== expected.relocationOffset ||
    ir.memory?.targetOffset !== expected.messageOffset
  ) {
    return fail(
      "counter-cli-wrong-pointer-relocation",
      "pointer relocation table does not match the proven layout",
    );
  }
  if (sourcePointer !== sourceBase + BigInt(expected.messageOffset)) {
    return fail(
      "counter-cli-pointer-outside-proven-layout",
      "source pointer does not point to the declared in-region message field",
    );
  }
  if (readCounter(ir.memory?.bytesHex) !== expected.counterValue) {
    return fail(
      "counter-cli-wrong-counter-value",
      "captured scalar counter does not match the proven safe-point value",
    );
  }
  if (ir.memory.bytesHex.length !== expected.stateSizeBytes * 2) {
    return fail(
      "counter-cli-wrong-memory-byte-length",
      "captured memory byte length does not match the declared state size",
    );
  }

  for (const key of [
    "arbitraryProcessRestoreClaimed",
    "rawVmReplayUsed",
    "sourceIsaEmulationUsed",
    "metadataOnlySuccess",
  ]) {
    if (!guardFalse(ir, key)) {
      return fail("counter-cli-claim-guard-not-false", `claim guard ${key} must be false`);
    }
  }
  if (hasUnsupportedLiveState(ir)) {
    return fail(
      "counter-cli-unsupported-live-state",
      "active syscall, thread, or socket state is outside this supported subset",
    );
  }

  return accepted(ir, {
    sourcePc: ir.sourceCpu.pc,
    sourceSp: ir.sourceCpu.sp,
    sourceArg0: ir.sourceCpu.arg0,
    stateRegion: ir.memory.regionId,
    stateBytes: ir.memory.sizeBytes,
    relocatedPointerOffset: expected.messageOffset,
    targetArgumentRegister: targetRegister,
  });
}

function main() {
  const irPath = process.argv[2];
  if (!irPath) {
    console.error("usage: node counter-cli-detector.mjs <continuation-ir.json>");
    process.exit(2);
  }
  const ir = JSON.parse(readFileSync(irPath, "utf8"));
  const result = classifyCounterCli(ir);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.decision === "accepted" ? 0 : 10);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
