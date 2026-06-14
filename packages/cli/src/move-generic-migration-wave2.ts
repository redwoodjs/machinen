import type { MoveDescriptor, MovePidGraphNode, VmHandle } from "@machinen/runtime";

import { readMoveNcState } from "./move-envelope-capture.ts";
import type { GenericPreflight } from "./move-generic-wave2-baseline.ts";
import { readMoveHttpStateInVm } from "./move-python-http-envelope.ts";

type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
type MoveCapture = NonNullable<MoveResourcePlan["capture"]>;
type GenericState = MoveCapture["genericResourceGraphState"];
type GenericRefusalClass = NonNullable<GenericState>["refusalClasses"][number];

export async function seedGenericMigrationCaptureEvidence(
  vm: VmHandle,
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  executablePackage: MoveCapture["executablePackage"],
): Promise<void> {
  Object.assign((resourcePlan.capture ??= {}), {
    sourceVm: { pid: vm.pid, name: vm.name },
    executablePackage,
    httpState: await readMoveHttpStateInVm(vm, node, resourcePlan),
    ncState: readMoveNcState(node, resourcePlan),
  });
}

export function genericMigrationWave2(
  node: MovePidGraphNode,
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
  refusals: GenericRefusalClass[],
): NonNullable<GenericState>["migration"] {
  if (refusals.length > 0 || preflight.root !== "/") {
    return undefined;
  }
  const directory = pythonHttpDirectoryArg(node.argv);
  if (
    directory &&
    hasDirectoryIdentity(resourcePlan, preflight, directory) &&
    (listenerPort(preflight) !== undefined || bespokeIdleListenerPort(resourcePlan) !== undefined)
  ) {
    return {
      mode: "generic-primary",
      sourceProofName: "python-http-directory",
      genericProofName: "generic-static-http-daemon",
      fallbackPolicy:
        "bespoke python-http-directory loader remains available for out-of-contract shapes",
      boundary:
        "exact directory HTTP shape with stable cwd/data-dir identity, idle loopback listener, and no active clients",
      productPath: exactLiveProductPath(
        "python-http-directory",
        "generic-static-http-daemon",
        "exact-live-resource-graph",
      ),
    };
  }
  if (
    looksLikeNcListener(node.argv) &&
    (listenerPort(preflight) !== undefined || bespokeIdleListenerPort(resourcePlan) !== undefined)
  ) {
    return {
      mode: "generic-primary",
      sourceProofName: "nc-listener",
      genericProofName: "generic-interpreted-server",
      fallbackPolicy: "bespoke nc-listener loader remains available for out-of-contract shapes",
      boundary: "exact idle loopback nc listener shape with no active clients",
      productPath: exactLiveProductPath(
        "nc-listener",
        "generic-interpreted-server",
        "exact-live-resource-graph",
      ),
    };
  }
  return undefined;
}

function exactLiveProductPath(
  sourceProofName: string,
  genericProofName: string,
  observedGraph: "exact-single-process-service" | "exact-live-resource-graph",
): NonNullable<NonNullable<GenericState>["migration"]>["productPath"] {
  return {
    kind: "exact-live-capture",
    markerProofName: sourceProofName,
    supportProofName: genericProofName,
    refusalProofNames: [`${sourceProofName}-refusal-boundary`],
    observedGraph,
  };
}

function hasDirectoryIdentity(
  resourcePlan: MoveResourcePlan,
  preflight: GenericPreflight,
  path: string,
): boolean {
  return (
    preflight.dataDirs.some((dir) => dir.path === path) ||
    (resourcePlan.capture?.httpState?.directory === path &&
      resourcePlan.capture.httpState.directoryIdentity !== undefined)
  );
}

function listenerPort(preflight: GenericPreflight): number | undefined {
  return preflight.tcp.find((tcp) => tcp.state === "0A" && tcp.localHost === "127.0.0.1")
    ?.localPort;
}

export function bespokeIdleListenerPort(
  resourcePlan: MoveResourcePlan | undefined,
): number | undefined {
  const httpState = resourcePlan?.capture?.httpState;
  if (
    httpState?.bindAddress === "127.0.0.1" &&
    httpState.listenerState === "idle-single-listener"
  ) {
    return httpState.port;
  }
  return resourcePlan?.capture?.ncState?.port;
}

function pythonHttpDirectoryArg(argv: string[]): string | undefined {
  if (!looksLikePythonHttpServer(argv)) {
    return undefined;
  }
  const index = argv.indexOf("--directory");
  const path = index >= 0 ? argv[index + 1] : undefined;
  return path?.startsWith("/") ? path : undefined;
}

function looksLikeNcListener(argv: string[]): boolean {
  return argv.length === 3 && argv[1] === "-l" && /^[0-9]+$/.test(argv[2] ?? "");
}

export function looksLikePythonHttpServer(argv: string[]): boolean {
  const moduleIndex = argv.indexOf("-m");
  return moduleIndex >= 0 && argv[moduleIndex + 1] === "http.server";
}
