// Pure arg parser for `machinen fork`. Sibling of parse-run-args.ts —
// split out so the parser is unit-testable without spawning the CLI.

import { ParseError } from "@machinen/runtime";

import { consumePortForward } from "./parse-run-args.ts";

export interface ParsedForkArgs {
  /** Optional name for the fork (`--new-name <n>`). */
  newName?: string;
  /** Where to write the snapshot bundle (`--out-dir <d>`). */
  outDir?: string;
  /** Inherit live TCP connections into the fork (`--tcp-keep`). */
  tcpKeep: boolean;
  /** Hand the fork off and return immediately (`--detach`). */
  detach: boolean;
  /**
   * Host→guest port forwards (`-p <hostPort>:<guestPort>`). NOT
   * inherited from the source — host ports are global, so the source
   * already binds each one it forwarded. Pass new entries explicitly
   * with non-conflicting host ports.
   */
  portForward: Array<{ hostPort: number; guestPort: number }>;
  /** Args we didn't recognize — passed to `parseTargetFlags`. */
  rest: string[];
}

export function parseForkArgs(argv: string[]): ParsedForkArgs {
  let newName: string | undefined;
  let outDir: string | undefined;
  let tcpKeep = false;
  let detach = false;
  const portForward: Array<{ hostPort: number; guestPort: number }> = [];
  const seenHostPorts = new Set<number>();
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--new-name" || a.startsWith("--new-name=")) {
      const v = a === "--new-name" ? argv[++i] : a.slice("--new-name=".length);
      if (!v) {
        throw new ParseError("PARSE_FLAG_MISSING_VALUE", "--new-name requires a value");
      }
      if (newName !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--new-name may be given at most once per invocation",
        );
      }
      newName = v;
    } else if (a === "--out-dir" || a.startsWith("--out-dir=")) {
      const v = a === "--out-dir" ? argv[++i] : a.slice("--out-dir=".length);
      if (!v) {
        throw new ParseError(
          "PARSE_FLAG_MISSING_VALUE",
          "--out-dir requires a directory path",
        );
      }
      if (outDir !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--out-dir may be given at most once per invocation",
        );
      }
      outDir = v;
    } else if (a === "--tcp-keep") {
      tcpKeep = true;
    } else if (a === "--detach") {
      detach = true;
    } else if (
      a === "-p" ||
      a === "--publish" ||
      a.startsWith("-p=") ||
      a.startsWith("--publish=")
    ) {
      i = consumePortForward(a, argv, i, seenHostPorts, portForward);
    } else {
      rest.push(a);
    }
  }
  return { newName, outDir, tcpKeep, detach, portForward, rest };
}
