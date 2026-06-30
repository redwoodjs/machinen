import { randomBytes } from "node:crypto";
import { closeSync, existsSync, mkdtempSync, openSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import debugLib from "debug";

import { BootError } from "../errors.ts";
import {
  describePortHolder,
  ensureGvproxy,
  exposePort,
  probeHostPortFree,
  spawnGvproxy,
  warnGvproxyMissing,
} from "../gvproxy.ts";
import {
  applyNestedVirtualizationEnv,
  preflightNestedVirtualization,
  probeVmmNestedVirtualization,
} from "../nested-virt.ts";
import { reflinkCopy } from "../reflink.ts";
import { allocateSparseFile, SNAP_SCRATCH_BYTES } from "./helpers.ts";
import { resolveMemoryCeilingMib } from "./memory-resources.ts";
import type { BootOptions } from "./boot.ts";

const debug = debugLib("machinen:boot");

export async function validatePortForwardOpts(
  opts: BootOptions,
  portForward: NonNullable<BootOptions["portForward"]>,
): Promise<void> {
  if (portForward.length === 0) {
    return;
  }
  rejectPresetNetSocket(opts);
  validatePortForwardShape(portForward);
  await validatePortForwardAvailability(portForward);
}

function rejectPresetNetSocket(opts: BootOptions): void {
  const preSetNetSock =
    (opts.vmmEnv && opts.vmmEnv.MACHINEN_NET_SOCKET) || process.env.MACHINEN_NET_SOCKET;
  if (preSetNetSock) {
    throw new BootError(
      "BOOT_PORT_FORWARD_INVALID",
      "portForward requires the runtime to own gvproxy, but MACHINEN_NET_SOCKET " +
        "is already set. Either drop the env var or install the forwards yourself " +
        "against your gvproxy's control API.",
    );
  }
}

function validatePortForwardShape(portForward: NonNullable<BootOptions["portForward"]>): void {
  const seen = new Set<number>();
  for (const mapping of portForward) {
    validatePortMappingNumbers(mapping);
    rejectDuplicateHostPort(mapping.hostPort, seen);
  }
}

function validatePortMappingNumbers(
  mapping: NonNullable<BootOptions["portForward"]>[number],
): void {
  for (const [label, port] of portMappingPorts(mapping)) {
    if (!validTcpPort(port)) {
      throw new BootError(
        "BOOT_PORT_FORWARD_INVALID",
        `portForward: ${label} must be an integer in 1..65535 (got ${port})`,
      );
    }
  }
}

function portMappingPorts(
  mapping: NonNullable<BootOptions["portForward"]>[number],
): Array<readonly ["hostPort" | "guestPort", number]> {
  return [
    ["hostPort", mapping.hostPort],
    ["guestPort", mapping.guestPort],
  ];
}

function validTcpPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

function rejectDuplicateHostPort(hostPort: number, seen: Set<number>): void {
  if (seen.has(hostPort)) {
    throw new BootError(
      "BOOT_PORT_FORWARD_CONFLICT",
      `portForward: duplicate hostPort ${hostPort}`,
    );
  }
  seen.add(hostPort);
}

async function validatePortForwardAvailability(
  portForward: NonNullable<BootOptions["portForward"]>,
): Promise<void> {
  for (const mapping of portForward) {
    await validateHostPortFree(mapping);
  }
}

async function validateHostPortFree(
  mapping: NonNullable<BootOptions["portForward"]>[number],
): Promise<void> {
  const host = mapping.hostAddr ?? "127.0.0.1";
  const errno = await probeHostPortFree(host, mapping.hostPort);
  if (!errno) {
    return;
  }
  throw new BootError(
    "BOOT_PORT_FORWARD_IN_USE",
    `portForward: host port ${host}:${mapping.hostPort} is already in use (${errno}). ${await portHolderDetail(mapping.hostPort)}`,
  );
}

async function portHolderDetail(hostPort: number): Promise<string> {
  const holder = await describePortHolder(hostPort).catch(() => null);
  return holder
    ? `${holder}.`
    : "Common cause: an orphaned gvproxy from a prior `kill -9` of the VMM. " +
        "Try `pkill -f gvproxy` to clear it, or pick a different host port.";
}

// #263 phase A: forward the guest RAM ceiling so the VMM doesn't
// fall back to its boot_*.zig hardcoded default. An explicit caller
// value via vmmEnv wins over our auto-size; that's the documented
// debug-knob escape hatch. Returns the resolved ceiling so it can be
// persisted on the registry entry; undefined when caller pre-set
// MACHINEN_MEMORY (the runtime didn't pick the number, so it can't
// honestly report it).
export function configureNestedVirtualization(
  opts: BootOptions,
  binary: string,
  env: Record<string, string>,
): void {
  if (opts.nested) {
    preflightNestedVirtualization();
    probeVmmNestedVirtualization(binary, opts.cwd, env);
  }
  applyNestedVirtualizationEnv(opts.nested, env);
}

export function setMemoryCeiling(
  opts: BootOptions,
  env: Record<string, string>,
): number | undefined {
  // Validate public API input even when lower-level vmmEnv wins.
  const ceiling = resolveMemoryCeilingMib(opts);
  if (env.MACHINEN_MEMORY !== undefined) {
    return undefined;
  }
  env.MACHINEN_MEMORY = String(ceiling);
  return ceiling;
}

// The scratch virtio-blk device serves two unrelated workloads:
//   - caller-supplied path (string): a CRIU snapshot bundle to
//     restore from at boot — the runtime synthesizes
//     /sbin/machinen-restore when no cmd is given. The bundle is
//     reflink-cloned into a per-boot path so a future `vm.snapshot()`
//     against the restored VM doesn't corrupt the source bundle
//     when machinen-dump.sh re-formats the disk (#207).
//   - default (undefined): per-boot sparse scratch so any VM is
//     CRIU-dumpable later via vm.snapshot(). 8 GiB sparse means zero
//     real disk until the guest writes; cleaned up alongside the
//     rootdisk reflink on VM exit. Don't synthesize restore for this
//     case (the file is empty).
//   - `false`: opt out, no /dev/vdb. Test-fast paths use this.
export function prepareScratchDisk(
  opts: BootOptions,
  env: Record<string, string>,
): { diskAbs: string | undefined; perBootSnapDisk: string | undefined } {
  if (opts.snapshot === false) {
    return { diskAbs: undefined, perBootSnapDisk: undefined };
  }
  if (typeof opts.snapshot === "string") {
    const bundleDisk = resolve(opts.cwd ?? process.cwd(), opts.snapshot);
    if (!existsSync(bundleDisk)) {
      throw new BootError("BOOT_SNAPSHOT_NOT_FOUND", `snapshot image not found: ${bundleDisk}`);
    }
    // An explicit `cmd` means the caller is running their own workload
    // (e.g. provision()'s tar-to-/dev/vdb dump), not restoring a CRIU
    // bundle — so attach the disk in place. The reflink-clone below is
    // only needed for the restore path, where machinen-dump.sh later
    // mkfs's the scratch disk and would otherwise corrupt the source
    // bundle on the host fs (#207).
    if (opts.cmd) {
      env.MACHINEN_DISK = bundleDisk;
      debug("snap-restore in-place (explicit cmd) path=%s", bundleDisk);
      return { diskAbs: bundleDisk, perBootSnapDisk: undefined };
    }
    // Reflink-clone the bundle disk into a per-boot path so the
    // restored VM can be snapshotted again (#207). Same pattern as
    // #121 for the rootdisk: COPYFILE_FICLONE → cheap shared blocks
    // until guest writes, falls back to a full copy on non-reflink
    // filesystems.
    const perBoot = join(
      tmpdir(),
      `machinen-snap-restore-${process.pid}-${randomBytes(6).toString("hex")}.img`,
    );
    reflinkCopy(bundleDisk, perBoot);
    env.MACHINEN_DISK = perBoot;
    debug("snap-restore reflink-clone src=%s dst=%s", bundleDisk, perBoot);
    return { diskAbs: perBoot, perBootSnapDisk: perBoot };
  }
  if (!opts.image) {
    return { diskAbs: undefined, perBootSnapDisk: undefined };
  }
  // Auto-allocate only when the caller is booting a real image-backed
  // guest. VMM-only smoke boots (no image — e.g. MACHINEN_BOOT_TEST=1)
  // would otherwise be handed a zero-byte file as /dev/vda, failing
  // root mount; they have nothing to snapshot anyway. `cmd && !image`
  // already errors above, so this check covers all snapshotable
  // workload paths.
  const scratchPath = join(
    tmpdir(),
    `machinen-snap-${process.pid}-${randomBytes(6).toString("hex")}.img`,
  );
  allocateSparseFile(scratchPath, SNAP_SCRATCH_BYTES);
  env.MACHINEN_DISK = scratchPath;
  debug("snap-scratch auto path=%s sizeBytes=%d", scratchPath, SNAP_SCRATCH_BYTES);
  return { diskAbs: scratchPath, perBootSnapDisk: scratchPath };
}

export function validateKernelDtb(opts: BootOptions, env: Record<string, string>): void {
  if (opts.kernel) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.kernel);
    if (!existsSync(abs)) {
      throw new BootError("BOOT_KERNEL_NOT_FOUND", `kernel not found: ${abs}`);
    }
    env.MACHINEN_KERNEL = abs;
  }
  if (opts.dtb) {
    const abs = resolve(opts.cwd ?? process.cwd(), opts.dtb);
    if (!existsSync(abs)) {
      throw new BootError("BOOT_DTB_NOT_FOUND", `dtb not found: ${abs}`);
    }
    env.MACHINEN_DTB = abs;
  }
}

