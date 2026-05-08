// Pure arg parser for `machinen restore`. Sibling of parse-run-args.ts
// and parse-fork-args.ts — split out so the parser is unit-testable
// without spawning the CLI.

import { ParseError } from "@machinen/runtime";

import { consumeLiveMount, consumePortForward } from "./parse-run-args.ts";

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
  /**
   * `--eager` — opt out of the default lazy restore and load every
   * page from the bundle into host RAM up front (#263). The default
   * (lazy) live-mounts the bundle into the guest and runs
   * `criu restore --lazy-pages` so anon pages flow into the workload
   * only when faulted (#266).
   */
  eager: boolean;
  /**
   * #273: per-`guest` overrides for the live-share mounts recorded in
   * the bundle's `meta.liveMounts`. Each entry's `guest` MUST match a
   * recorded entry — restore() reproduces the snapshot's mount
   * topology, so this knob remaps the host path / mode for an
   * existing mount, it doesn't add new ones. The runtime emits
   * BOOT_LIVE_MOUNT_OVERRIDE_UNKNOWN for any unmatched entry.
   */
  liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }>;
}

export function parseRestoreArgs(argv: string[]): ParsedRestoreArgs {
  const positional: string[] = [];
  let name: string | undefined;
  let image: string | undefined;
  let eager = false;
  const portForward: Array<{ hostPort: number; guestPort: number }> = [];
  const liveMounts: Array<{ host: string; guest: string; mode: "ro" | "rw" }> = [];
  const seenLiveGuests = new Set<string>();
  const seenHostPorts = new Set<number>();
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--eager") {
      eager = true;
    } else if (a === "--name" || a.startsWith("--name=")) {
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
    } else if (a === "--mount-live" || a.startsWith("--mount-live=")) {
      const { value, next } = consumeLiveMount(a, argv, i);
      i = next;
      // CLI-side dedup: two overrides for the same guest is a typo,
      // not a feature. Runtime would still accept the second one
      // silently (last write wins on Map.set) — fail fast here.
      if (seenLiveGuests.has(value.guest)) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          `--mount-live override for guest=${value.guest} given more than once`,
        );
      }
      seenLiveGuests.add(value.guest);
      liveMounts.push(value);
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
  return { positional, name, image, portForward, eager, liveMounts };
}
