import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

interface MemoryScalarReport {
  kind: "machinen.node-memory-scalar-reconstruction-proof";
  accepted: boolean;
  scope: "single-memory-only-node-global-scalar-count";
  sourceArch: "arm64" | "amd64";
  targetArch: "arm64" | "amd64";
  migrationCompleted: boolean;
  sourceCapture: {
    accepted: boolean;
    capturedValue: number;
    captureMethod: "guest-proc-mem-v8-context-smi-scan";
    appHookUsedForCapture: false;
    rawV8HeapRestored: false;
    samePidRestored: false;
  };
  targetResult: {
    accepted: boolean;
    reconstructedInitialValue: number;
    incrementedValue: number;
    targetNativeNode: true;
    rawV8HeapRestored: false;
    samePidRestored: false;
  };
  claimBoundary: {
    claims: string[];
    notClaimed: string[];
  };
  claimGuard: Record<string, false>;
}

describe("Node memory scalar reconstruction proof", () => {
  it("retains a real arm64-to-amd64 memory-only count scalar proof", () => {
    const report = JSON.parse(
      readFileSync(
        resolve(
          "proofs/nodejs/memory-scalar-reconstruction/retained/node-memory-scalar-reconstruction-arm64-to-amd64-report.json",
        ),
        "utf8",
      ),
    ) as MemoryScalarReport;

    expect(report).toMatchObject({
      kind: "machinen.node-memory-scalar-reconstruction-proof",
      accepted: true,
      scope: "single-memory-only-node-global-scalar-count",
      sourceArch: "arm64",
      targetArch: "amd64",
      migrationCompleted: true,
      sourceCapture: {
        accepted: true,
        capturedValue: 41,
        captureMethod: "guest-proc-mem-v8-context-smi-scan",
        appHookUsedForCapture: false,
        rawV8HeapRestored: false,
        samePidRestored: false,
      },
      targetResult: {
        accepted: true,
        reconstructedInitialValue: 41,
        incrementedValue: 42,
        targetNativeNode: true,
        rawV8HeapRestored: false,
        samePidRestored: false,
      },
    });
    expect(report.claimBoundary.claims).toEqual([
      "one controlled memory-only Node count scalar was captured from source process memory and reconstructed target-native across arm64-to-amd64",
    ]);
    expect(report.claimBoundary.notClaimed).toEqual(
      expect.arrayContaining([
        "arbitrary Node process restore",
        "raw V8 heap restore",
        "same PID continuation",
        "active request/socket continuation",
        "source ISA emulation",
        "arbitrary Linux process restore",
      ]),
    );
    expect(report.claimGuard).toMatchObject({
      arbitraryNodeProcessRestoreClaimed: false,
      arbitraryLinuxProcessRestoreClaimed: false,
      rawV8HeapRestoreUsed: false,
      rawCpuStateReplayUsed: false,
      sourceIsaEmulationUsed: false,
      samePidContinuationClaimed: false,
      activeRequestOrSocketContinuationClaimed: false,
    });
  });

  it("uses source process memory capture, not an app-exported checkpoint", () => {
    const script = readFileSync(
      resolve("proofs/nodejs/scripts/node-memory-scalar-reconstruction.ts"),
      "utf8",
    );
    expect(script).toContain("/proc/\\${pid}/mem");
    expect(script).toContain("guest-proc-mem-v8-context-smi-scan");
    expect(script).toContain("appHookUsedForCapture: false");
    expect(script).toContain("rawV8HeapRestored: false");
  });
});
