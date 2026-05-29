// Pure arg parser for `machinen restore`. Sibling of parse-run-args.ts
// and parse-fork-args.ts — split out so the parser is unit-testable
// without spawning the CLI.

import { ParseError } from "@machinen/runtime";

import { consumeLiveMount, consumePortForward, takeValue } from "./parse-run-args.ts";

// fallow-ignore-next-line code-duplication
export interface ParsedRestoreCommandArgs {
  /**
   * Positional args (the snapshot bundle directory). The CLI enforces
   * exactly one — kept as an array here to match the parseRunArgs
   * shape and let the CLI emit the canonical `usage:` line.
   */
  positional: string[];
  /** Optional explicit name for the restored VM (`--name <name>`). */
  name?: string;
  /** Workload rootfs override (`--image <path>`). */
  image?: string;
  /**
   * Host→guest port forwards (`-p <hostPort>:<guestPort>`). Like
   * `fork`, restore does NOT inherit forwards from the source — host
   * ports are global, so the source already binds each one it
   * forwarded. Pass new entries explicitly with non-conflicting
   * host ports.
   */
  portForward: Array<{ hostPort: number; guestPort: number }>;
  /**
   * `--lazy` — opt into lazy-pages restore (#266). Live-mounts the
   * bundle into the guest and runs `criu restore --lazy-pages` so
   * anon pages flow into the workload only when faulted. Default
   * is eager: the runtime packs the CRIU image as a tar on
   * /dev/vdb, the guest untars into tmpfs, and CRIU loads
   * everything up front. Eager is the default because it composes
   * with `--detach` and doesn't fight virtio-balloon's free-page-
   * reporting kthread; the lazy save is moot on workloads that
   * fault every page within the first second anyway.
   */
  lazy: boolean;
  /**
   * #273: per-`guest` overrides for the live-share mounts recorded in
   * the bundle's `meta.liveMounts`. Each entry's `guest` MUST match a
   * recorded entry — restore() reproduces the snapshot's mount
   * topology, so this knob remaps the host path / mode for an
   * existing mount, it doesn't add new ones. The runtime emits
   * BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN for any unmatched entry.
   */
  liveMounts: Array<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
  }>;
  /** Product portable restore target architecture for semantic bundles. */
  targetArch?: "arm64" | "amd64";
  /** File containing target-native verifier output for semantic bundles. */
  targetVerifierOutput?: string;
}

type RestoreFlag =
  | "lazy"
  | "name"
  | "image"
  | "liveMount"
  | "portForward"
  | "targetArch"
  | "targetVerifierOutput";

type RestoreFlagHandler = (
  state: RestoreParseState,
  flag: string,
  args: string[],
  index: number,
) => number;

// fallow-ignore-next-line code-duplication
interface RestoreParseState {
  positional: string[];
  name?: string;
  image?: string;
  portForward: Array<{ hostPort: number; guestPort: number }>;
  lazy: boolean;
  liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  targetArch?: "arm64" | "amd64";
  targetVerifierOutput?: string;
  seenLiveGuests: Set<string>;
  seenHostPorts: Set<number>;
}

const RESTORE_VALUE_FLAGS = new Map<string, RestoreFlag>([
  ["--name", "name"],
  ["--image", "image"],
  ["--mount-live", "liveMount"],
  ["-p", "portForward"],
  ["--publish", "portForward"],
  ["--target-arch", "targetArch"],
  ["--target-verifier-output", "targetVerifierOutput"],
]);

const RESTORE_BARE_FLAGS = new Map<string, RestoreFlag>([["--lazy", "lazy"]]);

const RESTORE_FLAG_HANDLERS: Record<RestoreFlag, RestoreFlagHandler> = {
  lazy: handleRestoreLazy,
  name: handleRestoreName,
  image: handleRestoreImage,
  liveMount: handleRestoreLiveMount,
  portForward: handleRestorePortForward,
  targetArch: handleRestoreTargetArch,
  targetVerifierOutput: handleRestoreTargetVerifierOutput,
};

