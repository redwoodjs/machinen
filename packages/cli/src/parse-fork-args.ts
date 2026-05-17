// Pure arg parser for `machinen fork`. Sibling of parse-run-args.ts —
// split out so the parser is unit-testable without spawning the CLI.
//
// Fork is "snapshot live + restore" rolled into one call, so the flag
// surface mirrors `machinen boot` for the most part: --mount,
// --mount-live, --env, --memory, --cwd all take effect on the
// restored sibling. Fork-only flags are --new-name, --out-dir,
// --tcp-keep, --detach. The source target (`--name`/`--pid`) is
// resolved by `parseTargetFlags` from the `rest` we pass through.

import { ParseError } from "@machinen/runtime";

import {
  consumeEnv,
  consumeGuestCwd,
  consumeLiveMount,
  consumeMemory,
  consumeMount,
  consumePortForward,
  takeValue,
} from "./parse-run-args.ts";

interface ParsedForkArgs {
  /** Optional name for the fork (`--new-name <n>`). */
  newName?: string;
  /** Where to write the snapshot bundle (`--out-dir <d>`). */
  outDir?: string;
  /** Inherit live TCP connections into the fork (`--tcp-keep`). */
  tcpKeep: boolean;
  /** Hand the fork off and return immediately (`--detach`). */
  detach: boolean;
  /**
   * `--lazy` — opt into lazy-pages restore for this fork (#266).
   * Forced off whenever `--detach` is set: the lazy path relies on
   * a host-side FUSE server that lives in the runtime supervisor
   * process, and `--detach` exits that process, which would leave
   * the in-guest `criu lazy-pages` daemon blocked on the now-dead
   * FUSE channel. Lifting this constraint is #150 phase 3 — until
   * then, detach implies eager.
   */
  lazy: boolean;
  /**
   * Host→guest port forwards (`-p <hostPort>:<guestPort>`). NOT
   * inherited from the source — host ports are global, so the source
   * already binds each one it forwarded. Pass new entries explicitly
   * with non-conflicting host ports.
   */
  portForward: Array<{ hostPort: number; guestPort: number }>;
  /**
   * Single host directory to copy into the fork at boot
   * (`--mount <host>:<guest>`). Copy-once: same semantics as
   * `boot --mount`. Independent of the source's mount — the source's
   * `--mount` payload was baked into its rootdisk before snapshot,
   * so the fork inherits it via the disk image. Use this flag to
   * overlay an *additional* host dir on the fork.
   */
  mount?: { host: string; guest: string };
  /**
   * Live-share mounts (`--mount-live <host>:<guest>[:<mode>]`).
   * Establishes the mount on the fork after restore via an in-VMM
   * virtio-fs device (#332). See #78, #151.
   */
  liveMounts?: Array<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
  }>;
  /** Env vars exposed to the forked guest workload (`--env KEY=VALUE`). */
  env?: Record<string, string>;
  /**
   * Working directory for the guest cmd in the fork (`--cwd <abs-path>`).
   * Same shape as `boot --cwd`. Useful with `--mount` / `--mount-live`
   * to land directly inside the share.
   */
  guestCwd?: string;
  /**
   * Guest RAM ceiling for the fork in MiB (`--memory <mib>`). Same
   * shape as `boot --memory`. The runtime auto-sizes by default.
   */
  memory?: number;
  /** Args we didn't recognize — passed to `parseTargetFlags`. */
  rest: string[];
}

type ForkFlag =
  | "newName"
  | "outDir"
  | "tcpKeep"
  | "detach"
  | "lazy"
  | "portForward"
  | "mount"
  | "liveMount"
  | "env"
  | "guestCwd"
  | "memory";

type ForkFlagHandler = (
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
) => number;

interface ForkParseState {
  newName?: string;
  outDir?: string;
  tcpKeep: boolean;
  detach: boolean;
  lazy: boolean;
  portForward: Array<{ hostPort: number; guestPort: number }>;
  seenHostPorts: Set<number>;
  mount?: { host: string; guest: string };
  liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  env: Record<string, string>;
  guestCwd?: string;
  memory?: number;
  rest: string[];
}

const FORK_VALUE_FLAGS = new Map<string, ForkFlag>([
  ["--new-name", "newName"],
  ["--out-dir", "outDir"],
  ["-p", "portForward"],
  ["--publish", "portForward"],
  ["--mount", "mount"],
  ["--mount-live", "liveMount"],
  ["--env", "env"],
  ["--cwd", "guestCwd"],
  ["--memory", "memory"],
]);

