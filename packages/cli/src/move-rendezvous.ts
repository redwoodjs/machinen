import type { MoveDescriptor, NativeProcessImageRefusal, VmHandle } from "@machinen/runtime";
import { runMoveTargetZipCreateLoaderInVm } from "./move-archive-envelope.ts";
import {
  moveDescriptorHasCrossArchCliNextBinariesRoute,
  runMoveTargetCrossArchCliNextBinariesInVm,
} from "./move-cross-arch-cli-next-binaries.ts";
import { runMoveTargetBusyboxNcLoaderInVm } from "./move-busybox-nc-envelope.ts";
import { runMoveTargetChecksumLoaderInVm } from "./move-checksum-envelope.ts";
import * as fsMutationLoaders from "./move-filesystem-mutation-envelope.ts";
import { runMoveTargetDuLoaderInVm } from "./move-du-envelope.ts";
import { genericResourceGraphIsProductPrimary } from "./move-generic-resource-graph.ts";
import { runMoveTargetGenericResourceGraphLoaderInVm } from "./move-generic-resource-graph.ts";
import { runMoveTargetInstallLoaderInVm } from "./move-install-envelope.ts";
import { runMoveTargetLsLoaderInVm, runMoveTargetLsLongLoaderInVm } from "./move-ls-envelope.ts";
import { runMoveTargetReadlinkLoaderInVm } from "./move-readlink-envelope.ts";
import * as staticServers from "./move-nginx-envelope.ts";
import { runMoveTargetPostgresClusterLoaderInVm } from "./move-postgres-envelope.ts";
import { runMoveTargetRedisIdleLoaderInVm as runRedisIdle } from "./move-redis-envelope.ts";
import { runMoveTargetRealpathLoaderInVm } from "./move-realpath-envelope.ts";
import { runMoveTargetRecursiveGrepLoaderInVm } from "./move-recursive-grep-envelope.ts";
import { runMoveTargetRmdirLoaderInVm } from "./move-rmdir-envelope.ts";
import * as rsyncEnvelope from "./move-rsync-envelope.ts";
import { runMoveTargetStatLoaderInVm } from "./move-stat-envelope.ts";
import { runMoveTargetRmLoaderInVm } from "./move-rm-envelope.ts";
import { runMoveTargetSocatFileResponderLoaderInVm as runSocatFileResponder } from "./move-socat-envelope.ts";
import { runMoveTargetSymlinkLoaderInVm } from "./move-symlink-envelope.ts";
import { runMoveTargetTreeLoaderInVm } from "./move-tree-envelope.ts";
import {
  runMoveTargetBase64LoaderInVm,
  runMoveTargetGunzipLoaderInVm,
  runMoveTargetGzipLoaderInVm,
  runMoveTargetXzLoaderInVm,
  runMoveTargetZstdLoaderInVm,
} from "./move-encoder-envelope.ts";
import {
  moveBusyboxHttpLoaderCommand,
  moveCpLoaderCommand,
  moveDdLoaderCommand,
  moveFindLoaderCommand,
  moveGoStaticHttpLoaderCommand,
  moveGrepLoaderCommand,
  moveHttpLoaderCommand,
  moveMvLoaderCommand,
  moveNcLoaderCommand,
  movePythonStaticRouteLoaderCommand,
  moveReaderLoaderCommand,
  moveRustStaticHttpLoaderCommand,
  moveScriptPtyLoaderCommand,
  moveSha256LoaderCommand,
  moveShellLoaderCommand,
  moveSortLoaderCommand,
  moveTailGrepPipelineLoaderCommand,
  moveTailLoaderCommand,
  moveTarExtractLoaderCommand,
  moveTarLoaderCommand,
  moveTimeoutLoaderCommand,
  moveWatchLoaderCommand,
  moveWcLoaderCommand,
} from "./move-envelope-loader-commands.ts";
import {
  runMoveTargetAwkFieldLoaderInVm,
  runMoveTargetCommLoaderInVm,
  runMoveTargetCutLoaderInVm,
  runMoveTargetHeadLoaderInVm,
  runMoveTargetJoinLoaderInVm,
  runMoveTargetPasteLoaderInVm,
  runMoveTargetSedLoaderInVm,
  runMoveTargetTailLinesLoaderInVm,
  runMoveTargetUniqLoaderInVm,
} from "./move-file-utility-rendezvous.ts";
import { runMoveTargetFindPredicateLoaderInVm } from "./move-find-predicate-envelope.ts";
import { runMoveTargetMaxdepthFindLoaderInVm } from "./move-maxdepth-find-envelope.ts";
import { moveNodeStaticHttpLoaderCommand } from "./move-node-static-loader.ts";
import type { MoveLoadDirectLoader } from "./move-loader-types.ts";
import { parseGuestMoveResourceScan } from "./move-resource-plan.ts";
export type { MoveLoadDirectLoader } from "./move-loader-types.ts";
type Loader = (vm: VmHandle, descriptor: MoveDescriptor) => Promise<MoveLoadDirectLoader>;
type ParsedRendezvousOutput = { pid?: number; logPath?: string; captureRows: string[] };
export async function runMoveTargetDirectLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const argv = moveRendezvousArgv(descriptor, executable);
  if (!moveDescriptorHasProductContinuationRoute(descriptor)) {
    return moveContinuationOnlyRefused(executable, argv);
  }
  if (moveDescriptorHasCrossArchCliNextBinariesRoute(descriptor)) {
    return runMoveTargetCrossArchCliNextBinariesInVm(vm, descriptor);
  }
  const loader = moveTargetEnvelopeLoader(descriptor);
  if (loader) {
    return loader(vm, descriptor);
  }
  const command = moveRendezvousCommand(executable, argv.slice(1), descriptor);
  const result = await vm.execRaw(command, { execTimeoutMs: 30_000 });
  const parsed = parseRendezvousOutput(result.stdout);
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return loaderRefused(executable, argv, parsed, {
      code: "target-process-context-unsupported",
      message: "target ping direct loader failed before a capture was produced",
      detail: { exitCode: result.exitCode, stderr: result.stderr, stdout: result.stdout },
    });
  }
  const capture = parseGuestMoveResourceScan(parsed.captureRows.join("\n"));
  const patch = moveRendezvousPatchFromOutput(result);
  const refusals = [...moveRendezvousRefusals(capture), ...movePatchRefusals(patch)];
  if (refusals.length > 0 && parsed.pid) {
    await vm.execRaw(`kill -TERM ${parsed.pid} 2>/dev/null || true`, { execTimeoutMs: 5_000 });
  }
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-ping-direct-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    capture,
    patch,
    refusals,
  };
}

