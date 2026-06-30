import { type ChildProcessWithoutNullStreams, spawn as nodeSpawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { SnapshotError } from "../errors.ts";
import type { VsockExecOptions, VsockExecResult } from "../exec.ts";
import type { OnLog } from "../log.ts";
import { PhaseTimer } from "../phase-timer.ts";
import { reflinkCopy } from "../reflink.ts";
import type {
  SnapshotMeta,
  SnapshotOptions,
  SnapshotResult,
  VmstateSnapshotMeta,
} from "../vm-handle.ts";
import { resolveSnapshotEngine, VMSTATE_FILE } from "./snapshot-engine.ts";
import { relativeCheckpointParent, VMSTATE_SECTION, vmstateSectionTags } from "./vmstate-chain.ts";
import { copyVmstateRootDisk, finalizeVmstateRootDisk } from "./snapshot-rootdisk.ts";
import { waitForVmstateFile } from "./vmstate-wait.ts";
import {
  currentVmstateBackend,
  currentVmstateGuestArch,
  fileIdentity,
  readVmstateFacts,
} from "./vmstate-metadata.ts";

const debugSnapshot = debugLib("machinen:snapshot");
const debugVmstate = debugLib("machinen:vmstate");

/**
 * Injection surface for `performSnapshot`. The boot-owned handle and
 * the attach handle both plug in the same way, swapping `teeGuestConsole`
 * (only boot has a live stderr stream) and `errorOutput` (attach can't
 * see the guest console).
 */
export interface SnapshotContext {
  /** PID of the host VMM process — used in debug logs. */
  pid: number;
  /** Optional source name (from `boot({ name })`); written into bundle meta.json. */
  sourceName?: string;
  /**
   * Absolute path of the rootfs tarball the source VM was booted with;
   * written into bundle meta.json so `restore()` can default to the
   * same image. Optional because attach handles may be looking at a
   * registry entry that pre-dates `imagePath` tracking.
   */
  sourceImage?: string;
  /** Host file backing the scratch disk (`/dev/vdb`) for CRIU snapshots. */
  diskPath: string;
  /** Host file backing `/dev/vda`; vmstate bundles copy this exact image. */
  rootDiskPath?: string;
  /** Whether the source intentionally had no root block device. */
  rootDiskMode?: "block" | "none";
  /** Guest RAM ceiling/layout in MiB, when resolved by the runtime. */
  memoryCeilingMib?: number;
  /** Explicit kernel path used by the source boot, when known. */
  kernelPath?: string;
  /** Explicit DTB path used by the source boot, when known. */
  dtbPath?: string;
  /**
   * #272: when the source VM was booted with `mount: { host, guest }`,
   * the runtime materialized a squashfs lower + ext4 upper. We need
   * to reflink both files into the snapshot bundle so a restore
   * elsewhere can mount the same overlay without consulting the host
   * source dir. Undefined when no mount was configured.
   */
  mountDisk?: {
    guest: string;
    lowerPath: string;
    upperPath: string;
  };
  /**
   * #273: live-share mounts the source VM has active. Threaded into
   * the bundle's `meta.json` so `restore()` can re-establish the same
   * window (or apply per-guest overrides on a different host). Both
   * boot- and attach-handle ctxes populate this — boot from
   * `liveMountsResolved`, attach from the registry. Undefined / empty
   * for VMs booted without `liveMounts`. Since #332 each is served by
   * an in-VMM virtio-fs device that the VMM carries across the CRIU
   * dump, so there's nothing host-side to stop or respawn.
   */
  liveMounts?: ReadonlyArray<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
  }>;
  /**
   * Vmstate engine only: absolute path the VMM was told to write its
   * `.vmstate` state file to (the `MACHINEN_SNAPSHOT_PATH` it booted
   * with). `performSnapshotVmstate` sends SIGUSR1 to `pid` and waits
   * for this file. Undefined when the VM wasn't booted snapshot-
   * capable (the env var wasn't set), in which case a vmstate-engine
   * snapshot fails with a clear "boot it with the vmstate engine"
   * message.
   */
  vmstatePath?: string;
  /** Incremental vmstate checkpoint chain state for this VM. */
  vmstateChain?: {
    chainId: string;
    parentDir?: string;
    sequence: number;
  };
  /** Persist the next parent pointer after a successful vmstate checkpoint. */
  updateVmstateChain?: (next: { parentDir: string; sequence: number }) => void;
  /**
   * True when the source VM exposed EL2 to its guest. Provider-level
   * snapshots of this L1 are refused until nested KVM/HVF state capture
   * is audited, so we never write a bundle that looks valid but cannot
   * safely restore.
   */
  nested?: boolean;
  execRaw: (cmd: string, opts?: VsockExecOptions) => Promise<VsockExecResult>;
  syncVmstateSnapshot?: (opts?: VsockExecOptions) => Promise<VsockExecResult> | undefined;
  wait: () => Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
  kill: () => Promise<void>;
  teeGuestConsole: ((onChunk: (chunk: Buffer) => void) => void) | undefined;
  errorOutput: () => Promise<string>;
}

