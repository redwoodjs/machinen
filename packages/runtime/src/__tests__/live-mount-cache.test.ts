import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { isMachinenError } from "../errors.ts";
import { resolveLiveMounts } from "../vm/bundle.ts";

let hostDir: string;
let helperTmp: string | undefined;
let previousHelper: string | undefined;

beforeAll(() => {
  helperTmp = mkdtempSync(join(tmpdir(), "machinen-live-mount-helper-test-"));
  execFileSync("zig", ["build", "--prefix", helperTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousHelper = process.env.MACHINEN_RUNTIME_HELPER;
  process.env.MACHINEN_RUNTIME_HELPER = join(helperTmp, "bin", "machinen-runtime-helper");
});

afterAll(() => {
  if (previousHelper === undefined) {
    delete process.env.MACHINEN_RUNTIME_HELPER;
  } else {
    process.env.MACHINEN_RUNTIME_HELPER = previousHelper;
  }
  if (helperTmp) {
    rmSync(helperTmp, { recursive: true, force: true });
  }
});

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

  it("allows safe absolute guest paths outside /mnt", () => {
    expect(resolveLiveMounts([{ host: hostDir, guest: "/root/.commandcode" }], undefined)).toEqual([
      {
        host: hostDir,
        guest: "/root/.commandcode",
        mode: "rw",
        tag: "machinen-lm0",
      },
    ]);
  });

  it("allows reserved guest paths only with unsafeGuestPath", () => {
    expect(() => resolveLiveMounts([{ host: hostDir, guest: "/run/tool" }], undefined)).toThrow(
      /unsafeGuestPath: true/,
    );
    expect(
      resolveLiveMounts(
        [{ host: hostDir, guest: "/run/tool", unsafeGuestPath: true }],
        undefined,
      ).map(({ guest, mode, tag }) => ({ guest, mode, tag })),
    ).toEqual([{ guest: "/run/tool", mode: "rw", tag: "machinen-lm0" }]);
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
