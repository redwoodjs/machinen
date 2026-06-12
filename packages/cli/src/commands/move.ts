import {
  attach,
  loadMoveDescriptor,
  MOVE_DESCRIPTOR_FORMAT_VERSION,
  MOVE_REFUSAL_CODE,
  validateNativeProcessImageBundle,
  type MoveDescriptor,
  type MovePidGraph,
  type MovePidGraphNode,
  type MoveRefusalEvidence,
  type NativeProcessImageRefusal,
  type VmHandle,
} from "@machinen/runtime";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { consumeJsonFlag } from "../args.ts";
import { readMoveBusyboxNcState } from "../move-busybox-nc-envelope.ts";
import { readMoveChecksumStateInVm } from "../move-checksum-envelope.ts";
import { readMoveDuStateInVm } from "../move-du-envelope.ts";
import { readMoveFindPredicateStateInVm } from "../move-find-predicate-envelope.ts";
import { readMoveZipCreateStateInVm } from "../move-archive-envelope.ts";
import {
  readMoveBase64StateInVm,
  readMoveGunzipStateInVm,
  readMoveGzipStateInVm,
  readMoveXzStateInVm,
  readMoveZstdStateInVm,
} from "../move-encoder-envelope.ts";
import {
  readMoveExecutableIdentityInVm,
  validateMoveLoadTargetInVm,
  type MoveLoadTargetValidation,
} from "../move-executable-identity.ts";
import { seedGenericMigrationCaptureEvidence } from "../move-generic-migration-wave2.ts";
import { readMoveGenericResourceGraphStateInVm as readGenericGraphState } from "../move-generic-resource-graph.ts";
import {
  attachNativeContinuation,
  moveActiveSyscallPlan,
  writeNativeProcessImageScaffold,
} from "../move-native-bundle.ts";
import {
  readMoveChmodStateInVm,
  readMoveChownStateInVm,
  readMoveLinkStateInVm,
  readMoveMkdirParentsStateInVm,
  readMoveMkdirStateInVm,
  readMoveTouchStateInVm,
} from "../move-filesystem-mutation-envelope.ts";
import { readMoveInstallStateInVm } from "../move-install-envelope.ts";
import { readMoveLsLongStateInVm, readMoveLsStateInVm } from "../move-ls-envelope.ts";
import { readMoveMaxdepthFindStateInVm } from "../move-maxdepth-find-envelope.ts";
import { readMoveReadlinkStateInVm } from "../move-readlink-envelope.ts";
import * as staticServers from "../move-nginx-envelope.ts";
import { readMoveRedisIdleStateInVm as readRedisIdle } from "../move-redis-envelope.ts";
import { readMoveRealpathStateInVm } from "../move-realpath-envelope.ts";
import { readMovePostgresClusterStateInVm } from "../move-postgres-envelope.ts";
import { readMoveRecursiveGrepStateInVm } from "../move-recursive-grep-envelope.ts";
import { readMoveRmdirStateInVm } from "../move-rmdir-envelope.ts";
import * as rsyncEnvelope from "../move-rsync-envelope.ts";
import { readMoveSocatFileResponderStateInVm as readSocatFileResponder } from "../move-socat-envelope.ts";
import { readMoveRmStateInVm } from "../move-rm-envelope.ts";
import { readMoveStatStateInVm } from "../move-stat-envelope.ts";
import { readMoveSymlinkStateInVm } from "../move-symlink-envelope.ts";
import { readMoveTreeStateInVm } from "../move-tree-envelope.ts";
import {
  readMoveAwkFieldStateInVm,
  readMoveCommStateInVm,
  readMoveCutStateInVm,
  readMoveHeadStateInVm,
  readMoveJoinStateInVm,
  readMovePasteStateInVm,
  readMoveSedStateInVm,
  readMoveTailLinesStateInVm,
  readMoveUniqStateInVm,
} from "../move-file-utility-capture.ts";
import { buildMoveResourcePlan, parseGuestMoveResourceScan } from "../move-resource-plan.ts";
import { runMoveTargetDirectLoaderInVm, type MoveLoadDirectLoader } from "../move-rendezvous.ts";
import {
  readMoveBusyboxHttpState,
  readMoveCpState,
  readMoveDdState,
  readMoveEnvStateInVm,
  readMoveFindStateInVm,
  readMoveGoStaticHttpState,
  readMoveGrepState,
  readMoveLessState,
  readMoveMvStateInVm,
  readMoveNodeStaticHttpStateInVm,
  readMovePingStateInVm,
  readMovePythonStaticRouteStateInVm,
  readMoveReaderStateInVm,
  readMoveRustStaticHttpState,
  readMoveSha256StateInVm,
  readMoveShellState,
  readMoveSortStateInVm,
  readMoveSleepStateInVm,
  readMoveTailGrepPipelineState,
  readMoveTarExtractStateInVm,
  readMoveTarState,
  readMoveTailState,
  readMoveTimeoutState,
  readMoveViState,
  readMoveWcStateInVm,
  readMoveWatchState,
} from "../move-envelope-capture.ts";
import { die, handleError } from "../errors.ts";
import type { Target } from "../parse-target.ts";
import { parseTargetFlags, resolveTarget } from "./target.ts";
type MoveHandler = (args: string[], json: boolean) => Promise<number> | number;
type MoveResourcePlan = NonNullable<MoveDescriptor["resourcePlan"]>;
const MOVE_HANDLERS = new Map<string, MoveHandler>([
  ["scan", cmdMoveScan],
  ["save", cmdMoveSave],
  ["load", cmdMoveLoad],
]);
export function cmdMove(args: string[]): Promise<number> | number {
  const { json, rest } = consumeJsonFlag(args);
  const handler = MOVE_HANDLERS.get(rest[0] ?? "") ?? die(moveUsage());
  return handler(rest.slice(1), json);
}
async function cmdMoveScan(args: string[], json: boolean): Promise<number> {
  const target = parseTargetFlags(args, "move scan");
  return withMoveVm(target, async (vm) => {
    const graph = await scanMovePidGraphInVm(vm);
    if (json) {
      emitJson({ schema_version: 1, ...graph });
    } else {
      process.stdout.write(
        `move scan: ${graph.nodes.length} in-VM processes; refused=${graph.refusedStateClasses.length}\n`,
      );
    }
    return graph.refusedStateClasses.length === 0 ? 0 : 1;
  });
}
async function cmdMoveSave(args: string[], json: boolean): Promise<number> {
  const options = parseMoveSaveArgs(args);
  return withMoveVm(options.target, async (vm) => {
    const descriptor = await createMoveDescriptorInVm(vm, options.pid);
    const result = writeMoveDescriptorResult(descriptor, options);
    reportMoveSaveResult(result, json);
    return moveAcceptedExitCode(result.accepted);
  });
}
type MoveSaveOptions = {
  target: Target;
  pid: number;
  outPath: string;
  issue: boolean;
  issueRepo?: string;
};
type MoveSaveResult = {
  accepted: boolean;
  descriptorPath: string;
  descriptor: MoveDescriptor;
  refusalCode?: typeof MOVE_REFUSAL_CODE;
  issueReport?: MoveIssueReport;
};
type MoveIssueReport = { title: string; body: string; repository: string };
function parseMoveSaveArgs(args: string[]): MoveSaveOptions {
  const { target, rest } = resolveTarget(args, "move save");
  if (rest.length < 2) {
    die(moveUsage());
  }
  const { issue, issueRepo } = parseMoveSaveFlags(rest.slice(2));
  return {
    target,
    pid: parsePositiveInteger(rest[0]!, "pid"),
    outPath: rest[1]!,
    issue,
    issueRepo,
  };
}
function parseMoveSaveFlags(args: string[]): { issue: boolean; issueRepo?: string } {
  let flags = newMoveSaveFlags();
  for (let index = 0; index < args.length; index += 1) {
    const parsed = parseMoveSaveFlag(args, index, flags);
    flags = parsed.flags;
    index = parsed.index;
  }
  return flags;
}
const newMoveSaveFlags = (): { issue: boolean; issueRepo?: string } => ({ issue: false });
function parseMoveSaveFlag(
  args: string[],
  index: number,
  flags: { issue: boolean; issueRepo?: string },
): { index: number; flags: { issue: boolean; issueRepo?: string } } {
  const arg = args[index]!;
  if (arg === "--issue") {
    return { index, flags: { ...flags, issue: true } };
  }
  if (arg !== "--issue-repo") {
    die(`unknown argument: ${arg}`);
  }
  return parseMoveSaveIssueRepoFlag(args, index, flags);
}
function parseMoveSaveIssueRepoFlag(
  args: string[],
  index: number,
  flags: { issue: boolean; issueRepo?: string },
): { index: number; flags: { issue: boolean; issueRepo?: string } } {
  const issueRepo = args[index + 1];
  if (!issueRepo) {
    die("move save --issue-repo requires <owner/repo>");
  }
  return { index: index + 1, flags: { ...flags, issueRepo } };
}
function writeMoveDescriptorResult(
  descriptor: MoveDescriptor,
  options: MoveSaveOptions,
): MoveSaveResult {
  const bundlePath = prepareMoveBundleDir(options.outPath);
  const bundleDescriptor = attachNativeContinuation(descriptor);
  writeNativeProcessImageScaffold(bundlePath, bundleDescriptor);
  const descriptorPath = join(bundlePath, "move.json");
  writeFileSync(descriptorPath, `${JSON.stringify(bundleDescriptor, null, 2)}\n`);
  writeFileSync(
    join(bundlePath, "active-syscall-plan.json"),
    `${JSON.stringify(moveActiveSyscallPlan(bundleDescriptor), null, 2)}\n`,
  );
  const accepted = moveSaveAccepted(bundleDescriptor);
  return {
    accepted,
    descriptorPath: bundlePath,
    descriptor: bundleDescriptor,
    refusalCode: accepted ? undefined : MOVE_REFUSAL_CODE,
    issueReport: moveIssueReport(descriptor, options),
  };
}
function prepareMoveBundleDir(outPath: string): string {
  const bundlePath = resolve(outPath);
  if (existsSync(bundlePath) && !statSync(bundlePath).isDirectory()) {
    die("move save output must be a directory");
  }
  mkdirSync(bundlePath, { recursive: true });
  return bundlePath;
}
function moveSaveAccepted(descriptor: MoveDescriptor): boolean {
  if (descriptor.nativeContinuation?.state === "refused") {
    return false;
  }
  if (descriptor.refusedStateClasses.length === 0) {
    return true;
  }
  return moveEnvelopeAllowsOpenFileRefusals(descriptor);
}
function moveEnvelopeAllowsOpenFileRefusals(descriptor: MoveDescriptor): boolean {
  const allowed = moveEnvelopeAllowedRefusalClasses(descriptor);
  if (!allowed) {
    return false;
  }
  return descriptor.refusedStateClasses.every((refusal) => allowed.has(refusal.stateClass));
}
// fallow-ignore-next-line complexity
function moveEnvelopeAllowedRefusalClasses(descriptor: MoveDescriptor): Set<string> | undefined {
  if (descriptor.resourcePlan?.capture?.tailState) {
    return new Set(["open-files", "threads"]);
  }
  if (
    descriptor.resourcePlan?.capture?.lessState ||
    descriptor.resourcePlan?.capture?.viState ||
    descriptor.resourcePlan?.capture?.watchState ||
    descriptor.resourcePlan?.capture?.shellState ||
    descriptor.resourcePlan?.capture?.httpState ||
    descriptor.resourcePlan?.capture?.busyboxHttpState ||
    descriptor.resourcePlan?.capture?.ncState ||
    descriptor.resourcePlan?.capture?.busyboxNcState ||
    descriptor.resourcePlan?.capture?.socatFileResponderState ||
    descriptor.resourcePlan?.capture?.redisIdleState ||
    descriptor.resourcePlan?.capture?.postgresClusterState ||
    descriptor.resourcePlan?.capture?.nginxStaticState ||
    descriptor.resourcePlan?.capture?.caddyStaticState ||
    descriptor.resourcePlan?.capture?.rubyHttpState ||
    descriptor.resourcePlan?.capture?.phpStaticState ||
    descriptor.resourcePlan?.capture?.rsyncDaemonState ||
    descriptor.resourcePlan?.capture?.envState ||
    descriptor.resourcePlan?.capture?.timeoutState ||
    descriptor.resourcePlan?.capture?.pythonStaticRouteState ||
    descriptor.resourcePlan?.capture?.goStaticHttpState ||
    descriptor.resourcePlan?.capture?.rustStaticHttpState ||
    descriptor.resourcePlan?.capture?.nodeStaticHttpState ||
    descriptor.resourcePlan?.capture?.tailGrepPipelineState
  ) {
    return new Set(["open-files", "sockets", "threads"]);
  }
  if (genericResourceGraphIsFullySupported(descriptor)) {
    return new Set(["open-files", "sockets", "threads"]);
  }
  if (
    descriptor.resourcePlan?.capture?.readerState ||
    descriptor.resourcePlan?.capture?.grepState ||
    descriptor.resourcePlan?.capture?.ddState ||
    descriptor.resourcePlan?.capture?.cpState ||
    descriptor.resourcePlan?.capture?.mvState ||
    descriptor.resourcePlan?.capture?.headState ||
    descriptor.resourcePlan?.capture?.tailLinesState ||
    descriptor.resourcePlan?.capture?.sedState ||
    descriptor.resourcePlan?.capture?.awkFieldState ||
    descriptor.resourcePlan?.capture?.cutState ||
    descriptor.resourcePlan?.capture?.pasteState ||
    descriptor.resourcePlan?.capture?.uniqState ||
    descriptor.resourcePlan?.capture?.commState ||
    descriptor.resourcePlan?.capture?.joinState ||
    descriptor.resourcePlan?.capture?.sortState ||
    descriptor.resourcePlan?.capture?.wcState ||
    descriptor.resourcePlan?.capture?.sha256State ||
    descriptor.resourcePlan?.capture?.checksumState ||
    descriptor.resourcePlan?.capture?.base64State ||
    descriptor.resourcePlan?.capture?.gzipState ||
    descriptor.resourcePlan?.capture?.gunzipState ||
    descriptor.resourcePlan?.capture?.xzState ||
    descriptor.resourcePlan?.capture?.zstdState ||
    descriptor.resourcePlan?.capture?.findState ||
    descriptor.resourcePlan?.capture?.tarState ||
    descriptor.resourcePlan?.capture?.tarExtractState ||
    descriptor.resourcePlan?.capture?.zipCreateState ||
    descriptor.resourcePlan?.capture?.mkdirState ||
    descriptor.resourcePlan?.capture?.mkdirParentsState ||
    descriptor.resourcePlan?.capture?.touchState ||
    descriptor.resourcePlan?.capture?.chmodState ||
    descriptor.resourcePlan?.capture?.chownState ||
    descriptor.resourcePlan?.capture?.linkState ||
    descriptor.resourcePlan?.capture?.symlinkState ||
    descriptor.resourcePlan?.capture?.rmState ||
    descriptor.resourcePlan?.capture?.rmdirState ||
    descriptor.resourcePlan?.capture?.installState ||
    descriptor.resourcePlan?.capture?.lsState ||
    descriptor.resourcePlan?.capture?.lsLongState ||
    descriptor.resourcePlan?.capture?.duState ||
    descriptor.resourcePlan?.capture?.statState ||
    descriptor.resourcePlan?.capture?.readlinkState ||
    descriptor.resourcePlan?.capture?.realpathState ||
    descriptor.resourcePlan?.capture?.recursiveGrepState ||
    descriptor.resourcePlan?.capture?.maxdepthFindState ||
    descriptor.resourcePlan?.capture?.findPredicateState ||
    descriptor.resourcePlan?.capture?.treeState
  ) {
    return new Set(["open-files", "threads"]);
  }
  return undefined;
}
function genericResourceGraphIsFullySupported(descriptor: MoveDescriptor): boolean {
  const state = descriptor.resourcePlan?.capture?.genericResourceGraphState;
  return state !== undefined && state.refusalClasses.length === 0;
}
function genericResourceGraphHasRefusals(descriptor: MoveDescriptor): boolean {
  const state = descriptor.resourcePlan?.capture?.genericResourceGraphState;
  return state !== undefined && state.refusalClasses.length > 0;
}
function moveIssueReport(
  descriptor: MoveDescriptor,
  options: MoveSaveOptions,
): MoveIssueReport | undefined {
  if (!options.issue) {
    return undefined;
  }
  return buildMoveIssueReport(descriptor, options.issueRepo ?? "redwoodjs/machinen");
}
function moveAcceptedExitCode(accepted: boolean): 0 | 1 {
  return accepted ? 0 : 1;
}
function reportMoveSaveResult(result: MoveSaveResult, json: boolean): void {
  if (json) {
    emitJson({ schema_version: 1, ...result });
    return;
  }
  process.stdout.write(
    `${result.accepted ? "saved" : "refused"} move descriptor: ${result.descriptorPath}\n`,
  );
  printIssueReport(result);
}
function printIssueReport(result: MoveSaveResult): void {
  if (!result.issueReport) {
    return;
  }
  process.stdout.write(
    `issue report: ${result.issueReport.repository}\n${result.issueReport.body}\n`,
  );
}
async function cmdMoveLoad(args: string[], json: boolean): Promise<number> {
  const { target, rest } = resolveTarget(args, "move load");
  if (rest.length !== 1) {
    die(moveUsage());
  }
  return withMoveVm(target, async (vm) => {
    const bundlePath = resolve(rest[0]!);
    const descriptor = loadMoveDescriptor(moveLoadDescriptorPath(bundlePath));
    const targetValidation = await validateMoveLoadTargetInVm(
      vm,
      descriptor,
      moveLoadExecutablePath(descriptor),
    );
    const canStartLoader =
      targetValidation.state === "ready" && moveDescriptorContinuationPlanned(descriptor);
    const loader = canStartLoader ? await runMoveTargetDirectLoaderInVm(vm, descriptor) : undefined;
    const accepted = moveLoadAccepted(descriptor, bundlePath, targetValidation, loader);
    reportMoveLoadResult(descriptor, accepted, json, targetValidation, loader);
    return accepted ? 0 : 1;
  });
}
function moveLoadDescriptorPath(bundlePath: string): string {
  if (existsSync(bundlePath) && statSync(bundlePath).isDirectory()) {
    return join(bundlePath, "move.json");
  }
  return bundlePath;
}