function moveDescriptorHasProductContinuationRoute(descriptor: MoveDescriptor): boolean {
  return moveDescriptorHasCrossArchCliNextBinariesRoute(descriptor);
}

function moveContinuationOnlyRefused(executable: string, argv: string[]): MoveLoadDirectLoader {
  return {
    state: "refused",
    strategy: "continuation-only-refusal",
    executable,
    argv,
    refusals: [
      {
        code: "target-semantic-continuation-missing",
        message:
          "machinen move requires modeled live-state continuation; target-native reexec, restart, and resource reconstruction are banned",
        detail: {
          boundary: "move-continuation-only",
          banned: ["target-native-reexec", "restart", "resource-reconstruction"],
        },
      },
    ],
  };
}
// fallow-ignore-next-line complexity
function moveTargetEnvelopeLoader(descriptor: MoveDescriptor): Loader | undefined {
  const capture = descriptor.resourcePlan?.capture;
  if (genericResourceGraphIsProductPrimary(capture?.genericResourceGraphState)) {
    return runMoveTargetGenericResourceGraphLoaderInVm;
  }
  const loaders: Array<[unknown, Loader]> = [
    [capture?.sleepState, runMoveTargetSleepLoaderInVm],
    [capture?.tailState, runMoveTargetTailLoaderInVm],
    [capture?.lessState, runMoveTargetLessLoaderInVm],
    [capture?.viState, runMoveTargetViLoaderInVm],
    [capture?.readerState, runMoveTargetReaderLoaderInVm],
    [capture?.grepState, runMoveTargetGrepLoaderInVm],
    [capture?.watchState, runMoveTargetWatchLoaderInVm],
    [capture?.shellState, runMoveTargetShellLoaderInVm],
    [capture?.httpState, runMoveTargetHttpLoaderInVm],
    [capture?.busyboxHttpState, runMoveTargetBusyboxHttpLoaderInVm],
    [capture?.ncState, runMoveTargetNcLoaderInVm],
    [capture?.busyboxNcState, runMoveTargetBusyboxNcLoaderInVm],
    [capture?.socatFileResponderState, runSocatFileResponder],
    [capture?.redisIdleState, runRedisIdle],
    [capture?.postgresClusterState, runMoveTargetPostgresClusterLoaderInVm],
    [capture?.nginxStaticState, staticServers.runNginxStatic],
    [capture?.caddyStaticState, staticServers.runCaddyStatic],
    [capture?.rubyHttpState, staticServers.runRubyHttp],
    [capture?.phpStaticState, staticServers.runPhpStatic],
    [capture?.rsyncDaemonState, rsyncEnvelope.runRsyncDaemon],
    [capture?.timeoutState, runMoveTargetTimeoutLoaderInVm],
    [capture?.pythonStaticRouteState, runMoveTargetPythonStaticRouteLoaderInVm],
    [capture?.goStaticHttpState, runMoveTargetGoStaticHttpLoaderInVm],
    [capture?.rustStaticHttpState, runMoveTargetRustStaticHttpLoaderInVm],
    [capture?.tailGrepPipelineState, runMoveTargetTailGrepPipelineLoaderInVm],
    [capture?.ddState, runMoveTargetDdLoaderInVm],
    [capture?.cpState, runMoveTargetCpLoaderInVm],
    [capture?.mvState, runMoveTargetMvLoaderInVm],
    [capture?.headState, runMoveTargetHeadLoaderInVm],
    [capture?.tailLinesState, runMoveTargetTailLinesLoaderInVm],
    [capture?.sedState, runMoveTargetSedLoaderInVm],
    [capture?.awkFieldState, runMoveTargetAwkFieldLoaderInVm],
    [capture?.cutState, runMoveTargetCutLoaderInVm],
    [capture?.pasteState, runMoveTargetPasteLoaderInVm],
    [capture?.uniqState, runMoveTargetUniqLoaderInVm],
    [capture?.commState, runMoveTargetCommLoaderInVm],
    [capture?.joinState, runMoveTargetJoinLoaderInVm],
    [capture?.sortState, runMoveTargetSortLoaderInVm],
    [capture?.wcState, runMoveTargetWcLoaderInVm],
    [capture?.sha256State, runMoveTargetSha256LoaderInVm],
    [capture?.checksumState, runMoveTargetChecksumLoaderInVm],
    [capture?.base64State, runMoveTargetBase64LoaderInVm],
    [capture?.gzipState, runMoveTargetGzipLoaderInVm],
    [capture?.gunzipState, runMoveTargetGunzipLoaderInVm],
    [capture?.xzState, runMoveTargetXzLoaderInVm],
    [capture?.zstdState, runMoveTargetZstdLoaderInVm],
    [capture?.findState, runMoveTargetFindLoaderInVm],
    [capture?.tarState, runMoveTargetTarLoaderInVm],
    [capture?.tarExtractState, runMoveTargetTarExtractLoaderInVm],
    [capture?.zipCreateState, runMoveTargetZipCreateLoaderInVm],
    [capture?.mkdirState, fsMutationLoaders.runMoveTargetMkdirLoaderInVm],
    [capture?.mkdirParentsState, fsMutationLoaders.runMoveTargetMkdirParentsLoaderInVm],
    [capture?.touchState, fsMutationLoaders.runMoveTargetTouchLoaderInVm],
    [capture?.chmodState, fsMutationLoaders.runMoveTargetChmodLoaderInVm],
    [capture?.chownState, fsMutationLoaders.runMoveTargetChownLoaderInVm],
    [capture?.linkState, fsMutationLoaders.runMoveTargetLinkLoaderInVm],
    [capture?.symlinkState, runMoveTargetSymlinkLoaderInVm],
    [capture?.rmState, runMoveTargetRmLoaderInVm],
    [capture?.rmdirState, runMoveTargetRmdirLoaderInVm],
    [capture?.installState, runMoveTargetInstallLoaderInVm],
    [capture?.lsState, runMoveTargetLsLoaderInVm],
    [capture?.lsLongState, runMoveTargetLsLongLoaderInVm],
    [capture?.duState, runMoveTargetDuLoaderInVm],
    [capture?.statState, runMoveTargetStatLoaderInVm],
    [capture?.readlinkState, runMoveTargetReadlinkLoaderInVm],
    [capture?.realpathState, runMoveTargetRealpathLoaderInVm],
    [capture?.recursiveGrepState, runMoveTargetRecursiveGrepLoaderInVm],
    [capture?.maxdepthFindState, runMoveTargetMaxdepthFindLoaderInVm],
    [capture?.findPredicateState, runMoveTargetFindPredicateLoaderInVm],
    [capture?.treeState, runMoveTargetTreeLoaderInVm],
    [capture?.nodeStaticHttpState, runMoveTargetNodeStaticHttpLoaderInVm],
    [capture?.genericResourceGraphState, runMoveTargetGenericResourceGraphLoaderInVm],
  ];
  return loaders.find(([state]) => state)?.[1];
}

