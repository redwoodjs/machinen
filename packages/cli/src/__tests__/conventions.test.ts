// Conventions lint — the "Swiss cheese fix" from Trevin's principles
// post. Manually enforcing CLI consistency through review fails; this
// test asserts the rules mechanically, against the agent-context
// schema (the source of truth for the CLI surface).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { COMMANDS, EXIT_CODES, SCHEMA_VERSION, buildAgentContext } from "../agent-context.ts";

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = readFileSync(join(SRC_DIR, "..", "cli.ts"), "utf8");
const PORTABLE_RESTORE_ADAPTER_SRC = readFileSync(
  join(SRC_DIR, "..", "portable-restore-adapter.ts"),
  "utf8",
);

// Verbs that match Cloudflare's posted convention plus this CLI's
// domain verbs. Anything outside this set has to be justified per
// command — agents trained on neighboring CLIs should recognize the
// shape on first encounter.
const ALLOWED_VERBS = new Set([
  // generic
  "list",
  "get",
  "create",
  "update",
  "delete",
  "stop",
  "install",
  "completion",
  "support",
  // domain
  "boot",
  "restore",
  "capture",
  "exec",
  "snapshot",
  "fork",
  "attach",
  "repl",
  "gc",
  // agent-facing meta
  "agent-context",
  "feedback",
]);

// Flag-naming taboos called out in the post:
//   - --format=json instead of --json
//   - --skip-confirmations / --skip-* instead of --force
//   - `info` as a verb (we use `get`)
const BANNED_FLAG_NAMES = new Set(["--format", "--skip-confirmations"]);
const BANNED_VERBS = new Set(["info"]);

