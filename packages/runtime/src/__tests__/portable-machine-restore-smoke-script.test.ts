import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const SCRIPT = join(REPO_ROOT, "scripts/smoke/portable-machine-restore.sh");
const SCRIPT_ENV = { ...process.env, FORCE_COLOR: "1" };
const tempDirs: string[] = [];
const SMOKE_SCRIPT_TEST_TIMEOUT_MS = 30_000;

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "portable-machine-restore-smoke-"));
  tempDirs.push(dir);
  return dir;
}

describe("portable machine restore smoke profile", () => {
  it(
    "reports phase timings and skips target execution in dry-run mode",
    () => {
      const workDir = tempDir();
      const result = spawnSync(
        "bash",
        [SCRIPT, "--json", "--dry-run", "--keep", "--work-dir", workDir],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: SCRIPT_ENV,
          timeout: 30_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        profile: "portable-machine-restore",
        state: "skipped",
        skipReason: "dry run",
        portableMachineBundle: join(workDir, "portable-machine"),
        targetCodeFile: join(workDir, "portable-machine", "target", "continuation.bin"),
      });
      expect(
        summary.timings.map((timing: { name: string; status: string }) => [
          timing.name,
          timing.status,
        ]),
      ).toEqual([
        ["preflight", "ok"],
        ["capture", "ok"],
        ["bundle", "ok"],
        ["transfer", "ok"],
        ["target-boot-restore", "skipped"],
      ]);
      expect(
        summary.timings.every((timing: { ms: number }) => Number.isSafeInteger(timing.ms)),
      ).toBe(true);
    },
    SMOKE_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "accepts the file-read remote source profile in dry-run mode",
    () => {
      const workDir = tempDir();
      const result = spawnSync(
        "bash",
        [SCRIPT, "--json", "--remote-e2e", "--dry-run", "--keep", "--work-dir", workDir],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: { ...SCRIPT_ENV, PORTABLE_MACHINE_REMOTE_SOURCE_TARGET: "file-read" },
          timeout: 30_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        state: "skipped",
        skipReason: "dry run",
        remoteE2e: 1,
        remoteSourceTarget: "file-read",
      });
    },
    SMOKE_SCRIPT_TEST_TIMEOUT_MS,
  );

  it.each(["file-pread", "file-readv", "file-write", "file-pwrite", "file-writev"])(
    "accepts the %s remote source profile in dry-run mode",
    (sourceTarget) => {
      const workDir = tempDir();
      const result = spawnSync(
        "bash",
        [SCRIPT, "--json", "--remote-e2e", "--dry-run", "--keep", "--work-dir", workDir],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: { ...SCRIPT_ENV, PORTABLE_MACHINE_REMOTE_SOURCE_TARGET: sourceTarget },
          timeout: 30_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        state: "skipped",
        skipReason: "dry run",
        remoteE2e: 1,
        remoteSourceTarget: sourceTarget,
      });
    },
    SMOKE_SCRIPT_TEST_TIMEOUT_MS,
  );

  it(
    "accepts remote-e2e dry-run mode without live remotes",
    () => {
      const workDir = tempDir();
      const result = spawnSync(
        "bash",
        [SCRIPT, "--json", "--remote-e2e", "--dry-run", "--keep", "--work-dir", workDir],
        {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: SCRIPT_ENV,
          timeout: 30_000,
        },
      );

      expect(result.status, result.stderr).toBe(0);
      const summary = JSON.parse(result.stdout);
      expect(summary).toMatchObject({
        state: "skipped",
        skipReason: "dry run",
        remoteE2e: 1,
        arm64Ssh: "friend@100.126.46.90",
        amd64Ssh: "root@192.168.0.8",
        remotePortableMachineBundle: expect.stringContaining(
          "/tmp/machinen-portable-machine-restore-amd64-",
        ),
      });
      expect(summary.timings.map((timing: { name: string }) => timing.name)).toEqual([
        "preflight",
        "capture",
        "bundle",
        "transfer",
        "target-boot-restore",
      ]);
    },
    SMOKE_SCRIPT_TEST_TIMEOUT_MS,
  );
});
