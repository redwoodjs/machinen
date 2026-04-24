// Pure arg parser for `machinen run`. Split out from cli.ts so tests
// can import it without pulling @machinen/runtime (which resolves to
// dist/ and is unbuilt in the monorepo dev loop).

export interface ParsedRunArgs {
  positional: string[];
  double_dash_args: string[];
  mount?: { host: string; guest: string };
  env?: Record<string, string>;
  portForward?: Array<{ hostPort: number; guestPort: number }>;
  /** Snapshot image to restore from (`--snapshot <path>`). */
  snapshot?: string;
  /** Optional VM name registered for `attach` (`--name <name>`). */
  name?: string;
}

export class ParseRunArgsError extends Error {}

export function parseRunArgs(argv: string[]): ParsedRunArgs {
  const idx = argv.indexOf("--");
  const pre = idx === -1 ? argv : argv.slice(0, idx);
  const double_dash_args = idx === -1 ? [] : argv.slice(idx + 1);

  const positional: string[] = [];
  let mount: { host: string; guest: string } | undefined;
  const env: Record<string, string> = {};
  const portForward: Array<{ hostPort: number; guestPort: number }> = [];
  const seenHostPorts = new Set<number>();
  let snapshot: string | undefined;
  let name: string | undefined;
  for (let i = 0; i < pre.length; i++) {
    const a = pre[i]!;
    if (a === "--mount" || a.startsWith("--mount=")) {
      let spec: string | undefined;
      if (a === "--mount") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseRunArgsError("--mount requires a <host-dir>:<guest-path> value");
        }
        i++;
      } else {
        spec = a.slice("--mount=".length);
      }
      if (mount) {
        throw new ParseRunArgsError("--mount may be given at most once per invocation");
      }
      const colon = spec!.indexOf(":");
      if (colon <= 0 || colon === spec!.length - 1) {
        throw new ParseRunArgsError(`--mount: expected <host-dir>:<guest-path>, got '${spec}'`);
      }
      mount = { host: spec!.slice(0, colon), guest: spec!.slice(colon + 1) };
    } else if (a === "--env" || a.startsWith("--env=")) {
      let spec: string | undefined;
      if (a === "--env") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseRunArgsError("--env requires a KEY=VALUE value");
        }
        i++;
      } else {
        spec = a.slice("--env=".length);
      }
      const eq = spec!.indexOf("=");
      if (eq <= 0) {
        throw new ParseRunArgsError(`--env: expected KEY=VALUE, got '${spec}'`);
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
          throw new ParseRunArgsError(`${a} requires a <hostPort>:<guestPort> value`);
        }
        i++;
      } else if (a.startsWith("-p=")) {
        spec = a.slice("-p=".length);
      } else {
        spec = a.slice("--publish=".length);
      }
      const colon = spec!.indexOf(":");
      if (colon <= 0 || colon === spec!.length - 1) {
        throw new ParseRunArgsError(`-p: expected <hostPort>:<guestPort>, got '${spec}'`);
      }
      const hostPort = parsePort(spec!.slice(0, colon), "hostPort");
      const guestPort = parsePort(spec!.slice(colon + 1), "guestPort");
      if (seenHostPorts.has(hostPort)) {
        throw new ParseRunArgsError(`-p: duplicate hostPort ${hostPort}`);
      }
      seenHostPorts.add(hostPort);
      portForward.push({ hostPort, guestPort });
    } else if (a === "--snapshot" || a.startsWith("--snapshot=")) {
      let spec: string | undefined;
      if (a === "--snapshot") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseRunArgsError("--snapshot requires a path value");
        }
        i++;
      } else {
        spec = a.slice("--snapshot=".length);
      }
      if (snapshot) {
        throw new ParseRunArgsError("--snapshot may be given at most once per invocation");
      }
      snapshot = spec;
    } else if (a === "--name" || a.startsWith("--name=")) {
      let spec: string | undefined;
      if (a === "--name") {
        spec = pre[i + 1];
        if (spec === undefined) {
          throw new ParseRunArgsError("--name requires a value");
        }
        i++;
      } else {
        spec = a.slice("--name=".length);
      }
      if (name) {
        throw new ParseRunArgsError("--name may be given at most once per invocation");
      }
      name = spec;
    } else if (a.startsWith("-")) {
      throw new ParseRunArgsError(`unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  return {
    positional,
    double_dash_args,
    mount,
    env: Object.keys(env).length > 0 ? env : undefined,
    portForward: portForward.length > 0 ? portForward : undefined,
    snapshot,
    name,
  };
}

function parsePort(raw: string, label: string): number {
  if (!/^[0-9]+$/.test(raw)) {
    throw new ParseRunArgsError(`-p: ${label} must be numeric (got '${raw}')`);
  }
  const n = Number(raw);
  if (n < 1 || n > 65535) {
    throw new ParseRunArgsError(`-p: ${label} must be in 1..65535 (got ${n})`);
  }
  return n;
}