// #94: always wire up a vsock UDS bridge so `vm.exec()` works out of
// the box. Callers who set their own `MACHINEN_VSOCK` (e.g. the build
// flow) win — we parse their spec to extract the UDS path for exec.
export function setupVsockBridge(env: Record<string, string>): {
  vsockUdsPath: string | undefined;
  vsockTempDir: string | undefined;
} {
  if (env.MACHINEN_VSOCK) {
    const vsockUdsPath = parseVsockUdsPath(env.MACHINEN_VSOCK);
    debug(
      "vsock spec from caller env: %s (uds=%s)",
      env.MACHINEN_VSOCK,
      vsockUdsPath ?? "<unparsed>",
    );
    return { vsockUdsPath, vsockTempDir: undefined };
  }
  const vsockTempDir = mkdtempSync(join(tmpdir(), "machinen-vsock-"));
  const vsockUdsPath = join(vsockTempDir, "exec.sock");
  env.MACHINEN_VSOCK = `in:1978:${vsockUdsPath}`;
  debug("vsock auto uds=%s", vsockUdsPath);
  return { vsockUdsPath, vsockTempDir };
}

function parseVsockUdsPath(spec: string): string | undefined {
  return spec.match(/^in:\d+:(.+)$/)?.[1];
}

// #274: shared stats file the balloon backend writes counters to.
// 16 bytes (two u64 LE atomics, see balloon-stats.ts + stats.zig).
// Pre-allocated zero-filled here so the VMM's mmap'd writer and our
// host-side reader see a coherent layout even before the first
// reporting chain. Co-located under `vsockTempDir` when we own one
// (so cleanup rides along on its rmSync); otherwise allocated in
// tmpdir() with its own cleanup entry. Skipped when the caller
// already pre-set `MACHINEN_STATS_FILE` (debug knob).
export function setupStatsFile(
  env: Record<string, string>,
  vsockTempDir: string | undefined,
): { statsFilePath: string | undefined; statsTempDir: string | undefined } {
  if (env.MACHINEN_STATS_FILE !== undefined) {
    return { statsFilePath: env.MACHINEN_STATS_FILE, statsTempDir: undefined };
  }
  let statsTempDir: string | undefined;
  let statsFilePath: string;
  if (vsockTempDir) {
    statsFilePath = join(vsockTempDir, "stats.bin");
  } else {
    statsTempDir = mkdtempSync(join(tmpdir(), "machinen-stats-"));
    statsFilePath = join(statsTempDir, "stats.bin");
  }
  const fd = openSync(statsFilePath, "w");
  try {
    writeSync(fd, Buffer.alloc(16), 0, 16, 0);
  } finally {
    closeSync(fd);
  }
  env.MACHINEN_STATS_FILE = statsFilePath;
  return { statsFilePath, statsTempDir };
}

