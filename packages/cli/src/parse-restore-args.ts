// Pure arg parser for `machinen restore`. Sibling of parse-run-args.ts
// and parse-fork-args.ts — split out so the parser is unit-testable
// without spawning the CLI.

import { ParseError } from "@machinen/runtime";

import { consumeLiveMount, consumePortForward } from "./parse-run-args.ts";

export interface ParsedRestoreArgs {
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
  liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
}

interface ParseState {
  positional: string[];
  name?: string;
  image?: string;
  lazy: boolean;
  portForward: Array<{ hostPort: number; guestPort: number }>;
  liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  seenLiveGuests: Set<string>;
  seenHostPorts: Set<number>;
}

type FlagHandler = (state: ParseState, args: string[], i: number, flag: string) => number;

const FLAG_HANDLERS: ReadonlyArray<readonly [readonly string[], FlagHandler]> = [
  [["--lazy"], handleLazyFlag],
  [["--name"], handleNameFlag],
  [["--image"], handleImageFlag],
  [["--mount-live"], handleLiveMountFlag],
  [["-p", "--publish"], handlePortForwardFlag],
];

export function parseRestoreArgs(argv: string[]): ParsedRestoreArgs {
  const state: ParseState = {
    positional: [],
    lazy: false,
    portForward: [],
    liveMounts: [],
    seenLiveGuests: new Set<string>(),
    seenHostPorts: new Set<number>(),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = dispatchFlag(state, a, argv, i);
    if (next !== undefined) {
      i = next;
      continue;
    }
    if (a.startsWith("-")) {
      throw new ParseError("PARSE_FLAG_UNKNOWN", `unknown flag: ${a}`);
    }
    state.positional.push(a);
  }
  return {
    positional: state.positional,
    name: state.name,
    image: state.image,
    portForward: state.portForward,
    lazy: state.lazy,
    liveMounts: state.liveMounts,
  };
}

function dispatchFlag(
  state: ParseState,
  arg: string,
  args: string[],
  i: number,
): number | undefined {
  for (const [flags, handler] of FLAG_HANDLERS) {
    for (const flag of flags) {
      if (arg === flag || arg.startsWith(`${flag}=`)) {
        return handler(state, args, i, flag);
      }
    }
  }
  return undefined;
}

function assertNotSeen(predicate: boolean, flag: string): void {
  if (predicate) {
    throw new ParseError(
      "PARSE_FLAG_DUPLICATE",
      `${flag} may be given at most once per invocation`,
    );
  }
}

function takeInlineValue(
  arg: string,
  args: string[],
  i: number,
  flag: string,
): { v: string; i: number } {
  const v = arg === flag ? args[i + 1] : arg.slice(`${flag}=`.length);
  if (!v) {
    throw new ParseError("PARSE_FLAG_MISSING_VALUE", `${flag} requires a value`);
  }
  return { v, i: arg === flag ? i + 1 : i };
}

function handleLazyFlag(state: ParseState, _args: string[], i: number): number {
  state.lazy = true;
  return i;
}

function handleNameFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.name !== undefined, flag);
  const r = takeInlineValue(args[i]!, args, i, flag);
  state.name = r.v;
  return r.i;
}

function handleImageFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.image !== undefined, flag);
  const r = takeInlineValue(args[i]!, args, i, flag);
  state.image = r.v;
  return r.i;
}

function handleLiveMountFlag(state: ParseState, args: string[], i: number): number {
  const { value, next } = consumeLiveMount(args[i]!, args, i);
  // CLI-side dedup: two overrides for the same guest is a typo,
  // not a feature. Runtime would still accept the second one
  // silently (last write wins on Map.set) — fail fast here.
  if (state.seenLiveGuests.has(value.guest)) {
    throw new ParseError(
      "PARSE_FLAG_DUPLICATE",
      `--mount-live override for guest=${value.guest} given more than once`,
    );
  }
  state.seenLiveGuests.add(value.guest);
  state.liveMounts.push(value);
  return next;
}

function handlePortForwardFlag(state: ParseState, args: string[], i: number): number {
  return consumePortForward(args[i]!, args, i, state.seenHostPorts, state.portForward);
}
