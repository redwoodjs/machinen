import type {
  NativeMemoryMapping,
  NativeProcessImageRefusal,
  NativeProcessResource,
  NativeThreadState,
} from "./native-process-image.ts";
import type { NativeActiveSyscallPolicyOptions } from "./native-active-syscall-policy.ts";
import type { NativeSignalBlockedMaskPolicy } from "./native-signal-policy.ts";
import {
  planNativeThreadRestoreBoundary,
  type NativeThreadRestorePlan,
} from "./native-thread-restore-policy.ts";

export type NativeControlledTwoThreadRestorePlan =
  | {
      state: "accepted";
      targetThreadCount: 2;
      threadIds: [string, string];
      threadPlans: [
        Extract<NativeThreadRestorePlan, { state: "accepted" }>,
        Extract<NativeThreadRestorePlan, { state: "accepted" }>,
      ];
      refusals: [];
    }
  | {
      state: "refused";
      targetThreadCount: number;
      refusals: NativeProcessImageRefusal[];
    };

export interface NativeControlledTwoThreadRestorePlanRequest {
  threads: NativeThreadState[];
  mappings: NativeMemoryMapping[];
  resources?: NativeProcessResource[];
  activeSyscall?: NativeActiveSyscallPolicyOptions;
  signal?: {
    blockedMaskPolicy?: NativeSignalBlockedMaskPolicy;
  };
}

export function planNativeControlledTwoThreadRestoreBoundary(
  request: NativeControlledTwoThreadRestorePlanRequest,
): NativeControlledTwoThreadRestorePlan {
  if (request.threads.length !== 2) {
    return refused(request.threads.length, [
      refusal("thread-state-unsupported", "controlled restore requires exactly two threads"),
    ]);
  }

  const futexRefusals = futexResourceRefusals(request.resources ?? []);
  const threadPlans = request.threads.map((thread) =>
    planNativeThreadRestoreBoundary({
      threads: [thread],
      mappings: request.mappings,
      resources: nonFutexResources(request.resources ?? []),
      activeSyscall: request.activeSyscall,
      signal: request.signal,
    }),
  );
  const threadRefusals = threadPlans.flatMap((plan) =>
    plan.state === "refused" ? plan.refusals : [],
  );
  const refusals = [...futexRefusals, ...threadRefusals];
  if (refusals.length > 0) {
    return refused(request.threads.length, refusals);
  }

  const acceptedPlans = threadPlans as [
    Extract<NativeThreadRestorePlan, { state: "accepted" }>,
    Extract<NativeThreadRestorePlan, { state: "accepted" }>,
  ];
  return {
    state: "accepted",
    targetThreadCount: 2,
    threadIds: [request.threads[0]!.id, request.threads[1]!.id],
    threadPlans: acceptedPlans,
    refusals: [],
  };
}

function futexResourceRefusals(resources: NativeProcessResource[]): NativeProcessImageRefusal[] {
  return resources
    .filter((resource) => resource.kind === "futex")
    .map((resource) =>
      refusal("futex-state-unsupported", `resource ${resource.id} has futex wait state`, {
        resourceId: resource.id,
        kind: resource.kind,
        state: resource.state,
        requiredModel: [
          "futex word address translation",
          "waiter queue membership",
          "wake/requeue ordering",
          "robust-list owner-death semantics",
        ],
      }),
    );
}

function nonFutexResources(resources: NativeProcessResource[]): NativeProcessResource[] {
  return resources.filter((resource) => resource.kind !== "futex");
}

function refused(
  targetThreadCount: number,
  refusals: NativeProcessImageRefusal[],
): NativeControlledTwoThreadRestorePlan {
  return { state: "refused", targetThreadCount, refusals };
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail?: Record<string, unknown>,
): NativeProcessImageRefusal {
  return detail ? { code, message, detail } : { code, message };
}
