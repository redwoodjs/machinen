import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

const BANNED_PROOF_PACKAGE_SCRIPTS = [
  "smoke-node-proper-level5-timer-proof",
  "proof-node-proper-level5-timer-proof",
] as const;

describe("proof-local smoke script conventions", () => {
  it("keeps proof 025 smoke commands out of root package scripts", () => {
    const packageJson = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts?: Record<string, string>;
    };

    for (const scriptName of BANNED_PROOF_PACKAGE_SCRIPTS) {
      expect(
        packageJson.scripts?.[scriptName],
        `${scriptName} should run directly from proofs/by-id/025`,
      ).toBeUndefined();
    }
  });
});
