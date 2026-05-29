import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProductLevel4TimerfdSnapshot,
  isProductLevel4TimerfdBundle,
  restoreProductLevel4TimerfdSnapshot,
} from "../product-level4-timerfd.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "machinen-timerfd-product-"));
}

const SOURCE_VERIFIER =
  "timerfd clock=monotonic mode=relative remainingMs=60000 intervalMs=0 expirations=0 flags=cloexec";

describe("product Level 4 timerfd", () => {
  it("captures and restores the monotonic relative one-shot timerfd descriptor", () => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4TimerfdSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        remainingMs: 60_000,
      });
      expect(capture.state).toBe("completed");
      expect(capture.migrationCompleted).toBe(true);
      expect(isProductLevel4TimerfdBundle(dir)).toBe(true);
      if (capture.state !== "completed") {
        throw new Error("expected completed capture");
      }
      expect(capture.descriptor.subset).toBe("timerfd-relative-oneshot-v1-monotonic");
      expect(capture.descriptor.timerfd).toMatchObject({
        clock: "monotonic",
        mode: "relative",
        remainingMs: 60_000,
        intervalMs: 0,
        unreadExpirations: 0,
      });

      const restore = restoreProductLevel4TimerfdSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput: SOURCE_VERIFIER,
      });
      expect(restore).toMatchObject({
        state: "completed",
        migrationCompleted: true,
        targetVerifierResult: "passed",
        implementationLevel: "level-4-kernel-resource-reconstruction",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["timerfd-unread-expirations-unsupported", { unreadExpirations: 1 }],
    ["timerfd-periodic-unsupported", { intervalMs: 1000 }],
    ["timerfd-absolute-unsupported", { absolute: true }],
    ["timerfd-cancel-on-set-unsupported", { cancelOnSet: true }],
    ["timerfd-clock-unsupported", { clock: "realtime" as const }],
    ["timerfd-unsupported-flags", { nonblocking: true }],
    ["timerfd-active-read-unsupported", { activeRead: true }],
  ])("refuses unsafe timerfd source state: %s", (code, unsafe) => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4TimerfdSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        remainingMs: 60_000,
        ...unsafe,
      });
      expect(capture.state).toBe("refused");
      expect(capture.migrationCompleted).toBe(false);
      if (capture.state !== "refused") {
        throw new Error("expected refused capture");
      }
      expect(capture.refusal.expectedRefusalCode).toBe(code);
      expect(
        JSON.parse(readFileSync(join(dir, "portable-timerfd-refusal.json"), "utf8")),
      ).toMatchObject({
        expectedRefusalCode: code,
        migrationCompleted: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses mismatched target verifier output", () => {
    const dir = tempDir();
    try {
      createProductLevel4TimerfdSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        remainingMs: 60_000,
      });
      const restore = restoreProductLevel4TimerfdSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput:
          "timerfd clock=monotonic mode=relative remainingMs=1000 intervalMs=0 expirations=0 flags=cloexec",
      });
      expect(restore).toMatchObject({
        state: "refused",
        migrationCompleted: false,
        targetVerifierResult: "failed",
        refusal: { expectedRefusalCode: "timerfd-target-verifier-mismatch" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
