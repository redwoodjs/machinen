import { boot, type VmHandle } from "@machinen/runtime";
import debugLib from "debug";
import { resolve } from "node:path";

import { emitJson } from "../args.ts";
import { deriveBootName, resolveCliBaseAssets, type CliBaseAssetPaths } from "../base-assets.ts";
import { describeError, die, failQuiet, handleError } from "../errors.ts";
import { parseRunArgs } from "../parse-run-args.ts";
import { isQuiet, printHeadline, RingBuffer } from "../quiet.ts";
import {
  bootBufferOnlyQuietState,
  bootFilteredQuietState,
  runAttachedVmSession,
  type QuietRunState,
} from "../session.ts";

const debug = debugLib("machinen:cli");

type ParsedBootArgs = ReturnType<typeof parseRunArgs>;

export async function cmdBoot(args: string[]): Promise<number> {
  const parsed = parseBootCommandArgs(args);
  validateBootCommandArgs(parsed);

  // A macOS guest boots a prepared bundle, so the Debian kernel, DTB, and
  // rootfs cache must not be touched. Resolving them first would demand a
  // Linux base install for a guest that has no use for one.
  if (parsed.guestOS === "macos") {
    return bootMacosCommand(parsed);
  }

  const imageOverride = parsed.positional[0];
  const paths = await resolveCliBaseAssets();
  const imagePath = imageOverride ? resolve(imageOverride) : paths.defaultImagePath;
  logBootPlan(paths, imagePath, parsed);

  const quiet = createBootQuietState(parsed, imageOverride);
  const vm = await startBootVm(parsed, paths, imagePath, bootEnvCommand(parsed), quiet);
  if (parsed.detached) {
    reportDetachedBoot(vm, parsed);
    return 0;
  }
  return runBootAttachedSession(vm, quiet);
}

const MACOS_BOOT_REQUIREMENTS: ReadonlyArray<{
  missing: (parsed: ParsedBootArgs) => boolean;
  message: string;
}> = [
  {
    missing: (p) => (p.macosBundle ?? p.positional[0]) === undefined,
    message:
      "boot --guest-os macos needs a prepared bundle. " +
      "Pass --macos-bundle <dir> or a positional bundle path.",
  },
  {
    missing: (p) => p.sshIdentityFile === undefined,
    message:
      "boot --guest-os macos needs an SSH identity file for the guest. " +
      "Pass --ssh-key <path>. Password authentication is not supported.",
  },
];

async function bootMacosCommand(parsed: ParsedBootArgs): Promise<number> {
  rejectLinuxOnlyFlags(parsed);
  requireMacosOptions(parsed);
  const quiet = createBootQuietState(parsed, parsed.macosBundle);
  try {
    return await runMacosBoot(parsed, quiet);
  } catch (err) {
    handleBootFailure(err, quiet);
  }
}

function requireMacosOptions(parsed: ParsedBootArgs): void {
  const unmet = MACOS_BOOT_REQUIREMENTS.find((entry) => entry.missing(parsed));
  if (unmet) {
    die(unmet.message);
  }
}

async function runMacosBoot(parsed: ParsedBootArgs, quiet: QuietRunState): Promise<number> {
  const vm = await boot(macosBootOptions(parsed, quiet));
  if (parsed.detached) {
    reportDetachedBoot(vm, parsed);
    return 0;
  }
  process.stderr.write(
    `machinen: macOS guest ${parsed.name ?? vm.pid} is running over SSH. ` +
      "Interactive sessions are not implemented; use `machinen exec`.\n",
  );
  return 0;
}

function macosBootOptions(
  parsed: ParsedBootArgs,
  quiet: QuietRunState,
): Parameters<typeof boot>[0] {
  return {
    guestOS: "macos",
    provider: parsed.provider as "apple-vz" | undefined,
    name: parsed.name,
    detached: parsed.detached,
    onLog: quiet.onLog,
    timeoutMs: parsed.detached ? undefined : null,
    macos: {
      source: { kind: "prepared-bundle", path: macosBundlePath(parsed) },
      ssh: { user: macosSshUser(parsed), identityFile: parsed.sshIdentityFile! },
      memoryMib: parsed.memory,
    },
  };
}

