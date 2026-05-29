import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCT_LEVEL4_PING_SOCKET_MANIFEST,
  createProductLevel4PingSocketSnapshot,
  restoreProductLevel4PingSocketSnapshot,
} from "../product-level4-ping-socket.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "machinen-ping-l4-"));
}

describe("product Level 4 ping socket bundle", () => {
  it("captures and restores the narrow supported ping socket descriptor", () => {
    const dir = tempDir();
    try {
      const verifier = "ping-dgram-icmp id=7 seq=1 loopback target-loopback";
      const capture = createProductLevel4PingSocketSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        socketKind: "ping-dgram-icmp",
        sourceVerifierOutput: verifier,
        echoIdentifier: 7,
        echoSequence: 1,
        route: "loopback",
        namespace: "target-loopback",
      });
      expect(capture.state).toBe("completed");
      expect(capture.migrationCompleted).toBe(true);
      const descriptor = JSON.parse(
        readFileSync(join(dir, PRODUCT_LEVEL4_PING_SOCKET_MANIFEST), "utf8"),
      );
      expect(descriptor.implementationLevel).toBe("level-4-kernel-resource-reconstruction");
      expect(descriptor.restoreSurface).toBe(
        "machinen restore <bundle> --target-arch <arch> [--target-verifier-output <file>]",
      );
      expect(descriptor.continuation).toEqual({
        destination: "127.0.0.1",
        intervalMs: 1000,
        outputLogPath: "/tmp/machinen-restored-ping.log",
        sequencePolicy: "continue-at-next-supported-boundary",
        idPolicy: "descriptor-preserved-when-target-ping-supports-it",
        textOutputSequencePolicy: "target-ping-may-renumber-text-sequence",
      });
      expect(descriptor.gates.noActiveRecvmsgRequired).toBe(true);
      const restore = restoreProductLevel4PingSocketSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput: verifier,
      });
      expect(restore.state).toBe("completed");
      expect(restore.migrationCompleted).toBe(true);
      expect(restore.targetVerifierResult).toBe("passed");
      expect(restore.shortcutInspection).toEqual({
        sourceIsaEmulationUsed: false,
        sourceTextReusedAsTargetCode: false,
        sidecarRuntimeUsed: false,
        metadataOnlyShortcutAccepted: false,
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("carries target VM continuation intent from capture input", () => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4PingSocketSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        socketKind: "ping-dgram-icmp",
        sourceVerifierOutput: "ping-dgram-icmp id=5 seq=8 loopback target-loopback",
        echoIdentifier: 5,
        echoSequence: 8,
        destination: "127.0.0.1",
        intervalMs: 10_000,
        outputLogPath: "/tmp/machinen-restored-ping.log",
        route: "loopback",
        namespace: "target-loopback",
      });
      expect(capture.state).toBe("completed");
      if (capture.state !== "completed") {
        throw new Error("expected capture completion");
      }
      expect(capture.descriptor.continuation.destination).toBe("127.0.0.1");
      expect(capture.descriptor.continuation.intervalMs).toBe(10_000);
      expect(capture.descriptor.continuation.outputLogPath).toBe("/tmp/machinen-restored-ping.log");
      expect(capture.descriptor.socket.echoIdentifier).toBe(5);
      expect(capture.descriptor.socket.echoSequence).toBe(8);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each([
    ["activeRecvmsg", "ping-socket-active-recvmsg-unsupported"],
    ["unreadReceiveQueue", "ping-socket-unread-receive-queue-unsupported"],
    ["inflightPackets", "ping-socket-inflight-packets-unsupported"],
    ["ambiguousRouteOrNamespace", "ping-socket-ambiguous-route-or-namespace"],
    ["missingCredentialOrCapability", "ping-socket-missing-credential-or-capability"],
    ["unsupportedRawSocketOption", "ping-socket-unsupported-raw-socket-option"],
  ] as const)("refuses unsafe neighbor state at capture: %s", (flag, refusalCode) => {
    const dir = tempDir();
    try {
      const capture = createProductLevel4PingSocketSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        socketKind: "raw-icmp",
        sourceVerifierOutput: "raw-icmp id=9 seq=3 loopback target-loopback",
        echoIdentifier: 9,
        echoSequence: 3,
        route: "loopback",
        namespace: "target-loopback",
        [flag]: true,
      });
      expect(capture.state).toBe("refused");
      if (capture.state !== "refused") {
        throw new Error("expected capture refusal");
      }
      expect(capture.migrationCompleted).toBe(false);
      expect(capture.refusal.expectedRefusalCode).toBe(refusalCode);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses verifier and target architecture mismatches at restore", () => {
    const dir = tempDir();
    try {
      createProductLevel4PingSocketSnapshot({
        outDir: dir,
        sourceArch: "arm64",
        targetArch: "amd64",
        socketKind: "raw-icmp",
        sourceVerifierOutput: "raw-icmp id=11 seq=4 loopback target-loopback",
        echoIdentifier: 11,
        echoSequence: 4,
        route: "loopback",
        namespace: "target-loopback",
      });
      const verifierMismatch = restoreProductLevel4PingSocketSnapshot({
        bundleDir: dir,
        targetArch: "amd64",
        targetVerifierOutput: "raw-icmp id=12 seq=4 loopback target-loopback",
        dryRun: true,
      });
      expect(verifierMismatch.migrationCompleted).toBe(false);
      expect(verifierMismatch.refusal?.expectedRefusalCode).toBe(
        "ping-socket-target-verifier-mismatch",
      );

      const archMismatch = restoreProductLevel4PingSocketSnapshot({
        bundleDir: dir,
        targetArch: "arm64",
        targetVerifierOutput: "raw-icmp id=11 seq=4 loopback target-loopback",
        dryRun: true,
      });
      expect(archMismatch.migrationCompleted).toBe(false);
      expect(archMismatch.refusal?.expectedRefusalCode).toBe("ping-socket-target-arch-mismatch");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
