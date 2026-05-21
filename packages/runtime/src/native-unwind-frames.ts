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

export interface NativeEhFrameTextParseRequest {
  readelfFrames: string;
  mapping: string;
  functionName: string;
  pc: string;
}

export interface NativeEhFrameTextParseResult {
  rules: NativeUnwindFrameRule[];
  refusals: NativeProcessImageRefusal[];
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
      "unwind-fde-missing",
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

export function parseNativeEhFrameText(
  request: NativeEhFrameTextParseRequest,
): NativeEhFrameTextParseResult {
  if (!request.readelfFrames.trim()) {
    return {
      rules: [],
      refusals: [unwindRefusal("unwind-metadata-missing", "readelf did not emit .eh_frame data")],
    };
  }
  const pc = BigInt(request.pc);
  const block = ehFrameBlocks(request.readelfFrames).find(
    (candidate) => pc >= candidate.start && pc < candidate.end,
  );
  if (!block) {
    return {
      rules: [],
      refusals: [unwindRefusal("unwind-fde-missing", `no .eh_frame FDE covers pc ${request.pc}`)],
    };
  }
  const rule = ehFrameRuleFromBlock(request, block);
  if ("refusal" in rule) {
    return { rules: [], refusals: [rule.refusal] };
  }
  return { rules: [rule.rule], refusals: [] };
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

function ehFrameBlocks(stdout: string) {
  const blocks: Array<{ start: bigint; end: bigint; lines: string[] }> = [];
  let current: { start: bigint; end: bigint; lines: string[] } | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const match = /FDE .* pc=([0-9a-fA-F]+)\.\.([0-9a-fA-F]+)/.exec(line);
    if (match?.[1] && match[2]) {
      current = { start: BigInt(`0x${match[1]}`), end: BigInt(`0x${match[2]}`), lines: [] };
      blocks.push(current);
      continue;
    }
    current?.lines.push(line);
  }
  return blocks;
}

function ehFrameRuleFromBlock(
  request: NativeEhFrameTextParseRequest,
  block: { start: bigint; end: bigint; lines: string[] },
): { rule: NativeUnwindFrameRule } | { refusal: NativeProcessImageRefusal } {
  const cfaOffset = cfaOffsetFromX29(block.lines);
  const returnAddressOffset = lastCapture(
    block.lines,
    /DW_CFA_offset: r30(?: \([^)]*\))? at cfa([+-]\d+)/,
  );
  if (!cfaOffset || !returnAddressOffset) {
    return {
      refusal: unwindRefusal(
        "unwind-rule-unsupported",
        `.eh_frame FDE for ${request.functionName} does not use modeled x29 CFA and cfa-relative x30 rules`,
      ),
    };
  }
  return {
    rule: {
      id: `eh-frame:${request.functionName}:${hex(block.start)}`,
      functionName: request.functionName,
      mapping: request.mapping,
      pcStart: hex(block.start),
      pcEnd: hex(block.end),
      metadata: "eh-frame",
      cfa: { register: "x29", offset: Number.parseInt(cfaOffset, 10) },
      returnAddress: { location: "cfa-relative", offset: Number.parseInt(returnAddressOffset, 10) },
    },
  };
}

function cfaOffsetFromX29(lines: string[]) {
  const combined = lastCapture(lines, /DW_CFA_def_cfa: r29(?: \([^)]*\))? ofs:? (\d+)/);
  if (combined) {
    return combined;
  }
  let offset: string | undefined;
  let registerIsX29 = false;
  for (const line of lines) {
    const offsetMatch = /DW_CFA_def_cfa_offset: (\d+)/.exec(line);
    if (offsetMatch?.[1]) {
      offset = offsetMatch[1];
    }
    if (/DW_CFA_def_cfa_register: r29(?: \([^)]*\))?/.test(line)) {
      registerIsX29 = true;
    }
  }
  return registerIsX29 ? offset : undefined;
}

function lastCapture(lines: string[], pattern: RegExp) {
  let captured: string | undefined;
  for (const line of lines) {
    const match = pattern.exec(line);
    if (match?.[1]) {
      captured = match[1];
    }
  }
  return captured;
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
        code: "return-slot-unreadable",
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
  return { frames: [], refusals: [unwindRefusal(code, message)] };
}

function unwindRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
