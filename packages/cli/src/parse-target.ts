// Pure arg parser for the VM target shared by exec/snapshot/fork/
// attach/repl/stop. Sibling of parse-run-args.ts / parse-fork-args.ts
// — extracted so tests don't need to spawn the CLI.
//
// The target is a single positional. All-digits → pid; everything
// else → name. Anything that isn't the target lands in `rest` so
// callers with a second positional (snapshot's <out-dir>) can read
// it without re-parsing.

import { ParseError } from "@machinen/runtime";

export type Target = { name: string } | { pid: number };

export interface ExtractedTarget {
  target: Target;
  /** Args we didn't consume — extra positionals or flags the caller handles. */
  rest: string[];
}

export function extractTarget(args: string[], cmd: string): ExtractedTarget {
  let positional: string | undefined;
  const rest: string[] = [];
  for (const a of args) {
    if (!a.startsWith("-")) {
      if (positional === undefined) {
        positional = a;
      } else {
        rest.push(a);
      }
    } else {
      throw new ParseError("PARSE_FLAG_UNKNOWN", `unknown argument: ${a}`);
    }
  }
  if (positional === undefined) {
    throw new ParseError(
      "PARSE_FLAG_MISSING_VALUE",
      `machinen ${cmd}: requires a target name or pid (e.g. \`machinen ${cmd} <name|pid>\`)`,
    );
  }
  // Edge case: a VM literally named "123" can't be targeted
  // positionally (resolves as pid). Rename the VM if you hit this —
  // there's no flag escape hatch.
  const target: Target = /^[0-9]+$/.test(positional)
    ? { pid: Number(positional) }
    : { name: positional };
  return { target, rest };
}