describe("agent-context schema", () => {
  it("uses a positive integer schema version", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("buildAgentContext returns a parseable envelope", () => {
    const ctx = buildAgentContext();
    const round = JSON.parse(JSON.stringify(ctx));
    expect(round.schema_version).toBe(SCHEMA_VERSION);
    expect(round.cli_version).toMatch(/^\d/);
    expect(Array.isArray(round.commands)).toBe(true);
    expect(round.exit_codes.ok).toBe(0);
  });

  it("has a stable exit-code taxonomy", () => {
    expect(EXIT_CODES.ok).toBe(0);
    expect(EXIT_CODES.signalled_sigint).toBe(130);
    expect(EXIT_CODES.signalled_sigterm).toBe(143);
  });
});

describe("verb conventions", () => {
  it("primary command names are in the allowed set", () => {
    for (const cmd of COMMANDS) {
      expect(ALLOWED_VERBS.has(cmd.name), `command "${cmd.name}" not in allowed verbs`).toBe(true);
    }
  });

  it("no command uses a banned verb", () => {
    for (const cmd of COMMANDS) {
      expect(BANNED_VERBS.has(cmd.name), `banned verb "${cmd.name}"`).toBe(false);
      for (const alias of cmd.aliases ?? []) {
        expect(BANNED_VERBS.has(alias), `banned alias "${alias}" on ${cmd.name}`).toBe(false);
      }
    }
  });

  it("`list` is the primary verb (ls/ps are aliases)", () => {
    const list = COMMANDS.find((c) => c.name === "list");
    expect(list, "list command missing from agent-context").toBeDefined();
    expect(list?.aliases ?? []).toContain("ls");
    expect(list?.aliases ?? []).toContain("ps");
  });

  it("command names are unique across primary + aliases", () => {
    const seen = new Map<string, string>();
    for (const cmd of COMMANDS) {
      for (const name of [cmd.name, ...(cmd.aliases ?? [])]) {
        const owner = seen.get(name);
        expect(owner, `name "${name}" claimed by both ${owner} and ${cmd.name}`).toBeUndefined();
        seen.set(name, cmd.name);
      }
    }
  });
});

describe("flag conventions", () => {
  it("no command uses a banned flag name", () => {
    for (const cmd of COMMANDS) {
      for (const flag of cmd.flags) {
        expect(
          BANNED_FLAG_NAMES.has(flag.name),
          `${cmd.name}: banned flag "${flag.name}" — use --json / --force instead`,
        ).toBe(false);
        for (const alias of flag.aliases ?? []) {
          expect(
            BANNED_FLAG_NAMES.has(alias),
            `${cmd.name}: banned alias "${alias}" on ${flag.name}`,
          ).toBe(false);
          // --skip-* family is a generalised ban.
          expect(
            alias.startsWith("--skip-"),
            `${cmd.name}: --skip-* flag "${alias}" — use --force instead`,
          ).toBe(false);
        }
        expect(
          flag.name.startsWith("--skip-"),
          `${cmd.name}: --skip-* flag "${flag.name}" — use --force instead`,
        ).toBe(false);
      }
    }
  });

  it("every command claiming jsonOutput exposes a --json flag", () => {
    for (const cmd of COMMANDS) {
      if (!cmd.jsonOutput) {
        continue;
      }
      // agent-context is itself JSON — its envelope is implicitly --json.
      if (cmd.name === "agent-context") {
        continue;
      }
      const hasJson = cmd.flags.some((f) => f.name === "--json");
      expect(hasJson, `${cmd.name}: jsonOutput=true but no --json flag declared`).toBe(true);
    }
  });

  it("every mutating command supports --dry-run (or has a documented exception)", () => {
    // `feedback` writes a one-line append; --dry-run would be theatre.
    // `fork` is a multi-step submit-and-attach where dry-run would
    //   need to short-circuit before the snapshot, which is the same
    //   thing as not running the command. Skipped intentionally.
    const exceptions = new Set(["feedback", "fork"]);
    for (const cmd of COMMANDS) {
      if (!cmd.mutating) {
        continue;
      }
      if (exceptions.has(cmd.name)) {
        continue;
      }
      const hasDryRun = cmd.flags.some(
        (f) => f.name === "--dry-run" || (f.aliases ?? []).includes("--dry-run"),
      );
      expect(hasDryRun, `${cmd.name}: mutating but no --dry-run flag declared`).toBe(true);
    }
  });

  it("snapshot/restore product portability does not require runtime-specific workflow flags", () => {
    for (const name of ["snapshot", "restore"]) {
      const cmd = COMMANDS.find((candidate) => candidate.name === name);
      expect(cmd, `${name} command missing`).toBeDefined();
      const flags = new Set(cmd?.flags.map((flag) => flag.name));
      expect(flags.has("--portable"), `${name}: must not expose --portable`).toBe(false);
      expect(flags.has("--runtime"), `${name}: must not expose --runtime`).toBe(false);
    }
  });

  it("flags with type=enum carry a values list", () => {
    for (const cmd of COMMANDS) {
      for (const flag of cmd.flags) {
        if (flag.type !== "enum") {
          continue;
        }
        expect(
          Array.isArray(flag.values) && flag.values.length > 0,
          `${cmd.name} ${flag.name}: enum without values`,
        ).toBe(true);
      }
    }
  });
});

describe("portable restore adapter convention", () => {
  it("defines the reusable adapter hooks and registers ping/eventfd/pipe adapters", () => {
    for (const hook of [
      "detect",
      "validate",
      "plan",
      "foregroundRestore",
      "detachedRestore",
      "verify",
      "refuse",
    ]) {
      expect(PORTABLE_RESTORE_ADAPTER_SRC).toContain(`${hook}(`);
    }
    expect(CLI_SRC).toContain("const pingPortableRestoreAdapter");
    expect(CLI_SRC).toContain("const eventfdPortableRestoreAdapter");
    expect(CLI_SRC).toContain("const pipePortableRestoreAdapter");
    expect(CLI_SRC).toMatch(
      /const portableRestoreAdapters = \[\s*pingPortableRestoreAdapter,\s*eventfdPortableRestoreAdapter,\s*pipePortableRestoreAdapter,/,
    );
    expect(CLI_SRC).toContain("detectPortableRestoreAdapter(snapDir)");
  });
});

describe("schema vs implementation", () => {
  it("dispatch in cli.ts handles every documented command", () => {
    // Naive but catches drift: if we add a command to the schema, we
    // must also wire it into main()'s dispatch table. Keep the legacy
    // switch marker too so the test still guides future rewrites.
    for (const cmd of COMMANDS) {
      const candidates = [cmd.name, ...(cmd.aliases ?? [])];
      const hit = candidates.some(
        (n) => CLI_SRC.includes(`case "${n}":`) || CLI_SRC.includes(`["${n}",`),
      );
      expect(hit, `cli.ts has no dispatch entry for "${cmd.name}" or its aliases`).toBe(true);
    }
  });
});
