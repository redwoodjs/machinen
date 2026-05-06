// Pure arg parser for `machinen restore`. Sibling of parse-run-args.ts
// and parse-fork-args.ts — split out so the parser is unit-testable
// without spawning the CLI.

import { ParseError } from "@machinen/runtime";

import { consumePortForward } from "./parse-run-args.ts";

export interface ParsedRestoreArgs {
  /**
   * Positional args (the snapshot bundle directory). The CLI enforces
   * exactly one — kept as an array here to match the parseRunArgs
   * shape and let the CLI emit the canonical `usage:` line.
   */
  positional: string[];
  /** Optional explicit name for the restored VM (`--name <name>`). */
  name?: string;
  /** Workload rootfs override (`--image <path>`). */
  image?: string;
  /**
   * Host→guest port forwards (`-p <hostPort>:<guestPort>`). Like
   * `fork`, restore does NOT inherit forwards from the source — host
   * ports are global, so the source already binds each one it
   * forwarded. Pass new entries explicitly with non-conflicting
   * host ports.
   */
  portForward: Array<{ hostPort: number; guestPort: number }>;
}

export function parseRestoreArgs(argv: string[]): ParsedRestoreArgs {
  const positional: string[] = [];
  let name: string | undefined;
  let image: string | undefined;
  const portForward: Array<{ hostPort: number; guestPort: number }> = [];
  const seenHostPorts = new Set<number>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--name" || a.startsWith("--name=")) {
      const v = a === "--name" ? argv[++i] : a.slice("--name=".length);
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
    } else if (a === "--image" || a.startsWith("--image=")) {
      const v = a === "--image" ? argv[++i] : a.slice("--image=".length);
      if (!v) {
        throw new ParseError("PARSE_FLAG_MISSING_VALUE", "--image requires a value");
      }
      if (image !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--image may be given at most once per invocation",
        );
      }
      image = v;
    } else if (
      a === "-p" ||
      a === "--publish" ||
      a.startsWith("-p=") ||
      a.startsWith("--publish=")
    ) {
      i = consumePortForward(a, argv, i, seenHostPorts, portForward);
    } else if (a.startsWith("-")) {
      throw new ParseError("PARSE_FLAG_UNKNOWN", `unknown flag: ${a}`);
    } else {
      positional.push(a);
    }
  }
  return { positional, name, image, portForward };
}
