import { normalizeNativeHex } from "./native-hex.ts";
import { nativeThreadRefusal } from "./native-thread-state-policy.ts";
import type {
  NativeProcessImageArchitecture,
  NativeProcessImageRefusal,
  NativeThreadState,
  NativeTlsAmd64SegmentBases,
  NativeTlsThreadPointerRegister,
} from "./native-process-image.ts";

export type NativeTlsTargetAccessPolicy =
  | "not-required"
  | "segment-bases-provided"
  | "target-tcb-materialized"
  | "target-tcb-required";

export type NativeTlsSegmentBaseHandoffResult =
  | {
      state: "accepted";
      threadId: string;
      sourceArch: "arm64";
      sourceRegister: "arm64-tpidr-el0";
      sourceThreadPointer: string;
      targetArch: "amd64";
      targetSegmentBases: {
        fsBase: string;
        gsBase: string;
        accessPolicy: Exclude<NativeTlsTargetAccessPolicy, "target-tcb-required">;
      };
      refusals: [];
    }
  | {
      state: "refused";
      threadId: string;
      refusals: NativeProcessImageRefusal[];
    };

export interface NativeTlsSegmentBaseHandoffRequest {
  threadId: string;
  sourceArch: NativeProcessImageArchitecture;
  targetArch: NativeProcessImageArchitecture;
  sourceThreadPointer?: string;
  sourceRegister?: NativeTlsThreadPointerRegister;
  targetFsBase?: string;
  targetGsBase?: string;
  targetAccessPolicy?: NativeTlsTargetAccessPolicy;
  capturedTargetSegmentBases?: NativeTlsAmd64SegmentBases;
}

export interface NativeThreadTlsPolicyRequest {
  thread: NativeThreadState;
  targetArch?: NativeProcessImageArchitecture;
  targetFsBase?: string;
  targetGsBase?: string;
  targetAccessPolicy?: NativeTlsTargetAccessPolicy;
}

export function planNativeTlsSegmentBaseHandoff(
  request: NativeTlsSegmentBaseHandoffRequest,
): NativeTlsSegmentBaseHandoffResult {
  const architectureRefusal = architecturePairRefusal(request);
  if (architectureRefusal) {
    return architectureRefusal;
  }

  const source = planSourceThreadPointer(request);
  if (source.state === "refused") {
    return source;
  }

  const target = request.capturedTargetSegmentBases
    ? planCapturedSegmentBases(request.threadId, request.capturedTargetSegmentBases)
    : planRequestedSegmentBases(request);
  if (target.state === "refused") {
    return target;
  }

  return acceptedHandoff(request.threadId, source, target);
}

export function safeTlsSegmentBaseRefusal(
  request: NativeThreadTlsPolicyRequest,
): NativeProcessImageRefusal | undefined {
  const thread = request.thread;
  if (thread.sourceRegisters.arch !== "arm64") {
    return undefined;
  }
  const plan = planNativeTlsSegmentBaseHandoff({
    threadId: thread.id,
    sourceArch: thread.sourceRegisters.arch,
    targetArch: request.targetArch ?? "amd64",
    sourceThreadPointer: thread.tls.threadPointer,
    sourceRegister: thread.tls.sourceRegister,
    targetFsBase: request.targetFsBase,
    targetGsBase: request.targetGsBase,
    targetAccessPolicy: request.targetAccessPolicy,
    capturedTargetSegmentBases: thread.tls.targetSegmentBases,
  });
  return plan.state === "refused" ? plan.refusals[0] : undefined;
}

interface NativeTlsSourceThreadPointerPlan {
  state: "accepted";
  sourceRegister: "arm64-tpidr-el0";
  sourceThreadPointer: string;
}

interface NativeTlsTargetSegmentBasePlan {
  state: "accepted";
  targetSegmentBases: Extract<
    NativeTlsSegmentBaseHandoffResult,
    { state: "accepted" }
  >["targetSegmentBases"];
}

type NativeTlsPolicyRefusal = Extract<NativeTlsSegmentBaseHandoffResult, { state: "refused" }>;

function architecturePairRefusal(
  request: NativeTlsSegmentBaseHandoffRequest,
): NativeTlsPolicyRefusal | undefined {
  return request.sourceArch === "arm64" && request.targetArch === "amd64"
    ? undefined
    : refused(
        request.threadId,
        "architecture-pair-unsupported",
        `native TLS handoff only supports arm64 TPIDR_EL0 -> amd64 segment bases in this proof (got ${request.sourceArch} -> ${request.targetArch})`,
      );
}

function planSourceThreadPointer(
  request: NativeTlsSegmentBaseHandoffRequest,
): NativeTlsSourceThreadPointerPlan | NativeTlsPolicyRefusal {
  const sourceRegister = request.sourceRegister ?? "arm64-tpidr-el0";
  if (sourceRegister !== "arm64-tpidr-el0") {
    return refused(
      request.threadId,
      "tls-state-unsupported",
      `thread ${request.threadId} TLS source register ${sourceRegister} cannot be used as arm64 TPIDR_EL0`,
    );
  }
  const sourceThreadPointer = knownHex(request.sourceThreadPointer);
  return sourceThreadPointer
    ? { state: "accepted", sourceRegister, sourceThreadPointer }
    : refused(
        request.threadId,
        "tls-state-unsupported",
        `thread ${request.threadId} has unknown arm64 TPIDR_EL0`,
      );
}

