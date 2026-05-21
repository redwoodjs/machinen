/** Target-native unwind matching for real utility continuation planning. */

import { nativeEhFrameTextBlocks, nativeLastCapture } from "./native-eh-frame-text.ts";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type {
  NativeDiscoveredUnwindFrame,
  NativeUnwindMetadataKind,
} from "./native-unwind-frames.ts";

export type NativeTargetUnwindRegister =
  | "rsp"
  | "rbp"
  | "rip"
  | "rbx"
  | "r12"
  | "r13"
  | "r14"
  | "r15";

export interface NativeTargetUnwindFrameRule {
  id: string;
  functionName: string;
  mapping: string;
  pcStart: string;
  pcEnd: string;
  metadata: NativeUnwindMetadataKind;
  cfa: { register: Extract<NativeTargetUnwindRegister, "rsp" | "rbp">; offset: number };
  returnAddress: { location: "cfa-relative"; offset: number };
  calleeSaved?: Array<{
    register: Exclude<NativeTargetUnwindRegister, "rsp" | "rip">;
    location: "same-value" | "cfa-relative";
    offset?: number;
  }>;
}

export interface NativeTargetEhFrameTextParseRequest {
  readelfFrames: string;
  mapping: string;
  functionName: string;
  targetAddress: string;
}

export interface NativeTargetEhFrameTextParseResult {
  rules: NativeTargetUnwindFrameRule[];
  refusals: NativeProcessImageRefusal[];
}

export interface NativeTargetUnwindMatchRequest {
  sourceFrame: NativeDiscoveredUnwindFrame;
  targetAddress: string;
  targetRules: NativeTargetUnwindFrameRule[];
}

export interface NativeTargetUnwindFrameMatch {
  sourceFrameId: string;
  targetRule: NativeTargetUnwindFrameRule;
  targetAddress: string;
  targetReturnAddressSlotOffset: number;
  preservesReturnContract: true;
}

export interface NativeTargetUnwindMatchResult {
  matches: NativeTargetUnwindFrameMatch[];
  refusals: NativeProcessImageRefusal[];
}

export function parseNativeTargetEhFrameText(
  request: NativeTargetEhFrameTextParseRequest,
): NativeTargetEhFrameTextParseResult {
  if (!request.readelfFrames.trim()) {
    return refusedParse("unwind-metadata-missing", "target readelf did not emit .eh_frame data");
  }
  const targetAddress = BigInt(request.targetAddress);
  const block = nativeEhFrameTextBlocks(request.readelfFrames).find(
    (candidate) => targetAddress >= candidate.start && targetAddress < candidate.end,
  );
  if (!block) {
    return refusedParse(
      "target-unwind-mismatch",
      `no target .eh_frame FDE covers ${request.targetAddress}`,
    );
  }
  const rule = targetRuleFromBlock(request, block);
  if ("refusal" in rule) {
    return { rules: [], refusals: [rule.refusal] };
  }
  return { rules: [rule.rule], refusals: [] };
}

export function matchNativeTargetUnwindFrame(
  request: NativeTargetUnwindMatchRequest,
): NativeTargetUnwindMatchResult {
  const targetAddress = BigInt(request.targetAddress);
  const rule = request.targetRules.find(
    (candidate) =>
      targetAddress >= BigInt(candidate.pcStart) && targetAddress < BigInt(candidate.pcEnd),
  );
  if (!rule) {
    return refusedMatch(
      "target-unwind-mismatch",
      `no target unwind rule covers ${request.targetAddress}`,
    );
  }
  const refusal = validateTargetRule(request.sourceFrame, rule);
  if (refusal) {
    return { matches: [], refusals: [refusal] };
  }
  return {
    matches: [
      {
        sourceFrameId: request.sourceFrame.id,
        targetRule: rule,
        targetAddress: request.targetAddress,
        targetReturnAddressSlotOffset: rule.returnAddress.offset,
        preservesReturnContract: true,
      },
    ],
    refusals: [],
  };
}

function validateTargetRule(
  sourceFrame: NativeDiscoveredUnwindFrame,
  rule: NativeTargetUnwindFrameRule,
): NativeProcessImageRefusal | undefined {
  if (!sourceFrame.returnAddressSlot) {
    return refusal(
      "return-slot-unreadable",
      `source frame ${sourceFrame.id} has no captured return-address slot`,
    );
  }
  if (rule.cfa.register !== "rsp" && rule.cfa.register !== "rbp") {
    return refusal(
      "target-frame-layout-unsupported",
      `target rule ${rule.id} uses unsupported CFA register ${rule.cfa.register}`,
    );
  }
  if (rule.returnAddress.location !== "cfa-relative" || rule.returnAddress.offset >= 0) {
    return refusal(
      "target-return-slot-unsupported",
      `target rule ${rule.id} does not expose a modeled return-address stack slot`,
    );
  }
  const unsupportedSaved = rule.calleeSaved?.find((saved) => saved.register !== "rbp");
  if (unsupportedSaved) {
    return refusal(
      "target-callee-saved-state-unsupported",
      `target rule ${rule.id} saves ${unsupportedSaved.register}, which is not modeled yet`,
    );
  }
  return undefined;
}

