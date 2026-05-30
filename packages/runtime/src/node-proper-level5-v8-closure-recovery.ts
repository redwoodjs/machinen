export const NODE_PROPER_LEVEL5_V8_CLOSURE_RECOVERY_KIND =
  "machinen.node-proper-level5-v8-closure-recovery" as const;

export type NodeProperLevel5V8ClosureRecoveryRefusalCode =
  | "node-proper-level5-v8-heap-snapshot-malformed"
  | "node-proper-level5-v8-counter-closure-context-missing"
  | "node-proper-level5-v8-counter-cell-primitive-smi-not-addressable"
  | "node-proper-level5-v8-counter-cell-ambiguous";

export interface NodeProperLevel5V8ClosureRecoveryRefusal {
  code: NodeProperLevel5V8ClosureRecoveryRefusalCode;
  message: string;
}

export interface NodeProperLevel5V8ClosureCounterCellCandidate {
  closureNode: number;
  closureName: string;
  contextNode: number;
  variableName: string;
  cellNode: number;
  cellType: string;
  cellName: string;
  evidence: string[];
}

export interface NodeProperLevel5RawMemoryFragment {
  bytes: Uint8Array;
  startAddress: bigint;
  bytesPath?: string;
}

export interface NodeProperLevel5RawV8ContextSmiRecoveryResult {
  accepted: boolean;
  value?: number;
  anchorTaggedAddress?: string;
  anchorBytesPath?: string;
  contextBytesPath?: string;
  contextSlotOffset?: number;
  smiEncoding?: "v8-pointer-compressed-smi32" | "v8-tagged-smi64";
  refusals: NodeProperLevel5V8ClosureRecoveryRefusal[];
}

export interface NodeProperLevel5V8ClosureRecoveryResult {
  kind: typeof NODE_PROPER_LEVEL5_V8_CLOSURE_RECOVERY_KIND;
  accepted: boolean;
  variableName: string;
  candidates: NodeProperLevel5V8ClosureCounterCellCandidate[];
  refusals: NodeProperLevel5V8ClosureRecoveryRefusal[];
}

interface V8HeapSnapshotLike {
  snapshot?: {
    meta?: {
      node_fields?: string[];
      node_types?: unknown[][];
      edge_fields?: string[];
      edge_types?: unknown[][];
    };
  };
  nodes?: number[];
  edges?: number[];
  strings?: string[];
}

interface EdgeView {
  type: string;
  name: string | number;
  to: number;
}

// fallow-ignore-next-line complexity
export function recoverNodeProperLevel5RawV8ContextSmiCounter(
  fragments: NodeProperLevel5RawMemoryFragment[],
  options: { anchor: string; expectedValue?: number; searchRadiusBytes?: number },
): NodeProperLevel5RawV8ContextSmiRecoveryResult {
  const anchorBytes = new TextEncoder().encode(options.anchor);
  const expectedValue = options.expectedValue;
  const radius = options.searchRadiusBytes ?? 128;
  const anchorPointers: Array<{ tagged: bigint; bytesPath?: string }> = [];

  for (const fragment of fragments) {
    for (const offset of findBytes(fragment.bytes, anchorBytes)) {
      for (const headerBytes of [16, 24, 8]) {
        if (offset < headerBytes) {
          continue;
        }
        anchorPointers.push({
          tagged: fragment.startAddress + BigInt(offset - headerBytes) + 1n,
          bytesPath: fragment.bytesPath,
        });
      }
    }
  }

  for (const anchor of anchorPointers) {
    const pointerBytes = littleEndian64(anchor.tagged);
    for (const fragment of fragments) {
      for (const pointerOffset of findBytes(fragment.bytes, pointerBytes)) {
        const start = Math.max(0, pointerOffset - radius);
        const end = Math.min(fragment.bytes.length - 8, pointerOffset + radius);
        for (let offset = start; offset <= end; offset += 8) {
          const word = readLittleEndian64(fragment.bytes, offset);
          const compressed = decodeV8PointerCompressedSmi32(word);
          const tagged = decodeV8TaggedSmi64(word);
          const matchesCompressed =
            compressed !== undefined &&
            (expectedValue === undefined || compressed === expectedValue);
          if (matchesCompressed) {
            return {
              accepted: true,
              value: compressed,
              anchorTaggedAddress: `0x${anchor.tagged.toString(16)}`,
              anchorBytesPath: anchor.bytesPath,
              contextBytesPath: fragment.bytesPath,
              contextSlotOffset: offset,
              smiEncoding: "v8-pointer-compressed-smi32",
              refusals: [],
            };
          }
          const matchesTagged =
            tagged !== undefined && (expectedValue === undefined || tagged === expectedValue);
          if (matchesTagged) {
            return {
              accepted: true,
              value: tagged,
              anchorTaggedAddress: `0x${anchor.tagged.toString(16)}`,
              anchorBytesPath: anchor.bytesPath,
              contextBytesPath: fragment.bytesPath,
              contextSlotOffset: offset,
              smiEncoding: "v8-tagged-smi64",
              refusals: [],
            };
          }
        }
      }
    }
  }

  return {
    accepted: false,
    refusals: [
      {
        code: "node-proper-level5-v8-counter-closure-context-missing",
        message: `could not find a raw V8 context Smi slot near anchor ${JSON.stringify(options.anchor)}`,
      },
    ],
  };
}

