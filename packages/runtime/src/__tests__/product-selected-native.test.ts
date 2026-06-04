import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  PRODUCT_SELECTED_NATIVE_MANIFEST,
  PRODUCT_SELECTED_NATIVE_REFUSAL,
  PRODUCT_SELECTED_NATIVE_RESTORE_SUMMARY,
  createProductSelectedNativeSnapshot,
  restoreProductSelectedNativeSnapshot,
} from "../product-selected-native.ts";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "product-selected-native-"));
}

function verifier(arch: "arm64" | "amd64", override: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "passed",
    targetArch: arch,
    targetNativeExecution: true,
    rawCpuRestoreUsed: false,
    sourceIsaEmulationUsed: false,
    runtimeProfileRestoreUsed: false,
    appHooksUsed: false,
    metadataOnlySuccessAccepted: false,
    checks: {
      memory: true,
      stack: true,
      bootstrap: true,
      targetFunctionReturned: true,
    },
    resources: {
      closedFd: true,
      stdio: true,
      reopenFile: true,
      pipe: true,
      eventfd: true,
      timerfd: true,
      epoll: true,
      tcpListener: true,
    },
    ...override,
  });
}

describe("product selected native descriptor", () => {
  it("captures and restores the selected native product-path gate without public claim lift", () => {
    const root = tempDir();
    const bundle = join(root, "bundle");
    const sourceCapture = join(root, "source-capture.json");
    const targetPlan = join(root, "target-plan.json");
    mkdirSync(root, { recursive: true });
    writeFileSync(sourceCapture, JSON.stringify({ kind: "source-capture" }));
    writeFileSync(targetPlan, JSON.stringify({ kind: "target-plan" }));

    const capture = createProductSelectedNativeSnapshot({
      outDir: bundle,
      sourceArch: "arm64",
      targetArch: "amd64",
      sourceVerifierOutput: verifier("arm64"),
      sourceCapturePath: sourceCapture,
      targetPlanPath: targetPlan,
    });

    expect(capture.state).toBe("completed");
    expect(capture.migrationCompleted).toBe(true);
    expect(readFileSync(join(bundle, PRODUCT_SELECTED_NATIVE_MANIFEST), "utf8")).toContain(
      "proof-only-product-path",
    );

    const restore = restoreProductSelectedNativeSnapshot({
      bundleDir: bundle,
      targetArch: "amd64",
      targetVerifierOutput: verifier("amd64"),
    });

    expect(restore.migrationCompleted).toBe(true);
    expect(restore.publicClaimAllowed).toBe(false);
    expect(restore.publicClaim.arbitraryProcessCrossArchRestore).toBe(0);
    expect(readFileSync(join(bundle, PRODUCT_SELECTED_NATIVE_RESTORE_SUMMARY), "utf8")).toContain(
      "selected-single-thread-native-workload-v1",
    );
  });

  it("refuses unsafe source state and forbidden target shortcuts", () => {
    const root = tempDir();
    const sourceRefused = createProductSelectedNativeSnapshot({
      outDir: join(root, "refused"),
      sourceArch: "arm64",
      targetArch: "amd64",
      sourceVerifierOutput: verifier("arm64"),
      activeSyscall: true,
    });

    expect(sourceRefused.state).toBe("refused");
    if (sourceRefused.state !== "refused") {
      throw new Error("expected refused source");
    }
    expect(sourceRefused.refusal.expectedRefusalCode).toBe("native-source-state-unsupported");
    expect(readFileSync(join(root, "refused", PRODUCT_SELECTED_NATIVE_REFUSAL), "utf8")).toContain(
      "native-source-state-unsupported",
    );

    const bundle = join(root, "shortcut");
    createProductSelectedNativeSnapshot({
      outDir: bundle,
      sourceArch: "arm64",
      targetArch: "amd64",
      sourceVerifierOutput: verifier("arm64"),
    });
    const shortcut = restoreProductSelectedNativeSnapshot({
      bundleDir: bundle,
      targetArch: "amd64",
      targetVerifierOutput: verifier("amd64", { sourceIsaEmulationUsed: true }),
    });

    expect(shortcut.migrationCompleted).toBe(false);
    expect(shortcut.refusal?.expectedRefusalCode).toBe("native-target-shortcut-detected");
  });
});