const FORK_BARE_FLAGS = new Map<string, ForkFlag>([
  ["--tcp-keep", "tcpKeep"],
  ["--detach", "detach"],
  ["--lazy", "lazy"],
]);

const FORK_FLAG_HANDLERS: Record<ForkFlag, ForkFlagHandler> = {
  newName: handleForkNewName,
  outDir: handleForkOutDir,
  tcpKeep: handleForkTcpKeep,
  detach: handleForkDetach,
  lazy: handleForkLazy,
  portForward: handleForkPortForward,
  mount: handleForkMount,
  liveMount: handleForkLiveMount,
  env: handleForkEnv,
  guestCwd: handleForkGuestCwd,
  memory: handleForkMemory,
};

export function parseForkArgs(argv: string[]): ParsedForkArgs {
  const state = newForkParseState();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    const flag = forkFlagFor(arg);
    if (flag) {
      i = FORK_FLAG_HANDLERS[flag](state, arg, argv, i);
      continue;
    }
    state.rest.push(arg);
  }

  return finishForkArgs(state);
}

function newForkParseState(): ForkParseState {
  return {
    tcpKeep: false,
    detach: false,
    lazy: false,
    portForward: [],
    seenHostPorts: new Set<number>(),
    liveMounts: [],
    env: {},
    rest: [],
  };
}

function forkFlagFor(arg: string): ForkFlag | undefined {
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    return FORK_VALUE_FLAGS.get(arg.slice(0, eq));
  }
  return FORK_BARE_FLAGS.get(arg) ?? FORK_VALUE_FLAGS.get(arg);
}

function finishForkArgs(state: ForkParseState): ParsedForkArgs {
  // Detach exits the runtime supervisor, taking the host-side FUSE
  // server with it — the in-guest lazy-pages daemon would then block
  // on a dead FUSE channel. Force eager (lazy=false) to keep --detach
  // usable until the FUSE server gains its own detach handoff
  // (#150 phase 3).
  return {
    newName: state.newName,
    outDir: state.outDir,
    tcpKeep: state.tcpKeep,
    detach: state.detach,
    lazy: state.lazy && !state.detach,
    portForward: state.portForward,
    mount: state.mount,
    liveMounts: state.liveMounts.length > 0 ? state.liveMounts : undefined,
    env: Object.keys(state.env).length > 0 ? state.env : undefined,
    guestCwd: state.guestCwd,
    memory: state.memory,
    rest: state.rest,
  };
}

function handleForkNewName(
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertForkFlagUnused(state.newName !== undefined, "--new-name");
  const { spec, next } = takeValue(flag, args, index, "a value");
  state.newName = spec;
  return next;
}

function handleForkOutDir(
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertForkFlagUnused(state.outDir !== undefined, "--out-dir");
  const { spec, next } = takeValue(flag, args, index, "a directory path");
  state.outDir = spec;
  return next;
}

function handleForkTcpKeep(
  state: ForkParseState,
  _flag: string,
  _args: string[],
  index: number,
): number {
  state.tcpKeep = true;
  return index;
}

function handleForkDetach(
  state: ForkParseState,
  _flag: string,
  _args: string[],
  index: number,
): number {
  state.detach = true;
  return index;
}

function handleForkLazy(
  state: ForkParseState,
  _flag: string,
  _args: string[],
  index: number,
): number {
  state.lazy = true;
  return index;
}

function handleForkPortForward(
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  return consumePortForward(flag, args, index, state.seenHostPorts, state.portForward);
}

function handleForkMount(
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertForkFlagUnused(state.mount !== undefined, "--mount");
  const result = consumeMount(flag, args, index);
  state.mount = result.value;
  return result.next;
}

function handleForkLiveMount(
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  const result = consumeLiveMount(flag, args, index);
  state.liveMounts.push(result.value);
  return result.next;
}

function handleForkEnv(state: ForkParseState, flag: string, args: string[], index: number): number {
  const result = consumeEnv(flag, args, index);
  state.env[result.key] = result.value;
  return result.next;
}

function handleForkGuestCwd(
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertForkFlagUnused(state.guestCwd !== undefined, "--cwd");
  const result = consumeGuestCwd(flag, args, index);
  state.guestCwd = result.value;
  return result.next;
}

function handleForkMemory(
  state: ForkParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertForkFlagUnused(state.memory !== undefined, "--memory");
  const result = consumeMemory(flag, args, index);
  state.memory = result.value;
  return result.next;
}

function assertForkFlagUnused(used: boolean, flag: string): void {
  if (used) {
    throw new ParseError(
      "PARSE_FLAG_DUPLICATE",
      `${flag} may be given at most once per invocation`,
    );
  }
}
