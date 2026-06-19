import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isMachinenError } from "../errors.ts";
import { resolveLiveMounts } from "../vm/bundle.ts";

let hostDir: string;

beforeEach(() => {
  hostDir = mkdtempSync(join(tmpdir(), "machinen-live-mount-cache-"));
});

afterEach(() => {
  rmSync(hostDir, { recursive: true, force: true });
});

describe("resolveLiveMounts cache modes", () => {
  it("defaults to rw cached metadata behavior", () => {
    expect(resolveLiveMounts([{ host: hostDir, guest: "/mnt/work" }], undefined)).toEqual([
      {
        host: hostDir,
        guest: "/mnt/work",
        mode: "rw",
        cache: "cached",
        sync: "eager",
        tag: "machinen-lm0",
      },
    ]);
  });

  it("preserves explicit strict/cached/fast cache modes per mount", () => {
    expect(
      resolveLiveMounts(
        [
          { host: hostDir, guest: "/mnt/strict", cache: "strict" },
          { host: hostDir, guest: "/mnt/cached", cache: "cached" },
          { host: hostDir, guest: "/mnt/fast", mode: "ro", cache: "fast" },
        ],
        undefined,
      ).map(({ guest, mode, cache, sync, tag }) => ({ guest, mode, cache, sync, tag })),
    ).toEqual([
      { guest: "/mnt/strict", mode: "rw", cache: "strict", sync: "eager", tag: "machinen-lm0" },
      { guest: "/mnt/cached", mode: "rw", cache: "cached", sync: "eager", tag: "machinen-lm1" },
      { guest: "/mnt/fast", mode: "ro", cache: "fast", sync: "eager", tag: "machinen-lm2" },
    ]);
  });

  it("preserves explicit eager/batch sync modes", () => {
    expect(
      resolveLiveMounts(
        [
          { host: hostDir, guest: "/mnt/eager", sync: "eager" },
          { host: hostDir, guest: "/mnt/batch", sync: "batch" },
        ],
        undefined,
      ).map(({ guest, sync }) => ({ guest, sync })),
    ).toEqual([
      { guest: "/mnt/eager", sync: "eager" },
      { guest: "/mnt/batch", sync: "batch" },
    ]);
  });

  it("rejects batch sync for read-only mounts", () => {
    expect(() =>
      resolveLiveMounts(
        [{ host: hostDir, guest: "/mnt/work", mode: "ro", sync: "batch" }],
        undefined,
      ),
    ).toThrow(/sync='batch' requires rw/);
  });

  it("rejects invalid cache modes from untyped callers", () => {
    expect(() =>
      resolveLiveMounts(
        [{ host: hostDir, guest: "/mnt/work", cache: "turbo" as never }],
        undefined,
      ),
    ).toThrow(/cache must be 'strict', 'cached', or 'fast'/);
    try {
      resolveLiveMounts(
        [{ host: hostDir, guest: "/mnt/work", cache: "turbo" as never }],
        undefined,
      );
    } catch (err) {
      expect(isMachinenError(err, "BOOT_MOUNT_INVALID")).toBe(true);
    }
  });
});
