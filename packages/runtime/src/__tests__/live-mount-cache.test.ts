import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isMachinenError } from "../errors.ts";
import { resolveLiveMounts } from "../vm/bundle.ts";

let hostDir: string;

beforeEach(() => {
  hostDir = mkdtempSync(join(tmpdir(), "machinen-live-mount-"));
});

afterEach(() => {
  rmSync(hostDir, { recursive: true, force: true });
});

describe("resolveLiveMounts sync defaults", () => {
  it("defaults rw mounts to batch sync", () => {
    expect(resolveLiveMounts([{ host: hostDir, guest: "/mnt/work" }], undefined)).toEqual([
      {
        host: hostDir,
        guest: "/mnt/work",
        mode: "rw",
        sync: "batch",
        tag: "machinen-lm0",
      },
    ]);
  });

  it("defaults ro mounts to batch sync", () => {
    expect(
      resolveLiveMounts([{ host: hostDir, guest: "/mnt/fixtures", mode: "ro" }], undefined).map(
        ({ guest, mode, sync, tag }) => ({ guest, mode, sync, tag }),
      ),
    ).toEqual([{ guest: "/mnt/fixtures", mode: "ro", sync: "batch", tag: "machinen-lm0" }]);
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

  it("accepts batch sync for read-only mounts", () => {
    expect(
      resolveLiveMounts(
        [{ host: hostDir, guest: "/mnt/work", mode: "ro", sync: "batch" }],
        undefined,
      ).map(({ guest, mode, sync }) => ({ guest, mode, sync })),
    ).toEqual([{ guest: "/mnt/work", mode: "ro", sync: "batch" }]);
  });

  it("rejects removed cache modes from untyped callers", () => {
    expect(() =>
      resolveLiveMounts([{ host: hostDir, guest: "/mnt/work", cache: "fast" } as never], undefined),
    ).toThrow(/cache is no longer supported/);
    try {
      resolveLiveMounts([{ host: hostDir, guest: "/mnt/work", cache: "fast" } as never], undefined);
    } catch (err) {
      expect(isMachinenError(err, "BOOT_MOUNT_INVALID")).toBe(true);
    }
  });
});
