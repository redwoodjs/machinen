import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProductLevel4PipeSnapshot,
  isProductLevel4PipeBundle,
  restoreProductLevel4PipeSnapshot,
} from "../product-level4-pipe.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "machinen-pipe-product-"));
}

const SOURCE_VERIFIER =
  "pipe readFd=10 writeFd=12 buffer=empty peer=open waiters=none readiness=not-readable flags=cloexec";

describe("product Level 4 pipe", () => {
  it("captures and restores the empty no-waiters pipe pair descriptor", () => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4PipeSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        readFd: 10,
        writeFd: 12,
      });
      expect(capture.state).toBe("completed");
      expect(capture.migrationCompleted).toBe(true);
      expect(isProductLevel4PipeBundle(dir)).toBe(true);
      if (capture.state !== "completed") {
        throw new Error("expected completed capture");
      }
      expect(capture.descriptor.subset).toBe("pipe-pair-v1-empty-no-waiters");
      expect(capture.descriptor.pipe).toMatchObject({
        readFd: 10,
        writeFd: 12,
        buffer: "empty",
        peerLifetime: "open",
        waiters: "none",
        readiness: "not-readable",
      });

      const restore = restoreProductLevel4PipeSnapshot({
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
    ["pipe-buffered-data-unsupported", { buffer: "bytes" as const, bufferedBytesHex: "50495045" }],
    ["pipe-peer-lifetime-unsupported", { peerLifetime: "unknown" as const }],
    ["pipe-waiters-unsupported", { waiters: "unknown" as const }],
    ["pipe-readiness-unsupported", { readiness: "readable" as const }],
    ["pipe-unsupported-flags", { nonblocking: true }],
    ["pipe-active-syscall-unsupported", { activeSyscall: true }],
  ])("refuses unsafe pipe source state: %s", (code, unsafe) => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4PipeSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        readFd: 10,
        writeFd: 12,
        ...unsafe,
      });
      expect(capture.state).toBe("refused");
      expect(capture.migrationCompleted).toBe(false);
      if (capture.state !== "refused") {
        throw new Error("expected refused capture");
      }
      expect(capture.refusal.expectedRefusalCode).toBe(code);
      expect(
        JSON.parse(readFileSync(join(dir, "portable-pipe-refusal.json"), "utf8")),
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
      createProductLevel4PipeSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        readFd: 10,
        writeFd: 12,
      });
      const restore = restoreProductLevel4PipeSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput:
          "pipe readFd=10 writeFd=12 buffer=bytes peer=open waiters=none readiness=readable flags=cloexec",
      });
      expect(restore).toMatchObject({
        state: "refused",
        migrationCompleted: false,
        targetVerifierResult: "failed",
        refusal: { expectedRefusalCode: "pipe-target-verifier-mismatch" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
