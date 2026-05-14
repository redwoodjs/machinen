// Pure arg parser for `machinen boot`. Split out from cli.ts so tests
// can import it without pulling @machinen/runtime (which resolves to
// dist/ and is unbuilt in the monorepo dev loop).

import { ParseError } from "@machinen/runtime";

interface ParsedRunArgs {
  positional: string[];
  double_dash_args: string[];
  mount?: { host: string; guest: string };
  /**
   * Live-share mounts (`--mount-live <host>:<guest>[:<mode>][:<protocol>]`).
   * Each entry stays connected to the host filesystem for the VM's
   * life; guest reads stream in on demand. `mode` is `rw` (default,
   * write-through) or `ro` for read-only. `protocol` is `virtiofs`
   * (the default — the in-VMM virtio-fs transport, #332) or `fuse`
   * (FUSE-over-vsock). Only one mount can use `virtiofs` per VM, so an
   * unset protocol on a second mount falls back to `fuse`. See #78,
   * #151, #332.
   */
  liveMounts?: Array<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
    protocol?: "fuse" | "virtiofs";
  }>;
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

export function parseRunArgs(argv: string[]): ParsedRunArgs {
  const idx = argv.indexOf("--");
  const pre = idx === -1 ? argv : argv.slice(0, idx);
  const double_dash_args = idx === -1 ? [] : argv.slice(idx + 1);

  const positional: string[] = [];
  let mount: { host: string; guest: string } | undefined;
  const liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }> = [];
  const env: Record<string, string> = {};
  const portForward: Array<{ hostPort: number; guestPort: number }> = [];
  const seenHostPorts = new Set<number>();
  let snapshot: string | undefined;
  let name: string | undefined;
  let guestCwd: string | undefined;
  let detached = false;
  let memory: number | undefined;
  let json = false;
  for (let i = 0; i < pre.length; i++) {
    const a = pre[i]!;
    if (a === "--mount" || a.startsWith("--mount=")) {
      if (mount) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--mount may be given at most once per invocation",
        );
      }
      const r = consumeMount(a, pre, i);
      mount = r.value;
      i = r.next;
    } else if (a === "--mount-live" || a.startsWith("--mount-live=")) {
      const r = consumeLiveMount(a, pre, i);
      liveMounts.push(r.value);
      i = r.next;
    } else if (a === "--env" || a.startsWith("--env=")) {
      const r = consumeEnv(a, pre, i);
      env[r.key] = r.value;
      i = r.next;
    } else if (
      a === "-p" ||
      a === "--publish" ||
      a.startsWith("-p=") ||
      a.startsWith("--publish=")
    ) {
      i = consumePortForward(a, pre, i, seenHostPorts, portForward);
    } else if (a === "--snapshot" || a.startsWith("--snapshot=")) {
      if (snapshot) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--snapshot may be given at most once per invocation",
        );
      }
      const { spec, next } = takeValue(a, pre, i, "a path value");
      snapshot = spec;
      i = next;
    } else if (a === "--cwd" || a.startsWith("--cwd=")) {
      if (guestCwd !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--cwd may be given at most once per invocation",
        );
      }
      const r = consumeGuestCwd(a, pre, i);
      guestCwd = r.value;
      i = r.next;
    } else if (a === "--name" || a.startsWith("--name=")) {
      if (name) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--name may be given at most once per invocation",
        );
      }
      const { spec, next } = takeValue(a, pre, i, "a value");
      name = spec;
      i = next;
    } else if (a === "--detached" || a === "--detach") {
      if (detached) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--detached may be given at most once per invocation",
        );
      }
      detached = true;
      // `--detached` is the legacy spelling. Surface a one-line
      // deprecation note so existing scripts keep working but agents
      // (and humans) learn the canonical name. Suppressed under
      // MACHINEN_QUIET_DEPRECATIONS (set by tests) and under VITEST
      // (parseRunArgs is unit-tested with --detached on every run).
      if (a === "--detached" && !process.env.MACHINEN_QUIET_DEPRECATIONS && !process.env.VITEST) {
        process.stderr.write(
          "machinen: --detached is deprecated; use --detach (same behaviour).\n",
        );
      }
    } else if (a === "--json") {
      json = true;
    } else if (a === "--memory" || a.startsWith("--memory=")) {
      // #263 phase A: decimal MiB, no unit suffix. Same shape as
      // MACHINEN_MEMORY. The runtime validates the floor; we only
      // reject syntactically bad values here.
      if (memory !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--memory may be given at most once per invocation",
        );
      }
      const r = consumeMemory(a, pre, i);
      memory = r.value;
      i = r.next;
    } else if (a.startsWith("-")) {
      throw new ParseError("PARSE_FLAG_UNKNOWN", `unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  return {
    positional,
    double_dash_args,
    mount,
    liveMounts: liveMounts.length > 0 ? liveMounts : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    portForward: portForward.length > 0 ? portForward : undefined,
    snapshot,
    name,
    guestCwd,
    detached: detached || undefined,
    memory,
    json: json || undefined,
  };
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
): {
  value: { host: string; guest: string; mode: "ro" | "rw"; protocol?: "fuse" | "virtiofs" };
  next: number;
} {
  const { spec, next } = takeValue(flag, args, i, "a <host-dir>:<guest-path> value");
  // Format: `<host>:<guest>[:<mode>][:<protocol>]`. The two trailing
  // modifiers are each optional and order-independent — a token is a
  // mode if it's `ro`/`rw`, a protocol if it's `fuse`/`virtiofs`. A
  // guest path containing a colon is rejected — same trade-off as
  // `--mount`.
  const parts = spec.split(":");
  if (parts.length < 2 || parts.length > 4 || !parts[0] || !parts[1]) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `--mount-live: expected <host-dir>:<guest-path>[:<mode>][:<protocol>], got '${spec}'`,
    );
  }
  let mode: "ro" | "rw" | undefined;
  let protocol: "fuse" | "virtiofs" | undefined;
  for (const tok of parts.slice(2)) {
    if (tok === "ro" || tok === "rw") {
      if (mode !== undefined) {
        throw new ParseError("PARSE_FLAG_MALFORMED", `--mount-live: mode given twice in '${spec}'`);
      }
      mode = tok;
    } else if (tok === "fuse" || tok === "virtiofs") {
      if (protocol !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_MALFORMED",
          `--mount-live: protocol given twice in '${spec}'`,
        );
      }
      protocol = tok;
    } else {
      throw new ParseError(
        "PARSE_FLAG_MALFORMED",
        `--mount-live: trailing modifier must be 'ro'/'rw' or 'fuse'/'virtiofs', got '${tok}'`,
      );
    }
  }
  return {
    value: {
      host: parts[0]!,
      guest: parts[1]!,
      mode: mode ?? "rw",
      ...(protocol !== undefined ? { protocol } : {}),
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