type DumpOutcome = { kind: "exited"; exitCode: number } | { kind: "rejected"; error: unknown };

interface DumpExtractResult {
  dumpOutcome: DumpOutcome | undefined;
  tarSpawnError: Error | undefined;
  tarResult: { code: number | null; signal: NodeJS.Signals | null };
  tarStderr: string;
  timedOut: boolean;
}

/**
 * Drive a CRIU dump inside the guest, wait for the VMM to exit, and
 * copy the disk to the caller's outPath. Shared between boot-owned
 * handles (`boot().snapshot(...)`) and attach handles
 * (`attach().snapshot(...)`).
 *
 * Success signal (cross-process-safe):
 *   - Kick off /sbin/machinen-dump via vsock exec.
 *   - Wait for the VMM child to exit.
 *   - If the host's kill-timer fired first, it's a SNAPSHOT_TIMEOUT.
 *   - Otherwise the guest shut down cleanly under its own steam,
 *     which only happens after /sbin/machinen-supervisor's wait()
 *     returned — i.e. CRIU killed the dumped tree (success) or the
 *     workload exited on its own (also fine; the dump either happened
 *     before that or not at all). A failed dump does NOT kill the
 *     workload, so the supervisor keeps waiting and the kill-timer
 *     fires.
 *
 * The previous string-grep on `"dump OK"` in the VMM stderr was
 * swapped out because attach-owned handles have no guest-console
 * stream — the kill-timer boundary is the same signal without
 * requiring console access.
 */
/**
 * Engine dispatcher. The vmstate backend (`performSnapshotVmstate`) —
 * a whole-VM `.vmstate` snapshot — is the default;
 * `MACHINEN_SNAPSHOT_ENGINE=criu` selects the process-tree backend
 * (`performSnapshotCriu`), and `MACHINEN_SNAPSHOT_ENGINE=portable`
 * selects the experimental semantic process backend (currently a
 * deliberate unsupported-workload error).
 */
export async function performSnapshot(
  ctx: SnapshotContext,
  opts: SnapshotOptions,
): Promise<SnapshotResult> {
  const engine = resolveSnapshotEngine();
  if (engine === "portable") {
    return performSnapshotPortable(ctx, opts);
  }
  if (ctx.nested) {
    throw new SnapshotError(
      "BOOT_VMSTATE_UNSUPPORTED",
      "vm.snapshot: provider-level snapshots of nested-enabled VMs are not supported yet.\n" +
        "  The guest may be using EL2 / /dev/kvm state that machinen does not yet capture safely.\n" +
        "  Snapshot/fork VMs created inside this guest from the nested machinen runtime instead.",
    );
  }
  if (engine === "vmstate") {
    return performSnapshotVmstate(ctx, opts);
  }
  return performSnapshotCriu(ctx, opts);
}

function performSnapshotPortable(
  _ctx: SnapshotContext,
  _opts: SnapshotOptions,
): Promise<SnapshotResult> {
  throw new SnapshotError(
    "SNAPSHOT_PORTABLE_REFUSED",
    "vm.snapshot: legacy portable Level 0-4 snapshot routes were removed; use vmstate snapshot/restore for same-ISA VM snapshots. For cross-ISA process movement, use machinen move only for explicitly supported target-native subsets.",
  );
}

