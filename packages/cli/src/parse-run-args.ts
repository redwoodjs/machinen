// Pure arg parser for `machinen boot`. Split out from cli.ts so tests
// can import it without pulling @machinen/runtime (which resolves to
// dist/ and is unbuilt in the monorepo dev loop).

import { ParseError } from "@machinen/runtime";

import { DEFAULT_VM_NAME } from "./defaults.ts";

export interface ParsedCpuResourceArgs {
  maxVcpus?: number;
  quotaCpus?: number;
  weight?: number;
}

export type LiveMountSyncMode = "eager" | "batch";

interface ParsedRunArgs {
  positional: string[];
  double_dash_args: string[];
  mount?: { host: string; guest: string };
  /**
   * Live-share mounts (`--mount-live <host>:<guest>[:<mode>][:<sync>]`). Each
   * entry stays connected to the host filesystem for the VM's life;
   * guest reads stream in on demand. `mode` is `rw` (default) or `ro`
   * for read-only. `sync` is `batch` by default; `rw:eager` opts back
   * into immediate host writes.
   * Served by an in-VMM virtio-fs device (#332); the FUSE-over-vsock
   * transport and its `:<protocol>` modifier were removed in #338. See
   * #78, #151, #332.
   */
  liveMounts?: Array<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
    sync?: LiveMountSyncMode;
  }>;
  env?: Record<string, string>;
  portForward?: Array<{ hostPort: number; guestPort: number }>;
  /** Snapshot image to restore from (`--snapshot <path>`). */
  snapshot?: string;
  /** Expose arm64 EL2 / `/dev/kvm` to the guest (`--nested`). */
  nested?: boolean;
  /** VM name registered for `attach` (`--name <name>`, default `default`). */
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
  /** CPU resource policy. Quota is scheduling budget; vCPUs are guest-visible. */
  cpu?: ParsedCpuResourceArgs;
  /**
   * Emit the boot identity (pid + name) as JSON to stdout. Only
   * meaningful with `--detach` — attached boots hand stdio to the
   * guest and have no clean place to print structured output. See
   * Trevin's principle 2 (structured output).
   */
  json?: boolean;
}

type RunFlag =
  | "mount"
  | "liveMount"
  | "env"
  | "portForward"
  | "snapshot"
  | "nested"
  | "nestedValue"
  | "guestCwd"
  | "name"
  | "detach"
  | "json"
  | "memory"
  | "cpuQuota"
  | "cpuWeight"
  | "vcpus";

type RunFlagHandler = (state: RunParseState, flag: string, args: string[], index: number) => number;

interface RunParseState {
  positional: string[];
  mount?: { host: string; guest: string };
  liveMounts: Array<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
    sync?: LiveMountSyncMode;
  }>;
  env: Record<string, string>;
  portForward: Array<{ hostPort: number; guestPort: number }>;
  seenHostPorts: Set<number>;
  snapshot?: string;
  nested: boolean;
  name?: string;
  guestCwd?: string;
  detached: boolean;
  memory?: number;
  cpu: ParsedCpuResourceArgs;
  json: boolean;
}

const RUN_VALUE_FLAGS = new Map<string, RunFlag>([
  ["--mount", "mount"],
  ["--mount-live", "liveMount"],
  ["--env", "env"],
  ["-p", "portForward"],
  ["--publish", "portForward"],
  ["--snapshot", "snapshot"],
  ["--cwd", "guestCwd"],
  ["--name", "name"],
  ["--memory", "memory"],
  ["--cpu-quota", "cpuQuota"],
  ["--cpu-weight", "cpuWeight"],
  ["--vcpus", "vcpus"],
]);

const RUN_BARE_FLAGS = new Map<string, RunFlag>([
  ["--nested", "nested"],
  ["--detached", "detach"],
  ["--detach", "detach"],
  ["--json", "json"],
]);

