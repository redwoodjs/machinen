import { describe, expect, it } from "vitest";
import { planNativeTlsSegmentBaseHandoff } from "../native-tls-segment-policy.ts";

const baseRequest = {
  threadId: "thread:tls",
  sourceArch: "arm64" as const,
  targetArch: "amd64" as const,
  sourceThreadPointer: "0xffff0000",
  sourceRegister: "arm64-tpidr-el0" as const,
};

describe("native TLS segment-base handoff policy", () => {
  it("models arm64 TPIDR_EL0 separately from amd64 fs/gs when TLS is not required", () => {
    expect(
      planNativeTlsSegmentBaseHandoff({
        ...baseRequest,
        targetFsBase: "0x0",
        targetGsBase: "0x0",
        targetAccessPolicy: "not-required",
      }),
    ).toMatchObject({
      state: "accepted",
      sourceRegister: "arm64-tpidr-el0",
      sourceThreadPointer: "0xffff0000",
      targetSegmentBases: { fsBase: "0x0", gsBase: "0x0", accessPolicy: "not-required" },
      refusals: [],
    });
  });

  it("accepts explicit target segment bases as modeled handoff state", () => {
    expect(
      planNativeTlsSegmentBaseHandoff({
        ...baseRequest,
        targetFsBase: "0x7ffff7d00000",
        targetGsBase: "0x0",
        targetAccessPolicy: "segment-bases-provided",
      }),
    ).toMatchObject({
      state: "accepted",
      targetSegmentBases: {
        fsBase: "0x7ffff7d00000",
        gsBase: "0x0",
        accessPolicy: "segment-bases-provided",
      },
    });
  });

  it("refuses unknown source TLS and ambiguous target segment bases precisely", () => {
    const cases = [
      { id: "unknown-source", sourceThreadPointer: "unknown" },
      { id: "wrong-source-register", sourceRegister: "amd64-fs-base" as const },
      { id: "malformed-target-fs", targetFsBase: "nope" },
      {
        id: "nonzero-not-required",
        targetFsBase: "0x7ffff7d00000",
        targetAccessPolicy: "not-required" as const,
      },
      { id: "tcb-required", targetAccessPolicy: "target-tcb-required" as const },
    ];

    for (const entry of cases) {
      expect(
        planNativeTlsSegmentBaseHandoff({
          ...baseRequest,
          targetFsBase: "0x0",
          targetGsBase: "0x0",
          ...entry,
        }),
        entry.id,
      ).toMatchObject({
        state: "refused",
        refusals: [expect.objectContaining({ code: "tls-state-unsupported" })],
      });
    }
  });
});
