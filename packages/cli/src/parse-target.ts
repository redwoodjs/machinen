// Pure arg parser for the VM target shared by exec/snapshot/fork/
// attach/repl/stop. Sibling of parse-run-args.ts / parse-fork-args.ts
// — extracted so tests don't need to spawn the CLI.
//
// Preferred form: a single positional. All-digits → pid; everything
// else → name. Legacy `--name`/`--pid` flags are still accepted for
// one release; callers warn the user via `legacyFlags`. Anything that
// isn't the target lands in `rest` so callers with a second positional
// (snapshot's <out-dir>) can read it without re-parsing.

import { ParseError } from "@machinen/runtime";

export type Target = { name: string } | { pid: number };

export interface ExtractedTarget {
  target: Target;
  /** Args we didn't consume — extra positionals or flags the caller handles. */
  rest: string[];
  /** Legacy flags the user passed; the CLI prints a one-time warning per flag. */
  legacyFlags: Array<"--name" | "--pid">;
}

export function extractTarget(args: string[], cmd: string): ExtractedTarget {
  let name: string | undefined;
  let pid: number | undefined;
  let positional: string | undefined;
  const rest: string[] = [];
  const legacyFlags: Array<"--name" | "--pid"> = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--name" || a.startsWith("--name=")) {
      const v = a === "--name" ? args[++i] : a.slice("--name=".length);
      if (!v) {
        throw new ParseError("PARSE_FLAG_MISSING_VALUE", "--name requires a value");
      }
      if (name !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--name may be given at most once per invocation",
        );
      }
      name = v;
      legacyFlags.push("--name");
    } else if (a === "--pid" || a.startsWith("--pid=")) {
      const v = a === "--pid" ? args[++i] : a.slice("--pid=".length);
      if (!v || !/^[0-9]+$/.test(v)) {
        throw new ParseError("PARSE_FLAG_MALFORMED", "--pid requires a numeric value");
      }
      if (pid !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--pid may be given at most once per invocation",
        );
      }
      pid = Number(v);
      legacyFlags.push("--pid");
    } else if (!a.startsWith("-")) {
      if (positional === undefined) {
        positional = a;
      } else {
        rest.push(a);
      }
    } else {
      throw new ParseError("PARSE_FLAG_UNKNOWN", `unknown argument: ${a}`);
    }
  }
  if (positional !== undefined && (name !== undefined || pid !== undefined)) {
    throw new ParseError(
      "PARSE_FLAG_MALFORMED",
      `machinen ${cmd}: pass the target once — either as a positional or via --name/--pid (deprecated), not both`,
    );
  }
  if (name !== undefined && pid !== undefined) {
    throw new ParseError("PARSE_FLAG_MALFORMED", `machinen ${cmd}: pass --name OR --pid, not both`);
  }
  let target: Target;
  if (positional !== undefined) {
    // Edge case: a VM literally named "123" can't be targeted
    // positionally (resolves as pid). Use the legacy `--name 123` form
    // until renamed.
    target = /^[0-9]+$/.test(positional) ? { pid: Number(positional) } : { name: positional };
  } else if (name !== undefined) {
    target = { name };
  } else if (pid !== undefined) {
    target = { pid };
  } else {
    throw new ParseError(
      "PARSE_FLAG_MISSING_VALUE",
      `machinen ${cmd}: requires a target name or pid (e.g. \`machinen ${cmd} <name|pid>\`)`,
    );
  }
  return { target, rest, legacyFlags };
}
