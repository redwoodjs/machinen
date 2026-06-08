import type {
  MoveDescriptor,
  MovePidGraphNode,
  NativeProcessImageArchitecture,
  NativeProcessImageRefusal,
} from "@machinen/runtime";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export function attachNativeContinuation(descriptor: MoveDescriptor): MoveDescriptor {
  const refusals = nativeContinuationRefusals(descriptor);
  return {
    ...descriptor,
    nativeContinuation: {
      kind: "machinen.move.native-continuation",
      bundlePath: ".",
      activeSyscallPlan: "active-syscall-plan.json",
      state: refusals.length === 0 ? "planned" : "refused",
      refusals,
    },
  };
}

export function moveActiveSyscallPlan(descriptor: MoveDescriptor): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "machinen.move.active-syscall-plan",
    state: descriptor.nativeContinuation?.state ?? "refused",
    refusals: descriptor.nativeContinuation?.refusals ?? nativeContinuationRefusals(descriptor),
  };
}

export function writeNativeProcessImageScaffold(
  bundlePath: string,
  descriptor: MoveDescriptor,
): void {
  const node = descriptor.nodes[0];
  const sourceArch = moveSourceArch(descriptor);
  const targetArch = oppositeNativeArch(sourceArch);
  const refusal = nativeMoveRefusal(
    "target-semantic-continuation-missing",
    "move save has not translated the native continuation yet",
  );
  writeJsonFile(bundlePath, "native-process.json", {
    formatVersion: 1,
    kind: "machinen.native-process-image",
    capture: {
      method: "external-ptrace-procfs",
      sourceArch,
      pid: descriptor.rootPid,
      capturedAt: descriptor.scannedAt,
    },
    target: { mode: "native-cross-isa", arch: targetArch, abi: "linux-user" },
    process: {
      exe: moveProcessExe(node),
      argv: node?.argv.length ? node.argv : [moveProcessExe(node)],
      env: {},
      cwd: node?.cwd ?? "/",
    },
    refusals: nativeMoveRefusals([refusal]),
  });
  const mappings = nativeMoveMappings(descriptor, refusal);
  writeJsonFile(bundlePath, "native-mappings.json", mappings);
  writeJsonFile(
    bundlePath,
    "native-threads.json",
    nativeMoveThreads(descriptor, sourceArch, nativeMoveStackMappingId(mappings), refusal),
  );
  writeJsonFile(bundlePath, "native-resources.json", {
    formatVersion: 1,
    resources: descriptor.resourcePlan?.resources ?? [],
    refusals: nativeMoveRefusals(descriptor.resourcePlan?.refusals ?? [refusal]),
  });
  writeJsonFile(
    bundlePath,
    "native-translation.json",
    nativeMoveTranslation(sourceArch, targetArch, refusal),
  );
  writeFileSync(join(bundlePath, "native-memory.bin"), Buffer.alloc(0));
}

function nativeContinuationRefusals(descriptor: MoveDescriptor): NativeProcessImageRefusal[] {
  return descriptor.resourcePlan?.refusals.length
    ? descriptor.resourcePlan.refusals
    : [
        nativeMoveRefusal(
          "target-semantic-continuation-missing",
          "native move continuation is not translated yet",
        ),
      ];
}

function writeJsonFile(bundlePath: string, name: string, value: unknown): void {
  writeFileSync(join(bundlePath, name), `${JSON.stringify(value, null, 2)}\n`);
}

function nativeMoveMappings(
  descriptor: MoveDescriptor,
  refusal: NativeProcessImageRefusal,
): { formatVersion: 1; mappings: Record<string, unknown>[]; refusals: Record<string, unknown> } {
  const mappings = (descriptor.resourcePlan?.capture?.maps ?? [])
    .map((line, index) => nativeMoveMappingFromProcMap(line, index, refusal))
    .filter((mapping): mapping is Record<string, unknown> => mapping !== undefined);
  return {
    formatVersion: 1,
    mappings: mappings.length > 0 ? mappings : [nativePlaceholderStackMapping(refusal)],
    refusals: nativeMoveRefusals([refusal]),
  };
}

function nativeMoveStackMappingId(mappings: { mappings: Record<string, unknown>[] }): string {
  const stack = mappings.mappings.find((mapping) => mapping.kind === "stack");
  return typeof stack?.id === "string" ? stack.id : "mapping:move-placeholder-stack";
}

function nativePlaceholderStackMapping(
  refusal: NativeProcessImageRefusal,
): Record<string, unknown> {
  return {
    id: "mapping:move-placeholder-stack",
    kind: "stack",
    sourceStart: "0x0",
    sourceEnd: "0x1000",
    sizeBytes: 4096,
    permissions: { read: true, write: true, execute: false, private: true, shared: false },
    target: { materialization: "refuse", reason: "move native mapping capture pending" },
    refusal,
  };
}

