// Unit tests for mkinitramfs.packBundle — focused on the single
// directory mount added in #64. Each test builds a bundle, packs it
// with a mount, parses the resulting cpio in-process, and asserts on
// the merged tree. Parsing in-process (rather than shelling out to
// `cpio -id`) keeps the tests hermetic — not every CI runner ships a
// cpio binary with matching flag semantics.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packBundle } from "../mkinitramfs.ts";

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
