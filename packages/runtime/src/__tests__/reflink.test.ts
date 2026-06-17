import {
  closeSync,
  existsSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { reflinkCopy } from "../reflink.ts";

describe("reflinkCopy", () => {
  let workDir: string | undefined;

  afterEach(() => {
    if (workDir && existsSync(workDir)) {
      rmSync(workDir, { recursive: true, force: true });
    }
    workDir = undefined;
  });

  it("clones a file byte-for-byte to a fresh destination", () => {
    workDir = mkdtempSync(join(tmpdir(), "reflink-test-"));
    const src = join(workDir, "src.bin");
    const dst = join(workDir, "dst.bin");
    const payload = Buffer.alloc(64 * 1024);
    payload.fill("A");
    writeFileSync(src, payload);
    reflinkCopy(src, dst);
    expect(readFileSync(dst).equals(payload)).toBe(true);
  });

  it("the clone is independent — writes to the source don't propagate", () => {
    workDir = mkdtempSync(join(tmpdir(), "reflink-test-"));
    const src = join(workDir, "src.bin");
    const dst = join(workDir, "dst.bin");
    writeFileSync(src, Buffer.from("original"));
    reflinkCopy(src, dst);
    writeFileSync(src, Buffer.from("modified-after-clone"));
    expect(readFileSync(dst).toString()).toBe("original");
  });

  it("preserves holes when Linux falls back from FICLONE to a byte copy", () => {
    if (platform() !== "linux") {
      return;
    }
    workDir = mkdtempSync(join(tmpdir(), "reflink-test-sparse-"));
    const src = join(workDir, "src.bin");
    const dst = join(workDir, "dst.bin");
    const fd = openSync(src, "w");
    try {
      truncateSync(src, 16 * 1024 * 1024);
      const payload = Buffer.from("payload");
      writeSync(fd, payload, 0, payload.length, 8 * 1024 * 1024);
    } finally {
      closeSync(fd);
    }

    reflinkCopy(src, dst);

    const srcStat = statSync(src);
    const dstStat = statSync(dst);
    expect(dstStat.size).toBe(srcStat.size);
    expect(
      readFileSync(dst)
        .subarray(8 * 1024 * 1024, 8 * 1024 * 1024 + 7)
        .toString(),
    ).toBe("payload");
    expect(dstStat.blocks * 512).toBeLessThan(srcStat.size / 4);
  });
});
