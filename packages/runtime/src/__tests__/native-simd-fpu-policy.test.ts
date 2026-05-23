import { describe, expect, it } from "vitest";
import {
  NATIVE_SIMD_FPU_LIVE_SUBSET_POLICY,
  planNativeSimdFpuLiveSubsetPolicy,
  planNativeSimdFpuRestorePolicy,
} from "../native-simd-fpu-policy.ts";
import type { NativeThreadState } from "../native-process-image.ts";

function thread(): NativeThreadState {
  return {
    id: "thread:simd",
    state: "stopped",
    stopReason: "ptrace-stop",
    stackMapping: "mapping:stack",
    sourceRegisters: {
      arch: "arm64",
      pc: "0x400120",
      sp: "0x700000000f00",
      pstate: "0x0",
      x: Array.from({ length: 31 }, (_value, index) => `0x${(index + 1).toString(16)}`),
    },
    syscall: { state: "outside-syscall" },
    signal: {
      blocked: ["0x0"],
      pending: ["0x0"],
      activeFrame: false,
      altStack: { state: "disabled" },
    },
    tls: { threadPointer: "0x0", sourceRegister: "arm64-tpidr-el0", rseq: { state: "absent" } },
    simdFpu: { state: "not-live", provenance: "unit-test-zero-fpstate" },
  };
}

describe("native SIMD/FPU policy", () => {
  it("documents that no live subset is currently ABI-safe", () => {
    expect(planNativeSimdFpuLiveSubsetPolicy()).toEqual(NATIVE_SIMD_FPU_LIVE_SUBSET_POLICY);
    expect(NATIVE_SIMD_FPU_LIVE_SUBSET_POLICY).toMatchObject({
      state: "refuse-all-live-subsets",
      acceptedSubsets: [],
      refusalCode: "simd-fpu-state-unsupported",
    });
  });

  it("accepts only clean/not-live state and refuses tempting partial subsets", () => {
    expect(planNativeSimdFpuRestorePolicy(thread())).toMatchObject({ state: "accepted" });

    const partial = thread();
    partial.simdFpu = {
      state: "requires-restore",
      arch: "arm64",
      byteLength: 528,
      liveSubset: "fp-control-state",
    };

    expect(planNativeSimdFpuRestorePolicy(partial)).toMatchObject({
      state: "refused",
      refusals: [
        expect.objectContaining({
          code: "simd-fpu-state-unsupported",
          message: expect.stringContaining("fp-control-state"),
        }),
      ],
    });
  });
});
