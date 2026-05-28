import { describe, expect, it } from "vitest";

import { createProductSemanticPingContinuation } from "../product-semantic-ping.ts";

const baseInput = {
  sourceArch: "arm64" as const,
  targetArch: "amd64" as const,
  destination: "198.51.100.10",
  intervalMs: 1000,
  identifier: 4242,
  nextSequence: 8,
  sent: 8,
  received: 7,
  lost: 1,
  receiveQueue: "empty" as const,
  activeRecvmsg: false,
  rawSocketState: "none" as const,
  verifierEchoReplies: 2,
};

describe("Goal 001 Level 2 semantic ping continuation", () => {
  it("continues ping sequence and counters through a logical descriptor", () => {
    const result = createProductSemanticPingContinuation(baseInput);

    expect(result).toMatchObject({
      state: "completed",
      migrationCompleted: true,
      descriptor: {
        supportLevel: "level-2-semantic-continuation",
        profile: "ping-sequence-counter-semantic-continuation-v1",
        logicalState: {
          identifier: 4242,
          nextSequence: 8,
          sent: 8,
          received: 7,
          lost: 1,
          inFlightPacketPolicy: "drop-and-count-lost",
        },
      },
      summary: {
        targetVerifierResult: "passed",
        continuedState: {
          firstTargetSequence: 8,
          sentAfterVerifier: 10,
          receivedAfterVerifier: 9,
          lostAfterVerifier: 1,
        },
      },
    });
    expect(result.state === "completed" && result.descriptor.gates.sourceIsaEmulationAllowed).toBe(
      false,
    );
  });

  it("refuses unread receive queues instead of silently dropping replies", () => {
    const result = createProductSemanticPingContinuation({
      ...baseInput,
      receiveQueue: "unread-replies",
    });

    expect(result).toMatchObject({
      state: "refused",
      migrationCompleted: false,
      refusal: {
        expectedRefusalCode: "semantic-ping-unread-receive-queue-unsupported",
      },
    });
    expect(
      result.state === "refused" &&
        result.refusal.observableStateDecisions.some(
          (decision) => decision.name === "unread-receive-queue" && decision.decision === "refused",
        ),
    ).toBe(true);
  });

  it("refuses active recvmsg and kernel-exact raw socket state", () => {
    expect(
      createProductSemanticPingContinuation({ ...baseInput, activeRecvmsg: true }),
    ).toMatchObject({
      state: "refused",
      refusal: { expectedRefusalCode: "semantic-ping-active-recvmsg-unsupported" },
    });
    expect(
      createProductSemanticPingContinuation({ ...baseInput, rawSocketState: "present" }),
    ).toMatchObject({
      state: "refused",
      refusal: { expectedRefusalCode: "semantic-ping-raw-socket-state-unsupported" },
    });
  });
});