const RUN_FLAG_HANDLERS: Record<RunFlag, RunFlagHandler> = {
  mount: handleRunMount,
  liveMount: handleRunLiveMount,
  env: handleRunEnv,
  portForward: handleRunPortForward,
  snapshot: handleRunSnapshot,
  nested: handleRunNested,
  nestedValue: handleRunNestedValue,
  guestCwd: handleRunGuestCwd,
  name: handleRunName,
  detach: handleRunDetach,
  json: handleRunJson,
  memory: handleRunMemory,
  cpuQuota: handleRunCpuQuota,
  cpuWeight: handleRunCpuWeight,
  vcpus: handleRunVcpus,
};

export function parseRunArgs(argv: string[]): ParsedRunArgs {
  const { pre, double_dash_args } = splitCommandArgs(argv);
  const state = newRunParseState();

  for (let i = 0; i < pre.length; i++) {
    const arg = pre[i]!;
    const flag = runFlagFor(arg);
    if (flag) {
      i = RUN_FLAG_HANDLERS[flag](state, arg, pre, i);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new ParseError("PARSE_FLAG_UNKNOWN", `unknown flag: ${arg}`);
    }
    state.positional.push(arg);
  }

  return finishRunArgs(state, double_dash_args);
}

function splitCommandArgs(argv: string[]): { pre: string[]; double_dash_args: string[] } {
  const idx = argv.indexOf("--");
  if (idx === -1) {
    return { pre: argv, double_dash_args: [] };
  }
  return { pre: argv.slice(0, idx), double_dash_args: argv.slice(idx + 1) };
}

function newRunParseState(): RunParseState {
  return {
    positional: [],
    liveMounts: [],
    env: {},
    portForward: [],
    seenHostPorts: new Set<number>(),
    nested: false,
    detached: false,
    cpu: {},
    json: false,
  };
}

function runFlagFor(arg: string): RunFlag | undefined {
  const eq = arg.indexOf("=");
  if (eq !== -1) {
    const head = arg.slice(0, eq);
    if (head === "--nested") {
      return "nestedValue";
    }
    return RUN_VALUE_FLAGS.get(head);
  }
  return RUN_BARE_FLAGS.get(arg) ?? RUN_VALUE_FLAGS.get(arg);
}

function finishRunArgs(state: RunParseState, double_dash_args: string[]): ParsedRunArgs {
  return {
    positional: state.positional,
    double_dash_args,
    mount: state.mount,
    liveMounts: state.liveMounts.length > 0 ? state.liveMounts : undefined,
    env: Object.keys(state.env).length > 0 ? state.env : undefined,
    portForward: state.portForward.length > 0 ? state.portForward : undefined,
    snapshot: state.snapshot,
    nested: state.nested || undefined,
    name: state.name ?? DEFAULT_VM_NAME,
    guestCwd: state.guestCwd,
    detached: state.detached || undefined,
    memory: state.memory,
    cpu: cpuArgsOrUndefined(state.cpu),
    json: state.json || undefined,
  };
}

function handleRunMount(state: RunParseState, flag: string, args: string[], index: number): number {
  assertRunFlagUnused(state.mount !== undefined, "--mount");
  const result = consumeMount(flag, args, index);
  state.mount = result.value;
  return result.next;
}

function handleRunLiveMount(
  state: RunParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  const result = consumeLiveMount(flag, args, index);
  state.liveMounts.push(result.value);
  return result.next;
}

function handleRunEnv(state: RunParseState, flag: string, args: string[], index: number): number {
  const result = consumeEnv(flag, args, index);
  state.env[result.key] = result.value;
  return result.next;
}

function handleRunPortForward(
  state: RunParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  return consumePortForward(flag, args, index, state.seenHostPorts, state.portForward);
}

function handleRunSnapshot(
  state: RunParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertRunFlagUnused(state.snapshot !== undefined, "--snapshot");
  const { spec, next } = takeValue(flag, args, index, "a path value");
  state.snapshot = spec;
  return next;
}

function handleRunNested(
  state: RunParseState,
  _flag: string,
  _args: string[],
  index: number,
): number {
  assertRunFlagUnused(state.nested, "--nested");
  state.nested = true;
  return index;
}

