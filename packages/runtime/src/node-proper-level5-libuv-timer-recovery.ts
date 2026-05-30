export const NODE_PROPER_LEVEL5_LIBUV_TIMER_RECOVERY_KIND =
  "machinen.node-proper-level5-libuv-timer-recovery" as const;

export type NodeProperLevel5LibuvTimerRecoveryRefusalCode =
  | "node-proper-level5-libuv-timer-missing"
  | "node-proper-level5-libuv-timer-ambiguous"
  | "node-proper-level5-libuv-timer-callback-active-unsupported";

export interface NodeProperLevel5LibuvTimerRecoveryRefusal {
  code: NodeProperLevel5LibuvTimerRecoveryRefusalCode;
  message: string;
}

export interface NodeProperLevel5LibuvTimerMemoryFragment {
  bytes: Uint8Array;
  bytesPath?: string;
  startAddress?: bigint;
}

export interface NodeProperLevel5LibuvTimerCandidate {
  anchor: string;
  bytesPath?: string;
  offset: number;
  evidence: string[];
}

export interface NodeProperLevel5LibuvTimerRecoveryResult {
  kind: typeof NODE_PROPER_LEVEL5_LIBUV_TIMER_RECOVERY_KIND;
  accepted: boolean;
  timerCount: number;
  candidates: NodeProperLevel5LibuvTimerCandidate[];
  refusals: NodeProperLevel5LibuvTimerRecoveryRefusal[];
}

export function recoverNodeProperLevel5LibuvTimerEvidence(
  fragments: NodeProperLevel5LibuvTimerMemoryFragment[],
  options: { anchor: string; callbackName?: string; activeCallbackDetected?: boolean },
): NodeProperLevel5LibuvTimerRecoveryResult {
  if (options.activeCallbackDetected) {
    return timerRefusal("node-proper-level5-libuv-timer-callback-active-unsupported", [
      {
        anchor: options.anchor,
        offset: -1,
        evidence: ["timer callback was active during capture"],
      },
    ]);
  }

  const anchorBytes = new TextEncoder().encode(options.anchor);
  const callbackBytes = options.callbackName
    ? new TextEncoder().encode(options.callbackName)
    : undefined;
  const candidates: NodeProperLevel5LibuvTimerCandidate[] = [];

  for (const fragment of fragments) {
    for (const offset of findBytes(fragment.bytes, anchorBytes)) {
      const evidence = ["timer anchor string found in accepted source memory"];
      if (callbackBytes && findBytes(fragment.bytes, callbackBytes).length > 0) {
        evidence.push("timer callback name found in accepted source memory");
      }
      candidates.push({ anchor: options.anchor, bytesPath: fragment.bytesPath, offset, evidence });
    }
  }

  if (candidates.length === 0) {
    return timerRefusal("node-proper-level5-libuv-timer-missing", candidates);
  }
  if (candidates.length > 1) {
    return timerRefusal("node-proper-level5-libuv-timer-ambiguous", candidates);
  }

  return {
    kind: NODE_PROPER_LEVEL5_LIBUV_TIMER_RECOVERY_KIND,
    accepted: true,
    timerCount: candidates.length,
    candidates,
    refusals: [],
  };
}

function timerRefusal(
  code: NodeProperLevel5LibuvTimerRecoveryRefusalCode,
  candidates: NodeProperLevel5LibuvTimerCandidate[],
): NodeProperLevel5LibuvTimerRecoveryResult {
  return {
    kind: NODE_PROPER_LEVEL5_LIBUV_TIMER_RECOVERY_KIND,
    accepted: false,
    timerCount: candidates.length,
    candidates,
    refusals: [{ code, message: timerRefusalMessage(code, candidates.length) }],
  };
}

function timerRefusalMessage(
  code: NodeProperLevel5LibuvTimerRecoveryRefusalCode,
  count: number,
): string {
  switch (code) {
    case "node-proper-level5-libuv-timer-missing":
      return "no supported libuv timer evidence was found in accepted source memory";
    case "node-proper-level5-libuv-timer-ambiguous":
      return `expected one supported libuv timer, found ${count}`;
    case "node-proper-level5-libuv-timer-callback-active-unsupported":
      return "timer callback execution was active during capture";
  }
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number[] {
  const offsets: number[] = [];
  if (needle.length === 0 || haystack.length < needle.length) {
    return offsets;
  }
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) {
        continue outer;
      }
    }
    offsets.push(offset);
  }
  return offsets;
}
