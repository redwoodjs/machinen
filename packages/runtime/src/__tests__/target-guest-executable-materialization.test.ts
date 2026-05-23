import { describe, expect, it } from "vitest";
import { planTargetGuestExecutableMaterialization } from "../target-guest-executable-materialization.ts";
import type { NativeMappingMaterializationStep } from "../native-mapping-materialization.ts";

const executableStep: NativeMappingMaterializationStep = {
  mapping: "mapping:text",
  kind: "text",
  action: "map-target-file",
  targetStart: "0x700300000000",
  sizeBytes: 8192,
  permissions: { read: true, write: false, execute: true, private: true, shared: false },
  targetFile: {
    path: "/usr/bin/target-tool",
    offset: 0,
    buildId: "target-build-id",
  },
};

describe("target guest executable materialization", () => {
  it("plans target-native executable mapping from provenanced target files", () => {
    expect(planTargetGuestExecutableMaterialization([executableStep])).toEqual({
      state: "planned",
      refusals: [],
      steps: [
        {
          action: "map-target-executable",
          mapping: "mapping:text",
          targetStart: "0x700300000000",
          sizeBytes: 8192,
          permissions: { read: true, write: false, execute: true, private: true, shared: false },
          path: "/usr/bin/target-tool",
          fileOffset: 0,
          buildId: "target-build-id",
          sha256: undefined,
          sourceTextReusedAsTargetCode: false,
        },
      ],
    });
  });

  it("ignores non-executable private data steps", () => {
    expect(
      planTargetGuestExecutableMaterialization([
        {
          ...executableStep,
          mapping: "mapping:heap",
          kind: "heap",
          action: "copy-captured-bytes",
          permissions: { read: true, write: true, execute: false, private: true, shared: false },
          sourceBytes: { offset: 0, sizeBytes: 4096 },
          targetFile: undefined,
        },
      ]),
    ).toEqual({ state: "planned", steps: [], refusals: [] });
  });

  it("refuses executable captured bytes and missing target provenance", () => {
    expect(
      planTargetGuestExecutableMaterialization([
        {
          ...executableStep,
          action: "copy-captured-bytes",
          sourceBytes: { offset: 0, sizeBytes: 16 },
        },
      ]),
    ).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "mapping-executable-unsupported" })],
    });

    expect(
      planTargetGuestExecutableMaterialization([
        { ...executableStep, targetFile: { path: "/usr/bin/target-tool", offset: 0 } },
      ]),
    ).toMatchObject({
      state: "refused",
      refusals: [expect.objectContaining({ code: "mapping-provenance-ambiguous" })],
    });
  });
});
