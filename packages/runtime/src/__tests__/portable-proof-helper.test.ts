import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const HELPER = join(REPO_ROOT, "scripts/portable-proof-compare.mjs");
const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function marker(phase: string, counter: number, arch = "amd64"): string {
  return (
    "MACHINEN_PORTABLE_PROOF " +
    JSON.stringify({
      schema_version: 1,
      phase,
      arch,
      counter,
      list: [1, 2, 3],
      checkpoint_abi_version: 1,
      checkpoint_symbol: "machinen_checkpoint",
      checkpoint_continuation: "machinen_portable_checkpoint",
      restore_symbol: "machinen_restore_main",
      restore_continuation: "machinen_portable_restore_entry",
      state_symbol: "machinen_portable_app_state",
      root_count: 2,
      root_names: ["machinen_portable_app_state", "machinen_portable_nodes"],
      checkpoint_result: 0,
      safe_point: {
        outside_signal_handler: true,
        outside_syscall: true,
      },
    }) +
    "\n"
  );
}

function writeLog(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "portable-proof-log-"));
  TMP.push(dir);
  const path = join(dir, "proof.log");
  writeFileSync(path, contents);
  return path;
}

function runHelper(args: string[], input?: string) {
  return spawnSync(process.execPath, [HELPER, ...args], { encoding: "utf8", input });
}

describe("portable proof workload helper", () => {
  it("accepts deterministic checkpoint/restore/continue markers", () => {
    const log = writeLog(
      marker("checkpoint", 1000) + marker("restore", 1000) + marker("continue", 1001),
    );
    const res = runHelper([
      "--expect-arch",
      "amd64",
      "--require-restore",
      "--require-continue",
      log,
    ]);
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ ok: true, events: 3 });
  });

  it("accepts stdin when the path is '-'", () => {
    const res = runHelper(
      ["--expect-arch", "amd64", "--require-restore", "--require-continue", "-"],
      marker("checkpoint", 1000) + marker("restore", 1000) + marker("continue", 1001),
    );
    expect(res.status).toBe(0);
    expect(JSON.parse(res.stdout)).toMatchObject({ ok: true, events: 3 });
  });

  it("rejects a restore marker whose state differs from the checkpoint", () => {
    const badRestore =
      "MACHINEN_PORTABLE_PROOF " +
      JSON.stringify({
        schema_version: 1,
        phase: "restore",
        arch: "amd64",
        counter: 999,
        list: [1, 2, 3],
        checkpoint_abi_version: 1,
        checkpoint_symbol: "machinen_checkpoint",
        checkpoint_continuation: "machinen_portable_checkpoint",
        restore_symbol: "machinen_restore_main",
        restore_continuation: "machinen_portable_restore_entry",
        state_symbol: "machinen_portable_app_state",
        root_count: 2,
        root_names: ["machinen_portable_app_state", "machinen_portable_nodes"],
        checkpoint_result: 0,
        safe_point: {
          outside_signal_handler: true,
          outside_syscall: true,
        },
      }) +
      "\n";
    const log = writeLog(marker("checkpoint", 1000) + badRestore);
    const res = runHelper(["--require-restore", log]);
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/restore\.counter expected 1000/);
  });
});
