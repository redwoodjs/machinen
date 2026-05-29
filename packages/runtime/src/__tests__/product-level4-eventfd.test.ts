import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProductLevel4EventfdSnapshot,
  isProductLevel4EventfdBundle,
  restoreProductLevel4EventfdSnapshot,
} from "../product-level4-eventfd.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "machinen-eventfd-product-"));
}

describe("product Level 4 eventfd", () => {
  it("captures and restores the bounded non-semaphore no-waiters eventfd descriptor", () => {
    const dir = tempDir();
    try {
      const verifier =
        "eventfd counter=42 semaphore=0 waiters=none aliases=none readiness=readable flags=cloexec";
      const capture = createProductLevel4EventfdSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: verifier,
        counter: "42",
      });
      expect(capture.state).toBe("completed");
      expect(capture.migrationCompleted).toBe(true);
      expect(isProductLevel4EventfdBundle(dir)).toBe(true);
      if (capture.state !== "completed") {
        throw new Error("expected completed capture");
      }
      expect(capture.descriptor.subset).toBe("eventfd-counter-v1-nonsemaphore-no-waiters");
      expect(capture.descriptor.eventfd).toMatchObject({
        counter: "42",
        semaphore: false,
        waiters: "none",
        aliases: "none",
        readiness: "readable",
      });

      const restore = restoreProductLevel4EventfdSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput: verifier,
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
    ["eventfd-semaphore-unsupported", { semaphore: true }],
    ["eventfd-waiters-unsupported", { waiters: "unknown" as const }],
    ["eventfd-alias-unsupported", { aliases: "present" as const }],
    ["eventfd-unsupported-flags", { nonblocking: true }],
    ["eventfd-active-syscall-unsupported", { activeSyscall: true }],
  ])("refuses unsafe eventfd source state: %s", (code, unsafe) => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4EventfdSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput:
          "eventfd counter=7 semaphore=0 waiters=none aliases=none readiness=readable flags=cloexec",
        counter: "7",
        ...unsafe,
      });
      expect(capture.state).toBe("refused");
      expect(capture.migrationCompleted).toBe(false);
      if (capture.state !== "refused") {
        throw new Error("expected refused capture");
      }
      expect(capture.refusal.expectedRefusalCode).toBe(code);
      expect(
        JSON.parse(readFileSync(join(dir, "portable-eventfd-refusal.json"), "utf8")),
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
      createProductLevel4EventfdSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput:
          "eventfd counter=42 semaphore=0 waiters=none aliases=none readiness=readable flags=cloexec",
        counter: "42",
      });
      const restore = restoreProductLevel4EventfdSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput:
          "eventfd counter=41 semaphore=0 waiters=none aliases=none readiness=readable flags=cloexec",
      });
      expect(restore).toMatchObject({
        state: "refused",
        migrationCompleted: false,
        targetVerifierResult: "failed",
        refusal: { expectedRefusalCode: "eventfd-target-verifier-mismatch" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