async function performSnapshotCriu(
  ctx: SnapshotContext,
  opts: SnapshotOptions,
): Promise<SnapshotResult> {
  const baseDumpCmd = opts.dumpCmd ?? "/sbin/machinen-dump";
  const deadlineMs = opts.timeoutMs ?? 90_000;
  const onLog = opts.onLog;
  const leaveRunning = opts.leaveRunning === true;
  const tcpClose = opts.tcpClose === true;
  // Env-prefix the dump command. The exec-agent runs commands via
  // `sh -c`, so standard shell `VAR=val cmd` syntax flows unmodified.
  const dumpCmd = tcpClose ? `MACHINEN_DUMP_TCP_CLOSE=1 ${baseDumpCmd}` : baseDumpCmd;
  const t0 = Date.now();
  // #221: per-phase timeline emitted under DEBUG=machinen:snapshot.
  const phases = new PhaseTimer();
  phases.start("staging");

  const { snapDir, imgDir } = prepareBundleDir(opts.outDir);

  debugSnapshot(
    "snapshot start pid=%d snapDir=%s dumpCmd=%s timeoutMs=%d leaveRunning=%s",
    ctx.pid,
    snapDir,
    dumpCmd,
    deadlineMs,
    leaveRunning,
  );

  if (onLog && ctx.teeGuestConsole) {
    ctx.teeGuestConsole((chunk) => {
      onLog({ source: "guest-console", chunk });
    });
  }
  phases.end("staging");

  phases.start("dump-exec");
  const dumpRes = await runDumpAndExtractTar(ctx, dumpCmd, deadlineMs, onLog, imgDir);
  phases.end("dump-exec");

  phases.start("validation");
  const elapsedMs = Date.now() - t0;
  const consoleLog = await ctx.errorOutput();
  debugSnapshot(
    "dump phase done elapsed=%dms consoleBytes=%d timedOut=%s tarExit=%j dumpOutcome=%j",
    elapsedMs,
    consoleLog.length,
    dumpRes.timedOut,
    dumpRes.tarResult,
    dumpRes.dumpOutcome,
  );

  const imgEntries = readdirSync(imgDir);
  validateDumpResult(dumpRes, imgEntries, consoleLog, deadlineMs);

  const mountDiskMeta = await reflinkMountOverlay(ctx, snapDir, deadlineMs);

  if (!leaveRunning) {
    phases.start("poweroff");
    await powerOffSourceVm(ctx, deadlineMs);
    phases.end("poweroff");
  }

  phases.end("validation");
  phases.start("finalize");
  writeSnapshotMeta(ctx, snapDir, mountDiskMeta, "criu");
  phases.end("finalize");

  debugSnapshot("snapshot done snapDir=%s imgEntries=%d", snapDir, imgEntries.length);
  phases.flush(debugSnapshot, "snapshot");
  return { engine: "criu", snapDir, imgDir, elapsedMs, consoleLog };
}

// Validate / prepare the bundle root directory. We refuse to
// overwrite an existing populated directory so a previous snapshot
// can't disappear under a typo'd outDir. Shared by both engines.
function prepareBundleRootDir(outDir: string): string {
  const snapDir = resolve(outDir);
  if (existsSync(snapDir)) {
    if (!statSync(snapDir).isDirectory()) {
      throw new SnapshotError(
        "SNAPSHOT_DUMP_FAILED",
        `vm.snapshot: outDir exists and is not a directory: ${snapDir}`,
      );
    }
    if (readdirSync(snapDir).length > 0) {
      throw new SnapshotError(
        "SNAPSHOT_DUMP_FAILED",
        `vm.snapshot: outDir is not empty: ${snapDir}`,
      );
    }
  } else {
    mkdirSync(snapDir, { recursive: true });
  }
  return snapDir;
}

// CRIU bundle: the root dir plus an `img/` subdir for the checkpoint images.
function prepareBundleDir(outDir: string): { snapDir: string; imgDir: string } {
  const snapDir = prepareBundleRootDir(outDir);
  const imgDir = join(snapDir, "img");
  mkdirSync(imgDir, { recursive: true });
  return { snapDir, imgDir };
}

