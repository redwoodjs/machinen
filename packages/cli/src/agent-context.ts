// Versioned, machine-readable description of the machinen CLI surface.
// Emitted by `machinen agent-context` and consumed by the conventions
// lint in `__tests__/conventions.test.ts`. Bump SCHEMA_VERSION when the
// shape changes in a way that breaks downstream parsers.

import pkg from "../package.json" with { type: "json" };

// SCHEMA_VERSION 2: introduced `positionals` on CommandSpec along
// with the <target> positional on exec/snapshot/fork/attach/repl/stop
// (and snapshot's <out-dir>).
export const SCHEMA_VERSION = 2 as const;

/** A single CLI flag. `enum` is set when the value must be one of a fixed list. */
interface FlagSpec {
  name: string;
  type: "boolean" | "string" | "integer" | "enum";
  /** When `type === "enum"`, the valid set. */
  values?: string[];
  /** Optional aliases (e.g. `["--detached"]` for `--detach`). */
  aliases?: string[];
  /** Repeatable flag (e.g. `--env`, `-p`, `--mount-live`). */
  repeatable?: boolean;
  /** When true, the flag takes a value. Implied by non-boolean type. */
  takesValue?: boolean;
  description: string;
}

/** A positional argument. Order matches the order in the array. */
interface PositionalSpec {
  name: string;
  /** Required positional? Defaults to true. */
  required?: boolean;
  description: string;
}

interface CommandSpec {
  name: string;
  /** Other accepted spellings (e.g. `ls` for `list`). */
  aliases?: string[];
  /** Short blurb for help text. */
  summary: string;
  /** Whether this command emits a structured payload under `--json`. */
  jsonOutput: boolean;
  /** Whether this command mutates state. Mutating commands should support --dry-run. */
  mutating?: boolean;
  /** Positional args, in order. */
  positionals?: PositionalSpec[];
  flags: FlagSpec[];
  /** Document the JSON envelope shape when `jsonOutput` is true. */
  jsonEnvelope?: string;
}

// Shared shape for the seven commands that target a running VM:
// a single positional, digits → pid, otherwise → name.
const TARGET_POSITIONAL: PositionalSpec = {
  name: "target",
  description: "The VM to act on. Pass a registered name or a host pid (digits-only).",
};

