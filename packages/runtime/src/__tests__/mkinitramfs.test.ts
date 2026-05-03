// Unit tests for mkinitramfs.packBundle — focused on the single
// directory mount added in #64. Each test builds a bundle, packs it
// with a mount, parses the resulting cpio in-process, and asserts on
// the merged tree. Parsing in-process (rather than shelling out to
// `cpio -id`) keeps the tests hermetic — not every CI runner ships a
// cpio binary with matching flag semantics.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packBundle, packTinyBundle, patchConfigEnv } from "../mkinitramfs.ts";

// Minimal parser for the newc cpio format produced by mkinitramfs.ts.
// Returns a name → {data, mode} map for all non-TRAILER entries.
function listCpioEntries(cpioPath: string): Map<string, { data: Buffer; mode: number }> {
  const buf = readFileSync(cpioPath);
  const out = new Map<string, { data: Buffer; mode: number }>();
  let offset = 0;
  while (offset + 110 <= buf.length) {
    const magic = buf.subarray(offset, offset + 6).toString("ascii");
    if (magic !== "070701") {
      break;
    }
    const hex = (i: number) =>
      parseInt(buf.subarray(offset + 6 + i * 8, offset + 6 + (i + 1) * 8).toString("ascii"), 16);
    const mode = hex(1);
    const filesize = hex(6);
    const namesize = hex(11);
    const nameStart = offset + 6 + 13 * 8;
    const name = buf.subarray(nameStart, nameStart + namesize - 1).toString("utf8");
    let cursor = nameStart + namesize;
    while ((cursor - offset) % 4 !== 0) {
      cursor++;
    }
    const data = Buffer.from(buf.subarray(cursor, cursor + filesize));
    cursor += filesize;
    while ((cursor - offset) % 4 !== 0) {
      cursor++;
    }
    offset = cursor;
    if (name === "TRAILER!!!") {
      break;
    }
    out.set(name, { data, mode });
  }
  return out;
}

describe("patchConfigEnv", () => {
  it("returns the original buffer untouched when env is absent", () => {
    const input = Buffer.from(JSON.stringify({ cmd: ["/bin/true"] }), "utf8");
    expect(patchConfigEnv(input, undefined)).toBe(input);
    expect(patchConfigEnv(input, {})).toBe(input);
  });

  it("adds env field to configs that don't have one", () => {
    const input = Buffer.from(JSON.stringify({ cmd: ["/bin/true"] }), "utf8");
    const out = patchConfigEnv(input, { FOO: "bar" });
    expect(JSON.parse(out.toString("utf8"))).toEqual({
      cmd: ["/bin/true"],
      env: { FOO: "bar" },
    });
  });

  it("lets the on-disk env win on key collision", () => {
    const input = Buffer.from(
      JSON.stringify({ cmd: ["/bin/true"], env: { FOO: "bundle" } }),
      "utf8",
    );
    const out = patchConfigEnv(input, { FOO: "runtime", BAR: "runtime" });
    const parsed = JSON.parse(out.toString("utf8"));
    expect(parsed.env).toEqual({ FOO: "bundle", BAR: "runtime" });
  });
});

