export const NODE_PROPER_LEVEL5_V8_OBJECT_RECOVERY_KIND =
  "machinen.node-proper-level5-v8-object-recovery" as const;

export type NodeProperLevel5V8ObjectRecoveryRefusalCode =
  | "node-proper-level5-v8-object-state-missing"
  | "node-proper-level5-v8-object-state-ambiguous"
  | "node-proper-level5-v8-object-hidden-class-unsupported"
  | "node-proper-level5-v8-object-sparse-array-unsupported"
  | "node-proper-level5-v8-object-accessor-unsupported"
  | "node-proper-level5-v8-object-proxy-unsupported"
  | "node-proper-level5-v8-object-symbol-key-unsupported"
  | "node-proper-level5-v8-object-external-string-unsupported"
  | "node-proper-level5-v8-object-elements-kind-unsupported";

export interface NodeProperLevel5V8ObjectRecoveryRefusal {
  code: NodeProperLevel5V8ObjectRecoveryRefusalCode;
  message: string;
}

export interface NodeProperLevel5V8ObjectMemoryFragment {
  bytes: Uint8Array;
  bytesPath?: string;
}

export interface NodeProperLevel5V8ObjectCandidate {
  anchor: string;
  bytesPath?: string;
  offset: number;
  total: number;
  history: number[];
  evidence: string[];
}

export interface NodeProperLevel5V8ObjectRecoveryResult {
  kind: typeof NODE_PROPER_LEVEL5_V8_OBJECT_RECOVERY_KIND;
  accepted: boolean;
  candidates: NodeProperLevel5V8ObjectCandidate[];
  refusals: NodeProperLevel5V8ObjectRecoveryRefusal[];
}

export interface NodeProperLevel5V8ObjectRecoveryOptions {
  anchor: string;
  expectedTotal: number;
  expectedHistory: number[];
  unsupportedShape?: NodeProperLevel5V8ObjectRecoveryRefusalCode;
}

export function recoverNodeProperLevel5V8ObjectStateEvidence(
  fragments: NodeProperLevel5V8ObjectMemoryFragment[],
  options: NodeProperLevel5V8ObjectRecoveryOptions,
): NodeProperLevel5V8ObjectRecoveryResult {
  if (options.unsupportedShape) {
    return objectRefusal(options.unsupportedShape, []);
  }

  const anchorBytes = new TextEncoder().encode(options.anchor);
  const candidates: NodeProperLevel5V8ObjectCandidate[] = [];
  for (const fragment of fragments) {
    for (const offset of findBytes(fragment.bytes, anchorBytes)) {
      const window = fragment.bytes.slice(offset, Math.min(fragment.bytes.length, offset + 512));
      const smiValues = decodeCompressedSmiValues(window);
      if (containsSubsequence(smiValues, [options.expectedTotal, ...options.expectedHistory])) {
        candidates.push({
          anchor: options.anchor,
          bytesPath: fragment.bytesPath,
          offset,
          total: options.expectedTotal,
          history: [...options.expectedHistory],
          evidence: [
            "object anchor string found in accepted source memory",
            "object total property decoded from raw V8 Smi memory",
            "packed Smi array length/elements decoded from raw V8 memory",
          ],
        });
      }
    }
  }

  if (candidates.length === 0) {
    return objectRefusal("node-proper-level5-v8-object-state-missing", candidates);
  }
  if (candidates.length > 1) {
    return objectRefusal("node-proper-level5-v8-object-state-ambiguous", candidates);
  }

  return {
    kind: NODE_PROPER_LEVEL5_V8_OBJECT_RECOVERY_KIND,
    accepted: true,
    candidates,
    refusals: [],
  };
}

function objectRefusal(
  code: NodeProperLevel5V8ObjectRecoveryRefusalCode,
  candidates: NodeProperLevel5V8ObjectCandidate[],
): NodeProperLevel5V8ObjectRecoveryResult {
  return {
    kind: NODE_PROPER_LEVEL5_V8_OBJECT_RECOVERY_KIND,
    accepted: false,
    candidates,
    refusals: [{ code, message: objectRefusalMessage(code, candidates.length) }],
  };
}

const objectRefusalMessages: Record<NodeProperLevel5V8ObjectRecoveryRefusalCode, string> = {
  "node-proper-level5-v8-object-state-missing":
    "no supported V8 object-state evidence was found in accepted source memory",
  "node-proper-level5-v8-object-state-ambiguous":
    "expected one supported V8 object-state candidate",
  "node-proper-level5-v8-object-hidden-class-unsupported":
    "unknown V8 hidden class/map is unsupported",
  "node-proper-level5-v8-object-sparse-array-unsupported": "sparse arrays are unsupported",
  "node-proper-level5-v8-object-accessor-unsupported": "accessor properties are unsupported",
  "node-proper-level5-v8-object-proxy-unsupported": "proxy objects are unsupported",
  "node-proper-level5-v8-object-symbol-key-unsupported": "symbol keys are unsupported",
  "node-proper-level5-v8-object-external-string-unsupported": "external strings are unsupported",
  "node-proper-level5-v8-object-elements-kind-unsupported": "unsupported V8 array elements kind",
};

function objectRefusalMessage(
  code: NodeProperLevel5V8ObjectRecoveryRefusalCode,
  count: number,
): string {
  if (code === "node-proper-level5-v8-object-state-ambiguous") {
    return `${objectRefusalMessages[code]}, found ${count}`;
  }
  return objectRefusalMessages[code];
}

function decodeCompressedSmiValues(bytes: Uint8Array): number[] {
  const values: number[] = [];
  for (let offset = 0; offset <= bytes.length - 8; offset++) {
    const word = readU64LE(bytes, offset);
    if ((word & 0xffffffffn) !== 0n) {
      continue;
    }
    const raw = Number((word >> 32n) & 0xffffffffn);
    values.push(raw > 0x7fffffff ? raw - 0x100000000 : raw);
  }
  return values;
}

function containsSubsequence(values: number[], expected: number[]): boolean {
  let index = 0;
  for (const value of values) {
    if (value === expected[index]) {
      index++;
      if (index === expected.length) {
        return true;
      }
    }
  }
  return false;
}

function readU64LE(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  return value;
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