// Spawn the host-side `tar x` and the guest-side dump exec, race them
// against the wall-clock deadline, and return everything the caller
// needs to decide success vs. failure.
async function runDumpAndExtractTar(
  ctx: SnapshotContext,
  dumpCmd: string,
  deadlineMs: number,
  onLog: OnLog | undefined,
  imgDir: string,
): Promise<DumpExtractResult> {
  // Spawn the host-side `tar x` that materializes the bundle. The
  // dump script tars its checkpoint image directory to stdout; we pump the
  // bytes through this child's stdin. tar logs its own errors on
  // stderr (inherited) which surface in the user's terminal if the
  // stream is malformed.
  const tarChild = nodeSpawn("tar", ["-xmf", "-", "-C", imgDir], {
    stdio: ["pipe", "ignore", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  let tarStderr = "";
  tarChild.stderr.on("data", (chunk: Buffer) => {
    tarStderr += chunk.toString("utf8");
  });
  let tarSpawnError: Error | undefined;
  tarChild.on("error", (err) => {
    tarSpawnError = err;
  });
  const tarExit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit) => {
      tarChild.once("exit", (code, signal) => resolveExit({ code, signal }));
    },
  );

  // Pipe vsock-exec stdout chunks (binary tar bytes) into the host
  // tar's stdin. Drop dump-exec stdout from the user-visible onLog
  // stream — those are tar bytes, not log content. Stderr from the
  // dump script (all log lines) still flows to onLog as exec-stderr.
  let dumpOutcome: DumpOutcome | undefined;
  const dumpDispatch = ctx
    .execRaw(dumpCmd, {
      // The dump runs against an already-attached, healthy VM, so a
      // long connect timeout is overkill, but 2s was tight enough to
      // reject under load and then get silently swallowed. Bound by
      // the snapshot deadline so a small `timeoutMs` doesn't stall
      // on connect retries.
      connectTimeoutMs: Math.min(deadlineMs, 10_000),
      execTimeoutMs: deadlineMs,
      onStdout: (chunk) => {
        if (tarSpawnError || tarChild.stdin.destroyed) {
          return;
        }
        try {
          tarChild.stdin.write(chunk);
        } catch (err) {
          debugSnapshot(
            "tar stdin write failed: %s",
            err instanceof Error ? err.message : String(err),
          );
        }
      },
      onStderr: onLog
        ? (chunk) => onLog({ source: "exec-stderr", cmd: dumpCmd, chunk })
        : undefined,
    })
    .then(
      (res) => {
        dumpOutcome = { kind: "exited", exitCode: res.exitCode };
        debugSnapshot("dump exec returned exitCode=%d", res.exitCode);
      },
      (err) => {
        dumpOutcome = { kind: "rejected", error: err };
        debugSnapshot(
          "dump exec dispatch rejected: %s",
          err instanceof Error ? err.message : String(err),
        );
      },
    );

  // Race the dump exec against a wall-clock timeout. The dump always
  // runs with --leave-running internally (so the supervisor's wait
  // stays parked while we tar), so the source VM keeps running until
  // the destructive-path poweroff below. Either flavor (leaveRunning
  // or not) needs the dump exec to return on its own.
  let timedOut = false;
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([
    dumpDispatch,
    new Promise<void>((resolveTimer) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolveTimer();
      }, deadlineMs);
      timer.unref();
    }),
  ]);
  if (timer) {
    clearTimeout(timer);
  }

  // Close tar's stdin so it sees EOF and exits, then wait for it.
  // `tar -x` happily processes a truncated archive (it'll error on
  // the partial member), but our SNAPSHOT_TIMEOUT/SNAPSHOT_DUMP_FAILED
  // checks below will surface the underlying problem regardless.
  if (!tarChild.stdin.destroyed) {
    tarChild.stdin.end();
  }
  const tarResult = await tarExit;
  return { dumpOutcome, tarSpawnError, tarResult, tarStderr, timedOut };
}

// Translate the raced dump+tar outcome into a SnapshotError on every
// failure mode, leaving the happy path to fall through. `imgEntries`
// is read once by the parent so the same listing can be reused for
// the post-success log line.
interface DumpValidationContext {
  res: DumpExtractResult;
  imgEntries: string[];
  dumpHint: string;
  tail: string;
  deadlineMs: number;
}

function validateDumpResult(
  res: DumpExtractResult,
  imgEntries: string[],
  consoleLog: string,
  deadlineMs: number,
): void {
  const ctx = createDumpValidationContext(res, imgEntries, consoleLog, deadlineMs);
  assertDumpNotTimedOut(ctx);
  assertDumpOutcomePresent(ctx);
  assertDumpSucceeded(ctx);
  assertTarExtracted(ctx);
  assertBundleHasCoreImage(ctx);
}

function createDumpValidationContext(
  res: DumpExtractResult,
  imgEntries: string[],
  consoleLog: string,
  deadlineMs: number,
): DumpValidationContext {
  return {
    res,
    imgEntries,
    deadlineMs,
    dumpHint: formatDumpOutcomeHint(res.dumpOutcome),
    tail: consoleLog ? `\nConsole tail:\n${consoleLog.slice(-2000)}` : "",
  };
}

function assertDumpNotTimedOut(ctx: DumpValidationContext): void {
  if (!ctx.res.timedOut) {
    return;
  }
  // Source VM is still up (--leave-running). Don't kill it — caller
  // can retry or kill manually. We just report the failure.
  throw new SnapshotError(
    "SNAPSHOT_TIMEOUT",
    `vm.snapshot: dump exec did not return within ${ctx.deadlineMs}ms — dump likely failed.` +
      ctx.dumpHint +
      ctx.tail,
  );
}

function assertDumpOutcomePresent(ctx: DumpValidationContext): void {
  if (ctx.res.dumpOutcome) {
    return;
  }
  throw new SnapshotError(
    "SNAPSHOT_DUMP_FAILED",
    "vm.snapshot: dump exec produced no outcome — dispatch raced the timeout.",
  );
}