// fallow-ignore-next-line complexity
export function recoverNodeProperLevel5V8ClosureCounterCell(
  heapSnapshot: unknown,
  options: { variableName?: string; closureNameIncludes?: string } = {},
): NodeProperLevel5V8ClosureRecoveryResult {
  const variableName = options.variableName ?? "count";
  const malformed = validateHeapSnapshot(heapSnapshot);
  if (malformed) {
    return refusal(variableName, "node-proper-level5-v8-heap-snapshot-malformed", malformed);
  }

  const snapshot = heapSnapshot as V8HeapSnapshotLike;
  const meta = snapshot.snapshot!.meta!;
  const nodeFields = meta.node_fields!;
  const edgeFields = meta.edge_fields!;
  const nodeTypes = meta.node_types![0] as string[];
  const edgeTypes = meta.edge_types![0] as string[];
  const nodes = snapshot.nodes!;
  const edges = snapshot.edges!;
  const strings = snapshot.strings!;

  const nodeFieldCount = nodeFields.length;
  const edgeFieldCount = edgeFields.length;
  const nodeTypeIndex = nodeFields.indexOf("type");
  const nodeNameIndex = nodeFields.indexOf("name");
  const nodeEdgeCountIndex = nodeFields.indexOf("edge_count");
  const edgeTypeIndex = edgeFields.indexOf("type");
  const edgeNameIndex = edgeFields.indexOf("name_or_index");
  const edgeToIndex = edgeFields.indexOf("to_node");

  const edgeStarts = new Map<number, number>();
  let edgeCursor = 0;
  for (let node = 0; node < nodes.length; node += nodeFieldCount) {
    edgeStarts.set(node, edgeCursor);
    edgeCursor += nodes[node + nodeEdgeCountIndex]! * edgeFieldCount;
  }

  const nodeType = (node: number) => nodeTypes[nodes[node + nodeTypeIndex]!] ?? "unknown";
  const nodeName = (node: number) => strings[nodes[node + nodeNameIndex]!] ?? "";
  const edgeViews = (node: number): EdgeView[] => {
    const start = edgeStarts.get(node) ?? 0;
    const count = nodes[node + nodeEdgeCountIndex]!;
    const out: EdgeView[] = [];
    for (let index = 0; index < count; index++) {
      const edge = start + index * edgeFieldCount;
      const edgeNameOrIndex = edges[edge + edgeNameIndex]!;
      out.push({
        type: edgeTypes[edges[edge + edgeTypeIndex]!] ?? "unknown",
        name: strings[edgeNameOrIndex] ?? edgeNameOrIndex,
        to: edges[edge + edgeToIndex]!,
      });
    }
    return out;
  };

  const candidates: NodeProperLevel5V8ClosureCounterCellCandidate[] = [];
  for (let node = 0; node < nodes.length; node += nodeFieldCount) {
    if (nodeType(node) !== "closure") {
      continue;
    }
    const closureName = nodeName(node);
    if (options.closureNameIncludes && !closureName.includes(options.closureNameIncludes)) {
      continue;
    }
    const contextEdge = edgeViews(node).find(
      (edge) => edge.type === "internal" && edge.name === "context",
    );
    if (!contextEdge) {
      continue;
    }
    const variableEdge = edgeViews(contextEdge.to).find(
      (edge) => edge.type === "context" && edge.name === variableName,
    );
    if (!variableEdge) {
      continue;
    }
    candidates.push({
      closureNode: node,
      closureName,
      contextNode: contextEdge.to,
      variableName,
      cellNode: variableEdge.to,
      cellType: nodeType(variableEdge.to),
      cellName: nodeName(variableEdge.to),
      evidence: [
        `closure:${closureName || "<anonymous>"}`,
        `internal-context:${contextEdge.to}`,
        `context-slot:${variableName}`,
        `cell:${nodeType(variableEdge.to)}:${nodeName(variableEdge.to)}`,
      ],
    });
  }

  if (candidates.length === 0) {
    return refusal(
      variableName,
      "node-proper-level5-v8-counter-closure-context-missing",
      `no V8 closure context edge named ${JSON.stringify(variableName)} was found`,
    );
  }
  if (candidates.length > 1) {
    return {
      kind: NODE_PROPER_LEVEL5_V8_CLOSURE_RECOVERY_KIND,
      accepted: false,
      variableName,
      candidates,
      refusals: [
        {
          code: "node-proper-level5-v8-counter-cell-ambiguous",
          message: `found ${candidates.length} V8 closure context cells named ${JSON.stringify(variableName)}`,
        },
      ],
    };
  }

  const [candidate] = candidates;
  if (candidate!.cellType !== "object" && candidate!.cellType !== "array") {
    return {
      kind: NODE_PROPER_LEVEL5_V8_CLOSURE_RECOVERY_KIND,
      accepted: false,
      variableName,
      candidates,
      refusals: [
        {
          code: "node-proper-level5-v8-counter-cell-primitive-smi-not-addressable",
          message:
            "the closure slot is not represented as an addressable heap object in the V8 heap graph; raw Smi slot decoding is required before materialization",
        },
      ],
    };
  }

  return {
    kind: NODE_PROPER_LEVEL5_V8_CLOSURE_RECOVERY_KIND,
    accepted: true,
    variableName,
    candidates,
    refusals: [],
  };
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

function readLittleEndian64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index--) {
    value = (value << 8n) | BigInt(bytes[offset + index] ?? 0);
  }
  return value;
}

