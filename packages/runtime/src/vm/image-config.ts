// Disk-cached lookup of `./machinen-config.json` inside an image
// tarball — the file `provision({ cmd, env })` bakes in so callers
// don't need to re-pass cmd/env on every boot. Without this cache,
// every boot pays ~170 ms decompressing a 2 GiB gzip stream looking
// for (or failing to find) the file — see #233.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Shape of the optional `./machinen-config.json` baked into a rootfs
 * tarball by `provision({ cmd, env })`. `boot()` reads it via
 * `readImageConfig()` so callers don't need to re-pass `cmd`/`env` on
 * every boot. `warmImageConfigCache()` accepts the same shape so a
 * tarball-producing tool can pre-populate the lookup cache.
 */
export type ImageConfig = { cmd?: string[]; env?: Record<string, string>; cwd?: string };

/**
 * Disk cache for `readImageConfig`. The base tarball is regenerated only
 * by `scripts/build-base-assets.sh` / `provision()`, so its (size, mtime)
 * is a reliable fingerprint between runs. Negative results are cached
 * too: most user-built tarballs don't carry the file.
 */
function imageConfigCacheDir(): string {
  return join(homedir(), ".cache", "machinen", "image-config");
}

function imageConfigCachePath(imagePath: string): string | undefined {
  let st;
  try {
    st = statSync(imagePath);
  } catch {
    return undefined;
  }
  // basename + size + mtime is enough to distinguish typical builds;
  // collisions are harmless because the cache file's body is the
  // authoritative answer for the keying tarball — a stale cache means
  // the tarball was overwritten without changing size+mtime, which
  // would also confuse `ensureRootfsImage`'s sha-based cache the same
  // way.
  const base = imagePath.split("/").pop() ?? "image";
  const key = `${base}-${st.size}-${Math.floor(st.mtimeMs)}.json`;
  return join(imageConfigCacheDir(), key);
}

/**
 * Pre-populate the image-config cache for a freshly-written tarball.
 * Lets `provision()` (and other tarball producers) skip the slow
 * `tar -xzOf` lookup that the next `boot()` would otherwise pay —
 * see #233. Best-effort: a missing/unwritable cache dir just falls
 * back to the slow path on the next boot.
 *
 * Call AFTER the tarball is on disk (so size+mtime match what the
 * cache key will be on read), passing exactly the config that was
 * baked into the tarball's `./machinen-config.json` (or `null` when
 * none was baked).
 */
export function warmImageConfigCache(imagePath: string, config: ImageConfig | null): void {
  const cachePath = imageConfigCachePath(imagePath);
  if (!cachePath) {
    return;
  }
  try {
    mkdirSync(imageConfigCacheDir(), { recursive: true });
    writeFileSync(cachePath, JSON.stringify({ config }));
  } catch {
    // Best-effort — a missing cache file just costs the next boot
    // an image-config-read hit.
  }
}

/** @internal — exported for tests; production callers should not use directly. */
export function readImageConfig(imagePath: string): ImageConfig | undefined {
  const cachePath = imageConfigCachePath(imagePath);
  if (cachePath && existsSync(cachePath)) {
    try {
      const raw = readFileSync(cachePath, "utf8");
      const cached = JSON.parse(raw) as { config: ImageConfig | null };
      return cached.config ?? undefined;
    } catch {
      // Corrupt cache — fall through, regenerate.
    }
  }
  let result: ImageConfig | undefined;
  try {
    // `-x` stream-extract, `-O` to stdout, `-z` auto-detect gzip. The
    // target path matches the layout `provision()` writes.
    const out = execFileSync("tar", ["-xzOf", imagePath, "./machinen-config.json"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (out.trim()) {
      result = JSON.parse(out) as ImageConfig;
    }
  } catch {
    // Either the tarball lacks the file or it's not a tarball we can
    // read — boot will still try to use the rootfs as-is.
  }
  if (cachePath) {
    try {
      mkdirSync(imageConfigCacheDir(), { recursive: true });
      writeFileSync(cachePath, JSON.stringify({ config: result ?? null }));
    } catch {
      // Best-effort cache write — a missing cache just means we redo
      // the slow path next time.
    }
  }
  return result;
}