interface GvproxyResult {
  gvStop: (() => void) | undefined;
  gvPid: number | undefined;
  gvExe: string | undefined;
  gvSocketDir: string | undefined;
}

export async function bringUpGvproxy(
  opts: BootOptions,
  binary: string,
  env: Record<string, string>,
  portForward: NonNullable<BootOptions["portForward"]>,
): Promise<GvproxyResult> {
  if (env.MACHINEN_NET_SOCKET) {
    debug("MACHINEN_NET_SOCKET already set — skipping gvproxy spawn");
    return { gvStop: undefined, gvPid: undefined, gvExe: undefined, gvSocketDir: undefined };
  }
  // Auto-install gvproxy on first use if not already resolvable —
  // visible stderr line; cached under ~/.machinen so subsequent
  // boots are silent. See #83 follow-up.
  const gvBin = await ensureGvproxy(binary);
  if (!gvBin) {
    if (portForward.length > 0) {
      throw new BootError(
        "BOOT_PORT_FORWARD_NO_GVPROXY",
        "portForward requires gvproxy, but no gvproxy binary was found. " +
          "Install gvproxy or point MACHINEN_GVPROXY at one.",
      );
    }
    debug("gvproxy not found — booting without networking");
    warnGvproxyMissing();
    return { gvStop: undefined, gvPid: undefined, gvExe: undefined, gvSocketDir: undefined };
  }
  debug("starting gvproxy bin=%s", gvBin);
  // Detach gvproxy alongside the VMM so the parent can exit
  // without stranding the guest's networking (#150 phase 2 PR3).
  const gv = await spawnGvproxy(gvBin, { detached: opts.detached });
  env.MACHINEN_NET_SOCKET = gv.socketPath;
  for (const m of portForward) {
    await exposePort(gv.controlSocketPath, m);
  }
  return {
    gvStop: gv.stop,
    gvPid: gv.child.pid,
    gvExe: gvBin,
    gvSocketDir: gv.socketDir,
  };
}

// #221/#233: stamp first-guest-byte and emit the boot timeline. Either
// path (first stderr byte, or VMM exit before any output) flushes
// exactly once — `phases.end` is a no-op the second time around. Also