function assertDumpSucceeded(ctx: DumpValidationContext): void {
  if (ctx.res.dumpOutcome?.kind !== "rejected" && ctx.res.dumpOutcome?.exitCode === 0) {
    return;
  }
  throw new SnapshotError(
    "SNAPSHOT_DUMP_FAILED",
    "vm.snapshot: dump exec failed." + ctx.dumpHint + ctx.tail,
  );
}

function assertTarExtracted(ctx: DumpValidationContext): void {
  if (!ctx.res.tarSpawnError && ctx.res.tarResult.code === 0) {
    return;
  }
  throw new SnapshotError(
    "SNAPSHOT_DUMP_FAILED",
    "vm.snapshot: failed to extract bundle on the host." + formatTarError(ctx.res) + ctx.tail,
  );
}

function formatTarError(res: DumpExtractResult): string {
  return res.tarSpawnError
    ? `\nHost tar spawn failed: ${res.tarSpawnError.message}`
    : `\nHost tar exited code=${res.tarResult.code} signal=${res.tarResult.signal}.${tarStderrSuffix(res)}`;
}

function tarStderrSuffix(res: DumpExtractResult): string {
  return res.tarStderr ? ` stderr:\n${res.tarStderr.slice(-1000)}` : "";
}

function assertBundleHasCoreImage(ctx: DumpValidationContext): void {
  // Sanity-check the materialized bundle: we expect at least one
  // core-*.img (CRIU produces one per task). An empty img/ means the
  // dump script ran but didn't actually dump anything (e.g. caller
  // pointed dumpCmd at /usr/bin/true).
  if (ctx.imgEntries.some((name) => /^core-\d+\.img$/.test(name))) {
    return;
  }
  throw new SnapshotError(
    "SNAPSHOT_DUMP_FAILED",
    `vm.snapshot: bundle has no core-*.img — the dump script likely never ran.` +
      ctx.dumpHint +
      ctx.tail,
  );
}