function nativeMoveMappingFromProcMap(
  line: string,
  index: number,
  refusal: NativeProcessImageRefusal,
): Record<string, unknown> | undefined {
  const match =
    /^(?<start>[0-9a-f]+)-(?<end>[0-9a-f]+)\s+(?<perms>\S+)\s+(?<offset>[0-9a-f]+)\s+\S+\s+\S+\s*(?<path>.*)$/.exec(
      line,
    );
  if (!match?.groups) {
    return undefined;
  }
  const start = BigInt(`0x${match.groups.start}`);
  const end = BigInt(`0x${match.groups.end}`);
  const path = match.groups.path.trim();
  const perms = match.groups.perms;
  return {
    id: `mapping:move-${index}`,
    kind: nativeMoveMappingKind(path, perms),
    sourceStart: `0x${start.toString(16)}`,
    sourceEnd: `0x${end.toString(16)}`,
    sizeBytes: Number(end - start),
    permissions: {
      read: perms[0] === "r",
      write: perms[1] === "w",
      execute: perms[2] === "x",
      private: perms[3] === "p",
      shared: perms[3] === "s",
    },
    ...(path.startsWith("/")
      ? { file: { path, offset: Number.parseInt(match.groups.offset, 16) } }
      : {}),
    target: { materialization: "refuse", reason: "move native mapping translation pending" },
    refusal,
  };
}

function nativeMoveMappingKind(path: string, perms: string): string {
  if (path === "[heap]") {
    return "heap";
  }
  if (path === "[stack]") {
    return "stack";
  }
  if (path === "[vdso]") {
    return "vdso";
  }
  if (path === "[vvar]") {
    return "vvar";
  }
  if (path.startsWith("/")) {
    return perms[2] === "x" ? "text" : "file";
  }
  if (path.startsWith("[")) {
    return "special";
  }
  return "anonymous";
}

function nativeMoveThreads(
  descriptor: MoveDescriptor,
  sourceArch: NativeProcessImageArchitecture,
  stackMapping: string,
  refusal: NativeProcessImageRefusal,
): Record<string, unknown> {
  return {
    formatVersion: 1,
    threads: [nativeMoveThread(descriptor, sourceArch, stackMapping, refusal)],
    refusals: nativeMoveRefusals([refusal]),
  };
}

function nativeMoveThread(
  descriptor: MoveDescriptor,
  sourceArch: NativeProcessImageArchitecture,
  stackMapping: string,
  refusal: NativeProcessImageRefusal,
): Record<string, unknown> {
  return {
    id: "thread:main",
    state: "stopped",
    stopReason:
      descriptor.resourcePlan?.capture?.freeze?.state === "ptrace-attached"
        ? "ptrace-stop"
        : "group-stop",
    stackMapping,
    sourceRegisters: descriptor.resourcePlan?.capture?.registers ?? nativeMoveRegisters(sourceArch),
    syscall: { state: "outside-syscall" },
    signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: "disabled" } },
    tls: { threadPointer: "0x0", rseq: { state: "absent" } },
    simdFpu: { state: "not-captured", reason: "move native capture pending" },
    refusal,
  };
}

function nativeMoveRegisters(sourceArch: NativeProcessImageArchitecture): Record<string, unknown> {
  if (sourceArch === "arm64") {
    return { arch: "arm64", pc: "0x0", sp: "0x0", pstate: "0x0", x: Array(31).fill("0x0") };
  }
  return {
    arch: "amd64",
    rip: "0x0",
    rsp: "0x0",
    rbp: "0x0",
    rax: "0x0",
    rbx: "0x0",
    rcx: "0x0",
    rdx: "0x0",
    rsi: "0x0",
    rdi: "0x0",
    r8: "0x0",
    r9: "0x0",
    r10: "0x0",
    r11: "0x0",
    r12: "0x0",
    r13: "0x0",
    r14: "0x0",
    r15: "0x0",
    rflags: "0x0",
    fsBase: "0x0",
    gsBase: "0x0",
  };
}

function nativeMoveTranslation(
  sourceArch: NativeProcessImageArchitecture,
  targetArch: NativeProcessImageArchitecture,
  refusal: NativeProcessImageRefusal,
): Record<string, unknown> {
  return {
    formatVersion: 1,
    mode: "native-cross-isa",
    sourceArch,
    targetArch,
    codeLocations: [],
    threads: [{ sourceThreadId: "thread:main", state: "refused", refusal }],
    memoryRelocations: [],
    refusals: nativeMoveRefusals([refusal]),
  };
}

function nativeMoveRefusals(refusals: NativeProcessImageRefusal[]): Record<string, unknown> {
  return { vocabularyVersion: 1, refusals };
}

function nativeMoveRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
): NativeProcessImageRefusal {
  return { code, message, detail: { boundary: "machinen-move-native-continuation" } };
}

function moveSourceArch(descriptor: MoveDescriptor): NativeProcessImageArchitecture {
  return descriptor.resourcePlan?.sourceArch ?? "arm64";
}

function oppositeNativeArch(
  sourceArch: NativeProcessImageArchitecture,
): NativeProcessImageArchitecture {
  return sourceArch === "arm64" ? "amd64" : "arm64";
}

function moveProcessExe(node: MovePidGraphNode | undefined): string {
  if (node?.exe?.startsWith("/")) {
    return node.exe;
  }
  const argv0 = node?.argv[0];
  if (argv0?.startsWith("/")) {
    return argv0;
  }
  return `/usr/bin/${node?.command ?? "unknown"}`;
}
