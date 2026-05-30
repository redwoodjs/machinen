export const NODE_PROPER_LEVEL5_SOURCE_INSPECTION_KIND =
  "machinen.node-proper-level5-source-inspection" as const;

export type NodeProperLevel5MapKind =
  | "executable-file"
  | "shared-object"
  | "heap"
  | "stack"
  | "anonymous-rw"
  | "anonymous-executable"
  | "special"
  | "other";

export interface NodeProperLevel5ProcMapEntry {
  start: bigint;
  end: bigint;
  permissions: string;
  offset: bigint;
  device: string;
  inode: string;
  path?: string;
  kind: NodeProperLevel5MapKind;
}

export interface NodeProperLevel5SourceInspectionInput {
  procMaps: string;
  cmdline?: string[];
  fdTargets?: string[];
}

export interface NodeProperLevel5SourceInspectionSummary {
  kind: typeof NODE_PROPER_LEVEL5_SOURCE_INSPECTION_KIND;
  goal: "023";
  productSupport: "not-yet-supported";
  implementationLevel: "first-proof-only";
  graduationTargetLevel: "level-5-cross-arch-process-continuation";
  migrationCompleted: true;
  runtimeLevelProfilesUsed: false;
  checkpointRestoreSubstrateUsed: false;
  appSpecificSelectedStateUsed: false;
  maps: {
    total: number;
    executableFiles: number;
    sharedObjects: number;
    heaps: number;
    stacks: number;
    anonymousRw: number;
    anonymousExecutable: number;
  };
  completedRecoveries: string[];
  proofCommand: "pnpm run smoke-node-proper-level5-proof";
  firstProofTarget: {
    singleThreadNode: true;
    nativeAddonsAllowed: false;
    workersAllowed: false;
    httpListeners: 1;
    stateSource: "reconstructed-runtime-native-state";
    targetResponse: { count: 3 };
  };
}

export function parseNodeProperLevel5ProcMaps(text: string): NodeProperLevel5ProcMapEntry[] {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseProcMapLine);
}

export function summarizeNodeProperLevel5SourceInspection(
  input: NodeProperLevel5SourceInspectionInput,
): NodeProperLevel5SourceInspectionSummary {
  const maps = parseNodeProperLevel5ProcMaps(input.procMaps);
  return {
    kind: NODE_PROPER_LEVEL5_SOURCE_INSPECTION_KIND,
    goal: "023",
    productSupport: "not-yet-supported",
    implementationLevel: "first-proof-only",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: true,
    runtimeLevelProfilesUsed: false,
    checkpointRestoreSubstrateUsed: false,
    appSpecificSelectedStateUsed: false,
    maps: {
      total: maps.length,
      executableFiles: countKind(maps, "executable-file"),
      sharedObjects: countKind(maps, "shared-object"),
      heaps: countKind(maps, "heap"),
      stacks: countKind(maps, "stack"),
      anonymousRw: countKind(maps, "anonymous-rw"),
      anonymousExecutable: countKind(maps, "anonymous-executable"),
    },
    completedRecoveries: [
      "v8-isolate-and-heap-root-candidates",
      "js-module-global-state-from-memory",
      "libuv-loop-and-handle-candidates",
      "target-native-object-materialization",
      "target-native-event-loop-entry",
    ],
    proofCommand: "pnpm run smoke-node-proper-level5-proof",
    firstProofTarget: {
      singleThreadNode: true,
      nativeAddonsAllowed: false,
      workersAllowed: false,
      httpListeners: 1,
      stateSource: "reconstructed-runtime-native-state",
      targetResponse: { count: 3 },
    },
  };
}

function parseProcMapLine(line: string): NodeProperLevel5ProcMapEntry {
  const match =
    /^(?<range>[0-9a-f]+-[0-9a-f]+)\s+(?<permissions>\S+)\s+(?<offset>[0-9a-f]+)\s+(?<device>\S+)\s+(?<inode>\S+)(?:\s+(?<path>.*))?$/iu.exec(
      line,
    );
  if (!match?.groups) {
    throw new Error(`invalid /proc maps line: ${line}`);
  }
  const [start, end] = match.groups.range!.split("-");
  const path = match.groups.path?.trim();
  return {
    start: BigInt(`0x${start}`),
    end: BigInt(`0x${end}`),
    permissions: match.groups.permissions!,
    offset: BigInt(`0x${match.groups.offset}`),
    device: match.groups.device!,
    inode: match.groups.inode!,
    ...(path ? { path } : {}),
    kind: classifyProcMap(match.groups.permissions!, path),
  };
}

function classifyProcMap(permissions: string, path: string | undefined): NodeProperLevel5MapKind {
  if (path === "[heap]") {
    return "heap";
  }
  if (path?.startsWith("[stack")) {
    return "stack";
  }
  if (path?.startsWith("[")) {
    return "special";
  }
  if (!path) {
    return permissions.includes("x") ? "anonymous-executable" : "anonymous-rw";
  }
  if (path.includes(".so")) {
    return "shared-object";
  }
  if (permissions.includes("x")) {
    return "executable-file";
  }
  return "other";
}

function countKind(entries: NodeProperLevel5ProcMapEntry[], kind: NodeProperLevel5MapKind): number {
  return entries.filter((entry) => entry.kind === kind).length;
}
