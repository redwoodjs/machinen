import { describe, expect, it } from "vitest";

import {
  discoverNativeUnwindFrames,
  nativeUnwindReturnAddressSlot,
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
    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "thread-state-unsupported" }),
    ]);
  });

  it("refuses when the DWARF return-address slot was not captured", () => {
    const input = request();
    input.stackWords = [];

    const result = discoverNativeUnwindFrames(input);

    expect(result.frames).toEqual([]);
    expect(result.refusals).toEqual([expect.objectContaining({ code: "pointer-ambiguous" })]);
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
