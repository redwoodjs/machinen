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
  for (let i = 0; i < pre.length; i++) {
    const a = pre[i]!;
    if (a === "--mount" || a.startsWith("--mount=")) {
      let spec: string | undefined;
      if (a === "--mount") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseError(
            "PARSE_FLAG_MISSING_VALUE",
            "--mount requires a <host-dir>:<guest-path> value",
          );
        }
        i++;
      } else {
        spec = a.slice("--mount=".length);
      }
      if (mount) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--mount may be given at most once per invocation",
        );
      }
      const colon = spec!.indexOf(":");
      if (colon <= 0 || colon === spec!.length - 1) {
        throw new ParseError(
          "PARSE_FLAG_MALFORMED",
          `--mount: expected <host-dir>:<guest-path>, got '${spec}'`,
        );
      }
      mount = { host: spec!.slice(0, colon), guest: spec!.slice(colon + 1) };
    } else if (a === "--mount-live" || a.startsWith("--mount-live=")) {
      let spec: string | undefined;
      if (a === "--mount-live") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseError(
            "PARSE_FLAG_MISSING_VALUE",
            "--mount-live requires a <host-dir>:<guest-path> value",
          );
        }
        i++;
      } else {
        spec = a.slice("--mount-live=".length);
      }
      // Format: `<host>:<guest>[:<mode>]`. Mode defaults to `rw`
      // (write-through, #151); pass `:ro` for read-only. A guest path
      // containing a colon is rejected — same trade-off as `--mount`.
      const parts = spec!.split(":");
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
      liveMounts.push({
        host: parts[0]!,
        guest: parts[1]!,
        mode: (modeRaw as "ro" | "rw" | undefined) ?? "rw",
      });
    } else if (a === "--env" || a.startsWith("--env=")) {
      let spec: string | undefined;
      if (a === "--env") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseError("PARSE_FLAG_MISSING_VALUE", "--env requires a KEY=VALUE value");
        }
        i++;
      } else {
        spec = a.slice("--env=".length);
      }
      const eq = spec!.indexOf("=");
      if (eq <= 0) {
        throw new ParseError("PARSE_FLAG_MALFORMED", `--env: expected KEY=VALUE, got '${spec}'`);
      }
      const key = spec!.slice(0, eq);
      const value = spec!.slice(eq + 1);
      env[key] = value;
    } else if (
      a === "-p" ||
      a === "--publish" ||
      a.startsWith("-p=") ||
      a.startsWith("--publish=")
    ) {
      let spec: string | undefined;
      if (a === "-p" || a === "--publish") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseError(
            "PARSE_FLAG_MISSING_VALUE",
            `${a} requires a <hostPort>:<guestPort> value`,
          );
        }
        i++;
      } else if (a.startsWith("-p=")) {
        spec = a.slice("-p=".length);
      } else {
        spec = a.slice("--publish=".length);
      }
      const colon = spec!.indexOf(":");
      if (colon <= 0 || colon === spec!.length - 1) {
        throw new ParseError(
          "PARSE_FLAG_MALFORMED",
          `-p: expected <hostPort>:<guestPort>, got '${spec}'`,
        );
      }
      const hostPort = parsePort(spec!.slice(0, colon), "hostPort");
      const guestPort = parsePort(spec!.slice(colon + 1), "guestPort");
      if (seenHostPorts.has(hostPort)) {
        throw new ParseError("PARSE_FLAG_DUPLICATE", `-p: duplicate hostPort ${hostPort}`);
      }
      seenHostPorts.add(hostPort);
      portForward.push({ hostPort, guestPort });
    } else if (a === "--snapshot" || a.startsWith("--snapshot=")) {
      let spec: string | undefined;
      if (a === "--snapshot") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseError("PARSE_FLAG_MISSING_VALUE", "--snapshot requires a path value");
        }
        i++;
      } else {
        spec = a.slice("--snapshot=".length);
      }
      if (snapshot) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--snapshot may be given at most once per invocation",
        );
      }
      snapshot = spec;
    } else if (a === "--cwd" || a.startsWith("--cwd=")) {
      let spec: string | undefined;
      if (a === "--cwd") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseError("PARSE_FLAG_MISSING_VALUE", "--cwd requires an absolute path value");
        }
        i++;
      } else {
        spec = a.slice("--cwd=".length);
      }
      if (guestCwd !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--cwd may be given at most once per invocation",
        );
      }
      guestCwd = spec;
    } else if (a === "--name" || a.startsWith("--name=")) {
      let spec: string | undefined;
      if (a === "--name") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseError("PARSE_FLAG_MISSING_VALUE", "--name requires a value");
        }
        i++;
      } else {
        spec = a.slice("--name=".length);
      }
      if (name) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--name may be given at most once per invocation",
        );
      }
      name = spec;
    } else if (a === "--detached" || a === "--detach") {
      if (detached) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--detached may be given at most once per invocation",
        );
      }
      detached = true;
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
