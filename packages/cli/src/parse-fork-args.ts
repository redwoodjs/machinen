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

export interface ParsedForkArgs {
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
   * Live-share FUSE mounts (`--mount-live <host>:<guest>[:<mode>]`).
   * Establishes a fresh vsock FUSE channel on the fork after restore.
   * The source must NOT have its own live mount active at fork time
   * (that's caught by the runtime — vsock FUSE channels can't survive
   * CRIU dump). See #78, #151.
   */
  liveMounts?: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
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

interface ParseState {
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

type FlagHandler = (state: ParseState, args: string[], i: number, flag: string) => number;

const FLAG_HANDLERS: ReadonlyArray<readonly [readonly string[], FlagHandler]> = [
  [["--new-name"], handleNewNameFlag],
  [["--out-dir"], handleOutDirFlag],
  [["--tcp-keep"], handleTcpKeepFlag],
  [["--detach"], handleDetachFlag],
  [["--lazy"], handleLazyFlag],
  [["-p", "--publish"], handlePortForwardFlag],
  [["--mount"], handleMountFlag],
  [["--mount-live"], handleLiveMountFlag],
  [["--env"], handleEnvFlag],
  [["--cwd"], handleCwdFlag],
  [["--memory"], handleMemoryFlag],
];

export function parseForkArgs(argv: string[]): ParsedForkArgs {
  const state: ParseState = {
    tcpKeep: false,
    detach: false,
    lazy: false,
    portForward: [],
    seenHostPorts: new Set<number>(),
    liveMounts: [],
    env: {},
    rest: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    const next = dispatchFlag(state, a, argv, i);
    if (next !== undefined) {
      i = next;
      continue;
    }
    state.rest.push(a);
  }
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

function handleNewNameFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.newName !== undefined, flag);
  const { spec, next } = takeValue(args[i]!, args, i, "a value");
  state.newName = spec;
  return next;
}

function handleOutDirFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.outDir !== undefined, flag);
  const { spec, next } = takeValue(args[i]!, args, i, "a directory path");
  state.outDir = spec;
  return next;
}

function handleTcpKeepFlag(state: ParseState, _args: string[], i: number): number {
  state.tcpKeep = true;
  return i;
}

function handleDetachFlag(state: ParseState, _args: string[], i: number): number {
  state.detach = true;
  return i;
}

function handleLazyFlag(state: ParseState, _args: string[], i: number): number {
  state.lazy = true;
  return i;
}

function handlePortForwardFlag(state: ParseState, args: string[], i: number): number {
  return consumePortForward(args[i]!, args, i, state.seenHostPorts, state.portForward);
}

function handleMountFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.mount !== undefined, flag);
  const r = consumeMount(args[i]!, args, i);
  state.mount = r.value;
  return r.next;
}

function handleLiveMountFlag(state: ParseState, args: string[], i: number): number {
  const r = consumeLiveMount(args[i]!, args, i);
  state.liveMounts.push(r.value);
  return r.next;
}

function handleEnvFlag(state: ParseState, args: string[], i: number): number {
  const r = consumeEnv(args[i]!, args, i);
  state.env[r.key] = r.value;
  return r.next;
}

function handleCwdFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.guestCwd !== undefined, flag);
  const r = consumeGuestCwd(args[i]!, args, i);
  state.guestCwd = r.value;
  return r.next;
}

function handleMemoryFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.memory !== undefined, flag);
  const r = consumeMemory(args[i]!, args, i);
  state.memory = r.value;
  return r.next;
}
