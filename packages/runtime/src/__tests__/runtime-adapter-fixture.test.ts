import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const FIXTURE = join(REPO_ROOT, "scripts/runtime-adapter-fixture.mjs");

describe("runtime-neutral adapter fixture", () => {
  it("validates mandatory runtime refusal behavior without claiming support", () => {
    const result = spawnSync("node", [FIXTURE], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, FORCE_COLOR: "1" },
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout);
    expect(summary).toMatchObject({
      passed: true,
      supportClaimed: false,
      refusalProof: {
        state: "refused",
        migrationCompleted: false,
        descriptorGateCompleted: false,
        refusal: { code: "runtime-native-extension-opaque" },
      },
    });
  });
});
