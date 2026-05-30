export const NODE_LEVEL5_HTTP_PROFILE_FORMAT_VERSION = 1 as const;
export const NODE_LEVEL5_HTTP_PROFILE_NAME = "node-v8-libuv-single-thread-http-v1" as const;

export const nodeLevel5HttpProfileRefusalCodes = [
  "node-level5-http-arbitrary-v8-heap-native-stack-unsupported",
  "node-level5-http-native-addon-unsupported",
  "node-level5-http-worker-thread-unsupported",
  "node-level5-http-inspector-unsupported",
  "node-level5-http-active-request-unsupported",
  "node-level5-http-active-tcp-stream-unsupported",
  "node-level5-http-active-syscall-unsupported",
  "node-level5-http-unsupported-timer-async-handle",
  "node-level5-http-unsupported-module-runtime-state",
  "node-level5-http-target-native-node-missing",
  "node-level5-http-source-isa-emulation-forbidden",
  "node-level5-http-sidecar-output-forbidden",
  "node-level5-http-metadata-only-success-forbidden",
] as const;

export type NodeLevel5HttpProfileRefusalCode = (typeof nodeLevel5HttpProfileRefusalCodes)[number];

export interface NodeLevel5HttpProfileRefusal {
  code: NodeLevel5HttpProfileRefusalCode;
  unsafeNeighbor:
    | "arbitrary-v8-heap-native-stack"
    | "native-addon"
    | "worker-thread"
    | "inspector-debug"
    | "active-request"
    | "active-tcp-stream"
    | "active-syscall"
    | "unsupported-timer-async-handle"
    | "unsupported-module-runtime-state"
    | "missing-target-native-node"
    | "source-isa-emulation"
    | "sidecar-output"
    | "metadata-only-success";
  message: string;
  evidenceStatus: "refusal";
  productSupport: "unsupported";
  implementationLevel: "level-0-fail-closed-discovery";
  graduationTargetLevel: "level-5-cross-arch-process-continuation";
  migrationCompleted: false;
}

export interface NodeLevel5HttpProfileSelectedState {
  kind: "node-http-counter-selected-state-v1";
  route: "/";
  captureMethod: "http-root-json-next-count";
  observedNextCount: number;
  restoredInitialCount: number;
  expectedFirstTargetBody: string;
}

export interface NodeLevel5HttpProfileCaptureInput {
  sourceArch: "arm64" | "amd64" | string;
  nodeVersion: string;
  sourceCwd: string;
  argv: string[];
  guestPort: number;
  verifier: { kind: string; path: string; sha256: string; bytes: number };
  selectedState?: NodeLevel5HttpProfileSelectedState;
  eventLoopResources?: unknown;
  kernelResources?: unknown;
}

export interface NodeLevel5HttpProfileCapture {
  kind: "machinen.node-level5-runtime-profile";
  formatVersion: typeof NODE_LEVEL5_HTTP_PROFILE_FORMAT_VERSION;
  sourceGoal: "021" | "022";
  evidenceStatus: "proof";
  productSupport: "not-yet-supported";
  implementationLevel: "not-implemented";
  graduationTargetLevel: "level-5-cross-arch-process-continuation";
  migrationCompleted: false;
  runtimeFamily: "node";
  profile: typeof NODE_LEVEL5_HTTP_PROFILE_NAME;
  sourceArch: string;
  runtimeIdentity: {
    executable: "node";
    version: string;
    targetNativeRuntimeRequired: true;
  };
  processModel: {
    processCount: 1;
    threadModel: "single-thread-required";
    activeSyscallsAllowed: false;
    activeRequestsAllowed: false;
    activeTcpStreamsAllowed: false;
  };
  moduleIdentity: {
    sourceCwd: string;
    argv: string[];
    entrypoint: string | null;
    unsupportedModuleStateAllowed: false;
  };
  selectedV8State: {
    stateModel: "bounded-profile-roots-only";
    arbitraryHeapContinuationAllowed: false;
    arbitraryNativeStackContinuationAllowed: false;
  };
  libuv: {
    handleInventory: unknown | null;
    timersAsyncHandlesPolicy: "refuse-unless-modeled";
  };
  kernelResources: {
    inventory: unknown | null;
    httpListeners: Array<{
      protocol: "tcp";
      bindAddress: "127.0.0.1";
      port: number;
      level4Profile: "tcp-listener-v1-loopback-empty-accept-queue";
    }>;
  };
  verifier: NodeLevel5HttpProfileCaptureInput["verifier"];
  selectedState?: NodeLevel5HttpProfileSelectedState;
  gates: {
    sourceIsaEmulationAllowed: false;
    sidecarOutputAllowed: false;
    metadataOnlySuccessAllowed: false;
    targetNativeNodeRequired: true;
  };
  refusals: NodeLevel5HttpProfileRefusal[];
  summary: {
    profileReady: true;
    targetNativeContinuationRequired: true;
    productSupportBlockedUntilActualRuntimeStateContinuation: true;
    selectedStateReconstructionHarness: boolean;
    notProperLevel5Reason: "app-specific-selected-state-descriptor" | "no-selected-state";
  };
}