/** The top-level commands of the CLI, keyed by canonical name. */
export const COMMANDS: CommandSpec[] = [
  {
    name: "boot",
    summary: "Boot a microVM and run a command in it.",
    jsonOutput: true,
    flags: [
      {
        name: "--name",
        type: "string",
        description: "Register the VM under a human-friendly name.",
      },
      {
        name: "--snapshot",
        type: "string",
        description: "Attach <path> as /dev/vda for a future vm.snapshot().",
      },
      { name: "--mount", type: "string", description: "Copy-once host directory into the guest." },
      {
        name: "--mount-live",
        type: "string",
        repeatable: true,
        description: "Live-share host dir over virtio-fs. Spec: <host>:<guest>[:rw|ro].",
      },
      {
        name: "--env",
        type: "string",
        repeatable: true,
        description: "Set an env var inside the guest (KEY=VALUE).",
      },
      {
        name: "--cwd",
        type: "string",
        description: "Working directory for the guest cmd (must be absolute).",
      },
      {
        name: "-p",
        type: "string",
        repeatable: true,
        aliases: ["--publish"],
        description: "Forward host TCP port to the guest.",
      },
      {
        name: "--detach",
        type: "boolean",
        aliases: ["--detached"],
        description: "Detach the VMM from the CLI on first-guest-byte readiness.",
      },
      { name: "--memory", type: "integer", description: "Guest RAM ceiling in MiB (debug knob)." },
      {
        name: "--nested",
        type: "boolean",
        description: "Expose arm64 EL2 / /dev/kvm to the guest when the host supports it.",
      },
      {
        name: "--json",
        type: "boolean",
        description: "Emit the boot identity as JSON to stdout (only meaningful with --detach).",
      },
    ],
    jsonEnvelope: '{"schema_version": 1, "pid": <int>, "name": <string|null>, "detached": <bool>}',
  },
  {
    name: "restore",
    summary: "Restore a VM from a snapshot bundle.",
    jsonOutput: false,
    flags: [
      { name: "--name", type: "string", description: "Register the restored VM under this name." },
      {
        name: "--image",
        type: "string",
        description:
          "Workload tarball used at boot time (needed when CRIU references files outside the base rootfs).",
      },
      {
        name: "--lazy",
        type: "boolean",
        description:
          "Opt into lazy-pages restore (#266) — vsock-FUSE mount the bundle and fault pages on demand. Default is eager.",
      },
      {
        name: "-p",
        type: "string",
        repeatable: true,
        description: "Forward host TCP port. Not inherited from the source.",
      },
      {
        name: "--mount-live",
        type: "string",
        repeatable: true,
        description:
          "Override a recorded live-share mount's host/mode (#273). Each entry's <guest> must match a guest path recorded in the bundle's meta.liveMounts.",
      },
    ],
  },
  {
    name: "list",
    aliases: ["ls", "ps"],
    summary: "List running VMs.",
    jsonOutput: true,
    flags: [
      {
        name: "--json",
        type: "boolean",
        description: "Emit machine-readable JSON to stdout instead of the text table.",
      },
    ],
    jsonEnvelope:
      '{"schema_version": 1, "vms": [{"pid": <int>, "name": <string|null>, "started_at": <ms>, "uptime_ms": <ms>, "memory": {"rss_bytes": <int|null>, "ceiling_mib": <int|null>}, "ports": [...], "forked_from": <string|null>}]}',
  },
  {
    name: "exec",
    summary: "Run a command in a running VM.",
    jsonOutput: false,
    positionals: [TARGET_POSITIONAL],
    flags: [
      {
        name: "--tty",
        type: "boolean",
        aliases: ["--pty"],
        description: "Allocate a real PTY in the guest (needed for vim, htop, job control).",
      },
    ],
  },
  {
    name: "snapshot",
    summary: "CRIU-snapshot a running VM.",
    jsonOutput: true,
    mutating: true,
    positionals: [
      TARGET_POSITIONAL,
      {
        name: "out-dir",
        description: "Directory to write the snapshot bundle into.",
      },
    ],
    flags: [
      {
        name: "--keep-alive",
        type: "boolean",
        description: "Leave the source VM running (default: source exits as part of the dump).",
      },
      {
        name: "--dry-run",
        type: "boolean",
        description: "Validate target + out-dir without dumping.",
      },
      { name: "--json", type: "boolean", description: "Emit the snapshot result as JSON." },
    ],
    jsonEnvelope:
      '{"schema_version": 1, "snap_dir": <abs-path>, "elapsed_ms": <int>, "dry_run": <bool>}',
  },
  {
    name: "fork",
    summary: "Clone a running VM into a sibling.",
    jsonOutput: true,
    mutating: true,
    positionals: [TARGET_POSITIONAL],
    flags: [
      { name: "--new-name", type: "string", description: "Name for the fork." },
      { name: "--out-dir", type: "string", description: "Keep the snapshot bundle here." },
      {
        name: "--tcp-keep",
        type: "boolean",
        description: "Inherit TCP socket state in the fork (rarely correct).",
      },
      {
        name: "--detach",
        type: "boolean",
        description: "Don't attach to the fork's stdio — return as soon as it's up.",
      },
      {
        name: "--lazy",
        type: "boolean",
        description:
          "Opt into lazy-pages restore (#266); ignored when --detach is set since the FUSE server can't survive supervisor exit.",
      },
      {
        name: "-p",
        type: "string",
        repeatable: true,
        description: "Forward host TCP port into the fork.",
      },
      {
        name: "--mount",
        type: "string",
        description: "Overlay an additional copy-once host directory on the fork.",
      },
      {
        name: "--mount-live",
        type: "string",
        repeatable: true,
        description: "Establish a fresh FUSE live-share on the fork.",
      },
      {
        name: "--env",
        type: "string",
        repeatable: true,
        description: "Set an env var inside the forked guest.",
      },
      {
        name: "--cwd",
        type: "string",
        description: "Working directory for the guest cmd in the fork.",
      },
      { name: "--memory", type: "integer", description: "Guest RAM ceiling for the fork." },
      { name: "--json", type: "boolean", description: "Emit the fork identity as JSON." },
    ],
    jsonEnvelope:
      '{"schema_version": 1, "pid": <int>, "name": <string|null>, "source": <string|null>, "bundle_dir": <abs-path>, "ephemeral": <bool>}',
  },
  {
    name: "attach",
    summary: "Drop into an interactive PTY shell in a running VM.",
    jsonOutput: false,
    positionals: [TARGET_POSITIONAL],
    flags: [
      {
        name: "--shell",
        type: "string",
        description: "Override the shell (default: /bin/bash -i).",
      },
      {
        name: "--tail",
        type: "integer",
        description:
          "Dump the boot-console snapshot before the shell. With no value, prints the whole snapshot.",
      },
    ],
  },
  {
    name: "repl",
    summary: "Per-line exec REPL — each line is a fresh one-shot command.",
    jsonOutput: false,
    positionals: [TARGET_POSITIONAL],
    flags: [],
  },
  {
    name: "stop",
    summary: "Stop a running VM (SIGTERM, SIGKILL after 2s).",
    jsonOutput: true,
    mutating: true,
    positionals: [TARGET_POSITIONAL],
    flags: [
      {
        name: "--force",
        type: "boolean",
        aliases: ["-9"],
        description: "SIGKILL immediately, skipping the SIGTERM grace period.",
      },
      {
        name: "--dry-run",
        type: "boolean",
        description: "Print what would be killed without sending signals.",
      },
      { name: "--json", type: "boolean", description: "Emit the stop result as JSON." },
    ],
    jsonEnvelope:
      '{"schema_version": 1, "pid": <int>, "name": <string|null>, "status": "stopped"|"already_dead"|"recycled"|"would_stop", "dry_run": <bool>}',
  },
  {
    name: "gc",
    summary: "Drop dead registry entries and their per-boot artifacts.",
    jsonOutput: true,
    mutating: true,
    flags: [
      {
        name: "--dry-run",
        type: "boolean",
        aliases: ["-n"],
        description: "Print what would be cleaned without removing anything.",
      },
      { name: "--json", type: "boolean", description: "Emit the gc results as JSON." },
    ],
    jsonEnvelope:
      '{"schema_version": 1, "dry_run": <bool>, "results": [{"pid": <int>, "name": <string|null>, "status": <string>, "removed_paths": [...], "failed_paths": [...]}]}',
  },
  {
    name: "install",
    summary: "Pre-fetch the kernel + base rootfs for a release tag.",
    jsonOutput: true,
    flags: [
      {
        name: "--version",
        type: "string",
        description: "Release tag (defaults to the CLI's own version).",
      },
      { name: "--json", type: "boolean", description: "Emit the install result as JSON." },
    ],
    jsonEnvelope:
      '{"schema_version": 1, "tag": <string>, "base_dir": <abs-path>, "fetched": <bool>}',
  },
  {
    name: "feedback",
    summary:
      "Record a friction note locally; optional upstream POST when MACHINEN_FEEDBACK_ENDPOINT is set.",
    jsonOutput: true,
    mutating: true,
    flags: [
      {
        name: "--list",
        type: "boolean",
        description: "Print recent feedback entries instead of recording a new one.",
      },
      { name: "--json", type: "boolean", description: "Emit the feedback result as JSON." },
    ],
    jsonEnvelope:
      '{"schema_version": 1, "recorded": <bool>, "path": <abs-path>, "upstream_status": <int|null>}',
  },
  {
    name: "agent-context",
    summary: "Emit a versioned JSON description of every command and flag.",
    jsonOutput: true,
    flags: [],
    jsonEnvelope:
      '{"schema_version": 1, "cli_version": <string>, "commands": [...], "exit_codes": {...}}',
  },
  {
    name: "completion",
    summary: "Print a shell completion script (bash | zsh | fish).",
    jsonOutput: false,
    flags: [],
  },
];

/** Stable exit-code taxonomy. `1` is the default failure; the rest are still 1 today,
 * but documented here so future taxonomy work has a target shape. */
export const EXIT_CODES = {
  ok: 0,
  generic_failure: 1,
  signalled_sigint: 130,
  signalled_sigterm: 143,
} as const;

interface AgentContext {
  schema_version: typeof SCHEMA_VERSION;
  cli_version: string;
  commands: CommandSpec[];
  exit_codes: typeof EXIT_CODES;
}

export function buildAgentContext(): AgentContext {
  return {
    schema_version: SCHEMA_VERSION,
    cli_version: pkg.version,
    commands: COMMANDS,
    exit_codes: EXIT_CODES,
  };
}
