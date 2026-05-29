import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createProductLevel4TcpListenerSnapshot,
  isProductLevel4TcpListenerBundle,
  restoreProductLevel4TcpListenerSnapshot,
} from "../product-level4-tcp-listener.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "machinen-tcp-listener-product-"));
}

const SOURCE_VERIFIER =
  "tcp-listener family=inet protocol=tcp bind=127.0.0.1:18080 backlog=16 acceptQueue=empty reuseaddr=true";

describe("product Level 4 TCP listener", () => {
  it("captures and restores the loopback listener descriptor", () => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4TcpListenerSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        bindAddress: "127.0.0.1",
        port: 18_080,
        backlog: 16,
      });
      expect(capture.state).toBe("completed");
      expect(capture.migrationCompleted).toBe(true);
      expect(isProductLevel4TcpListenerBundle(dir)).toBe(true);
      if (capture.state !== "completed") {
        throw new Error("expected completed capture");
      }
      expect(capture.descriptor.subset).toBe("tcp-listener-v1-loopback-empty-accept-queue");
      expect(capture.descriptor.listener).toMatchObject({
        family: "inet",
        protocol: "tcp",
        bindAddress: "127.0.0.1",
        port: 18_080,
        backlog: 16,
        acceptQueue: "empty",
        reuseAddr: true,
      });

      const restore = restoreProductLevel4TcpListenerSnapshot({
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
    ["tcp-listener-address-unsupported", { bindAddress: "0.0.0.0" }],
    ["tcp-listener-port-invalid", { port: 0 }],
    ["tcp-listener-backlog-out-of-range", { backlog: 1024 }],
    ["tcp-listener-active-connections-unsupported", { activeConnections: true }],
    ["tcp-listener-accept-queue-unsupported", { acceptQueue: "non-empty" as const }],
    ["tcp-listener-unsupported-options", { reuseAddr: false }],
    ["tcp-listener-partial-io-unsupported", { partialIo: true }],
    ["tcp-listener-active-syscall-unsupported", { activeSyscall: true }],
  ])("refuses unsafe TCP listener source state: %s", (code, unsafe) => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4TcpListenerSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        bindAddress: "127.0.0.1",
        port: 18_080,
        backlog: 16,
        ...unsafe,
      });
      expect(capture.state).toBe("refused");
      expect(capture.migrationCompleted).toBe(false);
      if (capture.state !== "refused") {
        throw new Error("expected refused capture");
      }
      expect(capture.refusal.expectedRefusalCode).toBe(code);
      expect(
        JSON.parse(readFileSync(join(dir, "portable-tcp-listener-refusal.json"), "utf8")),
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
      createProductLevel4TcpListenerSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        sourceVerifierOutput: SOURCE_VERIFIER,
        bindAddress: "127.0.0.1",
        port: 18_080,
        backlog: 16,
      });
      const restore = restoreProductLevel4TcpListenerSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput:
          "tcp-listener family=inet protocol=tcp bind=127.0.0.1:18081 backlog=16 acceptQueue=empty reuseaddr=true",
      });
      expect(restore).toMatchObject({
        state: "refused",
        migrationCompleted: false,
        targetVerifierResult: "failed",
        refusal: { expectedRefusalCode: "tcp-listener-target-verifier-mismatch" },
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