function moveLoadAccepted(
  descriptor: MoveDescriptor,
  bundlePath: string,
  targetValidation: MoveLoadTargetValidation,
  loader: MoveLoadDirectLoader | undefined,
): boolean {
  return moveLoadGates(descriptor, bundlePath, targetValidation, loader).every(Boolean);
}

function moveLoadGates(
  descriptor: MoveDescriptor,
  bundlePath: string,
  targetValidation: MoveLoadTargetValidation,
  loader: MoveLoadDirectLoader | undefined,
): boolean[] {
  return [
    moveBundleValid(bundlePath),
    moveDescriptorContinuationPlanned(descriptor),
    targetValidation.state === "ready",
    loader?.state === "ready" || false,
  ];
}

function moveLoadExecutablePath(descriptor: MoveDescriptor): string {
  return savedExecutablePath(descriptor) ?? descriptorExecutablePath(descriptor) ?? "/usr/bin/ping";
}

function savedExecutablePath(descriptor: MoveDescriptor): string | undefined {
  return descriptor.resourcePlan?.capture?.executablePackage?.path;
}

function descriptorExecutablePath(descriptor: MoveDescriptor): string | undefined {
  return descriptor.nodes[0]?.exe;
}

function moveBundleValid(bundlePath: string): boolean {
  if (!existsSync(bundlePath)) {
    return false;
  }
  if (!statSync(bundlePath).isDirectory()) {
    return false;
  }
  validateNativeProcessImageBundle(bundlePath);
  return true;
}

