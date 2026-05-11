// Pure arg parser for `machinen boot`. Split out from cli.ts so tests
// can import it without pulling @machinen/runtime (which resolves to
// dist/ and is unbuilt in the monorepo dev loop).

import { ParseError } from "@machinen/runtime";

interface ParsedRunArgs {
  positional: string[];
  double_dash_args: string[];
  mount?: { host: string; guest: string };
  /**
   * Live-share FUSE mounts (`--mount-live <host>:<guest>[:<mode>]`).
   * Each entry stays connected to the host filesystem for the VM's
   * life; guest reads stream in on demand. `mode` is `rw` (default,
   * write-through) or `ro` for read-only. See #78, #151.
   */
  liveMounts?: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  env?: Record<string, string>;
  portForward?: Array<{ hostPort: number; guestPort: number }>;
  /** Snapshot image to restore from (`--snapshot <path>`). */
  snapshot?: string;
  /** Optional VM name registered for `attach` (`--name <name>`). */
  name?: string;
  /**
   * Working directory for the guest cmd (`--cwd <abs-path>`). Lands
   * as `cwd` in the synthesized `machinen-config.json` and is
   * consumed by the guest `/init`. Must be absolute.
   */
  guestCwd?: string;
  /**
   * Detach the VMM from the CLI on first-guest-byte readiness so the
   * shell can exit while the VM keeps running. Reattach later with
   * `machinen attach <name|pid>`. See issue #150 phase 2 — refused in
   * v1 alongside `--mount`, `--mount-live`, and `-p` (those keep
   * helpers alive in the CLI).
   */
  detached?: boolean;
  /**
   * Guest RAM ceiling in MiB (`--memory <mib>`). Decimal integer, no
   * unit suffixes. Forwards to `boot({ memory })`. Documented as a
   * debug knob — most workloads should let the runtime auto-size.
   * See #263.
   */
  memory?: number;
  /**
   * Emit the boot identity (pid + name) as JSON to stdout. Only
   * meaningful with `--detach` — attached boots hand stdio to the
   * guest and have no clean place to print structured output. See
   * Trevin's principle 2 (structured output).
   */
  json?: boolean;
}

interface ParseState {
  positional: string[];
  mount?: { host: string; guest: string };
  liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
  env: Record<string, string>;
  portForward: Array<{ hostPort: number; guestPort: number }>;
  seenHostPorts: Set<number>;
  snapshot?: string;
  name?: string;
  guestCwd?: string;
  detached: boolean;
  memory?: number;
  json: boolean;
}

type FlagHandler = (state: ParseState, args: string[], i: number, flag: string) => number;

// Flag → handler dispatch table. Order doesn't matter (each entry
// matches by exact flag or `<flag>=` prefix). One row per logical
// flag; aliases share a row.
const FLAG_HANDLERS: ReadonlyArray<readonly [readonly string[], FlagHandler]> = [
  [["--mount"], handleMountFlag],
  [["--mount-live"], handleLiveMountFlag],
  [["--env"], handleEnvFlag],
  [["-p", "--publish"], handlePortForwardFlag],
  [["--snapshot"], handleSnapshotFlag],
  [["--cwd"], handleGuestCwdFlag],
  [["--name"], handleNameFlag],
  [["--detached", "--detach"], handleDetachedFlag],
  [["--json"], handleJsonFlag],
  [["--memory"], handleMemoryFlag],
];

export function parseRunArgs(argv: string[]): ParsedRunArgs {
  const idx = argv.indexOf("--");
  const pre = idx === -1 ? argv : argv.slice(0, idx);
  const double_dash_args = idx === -1 ? [] : argv.slice(idx + 1);

  const state: ParseState = {
    positional: [],
    liveMounts: [],
    env: {},
    portForward: [],
    seenHostPorts: new Set<number>(),
    detached: false,
    json: false,
  };
  for (let i = 0; i < pre.length; i++) {
    const a = pre[i]!;
    const next = dispatchFlag(state, a, pre, i);
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
    double_dash_args,
    mount: state.mount,
    liveMounts: state.liveMounts.length > 0 ? state.liveMounts : undefined,
    env: Object.keys(state.env).length > 0 ? state.env : undefined,
    portForward: state.portForward.length > 0 ? state.portForward : undefined,
    snapshot: state.snapshot,
    name: state.name,
    guestCwd: state.guestCwd,
    detached: state.detached || undefined,
    memory: state.memory,
    json: state.json || undefined,
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

function handlePortForwardFlag(state: ParseState, args: string[], i: number): number {
  return consumePortForward(args[i]!, args, i, state.seenHostPorts, state.portForward);
}

function handleSnapshotFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.snapshot !== undefined, flag);
  const { spec, next } = takeValue(args[i]!, args, i, "a path value");
  state.snapshot = spec;
  return next;
}

function handleGuestCwdFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.guestCwd !== undefined, flag);
  const r = consumeGuestCwd(args[i]!, args, i);
  state.guestCwd = r.value;
  return r.next;
}

function handleNameFlag(state: ParseState, args: string[], i: number, flag: string): number {
  assertNotSeen(state.name !== undefined, flag);
  const { spec, next } = takeValue(args[i]!, args, i, "a value");
  state.name = spec;
  return next;
}

function handleDetachedFlag(state: ParseState, args: string[], i: number): number {
  assertNotSeen(state.detached, "--detached");
  state.detached = true;
  // `--detached` is the legacy spelling. Surface a one-line
  // deprecation note so existing scripts keep working but agents
  // (and humans) learn the canonical name. Suppressed under
  // MACHINEN_QUIET_DEPRECATIONS (set by tests) and under VITEST
  // (parseRunArgs is unit-tested with --detached on every run).
  if (args[i] === "--detached" && !process.env.MACHINEN_QUIET_DEPRECATIONS && !process.env.VITEST) {
    process.stderr.write("machinen: --detached is deprecated; use --detach (same behaviour).\n");
  }
  return i;
}

function handleJsonFlag(state: ParseState, _args: string[], i: number): number {
  state.json = true;
  return i;
}

function handleMemoryFlag(state: ParseState, args: string[], i: number, flag: string): number {
  // #263 phase A: decimal MiB, no unit suffix. Same shape as
  // MACHINEN_MEMORY. The runtime validates the floor; we only
  // reject syntactically bad values here.
  assertNotSeen(state.memory !== undefined, flag);
  const r = consumeMemory(args[i]!, args, i);
  state.memory = r.value;
  return r.next;
}

function parsePort(raw: string, label: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new ParseError("PARSE_PORT_INVALID", `-p: ${label} must be numeric (got '${raw}')`);
  }
  const n = Number(raw);
  if (n < 1 || n > 65535) {
    throw new ParseError("PARSE_PORT_INVALID", `-p: ${label} must be in 1..65535 (got ${n})`);
  }
  return n;
}

/**
 * Pull the value attached to a flag, supporting both `--flag value` and
 * `--flag=value` forms. Returns the spec string and the new loop index.
 * Throws `PARSE_FLAG_MISSING_VALUE` when the space form has nothing
 * following it.
 *
 * Shared between `parseRunArgs` (boot) and `parseForkArgs`. Each
 * `consume*` helper below uses this to keep the dispatch loop short.
 */
export function takeValue(
  flag: string,
  args: string[],
  i: number,
  label: string,
): { spec: string; next: number } {
  if (flag.includes("=")) {
    const eq = flag.indexOf("=");
    return { spec: flag.slice(eq + 1), next: i };
  }
  const spec = args[i + 1];
  if (spec === undefined) {
    throw new ParseError("PARSE_FLAG_MISSING_VALUE", `${flag} requires ${label}`);
  }
  return { spec, next: i + 1 };
}

/**
 * Consume one `-p`/`--publish` token (and the following value, if the
 * flag was given without `=`). Pushes onto `portForward`, updates
 * `seenHostPorts`, and returns the new loop index. Shared between
 * `parseRunArgs` (boot) and the inline parser in `cmdFork`.
 */
export function consumePortForward(
  flag: string,
  args: string[],
  i: number,
  seenHostPorts: Set<number>,
  portForward: Array<{ hostPort: number; guestPort: number }>,
): number {
  const { spec, next } = takeValue(flag, args, i, "a <hostPort>:<guestPort> value");
  const colon = spec.indexOf(":");
  if (colon <= 0 || colon === spec.length - 1) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `-p: expected <hostPort>:<guestPort>, got '${spec}'`,
    );
  }
  const hostPort = parsePort(spec.slice(0, colon), "hostPort");
  const guestPort = parsePort(spec.slice(colon + 1), "guestPort");
  if (seenHostPorts.has(hostPort)) {
    throw new ParseError("PARSE_FLAG_DUPLICATE", `-p: duplicate hostPort ${hostPort}`);
  }
  seenHostPorts.add(hostPort);
  portForward.push({ hostPort, guestPort });
  return next;
}

