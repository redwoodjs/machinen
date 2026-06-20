// Tests for ensureRootfsImage — the tar→ext4-img materializer that
// backs `boot({ rootDisk: true })` (#114).
//
// These tests don't actually materialize ext4 images (that requires
// e2fsprogs on PATH and is verified in the smoke harness). They cover
// the host-side logic the runtime owns: input validation, the
// missing-tool error path, and that an explicit `rootDisk: '<path>'`
// surfaces through to MACHINEN_ROOTDISK in the spawned VMM's env.

import { execFileSync, execSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  boot,
  BootError,
  ensureRootfsImage,
  markRootfsImageClean,
  ProvisionError,
} from "../index.ts";
import { _rootfsImgInternal as _internal, prebakeRootfsImageFromTree } from "../rootfs-img.ts";

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

function expectSparseBlocksWhenHostReportsHoles(
  allocatedBytes: number,
  logicalBytes: number,
): void {
  if (platform() === "darwin" && allocatedBytes >= logicalBytes) {
    return;
  }
  expect(allocatedBytes).toBeLessThan(logicalBytes / 4);
}

describe("ensureRootfsImage", () => {
  it("throws PROVISION_BASE_NOT_FOUND when the tarball is missing", () => {
    expect(() => ensureRootfsImage("/nope/missing.tar.gz")).toThrow(ProvisionError);
  });

  it("throws with an install hint when no e2fsprogs binary is on PATH", () => {
    // We can't reliably make the binary absent on every CI runner, so
    // instead we drive the function with an empty PATH override. The
    // `which` lookup walks through `/usr/bin/env which`, which itself
    // resolves at the shell level — pointing PATH at an empty dir
    // suffices to make every name unfindable.
    const tarPath = `/tmp/machinen-rootfs-img-test-${process.pid}.tar.gz`;
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-cache-"));
    writeFileSync(tarPath, "");
    const emptyDir = mkdtempSync(join(tmpdir(), "machinen-empty-path-"));
    const savedPath = process.env.PATH;
    process.env.PATH = emptyDir;
    try {
      // The empty PATH won't find `tar` either, so the implementation
      // throws either at the missing-tool check or at the tar-extract
      // step. Both surface as ProvisionError. We just want to know
      // it doesn't silently succeed.
      expect(() => ensureRootfsImage(tarPath, { cacheDir })).toThrow(ProvisionError);
    } finally {
      if (savedPath !== undefined) {
        process.env.PATH = savedPath;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(cacheDir, { recursive: true, force: true });
      rmSync(emptyDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("looksLikeExt4 rejects files without the superblock magic", () => {
    // The cache-trust escape hatch: anything that doesn't sniff as ext4
    // is handed back as-is (test stubs, pre-baked non-ext4 images, etc.).
    const stub = `/tmp/machinen-rootfs-img-magic-${process.pid}`;
    writeFileSync(stub, "not an ext4 image, just bytes");
    try {
      expect(_internal.looksLikeExt4(stub)).toBe(false);
    } finally {
      try {
        unlinkSync(stub);
      } catch {}
    }
  });

  it("looksLikeExt4 detects the 0xEF53 superblock magic at offset 1080", () => {
    // Plant the two magic bytes at the right offset (inside what would
    // be the ext4 superblock); everything else can be zeros. We don't
    // need a complete superblock — only the sniff has to succeed.
    const stub = `/tmp/machinen-rootfs-img-magic-yes-${process.pid}`;
    const fd = openSync(stub, "w");
    try {
      const zeroPad = Buffer.alloc(1080);
      writeSync(fd, zeroPad, 0, zeroPad.length, 0);
      const magic = Buffer.from([0x53, 0xef]); // little-endian 0xEF53
      writeSync(fd, magic, 0, magic.length, 1080);
    } finally {
      closeSync(fd);
    }
    try {
      expect(_internal.looksLikeExt4(stub)).toBe(true);
    } finally {
      try {
        unlinkSync(stub);
      } catch {}
    }
  });

  it("zstd prebake returns false when zstd is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-rootfs-no-zstd-"));
    const zst = join(dir, "rootfs.img.zst");
    const out = join(dir, "rootfs.img");
    const savedPath = process.env.PATH;
    writeFileSync(zst, "not used because zstd is unavailable");
    process.env.PATH = dir;
    try {
      expect(_internal.zstdPrebakeToFile(zst, out)).toBe(false);
    } finally {
      if (savedPath === undefined) {
        delete process.env.PATH;
      } else {
        process.env.PATH = savedPath;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sparse prebake zstd preserves large zero ranges as holes when zstd is available", () => {
    const zstd = _internal.whichFirst(["zstd"]);
    if (!zstd) {
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "machinen-rootfs-sparse-zstd-"));
    const img = join(dir, "rootfs.img");
    const zst = join(dir, "rootfs.img.zst");
    const out = join(dir, "out.img");
    const image = Buffer.alloc(8 * 1024 * 1024);
    image[1080] = 0x53;
    image[1081] = 0xef;
    image.write("payload", 4 * 1024 * 1024);
    writeFileSync(img, image);
    execSync(`${zstd} -q -f -o ${zst} ${img}`);
    try {
      expect(_internal.zstdPrebakeToFile(zst, out)).toBe(true);
      const st = statSync(out);
      expect(st.size).toBe(image.length);
      expect(_internal.looksLikeExt4(out)).toBe(true);
      expectSparseBlocksWhenHostReportsHoles(st.blocks * 512, image.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("sparse prebake gunzip preserves large zero ranges as holes", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-rootfs-sparse-gunzip-"));
    const gz = join(dir, "rootfs.img.gz");
    const out = join(dir, "rootfs.img");
    const image = Buffer.alloc(8 * 1024 * 1024);
    image[1080] = 0x53;
    image[1081] = 0xef;
    image.write("payload", 4 * 1024 * 1024);
    writeFileSync(gz, gzipSync(image));
    try {
      expect(_internal.gunzipPrebakeToFile(gz, out)).toBe(true);
      const st = statSync(out);
      expect(st.size).toBe(image.length);
      expect(_internal.looksLikeExt4(out)).toBe(true);
      expectSparseBlocksWhenHostReportsHoles(st.blocks * 512, image.length);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("cachedImageIsUsable trusts non-ext4 cache hits without invoking e2fsck", () => {
    // A planted cache file with stub bytes should be returned as-is —
    // matches the existing "returns the cached path" test below, just
    // exercises the helper directly so the contract is pinned down.
    const stub = `/tmp/machinen-rootfs-img-trust-${process.pid}`;
    writeFileSync(stub, "fake image bytes");
    try {
      expect(_internal.cachedImageIsUsable(stub)).toBe(true);
    } finally {
      try {
        unlinkSync(stub);
      } catch {}
    }
  });

  it("findKegOnlyE2fs returns the absolute path when the binary lives in a keg-only prefix", () => {
    // Simulates Homebrew's keg-only e2fsprogs install on macOS (#124),
    // where `mke2fs` is on disk but not on PATH. The function should
    // probe the supplied dirs and return the first match.
    const dir = mkdtempSync(join(tmpdir(), "machinen-kegonly-"));
    const fake = join(dir, "mke2fs");
    writeFileSync(fake, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    try {
      const found = _internal.findKegOnlyE2fs(["mke2fs", "mkfs.ext4"], [dir]);
      expect(found).toBe(fake);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("findKegOnlyE2fs returns undefined when no candidate exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-kegonly-empty-"));
    try {
      const found = _internal.findKegOnlyE2fs(["mke2fs", "mkfs.ext4"], [dir]);
      expect(found).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("findBundledMke2fs resolves mke2fs from @machinen/native-<arch>-<os> when installed", () => {
    // mke2fs ships inside the consolidated @machinen/native-<arch>-<os>
    // package, declared as an optionalDependency of @machinen/runtime
    // and gated by `os` + `cpu`, so it's present on every developer
    // host that matches an arch we ship. If this test runs on an
    // unsupported host, skip — there's nothing to assert.
    const found = _internal.findBundledMke2fs();
    if (!found) {
      // Unsupported arch+os; no bundled package on disk.
      return;
    }
    expect(found).toMatch(/native-[^/]+\/e2fsprogs\/bin\/mke2fs$/);
    expect(existsSync(found)).toBe(true);
  });

  it("MACHINEN_MKE2FS env override resolves to the user-supplied path", () => {
    // The env override is step 1 of the resolution chain (#120), mirroring
    // MACHINEN_VMM / MACHINEN_GVPROXY. A valid path returns as-is.
    const dir = mkdtempSync(join(tmpdir(), "machinen-mke2fs-env-"));
    const fake = join(dir, "mke2fs-vendored");
    writeFileSync(fake, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = fake;
    try {
      expect(_internal.resolveMke2fsEnvOverride()).toBe(fake);
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("MACHINEN_MKE2FS pointing at a missing path throws ROOTFS_IMG_TOOL_MISSING", () => {
    // Explicit override that points at nothing is a user mistake — we
    // surface it loudly rather than silently falling through to the
    // bundled / PATH / keg-only steps.
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      expect(() => _internal.resolveMke2fsEnvOverride()).toThrow(ProvisionError);
      try {
        _internal.resolveMke2fsEnvOverride();
      } catch (err) {
        expect(err).toBeInstanceOf(ProvisionError);
        expect((err as ProvisionError).code).toBe("ROOTFS_IMG_TOOL_MISSING");
      }
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
    }
  });

  it("ensureRootfsImage surfaces ROOTFS_IMG_TOOL_MISSING when MACHINEN_MKE2FS points at nothing", () => {
    // The env override is the first step of the resolution chain, so
    // pointing it at a missing file is enough to drive the missing-tool
    // path on any host — even one with the bundled package installed.
    const tarPath = `/tmp/machinen-rootfs-env-tool-missing-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-env-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-env-cache-"));
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      try {
        ensureRootfsImage(tarPath, { cacheDir });
        // Unreachable — the override should always throw.
        expect.fail("expected ProvisionError");
      } catch (err) {
        expect(err).toBeInstanceOf(ProvisionError);
        expect((err as ProvisionError).code).toBe("ROOTFS_IMG_TOOL_MISSING");
      }
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("resolveMke2fsEnvOverride returns undefined when the env var is unset", () => {
    // Empty / absent override falls through to the next resolution step;
    // it should not throw.
    const saved = process.env.MACHINEN_MKE2FS;
    delete process.env.MACHINEN_MKE2FS;
    try {
      expect(_internal.resolveMke2fsEnvOverride()).toBeUndefined();
    } finally {
      if (saved !== undefined) {
        process.env.MACHINEN_MKE2FS = saved;
      }
    }
  });

  it("returns the cached path when the tarball's sha256 already has an .img", () => {
    // Build a real (tiny) tarball so sha256ing has something to chew
    // on, then plant a pre-existing cache file at the matching name.
    // The function should hit the cache and short-circuit before
    // reaching the (potentially-missing) mke2fs path.
    const tarPath = `/tmp/machinen-rootfs-img-cache-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-cache-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-cache-img-"));
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    try {
      // Compute sha256 of the tarball matching the implementation.
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      const expected = join(cacheDir, `${sha}.img`);
      writeFileSync(expected, "fake image bytes");
      // #170: planted .img also needs the clean-shutdown marker;
      // without it the cache hit path would treat the image as
      // poisoned and rematerialize.
      writeFileSync(_internal.okMarkerPath(expected), "");
      const result = ensureRootfsImage(tarPath, { cacheDir });
      expect(result).toBe(expected);
      // Cache file untouched.
      expect(existsSync(expected)).toBe(true);
      // The marker is consumed atomically on hand-off so a kill
      // between here and the next clean exit leaves it dirty.
      expect(existsSync(_internal.okMarkerPath(expected))).toBe(false);
    } finally {
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("sparse-extends a cached .img up to sizeBytes when the caller asks for more", () => {
    // #131: bumping rootDiskSizeBytes against an existing cache should
    // grow the host file (sparse, free) rather than rematerialize. The
    // guest's online ext4 grow makes the new capacity visible.
    const tarPath = `/tmp/machinen-rootfs-img-grow-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-grow-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-grow-img-"));
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    try {
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      const imgPath = join(cacheDir, `${sha}.img`);
      // Plant a 1 KiB cache file (well under the requested 4 KiB
      // target). Doesn't carry the ext4 magic, so cachedImageIsUsable
      // skips fsck and we hit the truncate path directly.
      writeFileSync(imgPath, Buffer.alloc(1024));
      writeFileSync(_internal.okMarkerPath(imgPath), "");
      const result = ensureRootfsImage(tarPath, { cacheDir, sizeBytes: 4096 });
      expect(result).toBe(imgPath);
      expect(statSync(imgPath).size).toBe(4096);
    } finally {
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("rematerializes over a cached .img with no clean-shutdown marker (#170)", () => {
    // Simulates a previous boot killed mid-write: the .img is on disk
    // but the .ok marker was never re-created. The next call must NOT
    // RETURN the planted bytes — it must fall through to materialize,
    // which atomically replaces the file via renameSync (or throws if
    // materialize can't run on this host).
    //
    // The eager unlinkSync(imgPath) on entry was removed in #233 because
    // it raced with concurrent callers holding imgPath as a cache-hit
    // return value (parallel test files; multiple boot()s on the same
    // tarball). The contract that matters is "we don't trust torn
    // bytes" — preserved by the always-materialize fallthrough — not
    // "the file is gone on entry."
    const tarPath = `/tmp/machinen-rootfs-img-poisoned-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-poisoned-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-poisoned-img-"));
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    try {
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      const imgPath = join(cacheDir, `${sha}.img`);
      const planted = Buffer.from("poisoned bytes that look nothing like ext4");
      writeFileSync(imgPath, planted);
      // No e2fsprogs guaranteed on the runner — if rematerialization
      // can't run the function throws ProvisionError. Either outcome
      // proves the planted bytes were rejected.
      let rematerialized = false;
      try {
        ensureRootfsImage(tarPath, { cacheDir });
        rematerialized = true;
      } catch (err) {
        expect(err).toBeInstanceOf(ProvisionError);
      }
      if (rematerialized) {
        // Atomic rename replaced the planted bytes with a real ext4 image.
        const after = statSync(imgPath).size;
        expect(after).not.toBe(planted.length);
      }
      // No assertion when materialize failed — the planted bytes may
      // still be on disk, but they will never be RETURNED to a caller
      // (the next call enters the same fallthrough path).
    } finally {
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("markRootfsImageClean writes the .ok marker only when the image exists", () => {
    // The runtime calls this on a clean VMM exit so the next boot
    // can reuse the cached file. No-op when the image is missing —
    // marking a non-existent file would cause `ensureRootfsImage`
    // to trust a phantom cache hit.
    const dir = mkdtempSync(join(tmpdir(), "machinen-rootfs-mark-clean-"));
    try {
      const missing = join(dir, "missing.img");
      markRootfsImageClean(missing);
      expect(existsSync(_internal.okMarkerPath(missing))).toBe(false);

      const present = join(dir, "present.img");
      writeFileSync(present, "fake image bytes");
      markRootfsImageClean(present);
      expect(existsSync(_internal.okMarkerPath(present))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // #223 prebake fast path. When build-base-assets.sh ships a
  // sibling `<basename>.img.gz` next to the tarball, ensureRootfsImage
  // gunzips it directly into the cache and skips tar -xf + mke2fs.
  // Tests use a synthetic "image" that's just the ext4 superblock
  // magic stamped at offset 1080 — looksLikeExt4 sniffs that and
  // doesn't need e2fsprogs on the runner.
  function writeFakeExt4Image(path: string, sizeBytes = 4096): void {
    const fd = openSync(path, "w");
    try {
      writeSync(fd, Buffer.alloc(sizeBytes), 0, sizeBytes, 0);
      // Little-endian 0xEF53 at offset 1080 — the ext4 superblock magic.
      writeSync(fd, Buffer.from([0x53, 0xef]), 0, 2, 1080);
    } finally {
      closeSync(fd);
    }
  }

  it("uses a sha256 sidecar and immutable template metadata to skip tarball hashing and e2fsck", () => {
    const tarPath = `/tmp/machinen-rootfs-sidecar-template-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-sidecar-template-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-sidecar-template-cache-"));
    const sha = "a".repeat(64);
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    try {
      writeFileSync(`${tarPath}.sha256`, `${sha}  ${tarPath.split("/").at(-1)}\n`);
      const imgPath = join(cacheDir, `${sha}.img`);
      writeFakeExt4Image(imgPath, 4096);
      writeFileSync(_internal.okMarkerPath(imgPath), "");
      writeFileSync(
        _internal.templateMetaPath(imgPath),
        `${JSON.stringify({
          version: 1,
          sha256: sha,
          sizeBytes: 4096,
          source: "prebake",
          createdAt: new Date().toISOString(),
        })}\n`,
      );

      const phases: string[] = [];
      const result = ensureRootfsImage(tarPath, { cacheDir, onPhase: (name) => phases.push(name) });

      expect(result).toBe(imgPath);
      expect(phases).toContain("sha256.sidecar");
      expect(phases).toContain("template-metadata");
      expect(phases).not.toContain("sha256");
      expect(phases).not.toContain("cache-mark-in-use");
      expect(phases).not.toContain("e2fsck");
      expect(existsSync(_internal.okMarkerPath(imgPath))).toBe(true);
    } finally {
      try {
        unlinkSync(tarPath);
      } catch {}
      try {
        unlinkSync(`${tarPath}.sha256`);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("does not trust immutable template metadata without the clean marker", () => {
    const tarPath = `/tmp/machinen-rootfs-template-dirty-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-template-dirty-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-template-dirty-cache-"));
    const sha = "b".repeat(64);
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      writeFileSync(`${tarPath}.sha256`, `${sha}  ${tarPath.split("/").at(-1)}\n`);
      const imgPath = join(cacheDir, `${sha}.img`);
      writeFakeExt4Image(imgPath, 4096);
      writeFileSync(
        _internal.templateMetaPath(imgPath),
        `${JSON.stringify({
          version: 1,
          sha256: sha,
          sizeBytes: 4096,
          source: "prebake",
          createdAt: new Date().toISOString(),
        })}\n`,
      );

      expect(() => ensureRootfsImage(tarPath, { cacheDir })).toThrow(ProvisionError);
      try {
        ensureRootfsImage(tarPath, { cacheDir });
      } catch (err) {
        expect((err as ProvisionError).code).toBe("ROOTFS_IMG_TOOL_MISSING");
      }
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      try {
        unlinkSync(`${tarPath}.sha256`);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("siblingPrebakePath strips .tar.gz / .tgz / .tar and points at .img.gz", () => {
    // Only the gzipped release-build sibling form is recognized;
    // provision() writes its prebake into the runtime cache directly.
    expect(_internal.siblingPrebakePath("/r/rootfs.tar.gz")).toBe("/r/rootfs.img.gz");
    expect(_internal.siblingPrebakePath("/r/rootfs.tgz")).toBe("/r/rootfs.img.gz");
    expect(_internal.siblingPrebakePath("/r/rootfs.tar")).toBe("/r/rootfs.img.gz");
    // Non-tarball paths return undefined — no prebake convention exists
    // for them, so the runtime falls through to the materialize path.
    expect(_internal.siblingPrebakePath("/r/rootfs")).toBeUndefined();
    expect(_internal.siblingPrebakePath("/r/rootfs.zip")).toBeUndefined();
    expect(_internal.siblingPrebakeCandidates("/r/rootfs.tar.gz")).toEqual([
      { path: "/r/rootfs.img.zst", format: "zst", phaseName: "zstd-prebake" },
      { path: "/r/rootfs.img.gz", format: "gz", phaseName: "gunzip-prebake" },
    ]);
  });

  it("uses a sibling .img.zst to populate the cache and skips mke2fs when zstd is available", () => {
    const zstd = _internal.whichFirst(["zstd"]);
    if (!zstd) {
      return;
    }
    const tarPath = `/tmp/machinen-rootfs-prebake-zst-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-zst-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-zst-cache-"));
    writeFileSync(join(tmpDir, "stub"), `prebake-zst-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const fakeImg = join(tmpDir, "fake.img");
    writeFakeExt4Image(fakeImg, 4096);
    const sibling = tarPath.replace(/\.tar\.gz$/, ".img.zst");
    execSync(`${zstd} -q -f -o ${sibling} ${fakeImg}`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      const phases: string[] = [];
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      const result = ensureRootfsImage(tarPath, { cacheDir, onPhase: (name) => phases.push(name) });
      expect(result).toBe(join(cacheDir, `${sha}.img`));
      expect(_internal.looksLikeExt4(result)).toBe(true);
      expect(phases).toContain("zstd-prebake");
      expect(phases).not.toContain("gunzip-prebake");
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      try {
        unlinkSync(sibling);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("falls back from an invalid .img.zst sibling to a valid .img.gz sibling", () => {
    const tarPath = `/tmp/machinen-rootfs-prebake-zst-fallback-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-zst-fallback-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-zst-fallback-cache-"));
    writeFileSync(join(tmpDir, "stub"), `prebake-zst-fallback-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const fakeImg = join(tmpDir, "fake.img");
    writeFakeExt4Image(fakeImg, 4096);
    const zstSibling = tarPath.replace(/\.tar\.gz$/, ".img.zst");
    const gzSibling = tarPath.replace(/\.tar\.gz$/, ".img.gz");
    writeFileSync(zstSibling, "not zstd");
    execSync(`gzip -n -c ${fakeImg} > ${gzSibling}`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      const phases: string[] = [];
      const result = ensureRootfsImage(tarPath, { cacheDir, onPhase: (name) => phases.push(name) });
      expect(_internal.looksLikeExt4(result)).toBe(true);
      expect(phases).toContain("zstd-prebake");
      expect(phases).toContain("gunzip-prebake");
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      try {
        unlinkSync(zstSibling);
      } catch {}
      try {
        unlinkSync(gzSibling);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("uses a sibling .img.gz to populate the cache and skips mke2fs", () => {
    // Pair a tarball with a sibling prebake. Pointing MACHINEN_MKE2FS
    // at a missing path proves the materialize branch was never
    // reached — the override would throw ROOTFS_IMG_TOOL_MISSING the
    // moment we tried to resolve mke2fs.
    const tarPath = `/tmp/machinen-rootfs-prebake-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-cache-"));
    writeFileSync(join(tmpDir, "stub"), `prebake-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const fakeImg = join(tmpDir, "fake.img");
    writeFakeExt4Image(fakeImg, 4096);
    const sibling = tarPath.replace(/\.tar\.gz$/, ".img.gz");
    execSync(`gzip -n -c ${fakeImg} > ${sibling}`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      const result = ensureRootfsImage(tarPath, { cacheDir });
      expect(result).toBe(join(cacheDir, `${sha}.img`));
      expect(_internal.looksLikeExt4(result)).toBe(true);
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      try {
        unlinkSync(sibling);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("sibling .img.gz fast path sparse-extends to sizeBytes when larger", () => {
    const tarPath = `/tmp/machinen-rootfs-prebake-grow-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-grow-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-grow-cache-"));
    writeFileSync(join(tmpDir, "stub"), `prebake-grow-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const fakeImg = join(tmpDir, "fake.img");
    writeFakeExt4Image(fakeImg, 4096);
    const sibling = tarPath.replace(/\.tar\.gz$/, ".img.gz");
    execSync(`gzip -n -c ${fakeImg} > ${sibling}`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      const requested = 32 * 1024;
      const result = ensureRootfsImage(tarPath, { cacheDir, sizeBytes: requested });
      // The decompressed image was 4 KiB; sizeBytes asks for 32 KiB,
      // which is sparse-extended in place before atomic-rename so the
      // guest's online ext4 grow has the headroom #131 promises.
      expect(statSync(result).size).toBe(requested);
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      try {
        unlinkSync(sibling);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("falls back to materialize when sibling .img.gz decompresses to non-ext4 bytes", () => {
    // Corrupted prebake: gunzip succeeds but the bytes inside don't
    // carry the ext4 superblock magic. The fast path must reject the
    // decompressed file and fall through to the materialize branch.
    // We point MACHINEN_MKE2FS at nothing so the fallback throws —
    // the throw itself proves the prebake branch returned undefined.
    const tarPath = `/tmp/machinen-rootfs-prebake-corrupt-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-corrupt-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-corrupt-cache-"));
    writeFileSync(join(tmpDir, "stub"), `prebake-corrupt-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const garbage = join(tmpDir, "garbage.bin");
    writeFileSync(garbage, "not an ext4 image, just some bytes");
    const sibling = tarPath.replace(/\.tar\.gz$/, ".img.gz");
    execSync(`gzip -n -c ${garbage} > ${sibling}`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      expect(() => ensureRootfsImage(tarPath, { cacheDir })).toThrow(ProvisionError);
      try {
        ensureRootfsImage(tarPath, { cacheDir });
      } catch (err) {
        expect(err).toBeInstanceOf(ProvisionError);
        expect((err as ProvisionError).code).toBe("ROOTFS_IMG_TOOL_MISSING");
      }
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      try {
        unlinkSync(sibling);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);

  it("prebakeRootfsImageFromTree leaves an existing cache image untouched", () => {
    // Don't clobber a `<sha>.img` that a concurrent boot() might have
    // open via virtio-blk. Renaming over an in-use inode would leave
    // that boot writing dead bytes while the next boot reads ours.
    const tarPath = `/tmp/machinen-rootfs-prebake-skip-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-skip-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-skip-cache-"));
    writeFileSync(join(tmpDir, "stub"), `prebake-skip-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    try {
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      const imgPath = join(cacheDir, `${sha}.img`);
      const sentinel = Buffer.from("do not overwrite me");
      writeFileSync(imgPath, sentinel);

      prebakeRootfsImageFromTree({ tarPath, treeDir: tmpDir, cacheDir });

      // File is byte-identical — no mke2fs ran.
      expect(readFileSync(imgPath)).toEqual(sentinel);
    } finally {
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("prebakeRootfsImageFromTree no-ops when no mke2fs is available", () => {
    // Best-effort contract: missing tooling logs and returns, never
    // throws. We point MACHINEN_MKE2FS at a non-existent path —
    // resolveMke2fsEnvOverride() throws ProvisionError in that case,
    // and prebakeRootfsImageFromTree must swallow it.
    const tarPath = `/tmp/machinen-rootfs-prebake-nomke-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-nomke-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-prebake-nomke-cache-"));
    writeFileSync(join(tmpDir, "stub"), `prebake-nomke-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    const saved = process.env.MACHINEN_MKE2FS;
    process.env.MACHINEN_MKE2FS = "/definitely/not/here/mke2fs";
    try {
      expect(() =>
        prebakeRootfsImageFromTree({ tarPath, treeDir: tmpDir, cacheDir }),
      ).not.toThrow();
      // No cache file produced.
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      expect(existsSync(join(cacheDir, `${sha}.img`))).toBe(false);
    } finally {
      if (saved === undefined) {
        delete process.env.MACHINEN_MKE2FS;
      } else {
        process.env.MACHINEN_MKE2FS = saved;
      }
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  });

  it("preserves the sticky bit on /tmp during extract (#262)", () => {
    // BSD tar (the macOS default) applies the host umask when extracting
    // as non-root, which silently drops the sticky bit. Our base rootfs
    // ships /tmp at 1777; without `tar -p` it lands as 0755 in the
    // staging tree, gets baked into the ext4 image, and breaks
    // `apt-get install` in the booted guest because apt drops to the
    // _apt user for fetches and can't write to /tmp.
    //
    // Build a tiny tarball with /tmp at 1777 and run the extract helper
    // ensureRootfsImage uses internally. The mode the helper wrote must
    // match the archive byte-for-byte (1777, not 0755).
    const stage = mkdtempSync(join(tmpdir(), "machinen-rootfs-tmp-perms-stage-"));
    const dest = mkdtempSync(join(tmpdir(), "machinen-rootfs-tmp-perms-dest-"));
    const tarPath = join(stage, "rootfs.tar.gz");
    try {
      const src = join(stage, "src");
      mkdirSync(join(src, "tmp"), { recursive: true });
      // mkdirSync applies the process umask, so set the mode explicitly
      // — the test's invariant is "the archive declares 1777 and the
      // extracted tree matches" and we need the source side to actually
      // be 1777 before we tar it up.
      chmodSync(join(src, "tmp"), 0o1777);
      execSync(`tar -czf ${tarPath} -C ${src} .`);

      _internal.extractTarball(tarPath, dest);

      const mode = statSync(join(dest, "tmp")).mode & 0o7777;
      expect(mode).toBe(0o1777);
    } finally {
      rmSync(stage, { recursive: true, force: true });
      rmSync(dest, { recursive: true, force: true });
    }
  });

  it("never shrinks a cached .img — sizeBytes < existing is a no-op", () => {
    // Truncate-down would actually destroy data inside the ext4 fs, so
    // the truncate guard is a critical safety: if the cache is already
    // bigger than what the caller asked for, leave it alone.
    const tarPath = `/tmp/machinen-rootfs-img-noshrink-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-noshrink-tar-"));
    const cacheDir = mkdtempSync(join(tmpdir(), "machinen-rootfs-noshrink-img-"));
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    try {
      const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
        .trim()
        .split(/\s+/, 1)[0]!;
      const imgPath = join(cacheDir, `${sha}.img`);
      writeFileSync(imgPath, Buffer.alloc(8 * 1024));
      writeFileSync(_internal.okMarkerPath(imgPath), "");
      const result = ensureRootfsImage(tarPath, { cacheDir, sizeBytes: 1024 });
      expect(result).toBe(imgPath);
      expect(statSync(imgPath).size).toBe(8 * 1024);
    } finally {
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);
});

describe("boot({ rootDisk })", () => {
  it("rejects rootDisk: true without an image to materialize from", async () => {
    await expect(boot({ binary: "/bin/sh", rootDisk: true })).rejects.toThrow(BootError);
  });

  it("throws when rootDisk path does not exist", async () => {
    await expect(boot({ binary: "/bin/sh", rootDisk: "/nope/missing-rootfs.img" })).rejects.toThrow(
      /rootDisk image not found/,
    );
  });

  it("passes the resolved rootDisk path as MACHINEN_ROOTDISK to the child", async () => {
    // Round-trip: spawn /bin/sh with args that print MACHINEN_ROOTDISK,
    // pass an existing file as `rootDisk`. Doesn't boot a real VMM.
    const rd = `/tmp/machinen-runtime-rootdisk-${process.pid}`;
    writeFileSync(rd, "");
    try {
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", "printf 'ROOTDISK=%s\\n' \"$MACHINEN_ROOTDISK\""],
        rootDisk: rd,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`ROOTDISK=${rd}`);
    } finally {
      try {
        unlinkSync(rd);
      } catch {}
    }
  });

  it("defaults to materializing the image when rootDisk is omitted", async () => {
    // No explicit rootDisk + an image present → the runtime should
    // try to materialize. We don't have mke2fs guaranteed on the
    // runner, so we point image at a missing path and assert we
    // hit the materialize path (which surfaces the "tarball not
    // found" error before any e2fsprogs lookup).
    const missing = `/tmp/machinen-rootdisk-default-missing-${process.pid}.tar.gz`;
    await expect(
      boot({
        binary: "/bin/sh",
        image: missing,
        cmd: ["/bin/true"],
        timeoutMs: 2_000,
      }),
    ).rejects.toThrow(/image tarball not found/);
  });

  it("opts back to the legacy initramfs path on rootDisk: false", async () => {
    // Same shape as the test above, but with rootDisk: false the
    // runtime should never call ensureRootfsImage. Confirms the
    // escape hatch still routes around materialization.
    const tarPath = `/tmp/machinen-rootdisk-optout-${process.pid}.tar.gz`;
    const tmpDir = mkdtempSync(join(tmpdir(), "machinen-rootdisk-optout-"));
    writeFileSync(join(tmpDir, "stub"), "x");
    execSync(`tar -czf ${tarPath} -C ${tmpDir} .`);
    try {
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", "printf 'ROOTDISK=%s\\n' \"${MACHINEN_ROOTDISK:-unset}\""],
        image: tarPath,
        cmd: ["/bin/true"],
        rootDisk: false,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe("ROOTDISK=unset");
    } finally {
      try {
        unlinkSync(tarPath);
      } catch {}
      rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("forwards MACHINEN_ROOTDISK alongside MACHINEN_DISK when both are set", async () => {
    const rd = `/tmp/machinen-runtime-rootdisk2-${process.pid}`;
    const snap = `/tmp/machinen-runtime-snap2-${process.pid}`;
    writeFileSync(rd, "");
    writeFileSync(snap, "");
    try {
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", 'printf \'ROOTDISK=%s DISK=%s\\n\' "$MACHINEN_ROOTDISK" "$MACHINEN_DISK"'],
        rootDisk: rd,
        snapshot: snap,
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      // ROOTDISK is the caller's path verbatim; DISK is a per-boot
      // reflink-clone of `snap` so the chained-snapshot path can mkfs
      // the disk without corrupting the source bundle (#207). The
      // clone lives in tmpdir and carries a `machinen-snap-restore-`
      // prefix.
      const m = out.trim().match(/^ROOTDISK=(.+) DISK=(.+)$/);
      expect(m, `unexpected output: ${out.trim()}`).not.toBeNull();
      expect(m![1]).toBe(rd);
      expect(m![2]).toMatch(/machinen-snap-restore-.*\.img$/);
    } finally {
      try {
        unlinkSync(rd);
      } catch {}
      try {
        unlinkSync(snap);
      } catch {}
    }
  });
});

// #121: per-boot reflink copy of the cached rootfs image.
//
// `boot({ rootDisk: true })` mounts the image read-write on virtio-blk,
// so handing the cached `<sha>.img` directly to the VMM would let one
// boot's writes persist into the next boot from the same tarball.
// The runtime now COPYFILE_FICLONEs the cache template to a per-boot
// path, hands that copy to the VMM, and unlinks it on exit.
//
// These tests run `binary: "/bin/sh"` against a planted cache template
// inside a private $HOME so they exercise the host-side wiring without
// needing e2fsprogs or a real VMM.
describe("boot({ rootDisk }) per-boot copy (#121)", () => {
  // Plant a cache template under a temp $HOME and return the bits each
  // test needs to drive boot() and assert against the copy.
  function buildHarness(label: string) {
    const homeDir = mkdtempSync(join(tmpdir(), `machinen-home-${label}-`));
    const cacheDir = join(homeDir, ".cache", "machinen", "rootfs");
    mkdirSync(cacheDir, { recursive: true });

    // Unique tarball content per harness so the sha256-keyed cache
    // entry never collides between concurrent vitest workers.
    const tarPath = join(homeDir, `${label}.tar.gz`);
    const stageDir = mkdtempSync(join(tmpdir(), `machinen-stage-${label}-`));
    writeFileSync(join(stageDir, "stub"), `stub-${label}-${process.pid}-${Date.now()}`);
    execSync(`tar -czf ${tarPath} -C ${stageDir} .`);

    const sha = execSync(`shasum -a 256 ${tarPath}`, { encoding: "utf8" })
      .trim()
      .split(/\s+/, 1)[0]!;
    const cachedImg = join(cacheDir, `${sha}.img`);
    // Plant non-ext4 bytes so cachedImageIsUsable's e2fsck sniff is
    // skipped and we reach the COPYFILE_FICLONE path directly.
    writeFileSync(cachedImg, "TEMPLATE_CONTENT");
    writeFileSync(`${cachedImg}.ok`, "");

    // packTinyBundle requires a modules tarball; an empty gzipped tar
    // is enough to satisfy it for an env-passthrough boot.
    const modsTar = join(homeDir, `mods-${label}.tar.gz`);
    const modsStage = mkdtempSync(join(tmpdir(), `machinen-mods-${label}-`));
    execSync(`tar -czf ${modsTar} -C ${modsStage} .`);

    return {
      homeDir,
      tarPath,
      cachedImg,
      modsTar,
      cleanup() {
        rmSync(homeDir, { recursive: true, force: true });
        rmSync(stageDir, { recursive: true, force: true });
        rmSync(modsStage, { recursive: true, force: true });
      },
    };
  }

  function withHome<T>(homeDir: string, fn: () => Promise<T>): Promise<T> {
    const saved = process.env.HOME;
    process.env.HOME = homeDir;
    return fn().finally(() => {
      if (saved === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = saved;
      }
    });
  }

  it("clones the cached image to a per-boot path and removes it on exit", async () => {
    const h = buildHarness(`clone-${process.pid}`);
    try {
      await withHome(h.homeDir, async () => {
        const vm = await boot({
          binary: "/bin/sh",
          args: ["-c", 'printf "ROOTDISK=%s\\n" "$MACHINEN_ROOTDISK"'],
          image: h.tarPath,
          cmd: ["/bin/true"],
          vmmEnv: { MACHINEN_MODULES: h.modsTar },
          timeoutMs: 5_000,
        });
        await vm.wait();
        const out = (await vm.output()).trim();
        const m = /^ROOTDISK=(.+)$/m.exec(out);
        expect(m, `no ROOTDISK line in output: ${out}`).not.toBeNull();
        const perBoot = m![1]!;
        // Per-boot path is a distinct file from the cached template.
        expect(perBoot).not.toBe(h.cachedImg);
        // Exit handler unlinks the per-boot file before vm.wait() resolves.
        expect(existsSync(perBoot)).toBe(false);
        // Cached template survives the boot.
        expect(existsSync(h.cachedImg)).toBe(true);
        expect(readFileSync(h.cachedImg, "utf8")).toBe("TEMPLATE_CONTENT");
      });
    } finally {
      h.cleanup();
    }
  }, 20_000);

  it("guest writes to the per-boot copy do not leak into the cached template", async () => {
    const h = buildHarness(`leak-${process.pid}`);
    try {
      await withHome(h.homeDir, async () => {
        const vm = await boot({
          binary: "/bin/sh",
          args: ["-c", 'printf "GUEST_WROTE_HERE" > "$MACHINEN_ROOTDISK"'],
          image: h.tarPath,
          cmd: ["/bin/true"],
          vmmEnv: { MACHINEN_MODULES: h.modsTar },
          timeoutMs: 5_000,
        });
        await vm.wait();
        // The mock "guest" overwrote MACHINEN_ROOTDISK; the cached
        // template at <sha>.img must be unchanged. This is the core
        // contract per-boot copies restore.
        expect(readFileSync(h.cachedImg, "utf8")).toBe("TEMPLATE_CONTENT");
      });
    } finally {
      h.cleanup();
    }
  }, 20_000);

  it("back-to-back boots from the same tarball get distinct per-boot copies", async () => {
    const h = buildHarness(`distinct-${process.pid}`);
    try {
      await withHome(h.homeDir, async () => {
        const launch = async () => {
          const vm = await boot({
            binary: "/bin/sh",
            args: ["-c", 'printf "ROOTDISK=%s\\n" "$MACHINEN_ROOTDISK"'],
            image: h.tarPath,
            cmd: ["/bin/true"],
            vmmEnv: { MACHINEN_MODULES: h.modsTar },
            timeoutMs: 5_000,
          });
          await vm.wait();
          const out = (await vm.output()).trim();
          return /^ROOTDISK=(.+)$/m.exec(out)![1]!;
        };
        // Sequential rather than parallel — the cache marker
        // (#170) is single-consumer, so two simultaneous boots
        // would race on it. The per-boot path is what we're
        // asserting on; two back-to-back boots each get their
        // own copy in tmpdir.
        const p1 = await launch();
        const p2 = await launch();
        expect(p1).not.toBe(p2);
        expect(existsSync(p1)).toBe(false);
        expect(existsSync(p2)).toBe(false);
      });
    } finally {
      h.cleanup();
    }
  }, 30_000);
});
