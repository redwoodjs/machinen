#!/usr/bin/env node
import { readFileSync } from "node:fs";

const expected = {
  kind: "machinen.research.track-a.cpu-memory-final-jump-ir",
  safePoint: "captured_state_ready",
  entrySymbol: "continue_from_safepoint",
};
const allowedArchitectures = new Set(["arm64", "amd64"]);

function fail(code, reason) {
  return {
    shape: "010-libc-boundary-fixture",
    decision: "refused",
    supportStage: "1-refused",
    refusalCode: code,
    reason,
  };
}

function isHex(value) {
  return typeof value === "string" && /^0x[0-9a-f]+$/iu.test(value);
}

function guardFalse(ir, key) {
  return ir.claimGuard?.[key] === false;
}

export function classifyLibcBoundary(ir) {
  if (ir.kind !== expected.kind) {
    return fail(
      "libc-boundary-wrong-ir-kind",
      "IR kind is not the retained CPU/memory/final-jump IR",
    );
  }
  if (!allowedArchitectures.has(ir.sourceArch) || !allowedArchitectures.has(ir.targetArch)) {
    return fail("libc-boundary-unknown-architecture", "source or target architecture is unknown");
  }
  if (ir.sourceArch === ir.targetArch) {
    return fail(
      "libc-boundary-not-cross-architecture",
      "source and target architectures must differ",
    );
  }
  if (ir.safePoint !== expected.safePoint) {
    return fail(
      "libc-boundary-missing-safe-point",
      "safe point is not the declared libc boundary safe point",
    );
  }
  if (
    ir.entrySymbol !== expected.entrySymbol ||
    ir.targetCpuPlan?.pcSymbol !== expected.entrySymbol
  ) {
    return fail(
      "libc-boundary-unsupported-entry-symbol",
      "entry symbol is not the proven target-native continuation",
    );
  }
  if (!isHex(ir.sourceCpu?.pc) || !isHex(ir.sourceCpu?.sp) || !isHex(ir.sourceCpu?.arg0)) {
    return fail("libc-boundary-missing-source-cpu", "source pc, sp, and arg0 must be captured");
  }
  if (ir.targetCpuPlan?.argumentRegister !== (ir.targetArch === "amd64" ? "rdi" : "x0")) {
    return fail(
      "libc-boundary-wrong-target-argument-register",
      "target argument register does not match target ABI",
    );
  }
  if (ir.targetCpuPlan?.stackBytes !== 65536) {
    return fail(
      "libc-boundary-wrong-target-stack-plan",
      "target stack plan does not match retained proof",
    );
  }
  for (const key of [
    "arbitraryProcessRestoreClaimed",
    "rawVmReplayUsed",
    "sourceIsaEmulationUsed",
    "metadataOnlySuccess",
  ]) {
    if (!guardFalse(ir, key)) {
      return fail("libc-boundary-claim-guard-not-false", `claim guard ${key} must be false`);
    }
  }
  if (ir.activeSyscall === true || ir.hasThreads === true || ir.hasSocket === true) {
    return fail(
      "libc-boundary-unsupported-live-state",
      "active syscall, thread, or socket state is outside this supported subset",
    );
  }
  return {
    shape: "010-libc-boundary-fixture",
    decision: "accepted",
    supportStage: "4-supported-subset",
    supportScope:
      "declared-safe-point fixture that reconstructs target CPU/heap/stack state and calls target-native continuation code that crosses only into target-native libc after restore",
    sourceArch: ir.sourceArch,
    targetArch: ir.targetArch,
    facts: {
      sourcePc: ir.sourceCpu.pc,
      sourceSp: ir.sourceCpu.sp,
      sourceArg0: ir.sourceCpu.arg0,
      targetArgumentRegister: ir.targetCpuPlan.argumentRegister,
      targetStackBytes: ir.targetCpuPlan.stackBytes,
    },
  };
}

function main() {
  const irPath = process.argv[2];
  if (!irPath) {
    console.error("usage: node libc-boundary-detector.mjs <continuation-ir.json>");
    process.exit(2);
  }
  const result = classifyLibcBoundary(JSON.parse(readFileSync(irPath, "utf8")));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.decision === "accepted" ? 0 : 10);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
