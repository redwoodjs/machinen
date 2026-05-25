import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeControlledTwoThreadRestorePlan } from "./native-two-thread-boundary.ts";

export interface TargetGuestTwoThreadBinding {
  threadId: string;
  stackBase: string;
  stackLimit: string;
  registers: Record<string, string>;
}

export interface TargetGuestTwoThreadSpawnStep {
  action: "spawn-target-thread";
  threadId: string;
  stackBase: string;
  stackLimit: string;
  registers: Record<string, string>;
}

export type TargetGuestTwoThreadRestorePlan =
  | {
      state: "planned";
      targetThreadCount: 2;
      steps: [TargetGuestTwoThreadSpawnStep, TargetGuestTwoThreadSpawnStep];
      refusals: [];
    }
  | {
      state: "refused";
      targetThreadCount: number;
      steps: [];
      refusals: NativeProcessImageRefusal[];
    };

export function planTargetGuestTwoThreadRestore(
  boundary: NativeControlledTwoThreadRestorePlan,
  bindings: TargetGuestTwoThreadBinding[],
): TargetGuestTwoThreadRestorePlan {
  if (boundary.state === "refused") {
    return {
      state: "refused",
      targetThreadCount: boundary.targetThreadCount,
      steps: [],
      refusals: boundary.refusals,
    };
  }

  const refusals = validateBindings(boundary.threadIds, bindings);
  if (refusals.length > 0) {
    return { state: "refused", targetThreadCount: 2, steps: [], refusals };
  }

  const byThread = new Map(bindings.map((binding) => [binding.threadId, binding]));
  return {
    state: "planned",
    targetThreadCount: 2,
    steps: boundary.threadIds.map((threadId) => {
      const binding = byThread.get(threadId)!;
      return {
        action: "spawn-target-thread",
        threadId,
        stackBase: binding.stackBase,
        stackLimit: binding.stackLimit,
        registers: binding.registers,
      };
    }) as [TargetGuestTwoThreadSpawnStep, TargetGuestTwoThreadSpawnStep],
    refusals: [],
  };
}

function validateBindings(
  expectedThreadIds: [string, string],
  bindings: TargetGuestTwoThreadBinding[],
): NativeProcessImageRefusal[] {
  return [
    ...bindingCardinalityRefusals(expectedThreadIds, bindings),
    ...bindingRegisterRefusals(bindings),
    ...bindingStackRefusals(bindings),
  ];
}

function bindingCardinalityRefusals(
  expectedThreadIds: [string, string],
  bindings: TargetGuestTwoThreadBinding[],
): NativeProcessImageRefusal[] {
  const expected = new Set(expectedThreadIds);
  const seen = new Set<string>();
  const refusals: NativeProcessImageRefusal[] = [];
  for (const binding of bindings) {
    if (!expected.has(binding.threadId)) {
      refusals.push(
        refusal("thread-state-unsupported", `unexpected target thread ${binding.threadId}`),
      );
    }
    if (seen.has(binding.threadId)) {
      refusals.push(
        refusal("thread-state-unsupported", `duplicate target binding for ${binding.threadId}`),
      );
    }
    seen.add(binding.threadId);
  }
  for (const threadId of expected) {
    if (!seen.has(threadId)) {
      refusals.push(refusal("thread-state-unsupported", `missing target binding for ${threadId}`));
    }
  }
  return refusals;
}

function bindingRegisterRefusals(
  bindings: TargetGuestTwoThreadBinding[],
): NativeProcessImageRefusal[] {
  return bindings.flatMap((binding) => {
    const required = ["rip", "rsp"];
    const missing = required.filter((register) => binding.registers[register] === undefined);
    return missing.length === 0
      ? []
      : [
          refusal(
            "target-frame-register-value-unavailable",
            `${binding.threadId} target registers missing ${missing.join(", ")}`,
          ),
        ];
  });
}

function bindingStackRefusals(
  bindings: TargetGuestTwoThreadBinding[],
): NativeProcessImageRefusal[] {
  const parsed = bindings.map((binding) => ({
    binding,
    base: BigInt(binding.stackBase),
    limit: BigInt(binding.stackLimit),
  }));
  const malformed = parsed.flatMap(({ binding, base, limit }) =>
    base < limit
      ? []
      : [
          refusal(
            "target-stack-window-unsupported",
            `${binding.threadId} target stack is inverted`,
          ),
        ],
  );
  const overlap =
    parsed.length === 2 &&
    rangesOverlap(parsed[0]!.base, parsed[0]!.limit, parsed[1]!.base, parsed[1]!.limit)
      ? [
          refusal(
            "target-stack-window-unsupported",
            `${parsed[0]!.binding.threadId} and ${parsed[1]!.binding.threadId} target stacks overlap`,
          ),
        ]
      : [];
  return [...malformed, ...overlap];
}

function rangesOverlap(aBase: bigint, aLimit: bigint, bBase: bigint, bLimit: bigint): boolean {
  return aBase < bLimit && bBase < aLimit;
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message };
}