function macosBundlePath(parsed: ParsedBootArgs): string {
  return (parsed.macosBundle ?? parsed.positional[0])!;
}

function macosSshUser(parsed: ParsedBootArgs): string {
  return parsed.sshUser ?? process.env.USER ?? "admin";
}

function parseBootCommandArgs(args: string[]): ParsedBootArgs {
  try {
    return parseRunArgs(args);
  } catch (err) {
    handleError(err);
  }
}

function validateBootCommandArgs(parsed: ParsedBootArgs): void {
  if (parsed.json && !parsed.detached) {
    die("boot --json is only meaningful with --detach (attached boots take over stdio).");
  }
  if (parsed.positional.length > 1) {
    die(bootUsage());
  }
}

/**
 * Refuse Linux-only flags for a macOS guest before anything spawns.
 * Silently dropping them would produce a guest that does not match the
 * command line.
 */
const LINUX_ONLY_BOOT_FLAGS: ReadonlyArray<{
  flag: string;
  present: (parsed: ParsedBootArgs) => boolean;
}> = [
  { flag: "--snapshot", present: (p) => p.snapshot !== undefined },
  { flag: "--mount", present: (p) => p.mount !== undefined },
  { flag: "--mount-live", present: (p) => p.liveMounts !== undefined },
  { flag: "-p", present: (p) => p.portForward !== undefined },
  { flag: "--nested", present: (p) => p.nested },
  {
    flag: "--cpu-quota/--cpu-weight/--vcpus",
    present: (p) => p.cpu !== undefined && Object.keys(p.cpu).length > 0,
  },
  { flag: "--env", present: (p) => p.env !== undefined },
  { flag: "--cwd", present: (p) => p.guestCwd !== undefined },
  { flag: "-- <cmd>", present: (p) => p.double_dash_args.length > 0 },
];

function rejectLinuxOnlyFlags(parsed: ParsedBootArgs): void {
  const rejected = LINUX_ONLY_BOOT_FLAGS.filter((entry) => entry.present(parsed)).map(
    (entry) => entry.flag,
  );
  if (rejected.length === 0) {
    return;
  }
  die(
    `boot --guest-os macos does not support ${rejected.join(", ")}. ` +
      "A macOS guest boots a prepared bundle and is driven with `machinen exec`.",
  );
}

function bootUsage(): string {
  return (
    "usage: machinen boot [<image>] [--snapshot <path>] [--name <name>] " +
    "[--cwd <abs-path>] " +
    "[--mount ...] [--mount-live ...] [--env KEY=VALUE]... [--detached] " +
    "[--nested] [--memory <mib>] [-- <cmd> [args...]]"
  );
}

function logBootPlan(paths: CliBaseAssetPaths, imagePath: string, parsed: ParsedBootArgs): void {
  debug(
    "boot baseDir=%s kernel=%s dtb=%s image=%s snapshot=%s name=%s",
    paths.baseDir,
    paths.kernelPath,
    paths.dtbPath,
    imagePath,
    parsed.snapshot ?? "<none>",
    parsed.name ?? "<unset>",
  );
}

function bootEnvCommand(parsed: ParsedBootArgs): string[] | undefined {
  // Wrap the user cmd in /usr/bin/env so bare names like `node` or
  // `bash` are PATH-resolved. The guest init uses execve(), which
  // needs an absolute path for argv[0]; /usr/bin/env is the standard
  // shim for this. When the caller passes no `-- cmd`, the image may
  // carry a baked-in default (see `provision({ cmd })`); boot() falls
  // back to that automatically.
  if (parsed.double_dash_args.length === 0) {
    return undefined;
  }
  return ["/usr/bin/env", ...parsed.double_dash_args];
}

function createBootQuietState(
  parsed: ParsedBootArgs,
  imageOverride: string | undefined,
): QuietRunState {
  const headlineName = parsed.name ?? deriveBootName(imageOverride);
  const showHeadlines = shouldShowBootHeadlines(parsed);
  const buffer = new RingBuffer();
  if (!showHeadlines) {
    return { headlineName, showHeadlines, buffer, filter: null, filterOut: null };
  }
  return createVisibleBootQuietState(parsed, headlineName, showHeadlines, buffer);
}