/**
 * Consume one `--mount <host>:<guest>` token. Returns the parsed value
 * and the new loop index. Caller enforces "at most once" against its
 * own state — same shape as `consumePortForward`.
 */
export function consumeMount(
  flag: string,
  args: string[],
  i: number,
): { value: { host: string; guest: string }; next: number } {
  const { spec, next } = takeValue(flag, args, i, "a <host-dir>:<guest-path> value");
  const colon = spec.indexOf(":");
  if (colon <= 0 || colon === spec.length - 1) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `--mount: expected <host-dir>:<guest-path>, got '${spec}'`,
    );
  }
  return { value: { host: spec.slice(0, colon), guest: spec.slice(colon + 1) }, next };
}

/**
 * Consume one `--mount-live <host>:<guest>[:<mode>]` token. `mode`
 * defaults to `"rw"` (write-through). Returns the parsed entry and
 * the new loop index. Caller pushes onto its own array.
 */
export function consumeLiveMount(
  flag: string,
  args: string[],
  i: number,
): { value: { host: string; guest: string; mode: "ro" | "rw" }; next: number } {
  const { spec, next } = takeValue(flag, args, i, "a <host-dir>:<guest-path> value");
  // Format: `<host>:<guest>[:<mode>]`. A guest path containing a colon
  // is rejected — same trade-off as `--mount`.
  const parts = spec.split(":");
  if (parts.length < 2 || parts.length > 3 || !parts[0] || !parts[1]) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `--mount-live: expected <host-dir>:<guest-path>[:<mode>], got '${spec}'`,
    );
  }
  const modeRaw = parts[2];
  if (modeRaw !== undefined && modeRaw !== "ro" && modeRaw !== "rw") {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `--mount-live: mode must be 'ro' or 'rw', got '${modeRaw}'`,
    );
  }
  return {
    value: {
      host: parts[0]!,
      guest: parts[1]!,
      mode: (modeRaw as "ro" | "rw" | undefined) ?? "rw",
    },
    next,
  };
}

/**
 * Consume one `--env KEY=VALUE` token. Returns the key/value pair and
 * the new loop index. Caller assigns onto its own map (later entries
 * win on duplicate keys, matching boot semantics).
 */
export function consumeEnv(
  flag: string,
  args: string[],
  i: number,
): { key: string; value: string; next: number } {
  const { spec, next } = takeValue(flag, args, i, "a KEY=VALUE value");
  const eq = spec.indexOf("=");
  if (eq <= 0) {
    throw new ParseError("PARSE_FLAG_MALFORMED", `--env: expected KEY=VALUE, got '${spec}'`);
  }
  return { key: spec.slice(0, eq), value: spec.slice(eq + 1), next };
}

/**
 * Consume one `--memory <mib>` token. Returns the parsed integer and
 * the new loop index. Caller enforces "at most once". The runtime
 * validates the floor against host RAM.
 */
export function consumeMemory(
  flag: string,
  args: string[],
  i: number,
): { value: number; next: number } {
  const { spec, next } = takeValue(
    flag,
    args,
    i,
    "a <mib> value (decimal integer, no unit suffix)",
  );
  if (!/^[0-9]+$/.test(spec)) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `--memory: expected a decimal integer (MiB, no unit suffix), got '${spec}'`,
    );
  }
  const n = Number(spec);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ParseError("PARSE_FLAG_MALFORMED", `--memory: must be > 0 (got '${spec}')`);
  }
  return { value: n, next };
}

/**
 * Consume one `--cwd <abs-path>` token. The runtime validates the
 * absolute-path requirement; we only collect the spec here.
 */
export function consumeGuestCwd(
  flag: string,
  args: string[],
  i: number,
): { value: string; next: number } {
  const { spec, next } = takeValue(flag, args, i, "an absolute path value");
  return { value: spec, next };
}