// fallow-ignore-next-line complexity
function moveDescriptorContinuationPlanned(descriptor: MoveDescriptor): boolean {
  if (moveEnvelopeAllowsOpenFileRefusals(descriptor)) {
    return true;
  }
  if (genericResourceGraphHasRefusals(descriptor)) {
    return false;
  }
  if (descriptor.refusedStateClasses.every((refusal) => refusal.stateClass === "sockets")) {
    return true;
  }
  if (descriptor.refusedStateClasses.length !== 0) {
    return false;
  }
  return descriptor.nativeContinuation?.state !== "refused";
}

function reportMoveLoadResult(
  descriptor: MoveDescriptor,
  accepted: boolean,
  json: boolean,
  targetValidation: MoveLoadTargetValidation,
  loader: MoveLoadDirectLoader | undefined,
): void {
  if (json) {
    emitJson({
      schema_version: 1,
      accepted,
      descriptor,
      targetValidation,
      loader,
      rendezvous: loader,
    });
    return;
  }
  if (accepted) {
    process.stdout.write(`move load accepted descriptor for in-VM PID ${descriptor.rootPid}\n`);
    return;
  }
  process.stderr.write(
    `move load refused descriptor for in-VM PID ${descriptor.rootPid}: ${refusedStateClasses(descriptor)}\n`,
  );
}