function handleRunNestedValue(): number {
  throw new ParseError("PARSE_FLAG_MALFORMED", "--nested does not take a value");
}

function handleRunGuestCwd(
  state: RunParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertRunFlagUnused(state.guestCwd !== undefined, "--cwd");
  const result = consumeGuestCwd(flag, args, index);
  state.guestCwd = result.value;
  return result.next;
}

function handleRunName(state: RunParseState, flag: string, args: string[], index: number): number {
  assertRunFlagUnused(state.name !== undefined, "--name");
  const { spec, next } = takeValue(flag, args, index, "a value");
  state.name = spec;
  return next;
}

function handleRunDetach(
  state: RunParseState,
  flag: string,
  _args: string[],
  index: number,
): number {
  assertRunFlagUnused(state.detached, "--detached");
  state.detached = true;
  warnDeprecatedDetached(flag);
  return index;
}

function handleRunJson(
  state: RunParseState,
  _flag: string,
  _args: string[],
  index: number,
): number {
  state.json = true;
  return index;
}

function handleRunMemory(
  state: RunParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  // #263 phase A: decimal MiB, no unit suffix. Same shape as
  // MACHINEN_MEMORY. The runtime validates the floor; we only
  // reject syntactically bad values here.
  assertRunFlagUnused(state.memory !== undefined, "--memory");
  const result = consumeMemory(flag, args, index);
  state.memory = result.value;
  return result.next;
}

// fallow-ignore-next-line code-duplication
function handleRunCpuQuota(
  state: RunParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertRunFlagUnused(state.cpu.quotaCpus !== undefined, "--cpu-quota");
  const result = consumeCpuQuota(flag, args, index);
  state.cpu.quotaCpus = result.value;
  return result.next;
}

function handleRunCpuWeight(
  state: RunParseState,
  flag: string,
  args: string[],
  index: number,
): number {
  assertRunFlagUnused(state.cpu.weight !== undefined, "--cpu-weight");
  const result = consumeCpuWeight(flag, args, index);
  state.cpu.weight = result.value;
  return result.next;
}

function handleRunVcpus(state: RunParseState, flag: string, args: string[], index: number): number {
  assertRunFlagUnused(state.cpu.maxVcpus !== undefined, "--vcpus");
  const result = consumeVcpus(flag, args, index);
  state.cpu.maxVcpus = result.value;
  return result.next;
}

function cpuArgsOrUndefined(cpu: ParsedCpuResourceArgs): ParsedCpuResourceArgs | undefined {
  return cpu.maxVcpus === undefined && cpu.quotaCpus === undefined && cpu.weight === undefined
    ? undefined
    : cpu;
}

function assertRunFlagUnused(used: boolean, flag: string): void {
  if (used) {
    throw new ParseError(
      "PARSE_FLAG_DUPLICATE",
      `${flag} may be given at most once per invocation`,
    );
  }
}

function warnDeprecatedDetached(flag: string): void {
  // `--detached` is the legacy spelling. Surface a one-line
  // deprecation note so existing scripts keep working but agents
  // (and humans) learn the canonical name. Suppressed under
  // MACHINEN_QUIET_DEPRECATIONS (set by tests) and under VITEST
  // (parseRunArgs is unit-tested with --detached on every run).
  if (flag === "--detached" && !process.env.MACHINEN_QUIET_DEPRECATIONS && !process.env.VITEST) {
    process.stderr.write("machinen: --detached is deprecated; use --detach (same behaviour).\n");
  }
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
 * Consume one `--mount-live <host>:<guest>[:<mode>][:<sync>]` token. `mode`
 * defaults to `"rw"`. The runtime chooses the sync default. Returns the parsed
 * entry and the new loop index. Caller pushes onto its own array.
 */
export function consumeLiveMount(
  flag: string,
  args: string[],
  i: number,
): {
  value: {
    host: string;
    guest: string;
    mode: "ro" | "rw";
    sync?: LiveMountSyncMode;
  };
  next: number;
} {
  const { spec, next } = takeValue(flag, args, i, "a <host-dir>:<guest-path> value");
  // Format: `<host>:<guest>[:<mode>][:<sync>]`. The trailing modifiers
  // are optional and order-independent: `ro` / `rw` and `eager` / `batch`.
  // A guest path containing a colon is rejected — same trade-off as `--mount`.
  const parts = spec.split(":");
  if (parts.length < 2 || parts.length > 4 || !parts[0] || !parts[1]) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `--mount-live: expected <host-dir>:<guest-path>[:<mode>][:<sync>], got '${spec}'`,
    );
  }
  const { mode, sync } = parseLiveMountModifiers(parts.slice(2), spec);
  return {
    value: {
      host: parts[0]!,
      guest: parts[1]!,
      mode: mode ?? "rw",
      ...(sync ? { sync } : {}),
    },
    next,
  };
}

