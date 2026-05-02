import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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
});
