import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const VERIFY_SCRIPT = join(REPO_ROOT, "scripts/native-thread-refusal-matrix.ts");
const TMP: string[] = [];

interface NativeThreadRefusalMatrixSummary {
  translated: { state: string };
  refusalCases: Array<{ id: string; refusalCode: string; message: string }>;
  restoreBoundary: {
    accepted: { state: string; threadId: string };
    refusalCases: Array<{ id: string; refusalCode: string; message: string }>;
  };
  architectureRefusal: { code: string; message: string };
}

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("native thread refusal matrix", () => {
  it("keeps unsafe syscall, signal, and rseq states behind precise refusals", () => {
    const outDir = mkdtempSync(join(tmpdir(), "native-thread-refusal-matrix-test-"));
    TMP.push(outDir);

    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", VERIFY_SCRIPT, "verify", "--out-dir", outDir, "--json"],
      {
        encoding: "utf8",
        cwd: REPO_ROOT,
        env: process.env,
        maxBuffer: 20 * 1024 * 1024,
      },
    );

    expect(result.status, result.stderr).toBe(0);
    const summary = JSON.parse(result.stdout) as NativeThreadRefusalMatrixSummary;
    expect(summary.translated.state).toBe("translated");
    expect(summary.refusalCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "inside-syscall", refusalCode: "active-syscall" }),
        expect.objectContaining({ id: "restart-block", refusalCode: "active-syscall" }),
        expect.objectContaining({ id: "signal-frame", refusalCode: "signal-frame-active" }),
        expect.objectContaining({
          id: "pending-signal-mask",
          refusalCode: "signal-state-unsupported",
        }),
        expect.objectContaining({
          id: "blocked-signal-mask",
          refusalCode: "signal-state-unsupported",
        }),
        expect.objectContaining({ id: "alt-stack", refusalCode: "signal-state-unsupported" }),
        expect.objectContaining({ id: "rseq-captured", refusalCode: "rseq-state-unsupported" }),
        expect.objectContaining({ id: "rseq-unsupported", refusalCode: "rseq-state-unsupported" }),
      ]),
    );
    expect(summary.restoreBoundary.accepted).toMatchObject({
      state: "accepted",
      threadId: "thread:restore-safe",
    });
    expect(summary.restoreBoundary.refusalCases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "multi-thread", refusalCode: "thread-state-unsupported" }),
        expect.objectContaining({ id: "futex-wait", refusalCode: "futex-state-unsupported" }),
        expect.objectContaining({
          id: "signal-delivery-stop",
          refusalCode: "signal-state-unsupported",
        }),
        expect.objectContaining({ id: "ptrace-debug", refusalCode: "thread-state-unsupported" }),
        expect.objectContaining({
          id: "shared-stack",
          refusalCode: "mapping-shared-unsupported",
        }),
        expect.objectContaining({ id: "unknown-tls", refusalCode: "tls-state-unsupported" }),
        expect.objectContaining({
          id: "wrong-tls-source-register",
          refusalCode: "tls-state-unsupported",
        }),
        expect.objectContaining({
          id: "unsupported-target-segment-bases",
          refusalCode: "tls-state-unsupported",
        }),
        expect.objectContaining({
          id: "ambiguous-registers",
          refusalCode: "thread-state-unsupported",
        }),
        expect.objectContaining({
          id: "missing-simd-fpu-state",
          refusalCode: "simd-fpu-state-unsupported",
        }),
        expect.objectContaining({
          id: "live-simd-fpu-state",
          refusalCode: "simd-fpu-state-unsupported",
        }),
        expect.objectContaining({
          id: "unsupported-simd-fpu-state",
          refusalCode: "simd-fpu-state-unsupported",
        }),
      ]),
    );
    expect(summary.architectureRefusal.code).toBe("architecture-pair-unsupported");
  });
});
