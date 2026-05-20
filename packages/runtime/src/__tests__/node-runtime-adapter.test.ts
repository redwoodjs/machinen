import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
  NodeRuntimeAdapterUnsupportedError,
  captureNodeRuntimeAdapterDocument,
  collectNodeRuntimeAdapterRefusals,
  restoreNodeRuntimeAdapterRoots,
} from "../node-runtime-adapter.ts";

describe("cooperative Node runtime adapter", () => {
  it("captures and restores semantic roots with shared identity, cycles, Maps, Sets, Dates, and bytes", () => {
    const shared = { label: "shared", count: 7 };
    const cycle: { name: string; self?: unknown; shared?: unknown } = { name: "cycle" };
    cycle.self = cycle;
    cycle.shared = shared;
    const map = new Map<unknown, unknown>([
      ["shared", shared],
      [shared, cycle],
    ]);
    const set = new Set<unknown>([shared, cycle]);
    const captured = captureNodeRuntimeAdapterDocument(
      {
        counter: 4330,
        shared,
        left: { shared },
        right: { shared },
        cycle,
        map,
        set,
        when: new Date("2026-05-20T12:00:00.000Z"),
        bytes: Buffer.from("portable"),
        typed: new Uint16Array([10, 20, 30]),
      },
      { process: { argv: ["node", "fixture.mjs"], env: { TEST: "1" }, cwd: "/work" } },
    );

    expect(captured.unsupported.refusals).toEqual([]);
    expect(new Set(captured.graph.objects.map((object) => object.id)).size).toBe(
      captured.graph.objects.length,
    );

    const restored = restoreNodeRuntimeAdapterRoots(captured) as {
      counter: number;
      shared: { label: string; count: number };
      left: { shared: unknown };
      right: { shared: unknown };
      cycle: { self: unknown; shared: unknown };
      map: Map<unknown, unknown>;
      set: Set<unknown>;
      when: Date;
      bytes: Buffer;
      typed: Uint16Array;
    };

    expect(restored.counter).toBe(4330);
    expect(restored.left.shared).toBe(restored.shared);
    expect(restored.right.shared).toBe(restored.shared);
    expect(restored.cycle.self).toBe(restored.cycle);
    expect(restored.cycle.shared).toBe(restored.shared);
    expect(restored.map.get("shared")).toBe(restored.shared);
    expect(restored.map.get(restored.shared)).toBe(restored.cycle);
    expect(restored.set.has(restored.shared)).toBe(true);
    expect(restored.set.has(restored.cycle)).toBe(true);
    expect(restored.when.toISOString()).toBe("2026-05-20T12:00:00.000Z");
    expect(Buffer.isBuffer(restored.bytes)).toBe(true);
    expect(restored.bytes.toString()).toBe("portable");
    expect([...restored.typed]).toEqual([10, 20, 30]);
  });

  it("emits stable refusals for unsupported JavaScript values", () => {
    const captured = captureNodeRuntimeAdapterDocument({ callback: () => "nope" });
    expect(collectNodeRuntimeAdapterRefusals(captured)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "object-unsupported",
          message: expect.stringContaining("function"),
        }),
      ]),
    );
    expect(captured.restore).toMatchObject({
      semanticStateSupported: false,
      refusal: { code: "object-unsupported" },
    });
    expect(() => restoreNodeRuntimeAdapterRoots(captured)).toThrow(
      NodeRuntimeAdapterUnsupportedError,
    );
  });
});
