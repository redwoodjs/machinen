import { describe, expect, it } from "vitest";

import {
  matchNativeTargetUnwindFrame,
  parseNativeTargetEhFrameText,
  type NativeTargetUnwindFrameRule,
} from "../native-target-unwind.ts";
import type { NativeDiscoveredUnwindFrame } from "../native-unwind-frames.ts";

const sourceFrame: NativeDiscoveredUnwindFrame = {
  id: "frame:thread:realspin_loop",
  functionName: "realspin_loop",
  sourcePc: "0x401234",
  sourceSp: "0x7fff0000",
  cfa: "0x7fff0040",
  returnAddress: "0x401280",
  returnAddressSlot: "0x7fff0038",
  metadata: "eh-frame",
  stackFrame: {
    id: "frame:thread:realspin_loop",
    sourceSp: "0x7fff0000",
    sourceReturnAddress: "0x401280",
    sizeBytes: 64,
    metadata: "dwarf",
    locals: [],
  },
};

function targetReadelfFrames() {
  return `
00000088 0000000000000024 0000001c FDE cie=00000070 pc=0000700000001200..0000700000001280
  DW_CFA_advance_loc: 1 to 0000700000001201
  DW_CFA_def_cfa_offset: 16
  DW_CFA_offset: r6 (rbp) at cfa-16
  DW_CFA_offset: r16 (rip) at cfa-8
  DW_CFA_advance_loc: 3 to 0000700000001204
  DW_CFA_def_cfa_register: r6 (rbp)
`;
}

describe("native target unwind matching", () => {
  it("parses target amd64 .eh_frame text and matches a source frame return contract", () => {
    const parsed = parseNativeTargetEhFrameText({
      readelfFrames: targetReadelfFrames(),
      mapping: "target:mapping:text",
      functionName: "realspin_loop",
      targetAddress: "0x700000001234",
    });

    expect(parsed.refusals).toEqual([]);
    expect(parsed.rules[0]).toMatchObject({
      functionName: "realspin_loop",
      metadata: "eh-frame",
      cfa: { register: "rbp", offset: 16 },
      returnAddress: { location: "cfa-relative", offset: -8 },
      calleeSaved: [{ register: "rbp", location: "cfa-relative", offset: -16 }],
    });

    const matched = matchNativeTargetUnwindFrame({
      sourceFrame,
      targetAddress: "0x700000001234",
      targetRules: parsed.rules,
    });

    expect(matched.refusals).toEqual([]);
    expect(matched.matches[0]).toMatchObject({
      sourceFrameId: sourceFrame.id,
      targetAddress: "0x700000001234",
      targetReturnAddressSlotOffset: -8,
      preservesReturnContract: true,
    });
  });

  it("uses precise target unwind parse refusals", () => {
    expect(
      parseNativeTargetEhFrameText({
        readelfFrames: "",
        mapping: "target:mapping:text",
        functionName: "missing",
        targetAddress: "0x700000001234",
      }).refusals[0]?.code,
    ).toBe("unwind-metadata-missing");
    expect(
      parseNativeTargetEhFrameText({
        readelfFrames: targetReadelfFrames(),
        mapping: "target:mapping:text",
        functionName: "missing",
        targetAddress: "0x700000009999",
      }).refusals[0]?.code,
    ).toBe("target-unwind-mismatch");
    expect(
      parseNativeTargetEhFrameText({
        readelfFrames:
          "FDE cie=00000070 pc=0000700000001200..0000700000001280\n  DW_CFA_def_cfa: r7 (rsp) ofs: 8",
        mapping: "target:mapping:text",
        functionName: "missing-return",
        targetAddress: "0x700000001234",
      }).refusals[0]?.code,
    ).toBe("target-return-slot-unsupported");
  });

  it("uses precise target unwind match refusals", () => {
    const rule: NativeTargetUnwindFrameRule = {
      id: "target:bad-callee",
      functionName: "realspin_loop",
      mapping: "target:mapping:text",
      pcStart: "0x700000001200",
      pcEnd: "0x700000001280",
      metadata: "eh-frame",
      cfa: { register: "rbp", offset: 16 },
      returnAddress: { location: "cfa-relative", offset: -8 },
      calleeSaved: [{ register: "rbx", location: "cfa-relative", offset: -24 }],
    };

    expect(
      matchNativeTargetUnwindFrame({
        sourceFrame,
        targetAddress: "0x700000001234",
        targetRules: [],
      }).refusals[0]?.code,
    ).toBe("target-unwind-mismatch");
    expect(
      matchNativeTargetUnwindFrame({
        sourceFrame: { ...sourceFrame, returnAddressSlot: undefined },
        targetAddress: "0x700000001234",
        targetRules: [rule],
      }).refusals[0]?.code,
    ).toBe("return-slot-unreadable");
    expect(
      matchNativeTargetUnwindFrame({
        sourceFrame,
        targetAddress: "0x700000001234",
        targetRules: [rule],
      }).refusals[0]?.code,
    ).toBe("target-callee-saved-state-unsupported");
  });
});
