/**
 * Strip `--json` (a top-level CLI convention — every data-returning
 * command supports it) from the arg list and report whether it was set.
 */
export function consumeJsonFlag(args: string[]): { json: boolean; rest: string[] } {
  const rest: string[] = [];
  let json = false;
  for (const a of args) {
    if (a === "--json") {
      json = true;
    } else {
      rest.push(a);
    }
  }
  return { json, rest };
}

/** Strip `--dry-run`/`-n` from the arg list. */
export function consumeDryRunFlag(args: string[]): { dryRun: boolean; rest: string[] } {
  const rest: string[] = [];
  let dryRun = false;
  for (const a of args) {
    if (a === "--dry-run" || a === "-n") {
      dryRun = true;
    } else {
      rest.push(a);
    }
  }
  return { dryRun, rest };
}

/** Newline-terminated JSON to stdout. Single source for every `--json` payload. */
export function emitJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value) + "\n");
}

/** Structured error for `--json` mode. Goes to stderr; caller exits non-zero. */
export function emitJsonError(code: string, message: string): void {
  process.stderr.write(JSON.stringify({ schema_version: 1, error: { code, message } }) + "\n");
}

export function argValue(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  if (i === -1) {
    return undefined;
  }
  return argv[i + 1];
}