// #272: reflink the `--mount` overlay's lower + upper into the
// bundle BEFORE the destructive poweroff. Two ordering concerns:
//   1. The runtime's exit handler unlinks the per-VM upper file
//      the moment the VMM exits — doing the reflink afterwards
//      would race ENOENT.
//   2. Guest writes to /mnt/<guest>/* land in the kernel's
//      ext4 page cache first; reflinking the upper before those
//      pages are flushed gives the restored VM a stale view of
//      the upper. CRIU dump doesn't sync the guest's filesystems,
//      so we issue `sync` via vsock first.
async function reflinkMountOverlay(
  ctx: SnapshotContext,
  snapDir: string,
  deadlineMs: number,
): Promise<SnapshotMeta["mountDisk"] | undefined> {
  if (!ctx.mountDisk) {
    return undefined;
  }
  try {
    // Best-effort sync. A failure here doesn't block the
    // snapshot — the overlay is just at risk of a partial view,
    // which the restored VM would surface as a missing recent
    // write rather than corruption. We log and proceed.
    await ctx.execRaw("sync && sync /mnt 2>/dev/null; true", {
      connectTimeoutMs: Math.min(deadlineMs, 5_000),
      execTimeoutMs: 10_000,
    });
  } catch (err) {
    debugSnapshot(
      "pre-reflink sync failed (continuing): %s",
      err instanceof Error ? err.message : String(err),
    );
  }
  const lowerName = "mount-lower.sqfs";
  const upperName = "mount-upper.img";
  try {
    reflinkCopy(ctx.mountDisk.lowerPath, join(snapDir, lowerName));
    reflinkCopy(ctx.mountDisk.upperPath, join(snapDir, upperName));
  } catch (err) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      `vm.snapshot: failed to reflink mount overlay into bundle: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { cause: err },
    );
  }
  return {
    guest: ctx.mountDisk.guest,
    lower: lowerName,
    upper: upperName,
  };
}

// Destructive snapshot: the source VM is still alive (we always
// pass --leave-running internally). Bring it down via a clean
// poweroff so callers see the same "VM is gone after snapshot"
// semantics as before. Fork (leaveRunning: true) skips this.
async function powerOffSourceVm(ctx: SnapshotContext, deadlineMs: number): Promise<void> {
  debugSnapshot("issuing /sbin/machinen-poweroff to bring VMM down");
  // Fire-and-forget: poweroff triggers PSCI SYSTEM_OFF which kills
  // the VMM, which closes vsock — the exec usually rejects or
  // returns with no exit code. Either is fine.
  ctx
    .execRaw("/sbin/machinen-poweroff", {
      connectTimeoutMs: Math.min(deadlineMs, 5_000),
      execTimeoutMs: 10_000,
    })
    .catch((err) => {
      debugSnapshot(
        "poweroff exec rejected (expected): %s",
        err instanceof Error ? err.message : String(err),
      );
    });
  // Wait for the VMM to actually exit. Bound by the same deadline
  // so a stuck guest doesn't hang the snapshot indefinitely.
  const powerOffTimer = setTimeout(() => {
    debugSnapshot("poweroff deadline fired — SIGKILLing VMM");
    void ctx.kill();
  }, deadlineMs);
  powerOffTimer.unref();
  try {
    await ctx.wait();
  } finally {
    clearTimeout(powerOffTimer);
  }
}

// Drop the bundle metadata next to the images so `restore({ snapDir })`
// can recover the source name and rootfs path without poking at the
// disk. `sourceImage` is the absolute host path to the tarball the
// source VM booted from — restore uses it as the default rootfs so
// CRIU can re-open file-backed VMAs (executable, libraries) at the
// paths they were dumped from. Cross-host restores still need the
// path to resolve on the new host (or `--image` to override).
function writeSnapshotMeta(
  ctx: SnapshotContext,
  snapDir: string,
  mountDiskMeta: SnapshotMeta["mountDisk"] | undefined,
  engine: SnapshotMeta["engine"],
  vmstateMeta?: VmstateSnapshotMeta,
): void {
  const meta: SnapshotMeta = {
    engine,
    sourceName: ctx.sourceName,
    sourceImage: ctx.sourceImage,
    snappedAt: Date.now(),
    vmstate: vmstateMeta,
    mountDisk: mountDiskMeta,
    // #273: bytes are NOT in the bundle — `host` is a path on the
    // snapshotting host that the restoring host has to resolve (or
    // remap via `restore({ liveMounts })`). Recorded only when ctx
    // carried a resolved list (boot-handle path).
    liveMounts:
      ctx.liveMounts && ctx.liveMounts.length > 0
        ? ctx.liveMounts.map(({ guest, host, mode }) => ({
            guest,
            host,
            mode,
          }))
        : undefined,
  };
  writeFileSync(join(snapDir, "meta.json"), JSON.stringify(meta));
}

function formatDumpOutcomeHint(outcome: DumpOutcome | undefined): string {
  if (!outcome) {
    return "";
  }
  if (outcome.kind === "rejected") {
    const err = outcome.error;
    const msg = err instanceof Error ? err.message : String(err);
    return `\nDump exec dispatch failed: ${msg}`;
  }
  if (outcome.exitCode !== 0) {
    return `\nDump exec exited ${outcome.exitCode} (workload kept running).`;
  }
  return "";
}

async function performSnapshotVmstate(
  ctx: SnapshotContext,
  opts: SnapshotOptions,
): Promise<SnapshotResult> {
  const t0 = Date.now();
  const phases = new PhaseTimer();
  const deadlineMs = opts.timeoutMs ?? 90_000;
  phases.start("prepare");
  assertVmstateSnapshotEnabled(ctx);
  const snapDir = prepareBundleRootDir(opts.outDir);
  logVmstateSnapshotStart(ctx, snapDir);
  clearVmstateStateFile(ctx.vmstatePath!);
  phases.end("prepare");
  phases.start("guest-sync");
  const syncMode = await syncGuestForVmstateSnapshot(ctx, deadlineMs);
  const syncMs = phases.end("guest-sync");
  phases.mark(`guest-sync.${syncMode}`, syncMs);
  const result = await captureVmstateSnapshotBundle(ctx, snapDir, deadlineMs, t0, phases);
  phases.flush(debugVmstate, "snapshot", result.elapsedMs);
  return result;
}

function assertVmstateSnapshotEnabled(ctx: SnapshotContext): void {
  if (!ctx.vmstatePath) {
    throw new SnapshotError(
      "SNAPSHOT_NO_DISK",
      "vm.snapshot: this VM was not booted with the vmstate engine.\n" +
        "  Set MACHINEN_SNAPSHOT_ENGINE=vmstate before `machinen boot` so the\n" +
        "  VMM installs the SIGUSR1 whole-VM dump handler.",
    );
  }
}

function logVmstateSnapshotStart(ctx: SnapshotContext, snapDir: string): void {
  debugVmstate(
    "vmstate snapshot start pid=%d snapDir=%s vmstatePath=%s leaveRunning=%s",
    ctx.pid,
    snapDir,
    ctx.vmstatePath,
    true,
  );
}

function clearVmstateStateFile(vmstatePath: string): void {
  try {
    unlinkSync(vmstatePath);
  } catch {
    // ENOENT — nothing to clear, which is the common case.
  }
}

async function syncGuestForVmstateSnapshot(
  ctx: SnapshotContext,
  deadlineMs: number,
): Promise<"direct" | "shell" | "failed"> {
  try {
    const direct = await tryDirectVmstateSync(ctx, deadlineMs);
    if (direct) {
      return "direct";
    }
    await shellVmstateSync(ctx, deadlineMs);
    return "shell";
  } catch (err) {
    debugVmstate(
      "pre-snapshot sync failed (continuing): %s",
      err instanceof Error ? err.message : String(err),
    );
    return "failed";
  }
}

async function tryDirectVmstateSync(ctx: SnapshotContext, deadlineMs: number): Promise<boolean> {
  if (!ctx.syncVmstateSnapshot) {
    return false;
  }
  try {
    const res = await ctx.syncVmstateSnapshot({
      connectTimeoutMs: Math.min(deadlineMs, 5_000),
      execTimeoutMs: 10_000,
    });
    if (res.exitCode === 0) {
      debugVmstate("pre-snapshot sync mode=direct");
      return true;
    }
    debugVmstate("pre-snapshot direct sync exit=%d; falling back", res.exitCode);
  } catch (err) {
    debugVmstate(
      "pre-snapshot direct sync unavailable; falling back: %s",
      err instanceof Error ? err.message : String(err),
    );
  }
  return false;
}

async function shellVmstateSync(ctx: SnapshotContext, deadlineMs: number): Promise<void> {
  await ctx.execRaw(VMSTATE_PRE_SNAPSHOT_SYNC, {
    connectTimeoutMs: Math.min(deadlineMs, 5_000),
    execTimeoutMs: 10_000,
  });
}

const VMSTATE_PRE_SNAPSHOT_SYNC =
  "sync; sync /mnt 2>/dev/null; " +
  "if [ -w /proc/sys/vm/drop_caches ]; then echo 3 > /proc/sys/vm/drop_caches; fi; true";

async function captureVmstateSnapshotBundle(
  ctx: SnapshotContext,
  snapDir: string,
  deadlineMs: number,
  t0: number,
  phases: PhaseTimer,
): Promise<SnapshotResult> {
  phases.start("pause-critical-section");
  const bundle = await withPausedVmstateSource(ctx, async () => {
    phases.start("wait-state-file");
    const waitStats = await waitForVmstateFile(ctx.vmstatePath!, deadlineMs);
    phases.end("wait-state-file");
    phases.mark("wait-state-file.poll-sleep", waitStats.pollSleepMs);
    phases.mark("wait-state-file.detect-latency", waitStats.detectLatencyMs);
    phases.start("copy-state-file");
    const bundleStatePath = copyVmstateStateIntoBundle(ctx.vmstatePath!, snapDir);
    phases.end("copy-state-file");
    const nextSequence = (ctx.vmstateChain?.sequence ?? 0) + 1;
    const flags = readVmstateSectionFlags(bundleStatePath);
    phases.start("rootdisk-reflink");
    const rootDisk = copyVmstateRootDisk(
      ctx,
      snapDir,
      shouldCopyRootdiskDeltaOnly(ctx.vmstateChain?.parentDir, flags),
    );
    phases.end("rootdisk-reflink");
    phases.start("mount-overlay-reflink");
    const mountDiskMeta = await reflinkMountOverlay(ctx, snapDir, deadlineMs);
    phases.end("mount-overlay-reflink");
    return { bundleStatePath, flags, mountDiskMeta, nextSequence, rootDisk };
  });
  phases.end("pause-critical-section");
  phases.start("rootdisk-identity");
  const rootDisk = finalizeVmstateRootDisk(bundle.rootDisk);
  phases.end("rootdisk-identity");
  phases.start("build-metadata");
  const vmstateMeta = buildVmstateMeta(
    ctx,
    bundle.bundleStatePath,
    snapDir,
    ctx.vmstateChain?.parentDir,
    bundle.nextSequence,
    bundle.flags,
    rootDisk,
  );
  phases.end("build-metadata");
  phases.start("write-meta");
  writeSnapshotMeta(ctx, snapDir, bundle.mountDiskMeta, "vmstate", vmstateMeta);
  ctx.updateVmstateChain?.({ parentDir: snapDir, sequence: bundle.nextSequence });
  phases.end("write-meta");
  return vmstateSnapshotResult(snapDir, bundle.bundleStatePath, t0);
}

async function withPausedVmstateSource<T>(
  ctx: SnapshotContext,
  body: () => Promise<T>,
): Promise<T> {
  let signaled = false;
  try {
    signalVmstateSnapshot(ctx.pid);
    signaled = true;
    return await body();
  } finally {
    if (signaled) {
      resumeVmstateSource(ctx.pid);
    }
  }
}

function signalVmstateSnapshot(pid: number): void {
  try {
    process.kill(pid, "SIGUSR1");
  } catch (err) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      `vm.snapshot: failed to signal the VMM (pid ${pid}): ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function copyVmstateStateIntoBundle(vmstatePath: string, snapDir: string): string {
  const bundleStatePath = join(snapDir, VMSTATE_FILE);
  try {
    copyFileSync(vmstatePath, bundleStatePath);
    return bundleStatePath;
  } catch (err) {
    throw new SnapshotError(
      "SNAPSHOT_DUMP_FAILED",
      `vm.snapshot: failed to copy the .vmstate into the bundle: ${err instanceof Error ? err.message : String(err)}`,
      { cause: err },
    );
  }
}

function vmstateSnapshotResult(
  snapDir: string,
  bundleStatePath: string,
  t0: number,
): SnapshotResult {
  const elapsedMs = Date.now() - t0;
  const stateBytes = statSync(bundleStatePath).size;
  debugVmstate(
    "vmstate snapshot done snapDir=%s stateBytes=%d elapsedMs=%d",
    snapDir,
    stateBytes,
    elapsedMs,
  );
  return {
    engine: "vmstate",
    snapDir,
    vmstatePath: bundleStatePath,
    elapsedMs,
    consoleLog: "",
  };
}

function resumeVmstateSource(pid: number): void {
  try {
    process.kill(pid, "SIGUSR2");
  } catch (err) {
    debugVmstate(
      "vmstate snapshot: failed to resume VMM pid=%d after snapshot: %s",
      pid,
      err instanceof Error ? err.message : String(err),
    );
  }
}

interface VmstateSectionFlags {
  hasRamDelta: boolean;
  hasRootdiskDelta: boolean;
}

type VmstateFactsForSnapshot = ReturnType<typeof readVmstateFacts>;

function buildVmstateMeta(
  ctx: SnapshotContext,
  statePath: string,
  snapDir: string,
  parentDir: string | undefined,
  sequence: number,
  flags: VmstateSectionFlags,
  rootDisk: VmstateSnapshotMeta["rootDisk"],
): VmstateSnapshotMeta {
  const facts = readVmstateFacts(statePath);
  return {
    sourceBackend: currentVmstateBackend(),
    guestArch: vmstateGuestArch(facts),
    topologyHash: facts.topologyHash,
    memoryCeilingMib: ctx.memoryCeilingMib,
    guestPauth: vmstateGuestPauth(facts),
    rootDisk,
    kernel: optionalFileIdentity(ctx.kernelPath),
    dtb: optionalFileIdentity(ctx.dtbPath),
    checkpoint: buildVmstateCheckpoint(ctx, snapDir, parentDir, sequence, flags),
  };
}

function readVmstateSectionFlags(statePath: string): VmstateSectionFlags {
  const tags = vmstateSectionTags(statePath);
  return {
    hasRamDelta: tags.includes(VMSTATE_SECTION.ramDelta),
    hasRootdiskDelta: tags.includes(VMSTATE_SECTION.rootdiskDelta),
  };
}

function vmstateGuestArch(facts: VmstateFactsForSnapshot): VmstateSnapshotMeta["guestArch"] {
  return facts.arch ?? currentVmstateGuestArch();
}

function vmstateGuestPauth(facts: VmstateFactsForSnapshot): VmstateSnapshotMeta["guestPauth"] {
  return {
    active: facts.guestPauthActive,
    sctlrEl1: facts.sctlrEl1,
  };
}

function optionalFileIdentity(
  path: string | undefined,
): ReturnType<typeof fileIdentity> | undefined {
  return path ? fileIdentity(path) : undefined;
}

function shouldCopyRootdiskDeltaOnly(
  parentDir: string | undefined,
  flags: VmstateSectionFlags,
): boolean {
  return parentDir !== undefined && flags.hasRootdiskDelta;
}

function buildVmstateCheckpoint(
  ctx: SnapshotContext,
  snapDir: string,
  parentDir: string | undefined,
  sequence: number,
  flags: VmstateSectionFlags,
): VmstateSnapshotMeta["checkpoint"] {
  return {
    chainId: vmstateChainId(ctx),
    sequence,
    parent: relativeCheckpointParent(snapDir, parentDir),
    ram: flags.hasRamDelta ? "delta" : "full",
    rootDisk: checkpointRootDiskMode(ctx, flags),
  };
}

function vmstateChainId(ctx: SnapshotContext): string {
  return ctx.vmstateChain?.chainId ?? `pid-${ctx.pid}`;
}

function checkpointRootDiskMode(
  ctx: SnapshotContext,
  flags: VmstateSectionFlags,
): VmstateSnapshotMeta["checkpoint"]["rootDisk"] {
  if (ctx.rootDiskMode === "none") {
    return "none";
  }
  return flags.hasRootdiskDelta ? "delta" : "full";
}
