/** Register/TLS/syscall-state translation rules for native process images. */

import { normalizeNativeHex } from "./native-hex.ts";
import {
  nativeThreadRefusal,
  unsafeNativeThreadExecutionState,
} from "./native-thread-state-policy.ts";
import type {
  NativeAmd64Registers,
  NativeArm64Registers,
  NativeProcessImageArchitecture,
  NativeProcessImageRefusal,
  NativeThreadState,
  NativeThreadTranslation,
} from "./native-process-image.ts";

export interface NativeRegisterTranslationRequest {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  threads: NativeThreadState[];
  continuations: Record<string, NativeContinuationTarget>;
}

export interface NativeContinuationTarget {
  sourcePc: string;
  targetIp: string;
  targetSp: string;
  targetTls: string;
  targetRegisterOverrides?: Partial<
    Pick<
      NativeAmd64Registers,
      | "rax"
      | "rbx"
      | "rcx"
      | "rdx"
      | "rsi"
      | "rdi"
      | "rbp"
      | "r8"
      | "r9"
      | "r10"
      | "r11"
      | "r12"
      | "r13"
      | "r14"
      | "r15"
    >
  >;
}

export interface NativeRegisterTranslationResult {
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  threads: NativeThreadTranslation[];
  refusals: NativeProcessImageRefusal[];
}

export function translateNativeRegisterState(
  request: NativeRegisterTranslationRequest,
): NativeRegisterTranslationResult {
  const architectureRefusal = validateRegisterArchitecturePair(request);
  if (architectureRefusal) {
    return refusedRegisterTranslation(request, architectureRefusal);
  }

  const threads = request.threads.map((thread) => translateThreadRegisters(thread, request));
  return {
    sourceArch: request.sourceArch,
    targetArch: request.targetArch,
    threads,
    refusals: threads.flatMap((thread) => (thread.refusal ? [thread.refusal] : [])),
  };
}

function validateRegisterArchitecturePair(
  request: NativeRegisterTranslationRequest,
): NativeProcessImageRefusal | undefined {
  if (request.sourceArch !== "arm64" || request.targetArch !== "amd64") {
    return nativeThreadRefusal(
      "architecture-pair-unsupported",
      `native register translation only supports arm64 -> amd64 in this proof (got ${request.sourceArch} -> ${request.targetArch})`,
    );
  }
  return undefined;
}

function refusedRegisterTranslation(
  request: NativeRegisterTranslationRequest,
  reason: NativeProcessImageRefusal,
): NativeRegisterTranslationResult {
  return {
    sourceArch: request.sourceArch,
    targetArch: request.targetArch,
    threads: request.threads.map((thread) => ({
      sourceThreadId: thread.id,
      state: "refused",
      refusal: reason,
    })),
    refusals: [reason],
  };
}

function translateThreadRegisters(
  thread: NativeThreadState,
  request: NativeRegisterTranslationRequest,
): NativeThreadTranslation {
  const unsafe = unsafeNativeThreadExecutionState(thread);
  if (unsafe) {
    return { sourceThreadId: thread.id, state: "refused", refusal: unsafe };
  }
  if (thread.sourceRegisters.arch !== "arm64") {
    return {
      sourceThreadId: thread.id,
      state: "refused",
      refusal: nativeThreadRefusal(
        "architecture-unsupported",
        `thread ${thread.id} has ${thread.sourceRegisters.arch} registers, expected arm64`,
      ),
    };
  }
  const continuation = request.continuations[thread.id];
  if (!continuation) {
    return {
      sourceThreadId: thread.id,
      state: "refused",
      refusal: nativeThreadRefusal(
        "code-location-unknown",
        `thread ${thread.id} has no target continuation`,
      ),
    };
  }
  if (normalizeNativeHex(continuation.sourcePc) !== normalizeNativeHex(thread.sourceRegisters.pc)) {
    return {
      sourceThreadId: thread.id,
      state: "refused",
      refusal: nativeThreadRefusal(
        "code-location-unknown",
        `thread ${thread.id} source pc ${thread.sourceRegisters.pc} does not match continuation ${continuation.sourcePc}`,
      ),
    };
  }
  return {
    sourceThreadId: thread.id,
    state: "translated",
    targetRegisters: arm64ToAmd64(thread.sourceRegisters, continuation),
  };
}

// fallow-ignore-next-line complexity
function arm64ToAmd64(
  source: NativeArm64Registers,
  continuation: NativeContinuationTarget,
): NativeAmd64Registers {
  const translated: NativeAmd64Registers = {
    arch: "amd64",
    rip: continuation.targetIp,
    rsp: continuation.targetSp,
    rflags: "0x202",
    rax: source.x[0] ?? "0x0",
    rbx: source.x[19] ?? "0x0",
    rcx: source.x[3] ?? "0x0",
    rdx: source.x[2] ?? "0x0",
    rsi: source.x[1] ?? "0x0",
    rdi: source.x[0] ?? "0x0",
    rbp: source.x[29] ?? continuation.targetSp,
    r8: source.x[4] ?? "0x0",
    r9: source.x[5] ?? "0x0",
    r10: source.x[6] ?? "0x0",
    r11: source.x[7] ?? "0x0",
    r12: source.x[20] ?? "0x0",
    r13: source.x[21] ?? "0x0",
    r14: source.x[22] ?? "0x0",
    r15: source.x[23] ?? "0x0",
    fsBase: continuation.targetTls,
    gsBase: "0x0",
  };
  return { ...translated, ...continuation.targetRegisterOverrides };
}
