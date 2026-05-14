// Pure arg parser for `machinen fork`. Sibling of parse-run-args.ts —
// split out so the parser is unit-testable without spawning the CLI.
//
// Fork is "snapshot live + restore" rolled into one call, so the flag
// surface mirrors `machinen boot` for the most part: --mount,
// --mount-live, --env, --memory, --cwd all take effect on the
// restored sibling. Fork-only flags are --new-name, --out-dir,
// --tcp-keep, --detach. The source target (`--name`/`--pid`) is
// resolved by `parseTargetFlags` from the `rest` we pass through.

import { ParseError } from "@machinen/runtime";

import {
  consumeEnv,
  consumeGuestCwd,
  consumeLiveMount,
  consumeMemory,
  consumeMount,
  consumePortForward,
  takeValue,
} from "./parse-run-args.ts";

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
   * `--lazy` — opt into lazy-pages restore for this fork (#266).
   * Forced off whenever `--detach` is set: the lazy path relies on
   * a host-side FUSE server that lives in the runtime supervisor
   * process, and `--detach` exits that process, which would leave
   * the in-guest `criu lazy-pages` daemon blocked on the now-dead
   * FUSE channel. Lifting this constraint is #150 phase 3 — until
   * then, detach implies eager.
   */
  lazy: boolean;
  /**
   * Host→guest port forwards (`-p <hostPort>:<guestPort>`). NOT
   * inherited from the source — host ports are global, so the source
   * already binds each one it forwarded. Pass new entries explicitly
   * with non-conflicting host ports.
   */
  portForward: Array<{ hostPort: number; guestPort: number }>;
  /**
   * Single host directory to copy into the fork at boot
   * (`--mount <host>:<guest>`). Copy-once: same semantics as
   * `boot --mount`. Independent of the source's mount — the source's
   * `--mount` payload was baked into its rootdisk before snapshot,
   * so the fork inherits it via the disk image. Use this flag to
   * overlay an *additional* host dir on the fork.
   */
  mount?: { host: string; guest: string };
  /**
   * Live-share mounts (`--mount-live <host>:<guest>[:<mode>]`).
   * Establishes the mount on the fork after restore via an in-VMM
   * virtio-fs device (#332). See #78, #151.
   */
  liveMounts?: Array<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
  }>;
  /** Env vars exposed to the forked guest workload (`--env KEY=VALUE`). */
  env?: Record<string, string>;
  /**
   * Working directory for the guest cmd in the fork (`--cwd <abs-path>`).
   * Same shape as `boot --cwd`. Useful with `--mount` / `--mount-live`
   * to land directly inside the share.
   */
  guestCwd?: string;
  /**
   * Guest RAM ceiling for the fork in MiB (`--memory <mib>`). Same
   * shape as `boot --memory`. The runtime auto-sizes by default.
   */
  memory?: number;
  /** Args we didn't recognize — passed to `parseTargetFlags`. */
  rest: string[];
}

export function parseForkArgs(argv: string[]): ParsedForkArgs {
  let newName: string | undefined;
  let outDir: string | undefined;
  let tcpKeep = false;
  let detach = false;
  let lazy = false;
  const portForward: Array<{ hostPort: number; guestPort: number }> = [];
  const seenHostPorts = new Set<number>();
  let mount: { host: string; guest: string } | undefined;
  const liveMounts: Array<{
    host: string;
    guest: string;
    mode: "ro" | "rw";
  }> = [];
  const env: Record<string, string> = {};
  let guestCwd: string | undefined;
  let memory: number | undefined;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--new-name" || a.startsWith("--new-name=")) {
      if (newName !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--new-name may be given at most once per invocation",
        );
      }
      const { spec, next } = takeValue(a, argv, i, "a value");
      newName = spec;
      i = next;
    } else if (a === "--out-dir" || a.startsWith("--out-dir=")) {
      if (outDir !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--out-dir may be given at most once per invocation",
        );
      }
      const { spec, next } = takeValue(a, argv, i, "a directory path");
      outDir = spec;
      i = next;
    } else if (a === "--tcp-keep") {
      tcpKeep = true;
    } else if (a === "--detach") {
      detach = true;
    } else if (a === "--lazy") {
      lazy = true;
    } else if (
      a === "-p" ||
      a === "--publish" ||
      a.startsWith("-p=") ||
      a.startsWith("--publish=")
    ) {
      i = consumePortForward(a, argv, i, seenHostPorts, portForward);
    } else if (a === "--mount" || a.startsWith("--mount=")) {
      if (mount) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--mount may be given at most once per invocation",
        );
      }
      const r = consumeMount(a, argv, i);
      mount = r.value;
      i = r.next;
    } else if (a === "--mount-live" || a.startsWith("--mount-live=")) {
      const r = consumeLiveMount(a, argv, i);
      liveMounts.push(r.value);
      i = r.next;
    } else if (a === "--env" || a.startsWith("--env=")) {
      const r = consumeEnv(a, argv, i);
      env[r.key] = r.value;
      i = r.next;
    } else if (a === "--cwd" || a.startsWith("--cwd=")) {
      if (guestCwd !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--cwd may be given at most once per invocation",
        );
      }
      const r = consumeGuestCwd(a, argv, i);
      guestCwd = r.value;
      i = r.next;
    } else if (a === "--memory" || a.startsWith("--memory=")) {
      if (memory !== undefined) {
        throw new ParseError(
          "PARSE_FLAG_DUPLICATE",
          "--memory may be given at most once per invocation",
        );
      }
      const r = consumeMemory(a, argv, i);
      memory = r.value;
      i = r.next;
    } else {
      rest.push(a);
    }
  }
  // Detach exits the runtime supervisor, taking the host-side FUSE
  // server with it — the in-guest lazy-pages daemon would then block
  // on a dead FUSE channel. Force eager (lazy=false) to keep --detach
  // usable until the FUSE server gains its own detach handoff
  // (#150 phase 3).
  return {
    newName,
    outDir,
    tcpKeep,
    detach,
    lazy: lazy && !detach,
    portForward,
    mount,
    liveMounts: liveMounts.length > 0 ? liveMounts : undefined,
    env: Object.keys(env).length > 0 ? env : undefined,
    guestCwd,
    memory,
    rest,
  };
}
