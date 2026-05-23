import type { NativeProcessImageRefusal, NativeThreadState } from "./native-process-image.ts";

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
  return simdFpuRefusal(thread, `SIMD/FPU state is ${state.state}`);
}

function simdFpuRefusal(thread: NativeThreadState, message: string): NativeProcessImageRefusal {
  return { code: "simd-fpu-state-unsupported", message: `thread ${thread.id}: ${message}` };
}
