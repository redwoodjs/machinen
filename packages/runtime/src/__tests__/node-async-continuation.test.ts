import { describe, expect, it } from "vitest";
import {
  captureNodeAsyncContinuations,
  restoreNodeAsyncContinuations,
} from "../node-async-continuation.ts";
import { NodeRuntimeAdapterUnsupportedError } from "../node-runtime-adapter.ts";

describe("Node async continuation metadata", () => {
  it("restores cooperative promise and timer continuations from semantic payloads", async () => {
    const shared = { base: 4200 };
    const state = captureNodeAsyncContinuations([
      {
        id: "promise:resume",
        kind: "promise",
        handlerToken: "add",
        payload: { shared, delta: 35 },
      },
      { id: "timer:resume", kind: "timer", handlerToken: "label", delayMs: 0, payload: { shared } },
    ]);

    expect(state.strategy).toBe("semantic-continuation");
    expect(state.unsupported.refusals).toEqual([]);
    expect(state.adapterDocument.graph.objects.length).toBeGreaterThan(0);

    const restored = await restoreNodeAsyncContinuations(state, {
      add: (payload) => {
        const value = payload as { shared: { base: number }; delta: number };
        return value.shared.base + value.delta;
      },
      label: (payload) => {
        const value = payload as { shared: { base: number } };
        return `timer:${value.shared.base}`;
      },
    });

    expect(restored).toEqual([
      { id: "promise:resume", kind: "promise", result: 4235 },
      { id: "timer:resume", kind: "timer", result: "timer:4200" },
    ]);
  });

  it("refuses native async callbacks with stable diagnostics", async () => {
    const state = captureNodeAsyncContinuations([
      {
        id: "native:fswatch",
        kind: "native-callback",
        handlerToken: "fswatch",
        reason: "fs watcher callbacks need host watcher recreation",
      },
    ]);

    expect(state.unsupported.refusals).toEqual([
      expect.objectContaining({
        code: "runtime-heap-unsupported",
        message: "fs watcher callbacks need host watcher recreation",
      }),
    ]);
    await expect(restoreNodeAsyncContinuations(state, {})).rejects.toThrow(
      NodeRuntimeAdapterUnsupportedError,
    );
  });

  it("refuses missing semantic continuation handlers", async () => {
    const state = captureNodeAsyncContinuations([
      { id: "promise:missing", kind: "promise", handlerToken: "missing", payload: 1 },
    ]);

    await expect(restoreNodeAsyncContinuations(state, {})).rejects.toMatchObject({
      refusals: [expect.objectContaining({ code: "runtime-heap-unsupported" })],
    });
  });
});
