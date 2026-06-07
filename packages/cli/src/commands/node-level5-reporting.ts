import { emitJson } from "../args.ts";

export function reportNodeLevel5ProductCommand(
  json: boolean,
  summary: Record<string, unknown>,
): number {
  if (json) {
    emitJson(summary);
  } else {
    process.stderr.write(`${summary.accepted ? "accepted" : "refused"} node-level5 command\n`);
  }
  return summary.accepted === false ? 1 : 0;
}

export function invalidNodeLevel5ReleaseReport(
  code: string,
  error: unknown,
): Record<string, unknown> {
  return {
    accepted: false,
    code,
    message: error instanceof Error ? error.message : String(error),
  };
}