function planCapturedSegmentBases(
  threadId: string,
  captured: NativeTlsAmd64SegmentBases,
): NativeTlsTargetSegmentBasePlan | NativeTlsPolicyRefusal {
  if (captured.state === "unsupported") {
    return captured.refusal
      ? { state: "refused", threadId, refusals: [captured.refusal] }
      : refused(
          threadId,
          "tls-state-unsupported",
          `thread ${threadId} has unsupported amd64 TLS segment bases`,
        );
  }

  const fsBase = knownHex(captured.fsBase);
  const gsBase = knownHex(captured.gsBase);
  if (!fsBase || !gsBase) {
    return refused(
      threadId,
      "tls-state-unsupported",
      `thread ${threadId} has malformed captured amd64 TLS segment bases`,
    );
  }
  if (captured.state === "not-required" && (!isZeroHex(fsBase) || !isZeroHex(gsBase))) {
    return refused(
      threadId,
      "tls-state-unsupported",
      `thread ${threadId} captured TLS-not-required state has non-zero segment bases`,
    );
  }
  return {
    state: "accepted",
    targetSegmentBases: {
      fsBase,
      gsBase,
      accessPolicy: captured.state === "not-required" ? "not-required" : "segment-bases-provided",
    },
  };
}

function planRequestedSegmentBases(
  request: NativeTlsSegmentBaseHandoffRequest,
): NativeTlsTargetSegmentBasePlan | NativeTlsPolicyRefusal {
  const fsBase = knownHex(request.targetFsBase ?? "0x0");
  const gsBase = knownHex(request.targetGsBase ?? "0x0");
  if (!fsBase || !gsBase) {
    return refused(
      request.threadId,
      "tls-state-unsupported",
      `thread ${request.threadId} has malformed amd64 TLS segment base state`,
    );
  }

  const accessPolicy = targetAccessPolicy(request, fsBase, gsBase);
  const policyRefusal = targetAccessRefusal(request.threadId, accessPolicy, fsBase, gsBase);
  if (policyRefusal) {
    return policyRefusal;
  }
  const acceptedAccessPolicy =
    accessPolicy === "not-required"
      ? "not-required"
      : accessPolicy === "target-tcb-materialized"
        ? "target-tcb-materialized"
        : "segment-bases-provided";
  return {
    state: "accepted",
    targetSegmentBases: { fsBase, gsBase, accessPolicy: acceptedAccessPolicy },
  };
}

function targetAccessRefusal(
  threadId: string,
  accessPolicy: NativeTlsTargetAccessPolicy,
  fsBase: string,
  gsBase: string,
): NativeTlsPolicyRefusal | undefined {
  if (accessPolicy === "target-tcb-required") {
    return refused(
      threadId,
      "tls-state-unsupported",
      `thread ${threadId} requires amd64 TCB/TLS materialization before %fs can be used`,
    );
  }
  if (accessPolicy === "not-required" && (!isZeroHex(fsBase) || !isZeroHex(gsBase))) {
    return refused(
      threadId,
      "tls-state-unsupported",
      `thread ${threadId} declares TLS not required but provides non-zero amd64 segment bases`,
    );
  }
  if (accessPolicy === "target-tcb-materialized" && isZeroHex(fsBase)) {
    return refused(
      threadId,
      "tls-state-unsupported",
      `thread ${threadId} declares a materialized target TCB with a zero amd64 fs base`,
    );
  }
  return undefined;
}

function acceptedHandoff(
  threadId: string,
  source: NativeTlsSourceThreadPointerPlan,
  target: NativeTlsTargetSegmentBasePlan,
): Extract<NativeTlsSegmentBaseHandoffResult, { state: "accepted" }> {
  return {
    state: "accepted",
    threadId,
    sourceArch: "arm64",
    sourceRegister: source.sourceRegister,
    sourceThreadPointer: source.sourceThreadPointer,
    targetArch: "amd64",
    targetSegmentBases: target.targetSegmentBases,
    refusals: [],
  };
}

function targetAccessPolicy(
  request: NativeTlsSegmentBaseHandoffRequest,
  fsBase: string,
  gsBase: string,
): NativeTlsTargetAccessPolicy {
  if (request.targetAccessPolicy) {
    return request.targetAccessPolicy;
  }
  return isZeroHex(fsBase) && isZeroHex(gsBase) ? "not-required" : "segment-bases-provided";
}

function knownHex(value: string | undefined): string | undefined {
  if (!value || value.toLowerCase() === "unknown") {
    return undefined;
  }
  try {
    return normalizeNativeHex(value);
  } catch {
    return undefined;
  }
}

function isZeroHex(value: string): boolean {
  return BigInt(value) === 0n;
}

function refused(
  threadId: string,
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeTlsPolicyRefusal {
  return { state: "refused", threadId, refusals: [nativeThreadRefusal(code, message)] };
}
