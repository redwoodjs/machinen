// Pure arg parser for `machinen run`. Split out from cli.ts so tests
// can import it without pulling @machinen/runtime (which resolves to
// dist/ and is unbuilt in the monorepo dev loop).

export interface ParsedRunArgs {
  positional: string[];
  double_dash_args: string[];
  mount?: { host: string; guest: string };
  guestEnv?: Record<string, string>;
}

export class ParseRunArgsError extends Error {}

export function parseRunArgs(argv: string[]): ParsedRunArgs {
  const idx = argv.indexOf("--");
  const pre = idx === -1 ? argv : argv.slice(0, idx);
  const double_dash_args = idx === -1 ? [] : argv.slice(idx + 1);

  const positional: string[] = [];
  let mount: { host: string; guest: string } | undefined;
  const guestEnv: Record<string, string> = {};
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
  };
}
