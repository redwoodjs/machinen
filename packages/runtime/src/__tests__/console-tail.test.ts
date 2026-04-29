// Ring-buffer behavior of the supervisor's stdout/stderr collector
// (issue #150). The collector retains only the most recent
// CONSOLE_TAIL_BYTES of a stream, so a multi-hour VM doesn't drag the
// JS supervisor's heap toward 4 GB.
//
// No VMM involved — drives a PassThrough end-to-end so the test stays
// fast and exercises the eviction logic directly.

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { _internal } from "../index.ts";

const { collect, CONSOLE_TAIL_BYTES } = _internal;

describe("collect() ring buffer", () => {
  it("returns the full stream when total bytes are under the cap", async () => {
    const stream = new PassThrough();
    const promise = collect(stream);
    stream.write("hello ");
    stream.write("world");
    stream.end();
    expect(await promise).toBe("hello world");
  });

  it("retains only the tail when total bytes exceed the cap", async () => {
    const stream = new PassThrough();
    const cap = 16;
    const promise = collect(stream, cap);
    // Each chunk is 8 bytes. After all writes, 32 bytes were sent;
    // only the last `cap` bytes should survive.
    stream.write("AAAAAAAA");
    stream.write("BBBBBBBB");
    stream.write("CCCCCCCC");
    stream.write("DDDDDDDD");
    stream.end();
    const result = await promise;
    expect(result.length).toBeLessThanOrEqual(cap);
    expect(result).toBe("CCCCCCCCDDDDDDDD");
  });

  it("bounds memory across many small chunks (steady-state)", async () => {
    const stream = new PassThrough();
    const cap = 1024;
    const promise = collect(stream, cap);
    // 10 KiB total in 10-byte chunks — simulates a long-running VM
    // dribbling console lines for hours.
    for (let i = 0; i < 1024; i++) {
      stream.write("xxxxxxxxxx");
    }
    stream.end();
    const result = await promise;
    // The retained tail must not exceed the cap by more than one
    // chunk-sized overhang (the head we couldn't safely drop).
    expect(result.length).toBeLessThanOrEqual(cap + 10);
    expect(result.length).toBeGreaterThanOrEqual(cap);
  });

  it("tail-slices a single oversized chunk on finish", async () => {
    const stream = new PassThrough();
    const cap = 8;
    const promise = collect(stream, cap);
    stream.write("0123456789ABCDEF"); // 16 bytes in one chunk
    stream.end();
    const result = await promise;
    expect(result).toBe("89ABCDEF");
  });

  it("default cap is exposed as CONSOLE_TAIL_BYTES = 1 MiB", () => {
    expect(CONSOLE_TAIL_BYTES).toBe(1_048_576);
  });

  it("rejects on stream error", async () => {
    const stream = new PassThrough();
    const promise = collect(stream);
    const err = new Error("boom");
    stream.destroy(err);
    await expect(promise).rejects.toBe(err);
  });
});