function refusedStateClasses(descriptor: MoveDescriptor): string {
  return descriptor.refusedStateClasses.map((item) => item.stateClass).join(", ");
}

async function withMoveVm<T>(target: Target, run: (vm: VmHandle) => Promise<T> | T): Promise<T> {
  const vm = await attach(target).catch(handleError);
  try {
    return await run(vm);
  } finally {
    await vm.detach();
  }
}

async function createMoveDescriptorInVm(vm: VmHandle, pid: number): Promise<MoveDescriptor> {
  const nodes = await readMoveProcNodesInVm(vm, pid);
  const resourcePlan = await scanMoveResourcePlanInVm(vm, nodes[0]!);
  const pipelineTailResourcePlan = await scanMoveTailPipelineResourcePlanInVm(vm, nodes);
  const timeoutChildResourcePlan = await scanMoveTimeoutChildResourcePlanInVm(vm, nodes);
  await attachMoveSourceIdentity(
    vm,
    nodes[0]!,
    nodes,
    resourcePlan,
    pipelineTailResourcePlan,
    timeoutChildResourcePlan,
  );
  const graph = buildMovePidGraph(pid, nodes, resourcePlan);
  return {
    ...graph,
    kind: "machinen.move.descriptor",
    target: "cross-isa-target-native-pid-translation",
    productSurface: "machinen move",
    resourcePlan,
  };
}

