// Unit tests for mountdisk-img.ts — content-addressed cache, manifest
// hashing, and the tool-missing failure mode (#272).
//
// Materialization itself (mksquashfs / mke2fs invocation) is exercised
// only when the binaries are available on this host — the hermetic
// tests here cover the parts that can be tested without shelling out:
// manifest hashing, cache-key computation, and the resolver chain.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  _mountdiskImgInternal,
  ensureMountDiskImage,
  ensureMountDiskUpper,
  markMountDiskImageClean,
  resolveMksquashfs,
  treeManifestHash,
} from "../mountdisk-img.ts";

let helperTmp: string | undefined;
let previousHelper: string | undefined;

beforeAll(() => {
  helperTmp = mkdtempSync(join(tmpdir(), "machinen-runtime-helper-test-"));
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

describe("treeManifestHash", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "machinen-mountdisk-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns the same hash for byte-identical trees", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, "x.txt"), "hello");
    writeFileSync(join(b, "x.txt"), "hello");
    // Pin mtimes so the hash is reproducible across the two writes.
    utimesSync(join(a, "x.txt"), 1000, 1000);
    utimesSync(join(b, "x.txt"), 1000, 1000);
    expect(treeManifestHash(a)).toBe(treeManifestHash(b));
  });

  it("changes when a file's content changes", () => {
    const dir = join(tmp, "d");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "x.txt"), "v1");
    utimesSync(join(dir, "x.txt"), 1000, 1000);
    const k1 = treeManifestHash(dir);
    writeFileSync(join(dir, "x.txt"), "v2");
    utimesSync(join(dir, "x.txt"), 1000, 1000);
    const k2 = treeManifestHash(dir);
    expect(k1).not.toBe(k2);
  });

  it("changes when a symlink target changes", () => {
    const dir = join(tmp, "d");
    mkdirSync(dir, { recursive: true });
    symlinkSync("target-a", join(dir, "link"));
    const k1 = treeManifestHash(dir);
    rmSync(join(dir, "link"));
    symlinkSync("target-b", join(dir, "link"));
    const k2 = treeManifestHash(dir);
    expect(k1).not.toBe(k2);
  });

  it("includes nested directory contents", () => {
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    mkdirSync(join(a, "sub"), { recursive: true });
    mkdirSync(join(b, "sub"), { recursive: true });
    writeFileSync(join(a, "sub", "f.txt"), "X");
    writeFileSync(join(b, "sub", "f.txt"), "Y");
    utimesSync(join(a, "sub", "f.txt"), 1000, 1000);
    utimesSync(join(b, "sub", "f.txt"), 1000, 1000);
    expect(treeManifestHash(a)).not.toBe(treeManifestHash(b));
  });

  it("matches the exact legacy manifest hash for a deterministic regular-file tree", () => {
    const root = join(tmp, "root");
    mkdirSync(join(root, "sub"), { recursive: true });
    writeFileSync(join(root, "alpha.txt"), "alpha");
    writeFileSync(join(root, "sub", "beta.sh"), "beta");
    chmodSync(join(root, "sub", "beta.sh"), 0o755);
    utimesSync(join(root, "alpha.txt"), 1000, 1000);
    utimesSync(join(root, "sub", "beta.sh"), 1000, 1000);
    utimesSync(join(root, "sub"), 1000, 1000);

    expect(treeManifestHash(root)).toBe(
      "c1f475b2e3e6ad2d70b50312c2e898c26a2a4236ee0f0f0983b62fb848db19cd",
    );
  });

  it("changes when a file's executable mode changes", () => {
    const dir = join(tmp, "d");
    mkdirSync(dir, { recursive: true });
    const script = join(dir, "run.sh");
    writeFileSync(script, "echo hi\n");
    utimesSync(script, 1000, 1000);
    chmodSync(script, 0o644);
    const k1 = treeManifestHash(dir);
    chmodSync(script, 0o755);
    utimesSync(script, 1000, 1000);
    const k2 = treeManifestHash(dir);
    expect(k1).not.toBe(k2);
  });

  it("reports a useful error when MACHINEN_RUNTIME_HELPER points at nothing", () => {
    const dir = join(tmp, "d");
    mkdirSync(dir, { recursive: true });
    const realHelper = process.env.MACHINEN_RUNTIME_HELPER;
    process.env.MACHINEN_RUNTIME_HELPER = join(tmp, "missing-machinen-runtime-helper");
    try {
      expect(() => treeManifestHash(dir)).toThrow(/MACHINEN_RUNTIME_HELPER=.*does not exist/);
    } finally {
      if (realHelper === undefined) {
        delete process.env.MACHINEN_RUNTIME_HELPER;
      } else {
        process.env.MACHINEN_RUNTIME_HELPER = realHelper;
      }
    }
  });

  it("reports a useful error when machinen-runtime-helper returns invalid JSON", () => {
    const dir = join(tmp, "d");
    mkdirSync(dir, { recursive: true });
    const fake = join(tmp, "fake-machinen-runtime-helper");
    writeFileSync(fake, "#!/bin/sh\nprintf 'not-json'\n");
    chmodSync(fake, 0o755);
    const realHelper = process.env.MACHINEN_RUNTIME_HELPER;
    process.env.MACHINEN_RUNTIME_HELPER = fake;
    try {
      expect(() => treeManifestHash(dir)).toThrow(/invalid JSON/);
    } finally {
      if (realHelper === undefined) {
        delete process.env.MACHINEN_RUNTIME_HELPER;
      } else {
        process.env.MACHINEN_RUNTIME_HELPER = realHelper;
      }
    }
  });

  it("is order-insensitive across readdir orderings", () => {
    // readdir order is non-portable; the manifest sort guarantees a
    // stable hash regardless. Test by creating files in two different
    // orders and asserting the hashes match.
    const a = join(tmp, "a");
    const b = join(tmp, "b");
    mkdirSync(a, { recursive: true });
    mkdirSync(b, { recursive: true });
    writeFileSync(join(a, "z.txt"), "Z");
    writeFileSync(join(a, "a.txt"), "A");
    writeFileSync(join(b, "a.txt"), "A");
    writeFileSync(join(b, "z.txt"), "Z");
    utimesSync(join(a, "z.txt"), 1000, 1000);
    utimesSync(join(a, "a.txt"), 1000, 1000);
    utimesSync(join(b, "z.txt"), 1000, 1000);
    utimesSync(join(b, "a.txt"), 1000, 1000);
    expect(treeManifestHash(a)).toBe(treeManifestHash(b));
  });
});

