import { describe, expect, it } from "vitest";

import { classifyNodeProperLevel5HttpStatePolicy } from "../node-proper-level5-http-state-policy.ts";

describe("classifyNodeProperLevel5HttpStatePolicy", () => {
  it("refuses active HTTP request state", () => {
    const result = classifyNodeProperLevel5HttpStatePolicy({ activeRequestDetected: true });

    expect(result.accepted).toBe(false);
    expect(result.activeRequestPolicy).toBe("refuse-active-request");
    expect(result.refusals).toEqual([
      {
        code: "node-proper-level5-http-active-request-unsupported",
        message: "active HTTP request state must refuse instead of being reconstructed",
      },
    ]);
  });

  it("accepts quiescent listener state with no idle sockets", () => {
    const result = classifyNodeProperLevel5HttpStatePolicy({});

    expect(result.accepted).toBe(true);
    expect(result.activeRequestPolicy).toBe("no-active-request-detected");
    expect(result.idleKeepAlivePolicy).toBe("none-detected");
  });

  it("classifies idle keep-alive sockets as safe close and recreate", () => {
    const result = classifyNodeProperLevel5HttpStatePolicy({ idleKeepAliveSockets: 1 });

    expect(result.accepted).toBe(true);
    expect(result.idleKeepAlivePolicy).toBe("safe-close-and-recreate-idle-connections-on-target");
  });

  it("refuses partial and ambiguous connection state", () => {
    const result = classifyNodeProperLevel5HttpStatePolicy({
      partialReadDetected: true,
      partialWriteDetected: true,
      ambiguousConnectionState: true,
    });

    expect(result.accepted).toBe(false);
    expect(result.refusals.map((refusal) => refusal.code)).toEqual([
      "node-proper-level5-http-partial-read-unsupported",
      "node-proper-level5-http-partial-write-unsupported",
      "node-proper-level5-http-ambiguous-connection-state",
    ]);
  });
});