// fallow-ignore-next-line complexity
export function buildNodeLevel5HttpProfileCapture(
  input: NodeLevel5HttpProfileCaptureInput,
): NodeLevel5HttpProfileCapture {
  const selectedStateSupported = isSupportedNodeLevel5HttpSelectedState(input.selectedState);
  return {
    kind: "machinen.node-level5-runtime-profile",
    formatVersion: NODE_LEVEL5_HTTP_PROFILE_FORMAT_VERSION,
    sourceGoal: selectedStateSupported ? "022" : "021",
    evidenceStatus: "proof",
    productSupport: "not-yet-supported",
    implementationLevel: "not-implemented",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: false,
    runtimeFamily: "node",
    profile: NODE_LEVEL5_HTTP_PROFILE_NAME,
    sourceArch: input.sourceArch,
    runtimeIdentity: {
      executable: "node",
      version: input.nodeVersion,
      targetNativeRuntimeRequired: true,
    },
    processModel: {
      processCount: 1,
      threadModel: "single-thread-required",
      activeSyscallsAllowed: false,
      activeRequestsAllowed: false,
      activeTcpStreamsAllowed: false,
    },
    moduleIdentity: {
      sourceCwd: input.sourceCwd,
      argv: input.argv,
      entrypoint: inferNodeEntrypoint(input.argv),
      unsupportedModuleStateAllowed: false,
    },
    selectedV8State: {
      stateModel: "bounded-profile-roots-only",
      arbitraryHeapContinuationAllowed: false,
      arbitraryNativeStackContinuationAllowed: false,
    },
    libuv: {
      handleInventory: input.eventLoopResources ?? null,
      timersAsyncHandlesPolicy: "refuse-unless-modeled",
    },
    kernelResources: {
      inventory: input.kernelResources ?? null,
      httpListeners: [
        {
          protocol: "tcp",
          bindAddress: "127.0.0.1",
          port: input.guestPort,
          level4Profile: "tcp-listener-v1-loopback-empty-accept-queue",
        },
      ],
    },
    verifier: input.verifier,
    ...(input.selectedState ? { selectedState: input.selectedState } : {}),
    gates: {
      sourceIsaEmulationAllowed: false,
      sidecarOutputAllowed: false,
      metadataOnlySuccessAllowed: false,
      targetNativeNodeRequired: true,
    },
    refusals: nodeLevel5HttpProfileRefusalRows(),
    summary: {
      profileReady: true,
      targetNativeContinuationRequired: true,
      productSupportBlockedUntilActualRuntimeStateContinuation: true,
      selectedStateReconstructionHarness: selectedStateSupported,
      notProperLevel5Reason: selectedStateSupported
        ? "app-specific-selected-state-descriptor"
        : "no-selected-state",
    },
  };
}

export function isSupportedNodeLevel5HttpSelectedState(
  selectedState: NodeLevel5HttpProfileSelectedState | undefined,
): selectedState is NodeLevel5HttpProfileSelectedState {
  return (
    selectedState?.kind === "node-http-counter-selected-state-v1" &&
    selectedState.route === "/" &&
    selectedState.captureMethod === "http-root-json-next-count" &&
    Number.isSafeInteger(selectedState.observedNextCount) &&
    Number.isSafeInteger(selectedState.restoredInitialCount) &&
    selectedState.restoredInitialCount >= 0 &&
    selectedState.observedNextCount === selectedState.restoredInitialCount + 1 &&
    selectedState.expectedFirstTargetBody ===
      `${JSON.stringify({ count: selectedState.observedNextCount })}\n`
  );
}