async function runMoveTargetSleepLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const sleepState = descriptor.resourcePlan?.capture?.sleepState;
  const argv = [executable, sleepRemainingSecondsArg(sleepState?.remainingMs ?? 0)];
  const result = await vm.execRaw(moveSleepLoaderCommand(executable, argv[1]!), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveSleepPatchFromOutput(result);
  const refusals = moveSleepLoaderRefusals(patch);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-sleep-remaining-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}
async function runMoveTargetTailLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const tailState = descriptor.resourcePlan?.capture?.tailState;
  const argv = [executable, "-c", `+${(tailState?.offset ?? 0) + 1}`, "-f", tailState?.path ?? ""];
  const result = await vm.execRaw(moveTailLoaderCommand(executable, tailState), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveTailPatchFromOutput(result);
  const refusals = moveTailLoaderRefusals(patch);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-tail-offset-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}
async function runMoveTargetLessLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const lessState = descriptor.resourcePlan?.capture?.lessState;
  const argv = [executable, `+${lessState?.line ?? 1}`, lessState?.path ?? ""];
  const result = await vm.execRaw(moveScriptPtyLoaderCommand(executable, "less", lessState), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveScriptPtyPatchFromOutput(result, "less");
  const refusals = moveScriptPtyLoaderRefusals(patch, "target less script-pty loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-less-script-pty-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}
async function runMoveTargetViLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const viState = descriptor.resourcePlan?.capture?.viState;
  const argv = [executable, `+${viState?.line ?? 1}`, viState?.path ?? ""];
  const result = await vm.execRaw(moveScriptPtyLoaderCommand(executable, "vi", viState), {
    execTimeoutMs: 30_000,
  });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveScriptPtyPatchFromOutput(result, "vi");
  const refusals = moveScriptPtyLoaderRefusals(patch, "target vi script-pty loader failed");
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy: "target-original-vi-readonly-script-pty-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}
async function runMoveTargetReaderLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.readerState;
  const argv = [executable, state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-cat-offset-loader",
    executable,
    argv,
    moveReaderLoaderCommand(executable, state),
    "reader-offset",
    "target cat offset loader failed",
  );
}
async function runMoveTargetGrepLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.grepState;
  const argv = [executable, state?.pattern ?? "", state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-grep-offset-loader",
    executable,
    argv,
    moveGrepLoaderCommand(executable, state),
    "grep-offset",
    "target grep offset loader failed",
  );
}
async function runMoveTargetWatchLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.watchState;
  const argv = [executable, "-n", String(state?.intervalSeconds ?? 2), ...(state?.command ?? [])];
  return runSimpleMoveLoader(
    vm,
    "target-original-watch-loop-loader",
    executable,
    argv,
    moveWatchLoaderCommand(executable, state),
    "watch-loop",
    "target watch loop loader failed",
  );
}
async function runMoveTargetShellLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.shellState;
  const argv = [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-sh-script-pty-loader",
    executable,
    argv,
    moveShellLoaderCommand(executable, state),
    "sh-script-pty",
    "target shell script-pty loader failed",
  );
}
async function runMoveTargetGoStaticHttpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const state = descriptor.resourcePlan?.capture?.goStaticHttpState;
  const executable = state?.binaryPath ?? moveRendezvousExecutable(descriptor);
  const argv = state
    ? [
        executable,
        "--machinen-move-envelope",
        state.markerVersion,
        "--port",
        String(state.port),
        "--health",
        state.healthPath,
      ]
    : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-native-go-static-http-loader",
    executable,
    argv,
    moveGoStaticHttpLoaderCommand(executable, state),
    "go-static-http",
    "target go static http loader failed",
  );
}
async function runMoveTargetRustStaticHttpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const state = descriptor.resourcePlan?.capture?.rustStaticHttpState;
  const executable = state?.binaryPath ?? moveRendezvousExecutable(descriptor);
  const argv = state
    ? [
        executable,
        "--machinen-move-envelope",
        state.markerVersion,
        "--port",
        String(state.port),
        "--health",
        state.healthPath,
      ]
    : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-native-rust-static-http-loader",
    executable,
    argv,
    moveRustStaticHttpLoaderCommand(executable, state),
    "rust-static-http",
    "target rust static http loader failed",
  );
}
async function runMoveTargetPythonStaticRouteLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.pythonStaticRouteState;
  const argv = state ? [executable, state.scriptPath] : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-python-static-route-loader",
    executable,
    argv,
    movePythonStaticRouteLoaderCommand(executable, state),
    "python-static-route",
    "target python static route loader failed",
  );
}
async function runMoveTargetTimeoutLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.timeoutState;
  const argv = state
    ? [
        executable,
        String(state.seconds),
        "/usr/bin/python3",
        "-m",
        "http.server",
        String(state.httpState.port),
      ]
    : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-timeout-python-http-server-loader",
    executable,
    argv,
    moveTimeoutLoaderCommand(executable, state),
    "timeout-python-http-server",
    "target timeout python http server loader failed",
  );
}
async function runMoveTargetNcLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.ncState;
  const argv = state ? [executable, "-l", String(state.port)] : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-nc-listener-loader",
    executable,
    argv,
    moveNcLoaderCommand(executable, state),
    "nc-listener",
    "target nc listener loader failed",
  );
}
async function runMoveTargetBusyboxHttpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.busyboxHttpState;
  const argv = state
    ? [executable, "httpd", "-f", "-p", String(state.port), "-h", state.root]
    : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-busybox-httpd-loader",
    executable,
    argv,
    moveBusyboxHttpLoaderCommand(executable, state),
    "busybox-httpd",
    "target busybox httpd loader failed",
  );
}
async function runMoveTargetHttpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.httpState;
  const argv = [executable, "-m", "http.server", "--bind", "127.0.0.1"].concat(
    state?.directory
      ? ["--directory", state.directory, String(state.port)]
      : [String(state?.port ?? 8000)],
  );
  return runSimpleMoveLoader(
    vm,
    "target-original-python-http-server-loader",
    executable,
    argv,
    moveHttpLoaderCommand(executable, state, descriptor.resourcePlan?.capture?.envState),
    "python-http-server",
    "target python http server loader failed",
  );
}
async function runMoveTargetNodeStaticHttpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.nodeStaticHttpState;
  const argv = [executable, state?.scriptPath ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-node-static-http-loader",
    executable,
    argv,
    moveNodeStaticHttpLoaderCommand(executable, state),
    "node-static-http",
    "target node static http loader failed",
  );
}
async function runMoveTargetTarLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.tarState;
  const argv = [executable, "-cf", state?.archivePath ?? "", state?.sourceDir ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-tar-create-loader",
    executable,
    argv,
    moveTarLoaderCommand(executable, state),
    "tar-create",
    "target tar create loader failed",
  );
}
async function runMoveTargetTarExtractLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.tarExtractState;
  const argv = [executable, "-xf", state?.archivePath ?? "", "-C", state?.targetDir ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-tar-extract-loader",
    executable,
    argv,
    moveTarExtractLoaderCommand(executable, state),
    "tar-extract",
    "target tar extract loader failed",
  );
}
async function runMoveTargetFindLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.findState;
  const argv = [executable, state?.rootPath ?? "", "-type", "f", "-print"];
  return runSimpleMoveLoader(
    vm,
    "target-original-find-cursor-loader",
    executable,
    argv,
    moveFindLoaderCommand(executable, state),
    "find-cursor",
    "target find cursor loader failed",
  );
}
async function runMoveTargetSha256LoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.sha256State;
  const argv = [executable, state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-sha256sum-file-loader",
    executable,
    argv,
    moveSha256LoaderCommand(executable, state),
    "sha256sum-file",
    "target sha256sum file loader failed",
  );
}
async function runMoveTargetWcLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.wcState;
  const argv = [executable, "-l", state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-wc-line-loader",
    executable,
    argv,
    moveWcLoaderCommand(executable, state),
    "wc-line",
    "target wc line loader failed",
  );
}
async function runMoveTargetSortLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.sortState;
  const argv = [executable, state?.path ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-sort-file-loader",
    executable,
    argv,
    moveSortLoaderCommand(executable, state),
    "sort-file",
    "target sort file loader failed",
  );
}
async function runMoveTargetMvLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.mvState;
  const argv = [executable, state?.sourcePath ?? "", state?.destinationPath ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-mv-rename-loader",
    executable,
    argv,
    moveMvLoaderCommand(executable, state),
    "mv-rename",
    "target mv rename loader failed",
  );
}
async function runMoveTargetCpLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.cpState;
  const argv = [executable, state?.sourcePath ?? "", state?.destinationPath ?? ""];
  return runSimpleMoveLoader(
    vm,
    "target-original-cp-offset-loader",
    executable,
    argv,
    moveCpLoaderCommand(executable, state),
    "cp-offset",
    "target cp offset loader failed",
  );
}
async function runMoveTargetDdLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const executable = moveRendezvousExecutable(descriptor);
  const state = descriptor.resourcePlan?.capture?.ddState;
  const argv = state
    ? [
        executable,
        `if=${state.inputPath}`,
        `of=${state.outputPath}`,
        `bs=${state.blockSize}`,
        `skip=${state.outputOffset}`,
        `seek=${state.outputOffset}`,
        "iflag=skip_bytes",
        "oflag=seek_bytes",
        "conv=notrunc",
      ]
    : [executable];
  return runSimpleMoveLoader(
    vm,
    "target-original-dd-offset-loader",
    executable,
    argv,
    moveDdLoaderCommand(executable, state),
    "dd-offset",
    "target dd offset loader failed",
  );
}
async function runMoveTargetTailGrepPipelineLoaderInVm(
  vm: VmHandle,
  descriptor: MoveDescriptor,
): Promise<MoveLoadDirectLoader> {
  const state = descriptor.resourcePlan?.capture?.tailGrepPipelineState;
  const executable = "/bin/sh";
  const argv = [
    executable,
    "-c",
    `tail -c +${(state?.offset ?? 0) + 1} -f -- ${state?.tailPath ?? ""} | grep --line-buffered -- ${state?.pattern ?? ""}`,
  ];
  return runSimpleMoveLoader(
    vm,
    "target-original-tail-grep-pipeline-loader",
    executable,
    argv,
    moveTailGrepPipelineLoaderCommand(state),
    "tail-grep-pipeline",
    "target tail-grep pipeline loader failed",
  );
}
async function runSimpleMoveLoader(
  vm: VmHandle,
  strategy: MoveLoadDirectLoader["strategy"],
  executable: string,
  argv: string[],
  command: string,
  patchName: string,
  refusalMessage: string,
): Promise<MoveLoadDirectLoader> {
  const result = await vm.execRaw(command, { execTimeoutMs: 300_000 });
  const parsed = parseRendezvousOutput(result.stdout);
  const patch = moveNamedPatchFromOutput(result, patchName);
  const refusals = moveNamedLoaderRefusals(patch, refusalMessage);
  return {
    state: refusals.length === 0 ? "ready" : "refused",
    strategy,
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    patch,
    refusals,
  };
}
function moveRendezvousExecutable(descriptor: MoveDescriptor): string {
  return (
    descriptor.resourcePlan?.capture?.executablePackage?.path ??
    descriptor.nodes[0]?.exe ??
    "/usr/bin/ping"
  );
}
function moveRendezvousArgv(descriptor: MoveDescriptor, executable: string): string[] {
  const argv = descriptor.nodes[0]?.argv ?? [];
  if (argv.length === 0) {
    return [executable];
  }
  return [executable, ...argv.slice(1)];
}
function moveRendezvousCommand(
  executable: string,
  args: string[],
  descriptor: MoveDescriptor,
): string {
  const pingState = descriptor.resourcePlan?.capture?.pingState;
  if (!pingState) {
    return "printf 'SAFE_BOUNDARY\\trefused\\tsource-ping-state-missing\\n'; exit 2";
  }
  const quotedExecutable = shellQuote(executable);
  const quotedArgs = args.map(shellQuote).join(" ");
  return `set -eu
log="/tmp/machinen-move-loader-$$.log"
if [ -x /sbin/machinen-move-capture ]; then
  /sbin/machinen-move-capture --load-ping-state ${pingState.ntransmitted} ${pingState.nreceived} ${pingState.nerrors} --log "$log" -- ${quotedExecutable}${quotedArgs ? ` ${quotedArgs}` : ""}
else
  printf 'SAFE_BOUNDARY\trefused\tmissing-move-capture-agent\n'
fi`;
}
function moveSleepLoaderCommand(executable: string, secondsArg: string): string {
  return `set -eu
log="/tmp/machinen-move-loader-$$.log"
${shellQuote(executable)} ${shellQuote(secondsArg)} >"$log" 2>&1 &
pid=$!
printf 'LOAD_PID\t%s\n' "$pid"
printf 'LOAD_LOG\t%s\n' "$log"
printf 'SAFE_BOUNDARY\tsleep-timer\ttarget-sleep-started\n'
printf 'PATCH\tsleep-remaining\tready\t%s\n' ${shellQuote(secondsArg)}
`;
}
function sleepRemainingSecondsArg(remainingMs: number): string {
  return Math.max(1, Math.ceil(remainingMs / 1000)).toString();
}
function moveSleepPatchFromOutput(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): MoveLoadDirectLoader["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes("PATCH\tsleep-remaining\tready")
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}
function moveSleepLoaderRefusals(
  patch: MoveLoadDirectLoader["patch"] | undefined,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [
    loaderRefusal("target-sleep-remaining-time-missing", "target sleep loader failed", { patch }),
  ];
}
function moveTailPatchFromOutput(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): MoveLoadDirectLoader["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes("PATCH\ttail-offset\tready")
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}
function moveTailLoaderRefusals(
  patch: MoveLoadDirectLoader["patch"] | undefined,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [
    loaderRefusal("target-fd-read-state-missing", "target tail offset loader failed", { patch }),
  ];
}
function moveScriptPtyPatchFromOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  kind: "less" | "vi",
): MoveLoadDirectLoader["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes(`PATCH\t${kind}-script-pty\tready`)
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}
function moveScriptPtyLoaderRefusals(
  patch: MoveLoadDirectLoader["patch"] | undefined,
  message: string,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [loaderRefusal("target-process-context-unsupported", message, { patch })];
}
function moveNamedPatchFromOutput(
  result: { stdout: string; stderr: string; exitCode: number },
  patchName: string,
): MoveLoadDirectLoader["patch"] {
  const state =
    result.exitCode === 0 && result.stdout.includes(`PATCH\t${patchName}\tready`)
      ? "ready"
      : "refused";
  return { state, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
}
function moveNamedLoaderRefusals(
  patch: MoveLoadDirectLoader["patch"] | undefined,
  message: string,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [loaderRefusal("target-process-context-unsupported", message, { patch })];
}
function parseRendezvousOutput(stdout: string): ParsedRendezvousOutput {
  const captureRows: string[] = [];
  let pid: number | undefined;
  let logPath: string | undefined;
  for (const row of stdout.split("\n").filter(Boolean)) {
    const parts = row.split("\t");
    if (parts[0] === "RENDEZVOUS_PID" || parts[0] === "LOAD_PID") {
      pid =
        Number.isInteger(Number(parts[1])) && Number(parts[1]) > 0 ? Number(parts[1]) : undefined;
    } else if (parts[0] === "RENDEZVOUS_LOG" || parts[0] === "LOAD_LOG") {
      logPath = parts[1];
    } else {
      captureRows.push(row);
    }
  }
  return { pid, logPath, captureRows };
}
function moveRendezvousPatchFromOutput(result: {
  stdout: string;
  stderr: string;
  exitCode: number;
}): MoveLoadDirectLoader["patch"] {
  const state =
    result.exitCode === 0 &&
    result.stdout.includes("PATCH\tping-rts") &&
    result.stdout.includes("PATCH\tping-send-buffer\tready")
      ? "ready"
      : "refused";
  return {
    state,
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode,
  };
}
function movePatchRefusals(
  patch: MoveLoadDirectLoader["patch"] | undefined,
): NativeProcessImageRefusal[] {
  if (patch?.state === "ready") {
    return [];
  }
  return [
    loaderRefusal("target-frame-register-value-unavailable", "target ping state patch failed", {
      patch,
    }),
  ];
}
function moveRendezvousRefusals(capture: {
  safeBoundary?: { state: "sleep-timer" | "pre-send-icmp" | "refused"; detail: string };
  freeze?: { state: "ptrace-attached" | "refused"; detail: string };
  registers?: Record<string, unknown>;
}): NativeProcessImageRefusal[] {
  const refusals: NativeProcessImageRefusal[] = [];
  pushBoundaryRefusal(refusals, capture.safeBoundary);
  pushFreezeRefusal(refusals, capture.freeze);
  pushRegisterRefusal(refusals, capture.registers);
  return refusals;
}
function pushBoundaryRefusal(
  refusals: NativeProcessImageRefusal[],
  safeBoundary: { state: "sleep-timer" | "pre-send-icmp" | "refused"; detail: string } | undefined,
): void {
  if (safeBoundary?.state === "sleep-timer" || safeBoundary?.state === "pre-send-icmp") {
    return;
  }
  refusals.push(
    loaderRefusal(
      "active-syscall",
      "target ping direct loader did not reach the pre-send boundary",
      {
        boundary: safeBoundary?.detail ?? "missing",
      },
    ),
  );
}
function pushFreezeRefusal(
  refusals: NativeProcessImageRefusal[],
  freeze: { state: "ptrace-attached" | "refused"; detail: string } | undefined,
): void {
  if (freeze?.state === "ptrace-attached") {
    return;
  }
  refusals.push(
    loaderRefusal("thread-state-unsupported", "target ping was not frozen by direct loader", {
      freeze: freeze?.detail ?? "missing",
    }),
  );
}
function pushRegisterRefusal(
  refusals: NativeProcessImageRefusal[],
  registers: Record<string, unknown> | undefined,
): void {
  if (registers) {
    return;
  }
  refusals.push(
    loaderRefusal(
      "target-frame-register-value-unavailable",
      "target register state was not captured by direct loader",
      {},
    ),
  );
}
function loaderRefused(
  executable: string,
  argv: string[],
  parsed: { pid?: number; logPath?: string; captureRows: string[] },
  refusal: NativeProcessImageRefusal,
): MoveLoadDirectLoader {
  return {
    state: "refused",
    strategy: "target-original-ping-direct-loader",
    executable,
    argv,
    targetPid: parsed.pid,
    logPath: parsed.logPath,
    refusals: [refusal],
  };
}
function loaderRefusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail: Record<string, unknown>,
): NativeProcessImageRefusal {
  return { code, message, detail: { ...detail, boundary: "target-original-ping-direct-loader" } };
}
const shellQuote = (value: string): string => `'${value.replaceAll("'", `'\\''`)}'`;
