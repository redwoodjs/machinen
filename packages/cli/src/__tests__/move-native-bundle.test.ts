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

describe("move native bundle scaffold", () => {
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
