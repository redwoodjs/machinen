// Catch missing/renamed/removed public symbols in API.md before
// hosted CI does. The hosted `docs.yml` workflow already gates on
// the same `git diff --exit-code -- packages/runtime/API.md` after
// `pnpm run build:docs`, but it's *skipped* under agent-ci local
// because typedoc's "Defined in:" links rely on git ls-files
// resolving paths and agent-ci's snapshot checkout puts the
// workspace where typedoc can't match (see docs.yml:38-43). Result:
// drift sneaks past the local gate (`pnpm vitest run` /
// `agent-ci run --all`) and only surfaces on the GitHub Actions
// hosted CI for the PR. This test closes that gap by running
// typedoc into a tmpdir and comparing structural content (after
// stripping the "Defined in:" URL/line-number lines that the
// agent-ci snapshot checkout messes with).

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const COMMITTED_API_MD = join(REPO_ROOT, "packages/runtime/API.md");

/**
 * Strip the "Defined in: [path](url)" link block from API.md content.
 * These lines change on every code edit (line numbers shift) and are
 * the source of the agent-ci local false-positives — we care about
 * structural drift (added/removed/renamed symbols + their JSDoc), not
 * which line a symbol happens to start on.
 */
function stripDefinedIn(md: string): string {
  return md
    .split("\n")
    .filter((line) => !line.startsWith("Defined in: "))
    .join("\n");
}

describe("API.md drift", () => {
  it(
    "matches `pnpm run build:docs` output (modulo line-number URLs)",
    () => {
      const out = mkdtempSync(join(tmpdir(), "machinen-api-md-drift-"));
      try {
        // Run the same typedoc invocation `pnpm run build:docs` runs,
        // but redirect the output so we don't clobber the on-disk
        // committed file mid-test. Reads typedoc.json from REPO_ROOT.
        execFileSync("npx", ["typedoc", "--out", out], {
          cwd: REPO_ROOT,
          stdio: ["ignore", "ignore", "pipe"],
          // Generous: typedoc cold-start + plugin load is ~1s on warm
          // node_modules, slower on a fresh CI checkout.
          timeout: 60_000,
        });
        const generated = readFileSync(join(out, "API.md"), "utf8");
        const committed = readFileSync(COMMITTED_API_MD, "utf8");
        const drift = stripDefinedIn(generated) !== stripDefinedIn(committed);
        if (drift) {
          // Surface a diff-y message so the failure tells the dev
          // exactly what to do, not just "they're different."
          expect.fail(
            "packages/runtime/API.md is out of date with the JSDoc in src/.\n" +
              "Run `pnpm run build:docs` and commit the result.\n" +
              "(This test ignores line-number changes in 'Defined in:' URLs;\n" +
              " the diff above is real structural drift — added, removed, or\n" +
              " renamed symbols, or changed JSDoc text.)",
          );
        }
      } finally {
        rmSync(out, { recursive: true, force: true });
      }
    },
    // Vitest's default `testTimeout` is 5s. Typedoc cold-start + plugin
    // load is ~1s on a warm `node_modules` but ~10-15s on hosted CI
    // runners (slower disks, cold caches, npx resolution overhead),
    // so the default fires before typedoc finishes its first run.
    // 60s gives plenty of headroom; the actual `execFileSync` carries
    // its own 60s cap above for the same reason.
    60_000,
  );
});
