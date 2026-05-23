import type { NativeProcessImageRefusal, NativeThreadState } from "./native-process-image.ts";

export interface NativeSimdFpuLiveSubsetPolicy {
  state: "refuse-all-live-subsets";
  acceptedSubsets: [];
  refusalCode: "simd-fpu-state-unsupported";
  reason: string;
}

export const NATIVE_SIMD_FPU_LIVE_SUBSET_POLICY: NativeSimdFpuLiveSubsetPolicy = {
  state: "refuse-all-live-subsets",
  acceptedSubsets: [],
  refusalCode: "simd-fpu-state-unsupported",
  reason:
    "No live SIMD/FPU subset is ABI-safe until a target restore contract models exact register, control-word, and signal-frame interactions.",
};

export function planNativeSimdFpuLiveSubsetPolicy(): NativeSimdFpuLiveSubsetPolicy {
  return NATIVE_SIMD_FPU_LIVE_SUBSET_POLICY;
}

export type NativeSimdFpuRestorePolicyResult =
  | {
      state: "accepted";
      threadId: string;
      policy: "not-live";
      refusals: [];
    }
  | {
      state: "refused";
      threadId: string;
      refusals: NativeProcessImageRefusal[];
    };

export function planNativeSimdFpuRestorePolicy(
  thread: NativeThreadState,
): NativeSimdFpuRestorePolicyResult {
  const refusal = safeSimdFpuRefusal(thread);
  return refusal === undefined
    ? { state: "accepted", threadId: thread.id, policy: "not-live", refusals: [] }
    : { state: "refused", threadId: thread.id, refusals: [refusal] };
}

export function safeSimdFpuRefusal(
  thread: NativeThreadState,
): NativeProcessImageRefusal | undefined {
  const state = thread.simdFpu;
  if (state === undefined) {
    return simdFpuRefusal(thread, "SIMD/FPU state was not captured");
  }
  if (state.state === "not-live") {
    return undefined;
  }
  if ("refusal" in state && state.refusal) {
    return state.refusal;
  }
  const subset = "liveSubset" in state && state.liveSubset ? ` (${state.liveSubset})` : "";
  return simdFpuRefusal(thread, `SIMD/FPU state is ${state.state}${subset}`);
}

function simdFpuRefusal(thread: NativeThreadState, message: string): NativeProcessImageRefusal {
  return { code: "simd-fpu-state-unsupported", message: `thread ${thread.id}: ${message}` };
}
