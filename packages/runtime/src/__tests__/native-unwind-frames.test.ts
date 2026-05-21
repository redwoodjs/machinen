import { describe, expect, it } from "vitest";

import {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
  parseNativeEhFrameText,
  type NativeUnwindFrameDiscoveryRequest,
  type NativeUnwindFrameRule,
} from "../native-unwind-frames.ts";

const RULE: NativeUnwindFrameRule = {
  id: "fde:active",
  functionName: "machinen_native_dwarf_unwind_active",
  mapping: "mapping:text",
  pcStart: "0x401120",
  pcEnd: "0x401180",
  metadata: "eh-frame",
  cfa: { register: "x29", offset: 16 },
  returnAddress: { location: "cfa-relative", offset: -8 },
};

function request(): NativeUnwindFrameDiscoveryRequest {
  return {
    threadId: "thread:1",
    stackMapping: "mapping:stack",
    sourceRegisters: {
      arch: "arm64",
      pc: "0x401140",
      sp: "0x7fffff00",
      pstate: "0x0",
      x: Array.from({ length: 31 }, (_, index) => {
        if (index === 29) {
          return "0x7fffff40";
        }
        if (index === 30) {
          return "0x401160";
        }
        return "0x0";
      }),
    },
    rules: [RULE],
    stackWords: [{ address: "0x7fffff48", value: "0x401190" }],
  };
}

describe("native unwind frame discovery", () => {
  it("discovers an arm64 frame from DWARF CFI CFA and return-address rules", () => {
    const input = request();
    const slot = nativeUnwindReturnAddressSlot({
      rule: RULE,
      sourceRegisters: input.sourceRegisters as Extract<
        NativeUnwindFrameDiscoveryRequest["sourceRegisters"],
        { arch: "arm64" }
      >,
    });

    const result = discoverNativeUnwindFrames(input);

    expect(slot).toBe("0x7fffff48");
    expect(result.refusals).toEqual([]);
    expect(result.frames).toEqual([
      expect.objectContaining({
        functionName: "machinen_native_dwarf_unwind_active",
        cfa: "0x7fffff50",
        returnAddressSlot: "0x7fffff48",
        returnAddress: "0x401190",
        metadata: "eh-frame",
        stackFrame: expect.objectContaining({
          sourceReturnAddress: "0x401190",
          metadata: "dwarf",
          locals: [],
        }),
      }),
    ]);
  });

  it("refuses when no unwind rule covers the captured PC", () => {
    const input = request();
    if (input.sourceRegisters.arch !== "arm64") {
      expect.fail("test fixture must be arm64");
    }
    input.sourceRegisters = { ...input.sourceRegisters, pc: "0x499999" };

    const result = discoverNativeUnwindFrames(input);

    expect(result.frames).toEqual([]);
    expect(result.refusals).toEqual([expect.objectContaining({ code: "unwind-fde-missing" })]);
  });

  it("refuses when the DWARF return-address slot was not captured", () => {
    const input = request();
    input.stackWords = [];

    const result = discoverNativeUnwindFrames(input);

    expect(result.frames).toEqual([]);
    expect(result.refusals).toEqual([expect.objectContaining({ code: "return-slot-unreadable" })]);
  });

  it("parses modeled arm64 rules from readelf .eh_frame text", () => {
    const result = parseNativeEhFrameText({
      readelfFrames: `
00000088 0000000000000024 0000001c FDE cie=00000070 pc=0000000000401120..0000000000401180
  DW_CFA_advance_loc: 4 to 0000000000401124
  DW_CFA_def_cfa_offset: 16
  DW_CFA_offset: r29 (x29) at cfa-16
  DW_CFA_offset: r30 (x30) at cfa-8
  DW_CFA_advance_loc: 4 to 0000000000401128
  DW_CFA_def_cfa_register: r29 (x29)
`,
      mapping: "mapping:text",
      functionName: "real_utility_frame",
      pc: "0x401140",
    });

    expect(result.refusals).toEqual([]);
    expect(result.rules).toEqual([
      expect.objectContaining({
        functionName: "real_utility_frame",
        pcStart: "0x401120",
        pcEnd: "0x401180",
        metadata: "eh-frame",
        cfa: { register: "x29", offset: 16 },
        returnAddress: { location: "cfa-relative", offset: -8 },
      }),
    ]);
  });

  it("uses precise .eh_frame parse refusals", () => {
    expect(
      parseNativeEhFrameText({
        readelfFrames: "",
        mapping: "mapping:text",
        functionName: "missing",
        pc: "0x401140",
      }).refusals[0]?.code,
    ).toBe("unwind-metadata-missing");
    expect(
      parseNativeEhFrameText({
        readelfFrames: "FDE cie=00000070 pc=0000000000402000..0000000000402100",
        mapping: "mapping:text",
        functionName: "missing",
        pc: "0x401140",
      }).refusals[0]?.code,
    ).toBe("unwind-fde-missing");
    expect(
      parseNativeEhFrameText({
        readelfFrames:
          "FDE cie=00000070 pc=0000000000401120..0000000000401180\n  DW_CFA_def_cfa: r31 ofs: 16",
        mapping: "mapping:text",
        functionName: "unsupported",
        pc: "0x401140",
      }).refusals[0]?.code,
    ).toBe("unwind-rule-unsupported");
  });

  it("refuses unsupported source architectures", () => {
    const input = request();
    input.sourceRegisters = {
      arch: "amd64",
      rip: "0x401140",
      rsp: "0x7fffff00",
      rflags: "0x202",
      rax: "0x0",
      rbx: "0x0",
      rcx: "0x0",
      rdx: "0x0",
      rsi: "0x0",
      rdi: "0x0",
      rbp: "0x0",
      r8: "0x0",
      r9: "0x0",
      r10: "0x0",
      r11: "0x0",
      r12: "0x0",
      r13: "0x0",
      r14: "0x0",
      r15: "0x0",
      fsBase: "0x0",
      gsBase: "0x0",
    };

    const result = discoverNativeUnwindFrames(input);

    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "architecture-unsupported" }),
    ]);
  });
});