function shouldShowBootHeadlines(parsed: ParsedBootArgs): boolean {
  if (!isQuiet()) {
    return false;
  }
  if (parsed.detached && parsed.json) {
    return false;
  }
  return true;
}

function createVisibleBootQuietState(
  parsed: ParsedBootArgs,
  headlineName: string,
  showHeadlines: boolean,
  buffer: RingBuffer,
): QuietRunState {
  printHeadline(`booting ${headlineName}…`);
  if (parsed.detached) {
    return bootBufferOnlyQuietState(headlineName, showHeadlines, buffer);
  }
  return bootFilteredQuietState(headlineName, showHeadlines, buffer, Date.now());
}

async function startBootVm(
  parsed: ParsedBootArgs,
  paths: CliBaseAssetPaths,
  imagePath: string,
  cmd: string[] | undefined,
  quiet: QuietRunState,
): Promise<VmHandle> {
  try {
    return await boot({
      // Always pass the base rootfs so /sbin/machinen-restore and
      // friends are in the initramfs even on a bare `machinen restore
      // <snap>` (no --image, no -- cmd).
      image: imagePath,
      cmd,
      env: parsed.env,
      kernel: paths.kernelPath,
      dtb: paths.dtbPath,
      mount: parsed.mount,
      liveMounts: parsed.liveMounts,
      portForward: parsed.portForward,
      snapshot: parsed.snapshot,
      nested: parsed.nested,
      name: parsed.name,
      guestCwd: parsed.guestCwd,
      detached: parsed.detached,
      memory: parsed.memory,
      resources: parsed.cpu ? { cpu: parsed.cpu } : undefined,
      onLog: quiet.onLog,
      // Interactive CLI: the session lives as long as the guest does.
      // Don't impose the default 60s cap. Detached boots fall back to
      // the runtime's own readiness timeout (60s) so the CLI can't
      // hang forever waiting for first-guest-byte.
      timeoutMs: parsed.detached ? undefined : null,
    });
  } catch (err) {
    handleBootFailure(err, quiet);
  }
}

// fallow-ignore-next-line code-duplication
function handleBootFailure(err: unknown, quiet: QuietRunState): never {
  quiet.filter?.flush();
  if (quiet.showHeadlines) {
    failQuiet(`boot ${quiet.headlineName} failed: ${describeError(err)}`, {
      buffer: quiet.buffer,
    });
  }
  handleError(err);
}

function reportDetachedBoot(vm: VmHandle, parsed: ParsedBootArgs): void {
  // #150 phase 2: detached boot — VMM is already unrefed inside boot()
  // and the registry entry stays live for `machinen attach`. Print a
  // short hint so users know how to reach the VM and exit cleanly.
  if (parsed.json) {
    emitDetachedBootJson(vm, parsed);
    return;
  }
  printDetachedBootHint(vm, parsed);
}

function emitDetachedBootJson(vm: VmHandle, parsed: ParsedBootArgs): void {
  emitJson({ schema_version: 1, pid: vm.pid, name: parsed.name ?? null, detached: true });
}

function printDetachedBootHint(vm: VmHandle, parsed: ParsedBootArgs): void {
  const target = parsed.name ?? `pid ${vm.pid}`;
  process.stderr.write(
    `machinen: detached (${target}). ` +
      `Reattach: machinen attach ${parsed.name ?? vm.pid}\n` +
      `Stop: kill ${vm.pid}  (machinen stop ships in PR2)\n`,
  );
}

function runBootAttachedSession(vm: VmHandle, quiet: QuietRunState): Promise<number> {
  // Quiet mode: the NoiseFilter already routes vm.stderr (via the
  // `onLog` hook installed by boot()) into the ring buffer + stderr,
  // splitting boot noise from workload output. Operator mode
  // (filter === null) keeps the legacy raw passthrough.
  // In quiet mode, don't display the workload's first prompt until
  // stdin is in raw mode and piped to the VM.
  return runAttachedVmSession(vm, {
    filter: quiet.filter,
    filterOut: quiet.filterOut,
    buffer: quiet.buffer,
    preReadyExitSummary: (code) =>
      `boot ${quiet.headlineName} exited ${code} before reaching ready`,
  });
}
