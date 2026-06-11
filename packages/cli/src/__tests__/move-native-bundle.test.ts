import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateNativeProcessImageBundle, type MoveDescriptor } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import {
  attachNativeContinuation,
  moveActiveSyscallPlan,
  writeNativeProcessImageScaffold,
} from "../move-native-bundle.ts";

type GenericRefusals = NonNullable<
  NonNullable<NonNullable<MoveDescriptor["resourcePlan"]>["capture"]>["genericResourceGraphState"]
>["refusalClasses"];

const descriptor: MoveDescriptor = {
  formatVersion: 1,
  kind: "machinen.move.descriptor",
  rootPid: 71,
  scannedAt: "2026-06-08T00:00:00.000Z",
  nodes: [
    {
      pid: 71,
      ppid: 70,
      command: "ping",
      argv: ["ping", "google.com"],
      cwd: "/root",
      exe: "/usr/bin/ping",
    },
  ],
  edges: [],
  translatedStateClasses: ["process-identity", "argv-env-cwd"],
  refusedStateClasses: [],
  target: "cross-isa-target-native-pid-translation",
  productSurface: "machinen move",
  resourcePlan: {
    kind: "machinen.move.resource-plan",
    source: "guest-procfs",
    sourceArch: "arm64",
    resources: [],
    fdTableEntries: [],
    targetGuestResources: [],
    refusals: [],
    acceptedSubsets: [],
  },
};

function genericGraphState(refusalClasses: GenericRefusals) {
  return {
    policy: "generic-resource-graph-target-native-reexec-v1" as const,
    executableIdentity: { path: "/usr/bin/ping" },
    argv: ["ping", "google.com"],
    env: { policy: "target-default" as const },
    cwd: { path: "/root" },
    ports: [],
    regularFiles: [],
    dataDirs: [],
    fileOffsets: [],
    stdioPolicy: "stdio-dev-null-or-closed" as const,
    healthProbe: { kind: "process-alive" as const },
    resourceClasses: refusalClasses.map((item) => ({
      resourceClass: item.resourceClass,
      status: item.status,
      evidence: item.evidence,
    })),
    refusalClasses,
  };
}

describe("move native bundle scaffold", () => {
  it("accepts generic resource graph state only when no refusal classes remain", () => {
    const withGenericOnly = attachNativeContinuation({
      ...descriptor,
      resourcePlan: {
        ...descriptor.resourcePlan!,
        capture: { genericResourceGraphState: genericGraphState([]) },
      },
    });
    const withGenericRefusal = attachNativeContinuation({
      ...descriptor,
      resourcePlan: {
        ...descriptor.resourcePlan!,
        capture: {
          genericResourceGraphState: genericGraphState([
            {
              resourceClass: "socket",
              status: "refused",
              reason: "generic socket class is not graduated",
              evidence: "fd=3 path=socket:[1]",
              nextAction: "graduate socket resource class first",
            },
          ]),
        },
      },
    });

    expect(withGenericOnly.nativeContinuation?.state).toBe("planned");
    expect(withGenericOnly.nativeContinuation?.refusals).toEqual([]);
    expect(withGenericRefusal.nativeContinuation?.state).toBe("refused");
    expect(withGenericRefusal.nativeContinuation?.refusals[0]?.code).toBe(
      "target-semantic-continuation-missing",
    );
  });

  it("keeps app-specific envelopes higher priority than generic frontier refusals", () => {
    const withSocatAndGeneric = attachNativeContinuation({
      ...descriptor,
      resourcePlan: {
        ...descriptor.resourcePlan!,
        capture: {
          genericResourceGraphState: genericGraphState([
            {
              resourceClass: "socket",
              status: "refused",
              reason: "generic socket class is not graduated",
              evidence: "fd=3 path=socket:[1]",
              nextAction: "keep bespoke socat envelope until generic listener support is proven",
            },
          ]),
          socatFileResponderState: {
            port: 8147,
            filePath: "/tmp/socat-response.txt",
            fileIdentity: { size: 17, sha256: "a".repeat(64) },
            argvContract: "socat-tcp-listen-fork-reuseaddr-file",
            listenerState: "idle-single-listener",
            binaryPolicy: "proof-provisioned-target-native-socat",
          },
        },
      },
    });

    expect(withSocatAndGeneric.nativeContinuation?.state).toBe("planned");
    expect(withSocatAndGeneric.nativeContinuation?.refusals).toEqual([]);
  });

  it("writes a canonical native process-image bundle with move continuation refusals", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-move-native-bundle-"));
    try {
      const withContinuation = attachNativeContinuation(descriptor);
      writeNativeProcessImageScaffold(dir, withContinuation);

      const bundle = validateNativeProcessImageBundle(dir);
      expect(bundle.manifest.process.exe).toBe("/usr/bin/ping");
      expect(bundle.manifest.capture.sourceArch).toBe("arm64");
      expect(bundle.manifest.target.arch).toBe("amd64");
      expect(bundle.translation.threads[0]).toMatchObject({ state: "refused" });
      expect(moveActiveSyscallPlan(withContinuation)).toMatchObject({ state: "refused" });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
