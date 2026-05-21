/** DWARF/eh-frame based native stack-frame discovery. */

import type {
  NativeArm64Registers,
  NativeProcessImageRefusal,
  NativeRegisterState,
} from "./native-process-image.ts";
import type { NativeStackFrame } from "./native-stack-translation.ts";

export type NativeUnwindMetadataKind = "dwarf" | "eh-frame";
export type NativeUnwindRegister = "sp" | "x29" | "x30";

export interface NativeUnwindFrameRule {
  id: string;
  functionName: string;
  mapping: string;
  pcStart: string;
  pcEnd: string;
  metadata: NativeUnwindMetadataKind;
  cfa: {
    register: Extract<NativeUnwindRegister, "sp" | "x29">;
    offset: number;
  };
  returnAddress:
    | { location: "register"; register: Extract<NativeUnwindRegister, "x30"> }
    | { location: "cfa-relative"; offset: number };
}

export interface NativeUnwindStackWord {
  address: string;
  value: string;
}

export interface NativeUnwindFrameDiscoveryRequest {
  threadId: string;
  stackMapping: string;
  sourceRegisters: NativeRegisterState;
  rules: NativeUnwindFrameRule[];
  stackWords: NativeUnwindStackWord[];
}

export interface NativeDiscoveredUnwindFrame {
  id: string;
  functionName: string;
  sourcePc: string;
  sourceSp: string;
  cfa: string;
  returnAddress: string;
  returnAddressSlot?: string;
  metadata: NativeUnwindMetadataKind;
  stackFrame: NativeStackFrame;
}

export interface NativeUnwindFrameDiscoveryResult {
  frames: NativeDiscoveredUnwindFrame[];
  refusals: NativeProcessImageRefusal[];
}

export function discoverNativeUnwindFrames(
  request: NativeUnwindFrameDiscoveryRequest,
): NativeUnwindFrameDiscoveryResult {
  if (request.sourceRegisters.arch !== "arm64") {
    return refused("architecture-unsupported", "unwind discovery currently supports arm64 input");
  }
  const rule = ruleForPc(request.rules, BigInt(request.sourceRegisters.pc));
  if (!rule) {
    return refused(
      "thread-state-unsupported",
      `thread ${request.threadId} has no unwind rule for pc ${request.sourceRegisters.pc}`,
    );
  }
  const resolved = resolveUnwindRule(rule, request.sourceRegisters, request.stackWords);
  if ("refusal" in resolved) {
    return { frames: [], refusals: [resolved.refusal] };
  }
  return {
    frames: [discoveredFrame(request, rule, resolved)],
    refusals: [],
  };
}

export function nativeUnwindReturnAddressSlot(options: {
  rule: NativeUnwindFrameRule;
  sourceRegisters: NativeArm64Registers;
}): string | undefined {
  if (options.rule.returnAddress.location !== "cfa-relative") {
    return undefined;
  }
  const cfa =
    registerValue(options.sourceRegisters, options.rule.cfa.register) +
    BigInt(options.rule.cfa.offset);
  return hex(cfa + BigInt(options.rule.returnAddress.offset));
}

function ruleForPc(rules: NativeUnwindFrameRule[], pc: bigint): NativeUnwindFrameRule | undefined {
  return rules.find((rule) => pc >= BigInt(rule.pcStart) && pc < BigInt(rule.pcEnd));
}

function resolveUnwindRule(
  rule: NativeUnwindFrameRule,
  registers: NativeArm64Registers,
  stackWords: NativeUnwindStackWord[],
):
  | { cfa: bigint; returnAddress: bigint; returnAddressSlot?: bigint }
  | { refusal: NativeProcessImageRefusal } {
  const cfa = registerValue(registers, rule.cfa.register) + BigInt(rule.cfa.offset);
  if (rule.returnAddress.location === "register") {
    return { cfa, returnAddress: registerValue(registers, rule.returnAddress.register) };
  }
  const returnAddressSlot = cfa + BigInt(rule.returnAddress.offset);
  const stackWord = stackWords.find((word) => BigInt(word.address) === returnAddressSlot);
  if (!stackWord) {
    return {
      refusal: {
        code: "pointer-ambiguous",
        message: `unwind rule ${rule.id} return-address slot ${hex(returnAddressSlot)} was not captured`,
      },
    };
  }
  return { cfa, returnAddress: BigInt(stackWord.value), returnAddressSlot };
}

function discoveredFrame(
  request: NativeUnwindFrameDiscoveryRequest,
  rule: NativeUnwindFrameRule,
  resolved: { cfa: bigint; returnAddress: bigint; returnAddressSlot?: bigint },
): NativeDiscoveredUnwindFrame {
  const registers = request.sourceRegisters as NativeArm64Registers;
  const frameSize = Number(resolved.cfa - BigInt(registers.sp));
  const sizeBytes = Number.isSafeInteger(frameSize) && frameSize > 0 ? frameSize : 16;
  const sourcePc = registers.pc;
  const sourceSp = registers.sp;
  const returnAddress = hex(resolved.returnAddress);
  return {
    id: `frame:${request.threadId}:${rule.functionName}`,
    functionName: rule.functionName,
    sourcePc,
    sourceSp,
    cfa: hex(resolved.cfa),
    returnAddress,
    returnAddressSlot: resolved.returnAddressSlot ? hex(resolved.returnAddressSlot) : undefined,
    metadata: rule.metadata,
    stackFrame: {
      id: `frame:${request.threadId}:${rule.functionName}`,
      sourceSp,
      sourceReturnAddress: returnAddress,
      sizeBytes,
      metadata: "dwarf",
      locals: [],
    },
  };
}

function registerValue(registers: NativeArm64Registers, register: NativeUnwindRegister): bigint {
  if (register === "sp") {
    return BigInt(registers.sp);
  }
  if (register === "x29") {
    return BigInt(registers.x[29] ?? "0x0");
  }
  return BigInt(registers.x[30] ?? "0x0");
}

function refused(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeUnwindFrameDiscoveryResult {
  return { frames: [], refusals: [{ code, message }] };
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