async function attachMoveSourceIdentity(
  vm: VmHandle,
  node: MovePidGraphNode,
  nodes: MovePidGraphNode[],
  resourcePlan: MoveResourcePlan,
  pipelineTailResourcePlan: MoveResourcePlan | undefined,
  timeoutChildResourcePlan: MoveResourcePlan | undefined,
): Promise<void> {
  const executablePath =
    node.exe ?? (node.argv[0]?.startsWith("/") ? node.argv[0] : `/usr/bin/${node.command}`);
  const executablePackage = await readMoveExecutableIdentityInVm(vm, executablePath);
  await seedGenericMigrationCaptureEvidence(vm, node, resourcePlan, executablePackage);
  const genericState = await readGenericGraphState(
    vm,
    node,
    resourcePlan,
    executablePath,
    executablePackage,
  );
  resourcePlan.capture = {
    ...resourcePlan.capture,
    genericResourceGraphState: genericState,
    pingState: await readMovePingStateInVm(vm, resourcePlan),
    sleepState: await readMoveSleepStateInVm(vm, node),
    tailState: readMoveTailState(node, resourcePlan),
    lessState: readMoveLessState(node),
    viState: readMoveViState(node),
    readerState: await readMoveReaderStateInVm(vm, node, resourcePlan),
    grepState: readMoveGrepState(node, resourcePlan),
    watchState: readMoveWatchState(node),
    shellState: readMoveShellState(node),
    busyboxHttpState: readMoveBusyboxHttpState(node, resourcePlan),
    busyboxNcState: readMoveBusyboxNcState(node, resourcePlan),
    socatFileResponderState: await readSocatFileResponder(vm, node, nodes, resourcePlan),
    redisIdleState: await readRedisIdle(vm, node, resourcePlan),
    postgresClusterState: await readMovePostgresClusterStateInVm(vm, node, resourcePlan),
    nginxStaticState: await staticServers.readNginxStatic(vm, node, resourcePlan),
    caddyStaticState: await staticServers.readCaddyStatic(vm, node, resourcePlan),
    rubyHttpState: await staticServers.readRubyHttpState(vm, node, resourcePlan),
    phpStaticState: await staticServers.readPhpStaticState(vm, node, resourcePlan),
    rsyncDaemonState: await rsyncEnvelope.readRsyncDaemonState(vm, node, resourcePlan),
    envState: await readMoveEnvStateInVm(vm, node, resourcePlan),
    timeoutState: readMoveTimeoutState(node, nodes, timeoutChildResourcePlan),
    pythonStaticRouteState: await readMovePythonStaticRouteStateInVm(vm, node, resourcePlan),
    goStaticHttpState: readMoveGoStaticHttpState(node, resourcePlan),
    rustStaticHttpState: readMoveRustStaticHttpState(node, resourcePlan),
    tailGrepPipelineState: readMoveTailGrepPipelineState(nodes, pipelineTailResourcePlan),
    ddState: readMoveDdState(node, resourcePlan),
    cpState: readMoveCpState(node, resourcePlan),
    mvState: await readMoveMvStateInVm(vm, node),
    headState: await readMoveHeadStateInVm(vm, node, resourcePlan),
    tailLinesState: await readMoveTailLinesStateInVm(vm, node, resourcePlan),
    sedState: await readMoveSedStateInVm(vm, node, resourcePlan),
    awkFieldState: await readMoveAwkFieldStateInVm(vm, node, resourcePlan),
    cutState: await readMoveCutStateInVm(vm, node, resourcePlan),
    pasteState: await readMovePasteStateInVm(vm, node, resourcePlan),
    uniqState: await readMoveUniqStateInVm(vm, node, resourcePlan),
    commState: await readMoveCommStateInVm(vm, node, resourcePlan),
    joinState: await readMoveJoinStateInVm(vm, node, resourcePlan),
    sortState: await readMoveSortStateInVm(vm, node, resourcePlan),
    wcState: await readMoveWcStateInVm(vm, node, resourcePlan),
    sha256State: await readMoveSha256StateInVm(vm, node, resourcePlan),
    checksumState: await readMoveChecksumStateInVm(vm, node, resourcePlan),
    base64State: await readMoveBase64StateInVm(vm, node, resourcePlan),
    gzipState: await readMoveGzipStateInVm(vm, node, resourcePlan),
    gunzipState: await readMoveGunzipStateInVm(vm, node, resourcePlan),
    xzState: await readMoveXzStateInVm(vm, node, resourcePlan),
    zstdState: await readMoveZstdStateInVm(vm, node, resourcePlan),
    findState: await readMoveFindStateInVm(vm, node, resourcePlan),
    tarState: readMoveTarState(node),
    tarExtractState: await readMoveTarExtractStateInVm(vm, node),
    zipCreateState: await readMoveZipCreateStateInVm(vm, node),
    mkdirState: await readMoveMkdirStateInVm(vm, node),
    mkdirParentsState: await readMoveMkdirParentsStateInVm(vm, node),
    touchState: await readMoveTouchStateInVm(vm, node),
    chmodState: await readMoveChmodStateInVm(vm, node),
    chownState: await readMoveChownStateInVm(vm, node),
    linkState: await readMoveLinkStateInVm(vm, node),
    symlinkState: await readMoveSymlinkStateInVm(vm, node),
    rmState: await readMoveRmStateInVm(vm, node),
    rmdirState: await readMoveRmdirStateInVm(vm, node),
    installState: await readMoveInstallStateInVm(vm, node),
    lsState: await readMoveLsStateInVm(vm, node, resourcePlan),
    lsLongState: await readMoveLsLongStateInVm(vm, node, resourcePlan),
    duState: await readMoveDuStateInVm(vm, node, resourcePlan),
    statState: await readMoveStatStateInVm(vm, node, resourcePlan),
    readlinkState: await readMoveReadlinkStateInVm(vm, node, resourcePlan),
    realpathState: await readMoveRealpathStateInVm(vm, node, resourcePlan),
    recursiveGrepState: await readMoveRecursiveGrepStateInVm(vm, node, resourcePlan),
    maxdepthFindState: await readMoveMaxdepthFindStateInVm(vm, node, resourcePlan),
    findPredicateState: await readMoveFindPredicateStateInVm(vm, node, resourcePlan),
    treeState: await readMoveTreeStateInVm(vm, node, resourcePlan),
    nodeStaticHttpState: await readMoveNodeStaticHttpStateInVm(vm, node, resourcePlan),
  };
}