export function parseRestoreArgs(argv: string[]): ParsedRestoreCommandArgs {
  const state = newRestoreParseState();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const flag = restoreFlagFor(arg);
    if (flag) {
      i = RESTORE_FLAG_HANDLERS[flag](state, arg, argv, i);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ParseError("PARSE_FLAG_UNKNOWN", `unknown flag: ${arg}`);
    }
    state.positional.push(arg);
  }

  return finishRestoreArgs(state);
}

function newRestoreParseState(): RestoreParseState {
  return {
    positional: [],
    portForward: [],
    lazy: false,
    liveMounts: [],
    seenLiveGuests: new Set<string>(),
    seenHostPorts: new Set<number>(),
  };
}

function restoreFlagFor(arg: string): RestoreFlag | undefined {
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    return RESTORE_VALUE_FLAGS.get(arg.slice(0, eq));
  }
  return RESTORE_BARE_FLAGS.get(arg) ?? RESTORE_VALUE_FLAGS.get(arg);
}

function finishRestoreArgs(state: RestoreParseState): ParsedRestoreCommandArgs {
  return {
    positional: state.positional,
    name: state.name,
    image: state.image,
    portForward: state.portForward,
    lazy: state.lazy,
    liveMounts: state.liveMounts,
    targetArch: state.targetArch,
    targetVerifierOutput: state.targetVerifierOutput,
  };
}

function handleRestoreLazy(
  state: RestoreParseState,
  _flag: string,
  _args: string[],
  index: number,
): number {
  state.lazy = true;
  return index;
}

function handleRestoreName(
  state: RestoreParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  const { spec, next } = takeRestoreValue(flag, args, index, "a value", "--name");
  assertRestoreFlagUnused(state.name !== undefined, "--name");
  state.name = spec;
  return next;
}

function handleRestoreImage(
  state: RestoreParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  const { spec, next } = takeRestoreValue(flag, args, index, "a value", "--image");
  assertRestoreFlagUnused(state.image !== undefined, "--image");
  state.image = spec;
  return next;
}

function handleRestoreTargetArch(
  state: RestoreParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  const { spec, next } = takeRestoreValue(flag, args, index, "arm64 or amd64", "--target-arch");
  assertRestoreFlagUnused(state.targetArch !== undefined, "--target-arch");
  if (spec !== "arm64" && spec !== "amd64") {
    throw new ParseError("PARSE_FLAG_MALFORMED", "--target-arch must be arm64 or amd64");
  }
  state.targetArch = spec;
  return next;
}

function handleRestoreTargetVerifierOutput(
  state: RestoreParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  const { spec, next } = takeRestoreValue(
    flag,
    args,
    index,
    "a file path",
    "--target-verifier-output",
  );
  assertRestoreFlagUnused(state.targetVerifierOutput !== undefined, "--target-verifier-output");
  state.targetVerifierOutput = spec;
  return next;
}

function handleRestoreLiveMount(
  state: RestoreParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  const { value, next } = consumeLiveMount(flag, args, index);
  assertRestoreLiveGuestUnused(state, value.guest);
  state.seenLiveGuests.add(value.guest);
  state.liveMounts.push(value);
  return next;
}

function handleRestorePortForward(
  state: RestoreParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  return consumePortForward(flag, args, index, state.seenHostPorts, state.portForward);
}

function takeRestoreValue(
  flag: string,
  args: string[],
  index: number,
  label: string,
  displayFlag: string,
): { spec: string; next: number } {
  const result = takeValue(flag, args, index, label);
  if (!result.spec) {
    throw new ParseError("PARSE_FLAG_MISSING_VALUE", `${displayFlag} requires ${label}`);
  }
  return result;
}

function assertRestoreFlagUnused(used: boolean, flag: string): void {
  if (used) {
    throw new ParseError(
      "PARSE_FLAG_DUPLICATE",
      `${flag} may be given at most once per invocation`,
    );
  }
}

function assertRestoreLiveGuestUnused(state: RestoreParseState, guest: string): void {
  // CLI-side dedup: two overrides for the same guest is a typo,
  // not a feature. Runtime would still accept the second one
  // silently (last write wins on Map.set) — fail fast here.
  if (state.seenLiveGuests.has(guest)) {
    throw new ParseError(
      "PARSE_FLAG_DUPLICATE",
      `--mount-live override for guest=${guest} given more than once`,
    );
  }
}