export function nodeLevel5HttpProfileRefusalRows(): NodeLevel5HttpProfileRefusal[] {
  return nodeLevel5HttpProfileRefusalCodes.map((code) => ({
    code,
    unsafeNeighbor: nodeLevel5HttpProfileUnsafeNeighbor(code),
    message: nodeLevel5HttpProfileRefusalMessage(code),
    evidenceStatus: "refusal",
    productSupport: "unsupported",
    implementationLevel: "level-0-fail-closed-discovery",
    graduationTargetLevel: "level-5-cross-arch-process-continuation",
    migrationCompleted: false,
  }));
}

function inferNodeEntrypoint(argv: string[]): string | null {
  const script = argv.find((arg, index) => index > 0 && !arg.startsWith("-"));
  return script ?? null;
}

// fallow-ignore-next-line complexity
function nodeLevel5HttpProfileUnsafeNeighbor(
  code: NodeLevel5HttpProfileRefusalCode,
): NodeLevel5HttpProfileRefusal["unsafeNeighbor"] {
  switch (code) {
    case "node-level5-http-arbitrary-v8-heap-native-stack-unsupported":
      return "arbitrary-v8-heap-native-stack";
    case "node-level5-http-native-addon-unsupported":
      return "native-addon";
    case "node-level5-http-worker-thread-unsupported":
      return "worker-thread";
    case "node-level5-http-inspector-unsupported":
      return "inspector-debug";
    case "node-level5-http-active-request-unsupported":
      return "active-request";
    case "node-level5-http-active-tcp-stream-unsupported":
      return "active-tcp-stream";
    case "node-level5-http-active-syscall-unsupported":
      return "active-syscall";
    case "node-level5-http-unsupported-timer-async-handle":
      return "unsupported-timer-async-handle";
    case "node-level5-http-unsupported-module-runtime-state":
      return "unsupported-module-runtime-state";
    case "node-level5-http-target-native-node-missing":
      return "missing-target-native-node";
    case "node-level5-http-source-isa-emulation-forbidden":
      return "source-isa-emulation";
    case "node-level5-http-sidecar-output-forbidden":
      return "sidecar-output";
    case "node-level5-http-metadata-only-success-forbidden":
      return "metadata-only-success";
  }
}

// fallow-ignore-next-line complexity
function nodeLevel5HttpProfileRefusalMessage(code: NodeLevel5HttpProfileRefusalCode): string {
  switch (code) {
    case "node-level5-http-arbitrary-v8-heap-native-stack-unsupported":
      return "arbitrary V8 heap and native stack continuation is refused until modeled";
    case "node-level5-http-native-addon-unsupported":
      return "native addon state is architecture-specific and refused";
    case "node-level5-http-worker-thread-unsupported":
      return "Node worker threads are refused by the single-thread HTTP profile";
    case "node-level5-http-inspector-unsupported":
      return "inspector and debug state are refused";
    case "node-level5-http-active-request-unsupported":
      return "active HTTP requests at capture are refused";
    case "node-level5-http-active-tcp-stream-unsupported":
      return "active TCP streams and in-flight network I/O are refused";
    case "node-level5-http-active-syscall-unsupported":
      return "active syscalls and restart blocks are refused";
    case "node-level5-http-unsupported-timer-async-handle":
      return "timers and async handles are refused unless explicitly modeled";
    case "node-level5-http-unsupported-module-runtime-state":
      return "unsupported module or runtime state is refused";
    case "node-level5-http-target-native-node-missing":
      return "target-native Node must be available before restore can continue";
    case "node-level5-http-source-isa-emulation-forbidden":
      return "source ISA emulation is forbidden for Level 5 success";
    case "node-level5-http-sidecar-output-forbidden":
      return "sidecar output shortcuts are forbidden for Level 5 success";
    case "node-level5-http-metadata-only-success-forbidden":
      return "metadata-only success is forbidden for Level 5 success";
  }
}