describe("markMountDiskImageClean", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "machinen-mountdisk-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates the .ok marker for an existing image", () => {
    const img = join(tmp, "fake.sqfs");
    writeFileSync(img, "not really squashfs");
    markMountDiskImageClean(img);
    expect(existsSync(_mountdiskImgInternal.okMarkerPath(img))).toBe(true);
  });

  it("is a no-op when the image is missing", () => {
    const img = join(tmp, "missing.sqfs");
    expect(() => markMountDiskImageClean(img)).not.toThrow();
    expect(existsSync(_mountdiskImgInternal.okMarkerPath(img))).toBe(false);
  });
});

describe("resolveMksquashfs", () => {
  it("respects MACHINEN_MKSQUASHFS env override", () => {
    const tmp = mkdtempSync(join(tmpdir(), "machinen-mountdisk-test-"));
    try {
      const fake = join(tmp, "fake-mksquashfs");
      writeFileSync(fake, "");
      const prev = process.env.MACHINEN_MKSQUASHFS;
      process.env.MACHINEN_MKSQUASHFS = fake;
      try {
        expect(resolveMksquashfs()).toBe(fake);
      } finally {
        if (prev === undefined) {
          delete process.env.MACHINEN_MKSQUASHFS;
        } else {
          process.env.MACHINEN_MKSQUASHFS = prev;
        }
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("throws when MACHINEN_MKSQUASHFS points at nothing", () => {
    const prev = process.env.MACHINEN_MKSQUASHFS;
    process.env.MACHINEN_MKSQUASHFS = "/definitely/does/not/exist/mksquashfs";
    try {
      expect(() => resolveMksquashfs()).toThrow(/MACHINEN_MKSQUASHFS/);
    } finally {
      if (prev === undefined) {
        delete process.env.MACHINEN_MKSQUASHFS;
      } else {
        process.env.MACHINEN_MKSQUASHFS = prev;
      }
    }
  });
});

describe("ensureMountDiskImage", () => {
  let tmp: string;
  let cacheDir: string;
  let host: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "machinen-mountdisk-test-"));
    cacheDir = join(tmp, "cache");
    mkdirSync(cacheDir, { recursive: true });
    host = join(tmp, "host");
    mkdirSync(host, { recursive: true });
    writeFileSync(join(host, "hello.txt"), "world");
    utimesSync(join(host, "hello.txt"), 1000, 1000);
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("throws BOOT_MOUNTDISK_TOOL_MISSING when mksquashfs is unavailable", () => {
    // Force the resolver to find nothing by pointing the override at a
    // missing path. resolveMksquashfsEnvOverride throws first; that
    // surfaces the same error code.
    const prev = process.env.MACHINEN_MKSQUASHFS;
    process.env.MACHINEN_MKSQUASHFS = "/nope/mksquashfs";
    try {
      expect(() => ensureMountDiskImage(host, { cacheDir })).toThrow(
        /MACHINEN_MKSQUASHFS|mksquashfs/,
      );
    } finally {
      if (prev === undefined) {
        delete process.env.MACHINEN_MKSQUASHFS;
      } else {
        process.env.MACHINEN_MKSQUASHFS = prev;
      }
    }
  });

  it("throws BOOT_MOUNT_HOST_NOT_FOUND when the host dir is missing", () => {
    expect(() => ensureMountDiskImage(join(tmp, "missing"), { cacheDir })).toThrow(
      /host directory not found/,
    );
  });

  it("throws BOOT_MOUNT_INVALID when the host path is a file, not a dir", () => {
    const file = join(tmp, "afile");
    writeFileSync(file, "x");
    expect(() => ensureMountDiskImage(file, { cacheDir })).toThrow(/must be a directory/);
  });

  it("returns the cached path on second call (mksquashfs available)", () => {
    if (!resolveMksquashfs()) {
      // No host mksquashfs — skip. CI runs the materialize tests on
      // hosts that do have it (release builds, smoke harness).
      return;
    }
    const r1 = ensureMountDiskImage(host, { cacheDir });
    expect(existsSync(r1.lowerPath)).toBe(true);
    expect(existsSync(_mountdiskImgInternal.okMarkerPath(r1.lowerPath))).toBe(false);
    markMountDiskImageClean(r1.lowerPath);
    const r2 = ensureMountDiskImage(host, { cacheDir });
    expect(r2.lowerPath).toBe(r1.lowerPath);
    expect(r2.key).toBe(r1.key);
  });

  it("rebuilds when the cache file is missing the .ok marker", () => {
    if (!resolveMksquashfs()) {
      return;
    }
    const r1 = ensureMountDiskImage(host, { cacheDir });
    // Don't mark clean. The next call should re-materialize (we can't
    // observe rebuild from outside, but the call must not throw).
    expect(() => ensureMountDiskImage(host, { cacheDir })).not.toThrow();
    expect(existsSync(r1.lowerPath)).toBe(true);
  });
});

describe("ensureMountDiskUpper", () => {
  it("rejects non-aligned sizeBytes", () => {
    expect(() => ensureMountDiskUpper({ sizeBytes: 4097 })).toThrow(/multiple of 4096/);
  });
});

// #272: prove the squashfs lower preserves symlinks bit-for-bit.
// mksquashfs pulls in libraries (lz4, lzma, zstd) and a real read of
// the host fs, so this test only runs when the runtime can resolve a
// usable mksquashfs (bundled package, env override, or PATH). On
// hosts without it the test skips silently — that matches how other
// optional-tool tests in this repo behave.
describe("ensureMountDiskImage symlink round-trip", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "machinen-mountdisk-symlink-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("preserves symlinks through the squashfs round-trip", () => {
    if (!resolveMksquashfs()) {
      // No mksquashfs on this host — bundled package missing, env
      // override unset, system squashfs-tools not installed. Skip.
      return;
    }
    // Find unsquashfs alongside mksquashfs (same package). Without
    // it we can't read the squashfs back here — skip.
    let unsquashfs: string | undefined;
    try {
      const out = execFileSync("/usr/bin/env", ["which", "unsquashfs"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (out) {
        unsquashfs = out;
      }
    } catch {
      // not on PATH — fall through and skip.
    }
    if (!unsquashfs) {
      return;
    }

    // Build a host dir with a symlink we can recognise.
    const host = join(tmp, "host");
    mkdirSync(host, { recursive: true });
    writeFileSync(join(host, "real.txt"), "real-content");
    symlinkSync("real.txt", join(host, "alias"));
    utimesSync(join(host, "real.txt"), 1000, 1000);

    const cacheDir = join(tmp, "cache");
    mkdirSync(cacheDir, { recursive: true });
    const r = ensureMountDiskImage(host, { cacheDir });

    // Use unsquashfs -ll to list the archive without unpacking.
    // Symlinks appear with `lrwxrwxrwx` and `-> target` in the output.
    const out = execFileSync(unsquashfs, ["-no-progress", "-ll", r.lowerPath], {
      encoding: "utf8",
    });
    // Look for the alias symlink line.
    const aliasLine = out.split("\n").find((line) => line.includes("alias"));
    expect(aliasLine, "alias entry missing from squashfs listing").toBeDefined();
    expect(aliasLine!).toMatch(/^l/); // entry type letter for symlinks
    expect(aliasLine!).toContain("-> real.txt");
  });
});
