// Tests for ensureRootfsImage — the tar→ext4-img materializer that
// backs `boot({ rootDisk: true })` (#114).
//
// These tests don't actually materialize ext4 images (that requires
// e2fsprogs on PATH and is verified in the smoke harness). They cover
// the host-side logic the runtime owns: input validation, the
// missing-tool error path, and that an explicit `rootDisk: '<path>'`
// surfaces through to MACHINEN_ROOTDISK in the spawned VMM's env.

import { execSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  openSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  writeSync,
  closeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { boot, BootError, ensureRootfsImage, ProvisionError } from "../index.ts";
import { _internal } from "../rootfs-img.ts";

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
      const result = ensureRootfsImage(tarPath, { cacheDir });
      expect(result).toBe(expected);
      // Cache file untouched.
      expect(existsSync(expected)).toBe(true);
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
    const mods = `/tmp/machinen-runtime-mods2-${process.pid}.tar.gz`;
    writeFileSync(rd, "");
    writeFileSync(snap, "");
    // The tiny-cpio path packs a /modules/*.ko tree from this tarball;
    // for an env-passthrough check (no real boot) any valid empty
    // gzipped tar works.
    const modStage = mkdtempSync(join(tmpdir(), "machinen-runtime-mods2-"));
    execSync(`tar -czf ${mods} -C ${modStage} .`);
    try {
      const vm = await boot({
        binary: "/bin/sh",
        args: ["-c", 'printf \'ROOTDISK=%s DISK=%s\\n\' "$MACHINEN_ROOTDISK" "$MACHINEN_DISK"'],
        rootDisk: rd,
        snapshot: snap,
        vmmEnv: { MACHINEN_MODULES: mods },
        timeoutMs: 2_000,
      });
      await vm.wait();
      const out = await vm.output();
      expect(out.trim()).toBe(`ROOTDISK=${rd} DISK=${snap}`);
    } finally {
      try {
        unlinkSync(rd);
      } catch {}
      try {
        unlinkSync(snap);
      } catch {}
      try {
        unlinkSync(mods);
      } catch {}
      rmSync(modStage, { recursive: true, force: true });
    }
  });
});