async function scanMovePidGraphInVm(vm: VmHandle, rootPid?: number): Promise<MovePidGraph> {
  const nodes = await readMoveProcNodesInVm(vm, rootPid);
  return buildMovePidGraph(rootPid, nodes);
}

async function scanMoveTimeoutChildResourcePlanInVm(
  vm: VmHandle,
  nodes: MovePidGraphNode[],
): Promise<MoveResourcePlan | undefined> {
  const root = nodes[0];
  const child =
    root?.command === "timeout" ? nodes.find((item) => item.ppid === root.pid) : undefined;
  return child ? scanMoveResourcePlanInVm(vm, child) : undefined;
}

async function scanMoveTailPipelineResourcePlanInVm(
  vm: VmHandle,
  nodes: MovePidGraphNode[],
): Promise<MoveResourcePlan | undefined> {
  const tailNode = nodes.find(
    (item) => basename(item.exe ?? item.argv[0] ?? item.command) === "tail",
  );
  return tailNode ? scanMoveResourcePlanInVm(vm, tailNode) : undefined;
}

// fallow-ignore-next-line code-duplication
function buildMovePidGraph(
  rootPid: number | undefined,
  nodes: MovePidGraphNode[],
  resourcePlan?: MoveResourcePlan,
): MovePidGraph {
  const pidSet = new Set(nodes.map((node) => node.pid));
  const edges = nodes
    .filter((node) => node.ppid !== undefined && pidSet.has(node.ppid))
    .map((node) => ({ fromPid: node.ppid!, toPid: node.pid, kind: "parent-child" as const }));
  return {
    formatVersion: MOVE_DESCRIPTOR_FORMAT_VERSION,
    kind: "machinen.move.pid-graph",
    rootPid,
    scannedAt: new Date().toISOString(),
    nodes,
    edges,
    translatedStateClasses: translatedStateClasses(resourcePlan),
    refusedStateClasses: buildRefusals(rootPid, nodes, resourcePlan),
  };
}

