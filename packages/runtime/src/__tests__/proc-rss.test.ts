// Smoke coverage for the host-RSS readers used by `vm.memoryStats()`
// and the `machinen ls` MEM column (#274). The OS-side regex / ps
// parsers can't be deterministically mocked without spinning up a
// real process — so these tests just verify that, against the
// running test process itself, the readers return a sensible
// positive number.

import { describe, expect, it } from "vitest";
import { readHostRssBytes, readHostRssBytesMulti } from "../proc-rss.ts";

describe("readHostRssBytes", () => {
  it("returns a positive number for the running process", () => {
    const rss = readHostRssBytes(process.pid);
    expect(rss).not.toBeNull();
    expect(rss!).toBeGreaterThan(0);
  });

  it("returns null for a pid that's almost certainly dead", () => {
    // 0x7fff_ffff — outside the kernel's pid_max on every Unix.
    expect(readHostRssBytes(0x7fff_ffff)).toBeNull();
  });
});

describe("readHostRssBytesMulti", () => {
  it("returns a map keyed by pid for the live processes it could read", () => {
    const map = readHostRssBytesMulti([process.pid, 0x7fff_ffff]);
    expect(map.get(process.pid)).toBeGreaterThan(0);
    expect(map.has(0x7fff_ffff)).toBe(false);
  });

  it("returns an empty map for an empty input (no syscall)", () => {
    expect(readHostRssBytesMulti([]).size).toBe(0);
  });
});
