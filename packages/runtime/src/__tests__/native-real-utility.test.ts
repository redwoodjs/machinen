import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-real-utility.ts");
const TMP: string[] = [];

interface NativeRealUtilitySummary {
  skipped?: boolean;
  attempts: Array<{
    name: string;
    state: "captured" | "refused" | "skipped";
    resourceKinds?: string[];
    resourceRefusals?: Array<{ code: string }>;
    refusal?: { code: string };
  }>;
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native real utility attempts", () => {
  it.skipIf(process.platform !== "linux")(
    "captures or precisely refuses real utilities including ping",
    { timeout: 120_000 },
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "native-real-utility-test-"));
      TMP.push(outDir);

      const result = spawnSync(
        process.execPath,
        ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
        { encoding: "utf8", cwd: REPO_ROOT, maxBuffer: 40 * 1024 * 1024 },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout) as NativeRealUtilitySummary;
      expect(summary.skipped).not.toBe(true);
      expect(summary.attempts.map((attempt) => attempt.name)).toEqual(["sleep", "cat", "ping"]);
      expect(
        summary.attempts.some(
          (attempt) => attempt.state === "captured" || attempt.state === "refused",
        ),
      ).toBe(true);
      expect(summary.attempts.find((attempt) => attempt.name === "cat")?.refusal?.code).toBe(
        "thread-state-unsupported",
      );
      const ping = summary.attempts.find((attempt) => attempt.name === "ping");
      if (ping?.state !== "skipped") {
        expect([
          ...(ping?.resourceKinds ?? []),
          ...(ping?.resourceRefusals ?? []).map((r) => r.code),
        ]).not.toHaveLength(0);
      }
    },
  );
});