async function readMoveProcNodesInVm(vm: VmHandle, rootPid?: number): Promise<MovePidGraphNode[]> {
  const result = await vm.execRaw(guestProcScanCommand(rootPid), { execTimeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    die(`move proc scan failed inside VM: ${moveProcScanError(result)}`);
  }
  return parseGuestProcRows(result.stdout, rootPid);
}

function moveProcScanError(result: { stderr: string; stdout: string; exitCode: number }): string {
  return result.stderr || result.stdout || String(result.exitCode);
}

async function scanMoveResourcePlanInVm(
  vm: VmHandle,
  node: MovePidGraphNode,
): Promise<MoveResourcePlan> {
  const result = await vm.execRaw(guestMoveResourceScanCommand(node.pid), {
    execTimeoutMs: 30_000,
  });
  if (result.exitCode !== 0) {
    die(`move resource scan failed inside VM: ${moveProcScanError(result)}`);
  }
  return buildMoveResourcePlan(node, parseGuestMoveResourceScan(result.stdout));
}

function guestMoveResourceScanCommand(pid: number): string {
  return `pid=${pid}
if [ -x /sbin/machinen-move-capture ]; then
  exec /sbin/machinen-move-capture "$pid" --timeout-ms 10000
fi
printf 'UNAME\t%s\n' "$(uname -m 2>/dev/null || true)"
status="/proc/$pid/status"
uid=""
gid=""
if [ -r "$status" ]; then
  while IFS= read -r line; do
    case "$line" in
      Uid:*) set -- $line; uid="$2" ;;
      Gid:*) set -- $line; gid="$2" ;;
    esac
  done < "$status"
fi
printf 'STATUS\t%s\t%s\n' "$uid" "$gid"
if [ -r "/proc/$pid/wchan" ]; then printf 'WCHAN\t%s\n' "$(cat "/proc/$pid/wchan" 2>/dev/null || true)"; fi
if [ -r "/proc/$pid/syscall" ]; then printf 'SYSCALL\t%s\n' "$(cat "/proc/$pid/syscall" 2>/dev/null || true)"; fi
if [ -r /proc/sys/net/ipv4/ping_group_range ]; then
  set -- $(cat /proc/sys/net/ipv4/ping_group_range 2>/dev/null || true)
  printf 'PING_RANGE\t%s\t%s\n' "$1" "$2"
fi
for f in /proc/$pid/fd/*; do
  [ -e "$f" ] || continue
  fd="\${f##*/}"
  target=$(readlink "$f" 2>/dev/null || true)
  printf 'FD\t%s\t%s\n' "$fd" "$target"
  if [ -r "/proc/$pid/fdinfo/$fd" ]; then
    while IFS= read -r line; do
      case "$line" in
        pos:*|flags:*|eventfd-count:*|eventfd-semaphore:*|tfd:*) printf 'FDINFO\t%s\t%s\n' "$fd" "$line" ;;
      esac
    done < "/proc/$pid/fdinfo/$fd"
  fi
done
if [ -r /proc/net/icmp ]; then
  while IFS= read -r line; do printf 'NET_ICMP\t%s\n' "$line"; done < /proc/net/icmp
fi
if [ -r /proc/net/raw ]; then
  while IFS= read -r line; do printf 'NET_RAW\t%s\n' "$line"; done < /proc/net/raw
fi`;
}

function guestProcScanCommand(_rootPid?: number): string {
  const pidSelector = 'for d in /proc/[0-9]*; do scan_pid "${d##*/}"; done';
  return `scan_pid() {
  pid="$1"
  d="/proc/$pid"
  [ -d "$d" ] || return 0
  stat=$(cat "$d/stat" 2>/dev/null || true)
  cmd=$(tr '\\000' '\\037' <"$d/cmdline" 2>/dev/null || true)
  cwd=$(readlink "$d/cwd" 2>/dev/null || true)
  exe=$(readlink "$d/exe" 2>/dev/null || true)
  printf '%s	%s	%s	%s	%s\n' "$pid" "$stat" "$cmd" "$cwd" "$exe"
}
${pidSelector}`;
}

function parseGuestProcRows(stdout: string, rootPid?: number): MovePidGraphNode[] {
  const allNodes = stdout
    .split("\n")
    .filter(Boolean)
    .slice(0, 250)
    .map(parseGuestProcRow)
    .filter((node): node is MovePidGraphNode => node !== undefined)
    .sort((left, right) => left.pid - right.pid);
  const nodes = rootPid === undefined ? allNodes : moveDescendantProcNodes(allNodes, rootPid);
  if (rootPid !== undefined && nodes.length === 0) {
    die(`in-VM pid ${rootPid} was not found`);
  }
  return nodes;
}

// fallow-ignore-next-line complexity
function moveDescendantProcNodes(nodes: MovePidGraphNode[], rootPid: number): MovePidGraphNode[] {
  const selected = new Set<number>([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.ppid !== undefined && selected.has(node.ppid) && !selected.has(node.pid)) {
        selected.add(node.pid);
        changed = true;
      }
    }
  }
  return nodes.filter((node) => selected.has(node.pid));
}

// fallow-ignore-next-line complexity
function parseGuestProcRow(row: string): MovePidGraphNode | undefined {
  const [pidText, stat = "", cmdline = "", cwd = "", exe = ""] = row.split("\t");
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  const argv = cmdline.split("\x1f").filter(Boolean);
  const command = moveProcCommand(argv, stat, pid);
  return {
    pid,
    ppid: parsePpid(stat),
    command,
    argv,
    cwd: cwd || undefined,
    exe: exe || undefined,
  };
}

function moveProcCommand(argv: string[], stat: string, pid: number): string {
  if (argv[0]) {
    return basename(argv[0]);
  }
  return parseStatCommand(stat) ?? `pid-${pid}`;
}

function translatedStateClasses(
  resourcePlan?: MoveResourcePlan,
): MovePidGraph["translatedStateClasses"] {
  const base: MovePidGraph["translatedStateClasses"] = ["process-identity", "argv-env-cwd"];
  if (resourcePlan && resourcePlan.refusals.length === 0) {
    return [...base, "open-files", "sockets"];
  }
  return base;
}

function buildRefusals(
  rootPid: number | undefined,
  nodes: MovePidGraphNode[],
  resourcePlan?: MoveResourcePlan,
): MoveRefusalEvidence[] {
  if (rootPid === undefined || !resourcePlan) {
    return genericMoveRefusals(rootPid, nodes);
  }
  return resourcePlanRefusals(rootPid, resourcePlan);
}

function genericMoveRefusals(
  rootPid: number | undefined,
  nodes: MovePidGraphNode[],
): MoveRefusalEvidence[] {
  return [
    {
      stateClass: "open-files",
      reason: "open file descriptor identity is not translated by this descriptor yet",
      evidence:
        rootPid === undefined ? "scan-only-no-root-pid" : `pid:${rootPid}:fd-audit-required`,
      nextAction: "add a move-owned fd detector and target-native file/socket reconstruction proof",
    },
    {
      stateClass: "sockets",
      reason:
        "kernel socket identity is not preserved across ISA and must be reconstructed or refused",
      evidence: `nodes:${nodes.length}:socket-audit-required`,
      nextAction: "attach socket-family evidence and a target-native reconstruction verifier",
    },
  ];
}

