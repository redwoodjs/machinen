// Pure arg parser for `machinen run`. Split out from cli.ts so tests
// can import it without pulling @machinen/runtime (which resolves to
// dist/ and is unbuilt in the monorepo dev loop).

export interface ParsedRunArgs {
  positional: string[];
  double_dash_args: string[];
  mount?: { host: string; guest: string };
  guestEnv?: Record<string, string>;
  portForward?: Array<{ hostPort: number; guestPort: number }>;
}

export class ParseRunArgsError extends Error {}

export function parseRunArgs(argv: string[]): ParsedRunArgs {
  const idx = argv.indexOf("--");
  const pre = idx === -1 ? argv : argv.slice(0, idx);
  const double_dash_args = idx === -1 ? [] : argv.slice(idx + 1);

  const positional: string[] = [];
  let mount: { host: string; guest: string } | undefined;
  const guestEnv: Record<string, string> = {};
  const portForward: Array<{ hostPort: number; guestPort: number }> = [];
  const seenHostPorts = new Set<number>();
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
      guestEnv[key] = value;
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
    guestEnv: Object.keys(guestEnv).length > 0 ? guestEnv : undefined,
    portForward: portForward.length > 0 ? portForward : undefined,
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
