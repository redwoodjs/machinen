import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { PhaseTimer } from "../phase-timer.ts";

describe("PhaseTimer", () => {
  it("records phases in insertion order with non-negative durations", async () => {
    const t = new PhaseTimer();
    t.start("a");
    await sleep(5);
    t.end("a");
    t.start("b");
    await sleep(5);
    t.end("b");
    const keys = [...t.phases().keys()];
    expect(keys).toEqual(["a", "b"]);
    for (const ms of t.phases().values()) {
      expect(ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("end() without matching start() is a no-op", () => {
    const t = new PhaseTimer();
    expect(t.end("never-started")).toBeUndefined();
    expect(t.phases().size).toBe(0);
  });

  it("mark() records externally-measured phases and skips undefined", () => {
    const t = new PhaseTimer();
    t.mark("inherited", 42);
    t.mark("skip-me", undefined);
    expect([...t.phases()]).toEqual([["inherited", 42]]);
  });

  it("format() emits kind, total, and phase k=v pairs in order", () => {
    const t = new PhaseTimer();
    t.mark("first", 10);
    t.mark("second", 20);
    const line = t.format("boot", 100);
    expect(line).toBe("phases kind=boot total=100 first=10 second=20");
  });

  it("totalMs is at least the sum of measured phases", async () => {
    const t = new PhaseTimer();
    t.start("a");
    await sleep(5);
    t.end("a");
    t.start("b");
    await sleep(5);
    t.end("b");
    const sum = [...t.phases().values()].reduce((s, n) => s + n, 0);
    expect(t.totalMs()).toBeGreaterThanOrEqual(sum);
  });

  it("flush() invokes the debug fn with the formatted line", () => {
    const t = new PhaseTimer();
    t.mark("only", 7);
    let captured = "";
    const fakeDebug = ((fmt: string, line: string) => {
      // debug uses printf-style; we know we pass "%s" + line.
      captured = fmt.replace("%s", line);
    }) as unknown as Parameters<PhaseTimer["flush"]>[0];
    t.flush(fakeDebug, "snapshot", 50);
    expect(captured).toBe("phases kind=snapshot total=50 only=7");
  });
});