function targetRuleFromBlock(
  request: NativeTargetEhFrameTextParseRequest,
  block: { start: bigint; end: bigint; lines: string[] },
): { rule: NativeTargetUnwindFrameRule } | { refusal: NativeProcessImageRefusal } {
  const cfa = targetCfa(block.lines);
  const returnAddressOffset = nativeLastCapture(
    block.lines,
    /DW_CFA_offset: r16(?: \([^)]*\))? at cfa([+-]\d+)/,
  );
  if (!cfa) {
    return {
      refusal: refusal("target-frame-layout-unsupported", "target FDE has no modeled rsp/rbp CFA"),
    };
  }
  if (!returnAddressOffset) {
    return {
      refusal: refusal(
        "target-return-slot-unsupported",
        "target FDE has no modeled cfa-relative return-address slot",
      ),
    };
  }
  return {
    rule: {
      id: `target-eh-frame:${request.functionName}:${hex(block.start)}`,
      functionName: request.functionName,
      mapping: request.mapping,
      pcStart: hex(block.start),
      pcEnd: hex(block.end),
      metadata: "eh-frame",
      cfa,
      returnAddress: { location: "cfa-relative", offset: Number.parseInt(returnAddressOffset, 10) },
      calleeSaved: targetCalleeSaved(block.lines),
    },
  };
}

function targetCfa(lines: string[]): NativeTargetUnwindFrameRule["cfa"] | undefined {
  const combined = nativeLastCapture(
    lines,
    /DW_CFA_def_cfa: r(?:6|7)(?: \((rbp|rsp)\))? ofs:? (\d+)/,
  );
  if (combined) {
    const [register, offset] = combined.split(":");
    return { register: targetCfaRegister(register), offset: Number.parseInt(offset, 10) };
  }
  let offset: string | undefined;
  let register: "rsp" | "rbp" | undefined;
  for (const line of lines) {
    const offsetMatch = /DW_CFA_def_cfa_offset: (\d+)/.exec(line);
    if (offsetMatch?.[1]) {
      offset = offsetMatch[1];
    }
    const registerMatch = /DW_CFA_def_cfa_register: r(?:6|7)(?: \((rbp|rsp)\))?/.exec(line);
    if (registerMatch) {
      register = targetCfaRegister(registerMatch[1]);
    }
  }
  return register && offset ? { register, offset: Number.parseInt(offset, 10) } : undefined;
}

function targetCalleeSaved(lines: string[]): NativeTargetUnwindFrameRule["calleeSaved"] {
  const saved: NonNullable<NativeTargetUnwindFrameRule["calleeSaved"]> = [];
  for (const line of lines) {
    const match = /DW_CFA_offset: r(\d+)(?: \(([^)]*)\))? at cfa([+-]\d+)/.exec(line);
    if (!match?.[1] || match[1] === "16") {
      continue;
    }
    const register = targetSavedRegister(match[1], match[2]);
    if (register) {
      saved.push({
        register,
        location: "cfa-relative",
        offset: Number.parseInt(match[3] ?? "0", 10),
      });
    }
  }
  return saved;
}

function targetCfaRegister(value: string | undefined): "rsp" | "rbp" {
  return value === "rsp" ? "rsp" : "rbp";
}

const TARGET_SAVED_REGISTERS = new Map<string, Exclude<NativeTargetUnwindRegister, "rsp" | "rip">>([
  ["6", "rbp"],
  ["rbp", "rbp"],
  ["3", "rbx"],
  ["rbx", "rbx"],
  ["12", "r12"],
  ["r12", "r12"],
  ["13", "r13"],
  ["r13", "r13"],
  ["14", "r14"],
  ["r14", "r14"],
  ["15", "r15"],
  ["r15", "r15"],
]);

function targetSavedRegister(number: string, name: string | undefined) {
  return TARGET_SAVED_REGISTERS.get(name ?? number) ?? TARGET_SAVED_REGISTERS.get(number);
}

function refusedParse(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeTargetEhFrameTextParseResult {
  return { rules: [], refusals: [refusal(code, message)] };
}

function refusedMatch(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeTargetUnwindMatchResult {
  return { matches: [], refusals: [refusal(code, message)] };
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
