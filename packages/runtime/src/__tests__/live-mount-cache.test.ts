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

describe("resolveLiveMounts live-mount options", () => {
  it("defaults mounts to rw mode without a public sync option", () => {
    expect(resolveLiveMounts([{ host: hostDir, guest: "/mnt/work" }], undefined)).toEqual([
      {
        host: hostDir,
        guest: "/mnt/work",
        mode: "rw",
        tag: "machinen-lm0",
      },
    ]);
  });

  it("preserves ro mode", () => {
    expect(
      resolveLiveMounts([{ host: hostDir, guest: "/mnt/fixtures", mode: "ro" }], undefined).map(
        ({ guest, mode, tag }) => ({ guest, mode, tag }),
      ),
    ).toEqual([{ guest: "/mnt/fixtures", mode: "ro", tag: "machinen-lm0" }]);
  });

  it("rejects removed sync modes from untyped callers", () => {
    expect(() =>
      resolveLiveMounts([{ host: hostDir, guest: "/mnt/work", sync: "eager" } as never], undefined),
    ).toThrow(/sync is no longer supported/);
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
