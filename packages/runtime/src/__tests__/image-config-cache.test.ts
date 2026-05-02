// #221 — image-config cache.
//
// `readImageConfig` decompresses a multi-GB gzip stream looking for
// `./machinen-config.json` on every boot. Most user-built tarballs
// don't carry the file, so on every boot we paid ~170 ms for a
// negative result. The cache writes a tiny JSON file keyed by
// (basename, size, mtime) and short-circuits subsequent calls.
//
// We assert: (1) the cache file gets written; (2) it's actually used
// (a stale tarball whose contents change but mtime/size don't is
// allowed to return the stale answer — that mirrors the behaviour
// of `ensureRootfsImage`'s sha cache, which has the same fingerprint
// trade-off); (3) modifying the tarball (mtime bump + size delta)
// invalidates.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readImageConfig } from "../vm.ts";

const CACHE_DIR = join(homedir(), ".cache", "machinen", "image-config");

function buildTarball(target: string, configBody: string | null): void {
  const stage = `${target}.stage`;
  mkdirSync(stage, { recursive: true });
  if (configBody !== null) {
    writeFileSync(join(stage, "machinen-config.json"), configBody);
  }
  // Pad with a small filler so different bodies produce different
  // tarball sizes (which the cache uses as part of its key).
  writeFileSync(join(stage, "filler.txt"), configBody ?? "no-config");
  execFileSync("tar", ["-czf", target, "-C", stage, "."]);
  rmSync(stage, { recursive: true, force: true });
}

function cacheEntriesFor(tarball: string): string[] {
  if (!existsSync(CACHE_DIR)) {
    return [];
  }
  const base = tarball.split("/").pop()!;
  return readdirSync(CACHE_DIR).filter((n) => n.startsWith(base));
}

describe("readImageConfig cache (#221)", () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir && existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
    // Clear only the cache entries this test wrote — leave the rest.
    if (workDir && existsSync(CACHE_DIR)) {
      const base = "rootfs-test-";
      for (const f of readdirSync(CACHE_DIR)) {
        if (f.startsWith(base)) {
          rmSync(join(CACHE_DIR, f), { force: true });
        }
      }
    }
    workDir = undefined;
  });

  it("returns the embedded config and caches the parsed result", () => {
    workDir = mkdtempSync(join(tmpdir(), "image-cfg-"));
    const tarball = join(workDir, `rootfs-test-positive-${Date.now()}.tar.gz`);
    buildTarball(tarball, JSON.stringify({ cmd: ["/bin/echo", "hi"] }));

    expect(cacheEntriesFor(tarball)).toEqual([]);
    const first = readImageConfig(tarball);
    expect(first).toEqual({ cmd: ["/bin/echo", "hi"] });
    expect(cacheEntriesFor(tarball).length).toBe(1);

    const second = readImageConfig(tarball);
    expect(second).toEqual({ cmd: ["/bin/echo", "hi"] });
  });

  it("caches the negative result (no embedded config)", () => {
    workDir = mkdtempSync(join(tmpdir(), "image-cfg-"));
    const tarball = join(workDir, `rootfs-test-negative-${Date.now()}.tar.gz`);
    buildTarball(tarball, null);

    expect(readImageConfig(tarball)).toBeUndefined();
    expect(cacheEntriesFor(tarball).length).toBe(1);
    expect(readImageConfig(tarball)).toBeUndefined();
  });

  it("invalidates when the tarball mtime or size changes", () => {
    workDir = mkdtempSync(join(tmpdir(), "image-cfg-"));
    const tarball = join(workDir, `rootfs-test-invalidate-${Date.now()}.tar.gz`);
    buildTarball(tarball, JSON.stringify({ cmd: ["/v1"] }));
    expect(readImageConfig(tarball)).toEqual({ cmd: ["/v1"] });

    // Rebuild with different contents → different size → different
    // cache key. Bump mtime explicitly because some filesystems give
    // us coarse mtime resolution and a fast rebuild could land in the
    // same millisecond.
    buildTarball(tarball, JSON.stringify({ cmd: ["/v2-with-much-longer-payload"] }));
    const future = new Date(Date.now() + 5_000);
    utimesSync(tarball, future, future);
    expect(readImageConfig(tarball)).toEqual({ cmd: ["/v2-with-much-longer-payload"] });

    // Two cache entries should now exist for the same basename.
    expect(cacheEntriesFor(tarball).length).toBe(2);
  });
});