describe("packBundle mount", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "machinen-packbundle-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  function makeEmptyBundle(): string {
    const bundleDir = join(tmp, "bundle");
    mkdirSync(join(bundleDir, "rootfs"), { recursive: true });
    writeFileSync(join(bundleDir, "machinen-config.json"), JSON.stringify({ cmd: ["/bin/true"] }));
    return bundleDir;
  }

  it("copies a host directory recursively to the guest path", () => {
    const bundle = makeEmptyBundle();
    const srcDir = join(tmp, "src");
    mkdirSync(join(srcDir, "nested"), { recursive: true });
    writeFileSync(join(srcDir, "a.txt"), "A");
    writeFileSync(join(srcDir, "nested", "b.txt"), "B");

    const out = join(tmp, "out.cpio");
    packBundle({
      bundle,
      out,
      mount: { host: srcDir, guest: "/mnt/app" },
    });

    const entries = listCpioEntries(out);
    expect(entries.get("mnt/app/a.txt")?.data.toString("utf8")).toBe("A");
    expect(entries.get("mnt/app/nested/b.txt")?.data.toString("utf8")).toBe("B");
  });

  it("lets the bundle win on path collisions", () => {
    // Bundle ships /mnt/app/x.txt = "bundle"; the mount tries to place
    // "mount" at the same path. Bundle is applied last → bundle wins.
    const bundleDir = join(tmp, "bundle");
    mkdirSync(join(bundleDir, "rootfs", "mnt", "app"), { recursive: true });
    writeFileSync(join(bundleDir, "rootfs", "mnt", "app", "x.txt"), "bundle");
    writeFileSync(join(bundleDir, "machinen-config.json"), JSON.stringify({ cmd: ["/bin/true"] }));

    const mountSrc = join(tmp, "mount-src");
    mkdirSync(mountSrc);
    writeFileSync(join(mountSrc, "x.txt"), "mount");

    const out = join(tmp, "out.cpio");
    packBundle({
      bundle: bundleDir,
      out,
      mount: { host: mountSrc, guest: "/mnt/app" },
    });

    const entries = listCpioEntries(out);
    expect(entries.get("mnt/app/x.txt")?.data.toString("utf8")).toBe("bundle");
  });

  it("merges env into the packed machinen-config.json", () => {
    const bundle = makeEmptyBundle();
    const out = join(tmp, "out.cpio");
    packBundle({
      bundle,
      out,
      env: { FNM_NODE_DIST_MIRROR: "http://192.168.127.1:9000/node-dist" },
    });

    const entries = listCpioEntries(out);
    const cfg = entries.get("machinen-config.json");
    expect(cfg).toBeDefined();
    const parsed = JSON.parse(cfg!.data.toString("utf8"));
    expect(parsed.env).toEqual({
      FNM_NODE_DIST_MIRROR: "http://192.168.127.1:9000/node-dist",
    });
    expect(parsed.cmd).toEqual(["/bin/true"]);
  });

  it("lets the bundle's on-disk env win over env on key collision", () => {
    const bundleDir = join(tmp, "bundle");
    mkdirSync(join(bundleDir, "rootfs"), { recursive: true });
    writeFileSync(
      join(bundleDir, "machinen-config.json"),
      JSON.stringify({ cmd: ["/bin/true"], env: { FOO: "from-bundle" } }),
    );

    const out = join(tmp, "out.cpio");
    packBundle({
      bundle: bundleDir,
      out,
      env: { FOO: "from-runtime", BAR: "from-runtime" },
    });

    const entries = listCpioEntries(out);
    const parsed = JSON.parse(entries.get("machinen-config.json")!.data.toString("utf8"));
    expect(parsed.env).toEqual({ FOO: "from-bundle", BAR: "from-runtime" });
  });

  it("leaves bundle config untouched when env is absent", () => {
    const bundle = makeEmptyBundle();
    const out = join(tmp, "out.cpio");
    packBundle({ bundle, out });

    const entries = listCpioEntries(out);
    const parsed = JSON.parse(entries.get("machinen-config.json")!.data.toString("utf8"));
    // No env field should have been added.
    expect(parsed.env).toBeUndefined();
    expect(parsed.cmd).toEqual(["/bin/true"]);
  });

  // #253: a cpio without /init silently produces an opaque kernel
  // panic at boot ("Can't open blockdev"). Both packTinyBundle and
  // packBundle inject /init from a host path; if that path is missing
  // or unreadable they must throw, not pack a bootless cpio. The
  // MACHINEN_REQUIRE_FIXTURES=0 escape hatch (used by tests with a
  // fake VMM binary) is opt-out, so flip it off for these cases.
  it("packTinyBundle throws MKINITRAMFS_INIT_MISSING when initPath is absent", () => {
    const bundle = makeEmptyBundle();
    const out = join(tmp, "no-init.cpio");
    const prev = process.env.MACHINEN_REQUIRE_FIXTURES;
    delete process.env.MACHINEN_REQUIRE_FIXTURES;
    try {
      expect(() => packTinyBundle({ bundle, out, initPath: join(tmp, "does-not-exist") })).toThrow(
        expect.objectContaining({ code: "MKINITRAMFS_INIT_MISSING" }),
      );
    } finally {
      if (prev !== undefined) {
        process.env.MACHINEN_REQUIRE_FIXTURES = prev;
      }
    }
  });

  it("packBundle throws MKINITRAMFS_INIT_MISSING when initPath is absent", () => {
    const bundle = makeEmptyBundle();
    const out = join(tmp, "no-init-bundle.cpio");
    const prev = process.env.MACHINEN_REQUIRE_FIXTURES;
    delete process.env.MACHINEN_REQUIRE_FIXTURES;
    try {
      expect(() => packBundle({ bundle, out, initPath: join(tmp, "does-not-exist") })).toThrow(
        expect.objectContaining({ code: "MKINITRAMFS_INIT_MISSING" }),
      );
    } finally {
      if (prev !== undefined) {
        process.env.MACHINEN_REQUIRE_FIXTURES = prev;
      }
    }
  });

  it("packTinyBundle silently skips a missing /init when MACHINEN_REQUIRE_FIXTURES=0", () => {
    // Test-only escape hatch for fake-VMM tests (binary: "/bin/sh"),
    // where the cpio's contents don't matter because the spawn is
    // never actually a VMM. Production callers don't set this flag,
    // so they get the strict MKINITRAMFS_INIT_MISSING throw.
    const bundle = makeEmptyBundle();
    const out = join(tmp, "no-init-allowed.cpio");
    const prev = process.env.MACHINEN_REQUIRE_FIXTURES;
    process.env.MACHINEN_REQUIRE_FIXTURES = "0";
    try {
      packTinyBundle({ bundle, out, initPath: join(tmp, "does-not-exist") });
      const entries = listCpioEntries(out);
      expect(entries.has("init")).toBe(false);
      expect(entries.has("machinen-config.json")).toBe(true);
    } finally {
      if (prev === undefined) {
        delete process.env.MACHINEN_REQUIRE_FIXTURES;
      } else {
        process.env.MACHINEN_REQUIRE_FIXTURES = prev;
      }
    }
  });

  // #119: packTinyBundle ships ~500 KB cpios for the rootDisk path —
  // /init + machinen-config.json + boot-epoch + /dev/console only.
  // No /modules/*.ko, no Debian rootfs tar overlay. The kernel has the
  // boot-path drivers compiled in, so the cpio carries only what /init
  // itself needs to read before pivoting to /dev/vda. These tests
  // codify the layout so the cpio doesn't silently re-fatten.
  it("produces a tiny cpio with no /modules tree", () => {
    const bundle = makeEmptyBundle();
    const out = join(tmp, "tiny.cpio");
    // Pass an explicit initPath so the test passes whether or not the
    // host has run `zig build` to populate test-fixtures/init. CI's
    // tests.yml job doesn't pre-build microvm assets — we don't want to
    // require it just to assert the cpio layout.
    const stubInit = join(tmp, "stub-init");
    writeFileSync(stubInit, "stub");
    packTinyBundle({ bundle, out, initPath: stubInit });

    const entries = listCpioEntries(out);
    // Must-haves for the kernel + /init handshake.
    expect(entries.has("init")).toBe(true);
    expect(entries.has("machinen-config.json")).toBe(true);
    expect(entries.has("etc/machinen-boot-epoch")).toBe(true);
    expect(entries.has("dev/console")).toBe(true);
    // Must-not-haves: the legacy /modules/*.ko tree is gone now that
    // the kernel ships virtio_*, ext4, vsock, fuse compiled in.
    for (const name of entries.keys()) {
      expect(name.startsWith("modules/")).toBe(false);
    }
    // Cap the cpio at 1 MiB. The issue's test plan asks for < 5 MB; we
    // come in well under that today (~130 KB without /init, ~250 KB
    // with). 1 MiB leaves room for /fuse-agent or a small mount payload
    // before this test starts complaining.
    const size = statSync(out).size;
    expect(size).toBeLessThan(1024 * 1024);
  });

  it("leaves non-colliding mount paths alone when the bundle overlays a sibling", () => {
    // Mount populates /mnt/app with a+b; bundle only provides /mnt/app/a.
    // After layering, bundle's a wins, mount's b survives.
    const bundleDir = join(tmp, "bundle");
    mkdirSync(join(bundleDir, "rootfs", "mnt", "app"), { recursive: true });
    writeFileSync(join(bundleDir, "rootfs", "mnt", "app", "a.txt"), "bundle-a");
    writeFileSync(join(bundleDir, "machinen-config.json"), JSON.stringify({ cmd: ["/bin/true"] }));

    const mountSrc = join(tmp, "mount-src");
    mkdirSync(mountSrc);
    writeFileSync(join(mountSrc, "a.txt"), "mount-a");
    writeFileSync(join(mountSrc, "b.txt"), "mount-b");

    const out = join(tmp, "out.cpio");
    packBundle({
      bundle: bundleDir,
      out,
      mount: { host: mountSrc, guest: "/mnt/app" },
    });

    const entries = listCpioEntries(out);
    expect(entries.get("mnt/app/a.txt")?.data.toString("utf8")).toBe("bundle-a");
    expect(entries.get("mnt/app/b.txt")?.data.toString("utf8")).toBe("mount-b");
  });
});