interface LiveMountModifiers {
  mode?: "ro" | "rw";
  sync?: LiveMountSyncMode;
}

function parseLiveMountModifiers(tokens: string[], spec: string): LiveMountModifiers {
  const modifiers: LiveMountModifiers = {};
  for (const token of tokens) {
    applyLiveMountModifier(modifiers, token, spec);
  }
  return modifiers;
}

function applyLiveMountModifier(modifiers: LiveMountModifiers, token: string, spec: string): void {
  if (token === "ro" || token === "rw") {
    setLiveMountMode(modifiers, token, spec);
    return;
  }
  if (isLiveMountSyncMode(token)) {
    setLiveMountSync(modifiers, token, spec);
    return;
  }
  throw new ParseError(
    "PARSE_FLAG_MALFORMED",
    `--mount-live: trailing modifier must be 'ro', 'rw', 'eager', or 'batch', got '${token}'`,
  );
}

function setLiveMountMode(modifiers: LiveMountModifiers, mode: "ro" | "rw", spec: string): void {
  if (modifiers.mode !== undefined) {
    throw new ParseError("PARSE_FLAG_MALFORMED", `--mount-live: mode given twice in '${spec}'`);
  }
  modifiers.mode = mode;
}

function setLiveMountSync(
  modifiers: LiveMountModifiers,
  sync: LiveMountSyncMode,
  spec: string,
): void {
  if (modifiers.sync !== undefined) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `--mount-live: sync mode given twice in '${spec}'`,
    );
  }
  modifiers.sync = sync;
}

function isLiveMountSyncMode(value: string): value is LiveMountSyncMode {
  return value === "eager" || value === "batch";
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

// fallow-ignore-next-line code-duplication
export function consumeCpuQuota(
  flag: string,
  args: string[],
  i: number,
): { value: number; next: number } {
  const { spec, next } = takeValue(flag, args, i, "a CPU quota value");
  if (!/^(?:[0-9]+|[0-9]*\.[0-9]+)$/.test(spec)) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `${flag}: expected a positive CPU count, e.g. 0.5 or 1 (got '${spec}')`,
    );
  }
  const n = Number(spec);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ParseError("PARSE_FLAG_MALFORMED", `${flag}: must be > 0 (got '${spec}')`);
  }
  return { value: n, next };
}

export function consumeCpuWeight(
  flag: string,
  args: string[],
  i: number,
): { value: number; next: number } {
  return consumePositiveInteger(flag, args, i, "a CPU weight value");
}

export function consumeVcpus(
  flag: string,
  args: string[],
  i: number,
): { value: number; next: number } {
  return consumePositiveInteger(flag, args, i, "a vCPU count");
}

// fallow-ignore-next-line code-duplication
function consumePositiveInteger(
  flag: string,
  args: string[],
  i: number,
  label: string,
): { value: number; next: number } {
  const { spec, next } = takeValue(flag, args, i, label);
  if (!/^[0-9]+$/.test(spec)) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `${flag}: expected a positive integer, got '${spec}'`,
    );
  }
  const n = Number(spec);
  if (!Number.isFinite(n) || n <= 0) {
    throw new ParseError("PARSE_FLAG_MALFORMED", `${flag}: must be > 0 (got '${spec}')`);
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