function littleEndian64(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let remaining = value;
  for (let index = 0; index < out.length; index++) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function decodeV8PointerCompressedSmi32(word: bigint): number | undefined {
  if ((word & 0xffffffffn) !== 0n) {
    return undefined;
  }
  const raw = Number((word >> 32n) & 0xffffffffn);
  const signed = raw > 0x7fffffff ? raw - 0x100000000 : raw;
  return Math.abs(signed) <= 1_000_000 ? signed : undefined;
}

function decodeV8TaggedSmi64(word: bigint): number | undefined {
  if ((word & 1n) !== 0n) {
    return undefined;
  }
  const shifted = word >> 1n;
  if (shifted > 1_000_000n) {
    return undefined;
  }
  return Number(shifted);
}

// fallow-ignore-next-line complexity
function validateHeapSnapshot(snapshot: unknown): string | undefined {
  if (!snapshot || typeof snapshot !== "object") {
    return "heap snapshot is not an object";
  }
  const candidate = snapshot as V8HeapSnapshotLike;
  const meta = candidate.snapshot?.meta;
  if (!meta || !candidate.nodes || !candidate.edges || !candidate.strings) {
    return "heap snapshot is missing meta/nodes/edges/strings";
  }
  for (const field of ["type", "name", "edge_count"]) {
    if (!meta.node_fields?.includes(field)) {
      return `heap snapshot is missing node field ${field}`;
    }
  }
  for (const field of ["type", "name_or_index", "to_node"]) {
    if (!meta.edge_fields?.includes(field)) {
      return `heap snapshot is missing edge field ${field}`;
    }
  }
  return undefined;
}

function refusal(
  variableName: string,
  code: NodeProperLevel5V8ClosureRecoveryRefusalCode,
  message: string,
): NodeProperLevel5V8ClosureRecoveryResult {
  return {
    kind: NODE_PROPER_LEVEL5_V8_CLOSURE_RECOVERY_KIND,
    accepted: false,
    variableName,
    candidates: [],
    refusals: [{ code, message }],
  };
}