function resourcePlanRefusals(
  rootPid: number,
  resourcePlan: MoveResourcePlan,
): MoveRefusalEvidence[] {
  const refusals = [
    openFileResourceRefusal(resourcePlan),
    socketResourceRefusal(resourcePlan),
    threadResourceRefusal(resourcePlan),
  ].filter((refusal): refusal is MoveRefusalEvidence => refusal !== undefined);
  if (resourcePlan.refusals.length > 0 && refusals.length === 0) {
    return genericMoveRefusals(rootPid, []);
  }
  return refusals;
}

function openFileResourceRefusal(resourcePlan: MoveResourcePlan): MoveRefusalEvidence | undefined {
  if (!resourcePlan.refusals.some(isOpenFileMoveRefusal)) {
    return undefined;
  }
  return {
    stateClass: "open-files",
    reason: "one or more open file descriptors still lack a target-native recipe",
    evidence: JSON.stringify(moveRefusalEvidenceSummary(resourcePlan, "open-files")),
    nextAction:
      "model or broker every inherited fd, including stdin/PTY state, before target execution",
  };
}

function socketResourceRefusal(resourcePlan: MoveResourcePlan): MoveRefusalEvidence | undefined {
  if (!resourcePlan.refusals.some(isSocketMoveRefusal)) {
    return undefined;
  }
  return {
    stateClass: "sockets",
    reason: "one or more socket descriptors still lack proven target-native reconstruction",
    evidence: JSON.stringify(moveRefusalEvidenceSummary(resourcePlan, "sockets")),
    nextAction:
      "graduate the captured socket into a supported ping/raw-ICMP loopback descriptor or keep it refused",
  };
}

function threadResourceRefusal(resourcePlan: MoveResourcePlan): MoveRefusalEvidence | undefined {
  if (!resourcePlan.refusals.some(isThreadMoveRefusal)) {
    return undefined;
  }
  return {
    stateClass: "threads",
    reason: "the process was not captured at the supported single-thread sleep/timer boundary",
    evidence: JSON.stringify({ capture: resourcePlan.capture }),
    nextAction:
      "wait for the ping sleep/timer boundary and freeze the single thread before translation",
  };
}

function isOpenFileMoveRefusal(refusal: NativeProcessImageRefusal): boolean {
  return !isSocketMoveRefusal(refusal) && !isThreadMoveRefusal(refusal);
}

function isSocketMoveRefusal(refusal: NativeProcessImageRefusal): boolean {
  const kind = refusal.detail?.kind;
  return kind === "socket" || kind === "raw-socket";
}

function isThreadMoveRefusal(refusal: NativeProcessImageRefusal): boolean {
  return refusal.detail?.kind === "thread";
}

function moveRefusalEvidenceSummary(
  resourcePlan: MoveResourcePlan,
  stateClass: "open-files" | "sockets",
): Record<string, unknown> {
  const predicate = stateClass === "sockets" ? isSocketMoveRefusal : isOpenFileMoveRefusal;
  const refusals = resourcePlan.refusals.filter(predicate);
  return {
    resourceRefusals: refusals.map((refusal) => ({
      code: refusal.code,
      fd: refusal.detail?.fd,
      kind: refusal.detail?.kind,
      requiredModel: refusal.detail?.requiredModel,
    })),
    acceptedSubsets: resourcePlan.acceptedSubsets,
  };
}

function buildMoveIssueReport(
  descriptor: MoveDescriptor,
  repository = "redwoodjs/machinen",
): MoveIssueReport {
  const stateClasses = descriptor.refusedStateClasses.map((item) => item.stateClass).join(", ");
  const rootPid = descriptor.rootPid === undefined ? "unknown" : String(descriptor.rootPid);
  const stateLabel = stateClasses || "no refusals";
  return {
    repository,
    title: `move refused in-VM PID ${rootPid}: ${stateLabel}`,
    body: [
      "## Problem",
      "`machinen move` refused this in-VM PID graph because some state classes are not proven yet.",
      "",
      "## Redacted evidence",
      `- root pid: ${rootPid}`,
      `- process count: ${descriptor.nodes.length}`,
      `- refused classes: ${stateClasses || "none"}`,
      "",
      "## Next action",
      ...descriptor.refusedStateClasses.map((item) => `- ${item.stateClass}: ${item.nextAction}`),
    ].join("\n"),
  };
}

function parseStatCommand(stat: string): string | undefined {
  const match = stat.match(/^\d+\s+\((.*)\)\s+\S+/);
  return match?.[1];
}

function parsePpid(stat: string): number | undefined {
  const match = stat.match(/^\d+\s+\(.*\)\s+\S+\s+(\d+)/);
  if (!match) {
    return undefined;
  }
  const parsed = Number(match[1]);
  return Number.isInteger(parsed) ? parsed : undefined;
}

function moveUsage(): string {
  return "usage: machinen move scan <vm> [--json] | machinen move save <vm> <pid> <out-dir> [--issue] [--issue-repo <owner/repo>] [--json] | machinen move load <vm> <bundle-dir> [--json]";
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    die(`${flag} must be a positive integer`);
  }
  return parsed;
}

function emitJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
