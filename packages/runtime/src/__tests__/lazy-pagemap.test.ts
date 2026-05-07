// Unit tests for the pagemap PE_LAZY rewriter. We hand-build pagemap
// bytes following criu/image.c v4.2 framing so the round-trip exercises
// the same wire format the page-server reads in production.

import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  markPagemapsLazy,
  parseLazyRangesFromMm,
  rewritePagemap,
  type VmaRange,
} from "../lazy-pagemap.ts";

const IMG_COMMON_MAGIC = 0x54564319;
const PAGEMAP_MAGIC = 0x56084025;
const MM_MAGIC = 0x57492820;
const VMA_ANON_PRIVATE = 1 << 4;
const VMA_FILE_PRIVATE = 1 << 1;
const VMA_AREA_VDSO = 1 << 8;
const VMA_AREA_VVAR = 1 << 11;

// A range that swallows every test address — used by tests that don't
// care about VMA filtering, only the pagemap-rewrite logic itself.
const ANY_RANGE: VmaRange[] = [{ lo: 0n, hi: 0xffff_ffff_ffff_ffffn }];
const PE_LAZY = 1 << 1;
const PE_PRESENT = 1 << 2;

function u32le(v: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v, 0);
  return b;
}

function varint(value: number): Buffer {
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = v >>> 7;
  }
  out.push(v & 0x7f);
  return Buffer.from(out);
}

function tag(field: number, wireType: number): Buffer {
  return varint((field << 3) | wireType);
}

/** Build a `pagemap_head { pages_id }` protobuf body. */
function pagemapHead(pagesId: number): Buffer {
  return Buffer.concat([tag(1, 0), varint(pagesId)]);
}

/** Build a `pagemap_entry` body with given fields. Omitted fields are not emitted. */
function pagemapEntry(opts: {
  vaddr?: number;
  nr_pages?: number;
  flags?: number;
  in_parent?: boolean;
}): Buffer {
  const parts: Buffer[] = [];
  if (opts.vaddr !== undefined) {
    parts.push(tag(1, 0), varint(opts.vaddr));
  }
  if (opts.in_parent !== undefined) {
    parts.push(tag(3, 0), varint(opts.in_parent ? 1 : 0));
  }
  if (opts.flags !== undefined) {
    parts.push(tag(4, 0), varint(opts.flags));
  }
  if (opts.nr_pages !== undefined) {
    parts.push(tag(5, 0), varint(opts.nr_pages));
  }
  return Buffer.concat(parts);
}

/** Wrap a stream of messages with the pagemap-*.img header + size prefixes. */
function buildPagemap(messages: Buffer[]): Buffer {
  const out: Buffer[] = [u32le(IMG_COMMON_MAGIC), u32le(PAGEMAP_MAGIC)];
  for (const m of messages) {
    out.push(u32le(m.length), m);
  }
  return Buffer.concat(out);
}

/** Decode a pagemap-*.img back into entries (test helper). */
function decodePagemap(buf: Buffer): { head: Buffer; entries: Buffer[] } {
  expect(buf.readUInt32LE(0)).toBe(IMG_COMMON_MAGIC);
  expect(buf.readUInt32LE(4)).toBe(PAGEMAP_MAGIC);
  let pos = 8;
  const headLen = buf.readUInt32LE(pos);
  pos += 4;
  const head = buf.subarray(pos, pos + headLen);
  pos += headLen;
  const entries: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32LE(pos);
    pos += 4;
    entries.push(buf.subarray(pos, pos + len));
    pos += len;
  }
  return { head, entries };
}

/** Read field 4 (flags varint) from a pagemap_entry body. Returns 0 if absent. */
function readFlags(entry: Buffer): number {
  let pos = 0;
  while (pos < entry.length) {
    let tagVal = 0;
    let shift = 0;
    while (true) {
      const b = entry[pos++];
      tagVal |= (b & 0x7f) << shift;
      if ((b & 0x80) === 0) {
        break;
      }
      shift += 7;
    }
    const field = tagVal >> 3;
    const wireType = tagVal & 0x7;
    if (wireType !== 0) {
      throw new Error(`unexpected wire type ${wireType}`);
    }
    let val = 0;
    let s = 0;
    while (true) {
      const b = entry[pos++];
      val |= (b & 0x7f) << s;
      if ((b & 0x80) === 0) {
        break;
      }
      s += 7;
    }
    if (field === 4) {
      return val;
    }
  }
  return 0;
}

describe("rewritePagemap", () => {
  it("ORs PE_LAZY onto every PE_PRESENT entry", () => {
    const input = buildPagemap([
      pagemapHead(1),
      pagemapEntry({ vaddr: 0x1000, nr_pages: 4, flags: PE_PRESENT }),
      pagemapEntry({ vaddr: 0x5000, nr_pages: 1, flags: PE_PRESENT }),
    ]);
    const result = rewritePagemap(input, ANY_RANGE);
    expect(result.changed).toBe(true);
    expect(result.entriesFlagged).toBe(2);
    expect(result.entriesAlreadyLazy).toBe(0);

    const decoded = decodePagemap(result.out);
    expect(decoded.entries).toHaveLength(2);
    expect(readFlags(decoded.entries[0])).toBe(PE_PRESENT | PE_LAZY);
    expect(readFlags(decoded.entries[1])).toBe(PE_PRESENT | PE_LAZY);
  });

  it("preserves non-flag fields (vaddr, nr_pages, in_parent) verbatim", () => {
    const input = buildPagemap([
      pagemapHead(7),
      pagemapEntry({
        vaddr: 0xdead_beef,
        nr_pages: 13,
        flags: PE_PRESENT,
        in_parent: false,
      }),
    ]);
    const result = rewritePagemap(input, ANY_RANGE);
    const decoded = decodePagemap(result.out);
    // The flags byte changed (4→6), but the rest of the bytes around it
    // — including vaddr, nr_pages, in_parent — should be untouched.
    // Cheapest check: parse the entry back and compare individual fields.
    const e = decoded.entries[0];
    // Walk all fields; collect into a map.
    const fields: Record<number, number> = {};
    let pos = 0;
    while (pos < e.length) {
      let tagVal = 0;
      let shift = 0;
      while (true) {
        const b = e[pos++];
        tagVal |= (b & 0x7f) << shift;
        if ((b & 0x80) === 0) {
          break;
        }
        shift += 7;
      }
      const field = tagVal >> 3;
      // Use BigInt to avoid 32-bit signed overflow on values > 0x7fffffff
      // (e.g. the 0xdead_beef vaddr below has bit 31 set).
      let val = 0n;
      let s = 0n;
      while (true) {
        const b = e[pos++];
        val |= BigInt(b & 0x7f) << s;
        if ((b & 0x80) === 0) {
          break;
        }
        s += 7n;
      }
      fields[field] = Number(val);
    }
    expect(fields[1]).toBe(0xdead_beef);
    expect(fields[3]).toBe(0); // in_parent=false
    expect(fields[4]).toBe(PE_PRESENT | PE_LAZY);
    expect(fields[5]).toBe(13);
  });

  it("skips entries that are already PE_LAZY", () => {
    const input = buildPagemap([
      pagemapHead(1),
      pagemapEntry({ vaddr: 0x1000, nr_pages: 1, flags: PE_PRESENT | PE_LAZY }),
    ]);
    const result = rewritePagemap(input, ANY_RANGE);
    expect(result.changed).toBe(false);
    expect(result.entriesFlagged).toBe(0);
    expect(result.entriesAlreadyLazy).toBe(1);
    expect(result.out.equals(input)).toBe(true);
  });

  it("skips entries without PE_PRESENT (e.g. PE_PARENT-only)", () => {
    // PE_PARENT = 1<<0 = 1; not PE_PRESENT.
    const input = buildPagemap([
      pagemapHead(1),
      pagemapEntry({ vaddr: 0x1000, nr_pages: 1, flags: 1 /* PE_PARENT */ }),
      pagemapEntry({ vaddr: 0x2000, nr_pages: 1, in_parent: true }), // flags omitted entirely
    ]);
    const result = rewritePagemap(input, ANY_RANGE);
    expect(result.changed).toBe(false);
    expect(result.entriesFlagged).toBe(0);
    expect(result.out.equals(input)).toBe(true);
  });

  it("is idempotent — second pass is a no-op", () => {
    const input = buildPagemap([
      pagemapHead(1),
      pagemapEntry({ vaddr: 0x1000, nr_pages: 4, flags: PE_PRESENT }),
    ]);
    const first = rewritePagemap(input, ANY_RANGE);
    expect(first.changed).toBe(true);
    const second = rewritePagemap(first.out, ANY_RANGE);
    expect(second.changed).toBe(false);
    expect(second.entriesAlreadyLazy).toBe(1);
    expect(second.out.equals(first.out)).toBe(true);
  });

  it("preserves the pagemap_head message (first record)", () => {
    const input = buildPagemap([
      pagemapHead(42),
      pagemapEntry({ vaddr: 0x1000, nr_pages: 1, flags: PE_PRESENT }),
    ]);
    const result = rewritePagemap(input, ANY_RANGE);
    const decoded = decodePagemap(result.out);
    expect(decoded.head.equals(pagemapHead(42))).toBe(true);
  });

  it("rejects bad common magic", () => {
    const bad = Buffer.concat([u32le(0xdeadbeef), u32le(PAGEMAP_MAGIC), u32le(0)]);
    expect(() => rewritePagemap(bad)).toThrow(/common magic/);
  });

  it("rejects bad pagemap magic", () => {
    const bad = Buffer.concat([u32le(IMG_COMMON_MAGIC), u32le(0xdeadbeef), u32le(0)]);
    expect(() => rewritePagemap(bad)).toThrow(/pagemap magic/);
  });
});

/** Build a single VmaEntry protobuf body. */
function vmaEntry(opts: { start: number; end: number; status: number }): Buffer {
  return Buffer.concat([
    tag(1, 0),
    varint(opts.start),
    tag(2, 0),
    varint(opts.end),
    tag(7, 0),
    varint(opts.status),
  ]);
}

/** Build an mm-*.img with the given vmas. */
function buildMm(vmas: Buffer[]): Buffer {
  const mmBody: Buffer[] = [];
  for (const v of vmas) {
    mmBody.push(tag(27, 2), varint(v.length), v);
  }
  const body = Buffer.concat(mmBody);
  return Buffer.concat([u32le(IMG_COMMON_MAGIC), u32le(MM_MAGIC), u32le(body.length), body]);
}

describe("parseLazyRangesFromMm", () => {
  it("returns only anon-private VMAs, excluding vdso/vvar/vsyscall", () => {
    const mm = buildMm([
      vmaEntry({ start: 0x10_0000, end: 0x12_0000, status: VMA_ANON_PRIVATE }),
      vmaEntry({ start: 0x20_0000, end: 0x21_0000, status: VMA_FILE_PRIVATE }),
      vmaEntry({
        start: 0x30_0000,
        end: 0x30_4000,
        status: VMA_ANON_PRIVATE | VMA_AREA_VDSO,
      }),
      vmaEntry({
        start: 0x40_0000,
        end: 0x40_4000,
        status: VMA_ANON_PRIVATE | VMA_AREA_VVAR,
      }),
      vmaEntry({ start: 0x50_0000, end: 0x52_0000, status: VMA_ANON_PRIVATE }),
    ]);
    const ranges = parseLazyRangesFromMm(mm);
    expect(ranges).toEqual([
      { lo: 0x10_0000n, hi: 0x12_0000n },
      { lo: 0x50_0000n, hi: 0x52_0000n },
    ]);
  });

  it("rejects bad magic", () => {
    const bad = Buffer.concat([u32le(0xdeadbeef), u32le(MM_MAGIC), u32le(0)]);
    expect(() => parseLazyRangesFromMm(bad)).toThrow(/common magic/);
  });
});

describe("rewritePagemap (range filter)", () => {
  it("only marks entries whose vaddr+len fits in a lazy range", () => {
    const ranges: VmaRange[] = [{ lo: 0x10_0000n, hi: 0x12_0000n }];
    const input = buildPagemap([
      pagemapHead(1),
      // inside range — should flip
      pagemapEntry({ vaddr: 0x10_0000, nr_pages: 1, flags: PE_PRESENT }),
      // outside range — must NOT flip
      pagemapEntry({ vaddr: 0x20_0000, nr_pages: 1, flags: PE_PRESENT }),
      // straddles range end — must NOT flip
      pagemapEntry({ vaddr: 0x11_f000, nr_pages: 4, flags: PE_PRESENT }),
    ]);
    const result = rewritePagemap(input, ranges);
    expect(result.entriesFlagged).toBe(1);
    expect(result.changed).toBe(true);
  });

  it("with no ranges is a complete no-op", () => {
    const input = buildPagemap([
      pagemapHead(1),
      pagemapEntry({ vaddr: 0x1000, nr_pages: 1, flags: PE_PRESENT }),
      pagemapEntry({ vaddr: 0x2000, nr_pages: 1, flags: PE_PRESENT }),
    ]);
    const result = rewritePagemap(input, []);
    expect(result.changed).toBe(false);
    expect(result.entriesFlagged).toBe(0);
    expect(result.out.equals(input)).toBe(true);
  });
});

describe("markPagemapsLazy", () => {
  it("only touches files matching pagemap-<digits>.img and uses mm-<pid> ranges", () => {
    const dir = mkdtempSync(join(tmpdir(), "lazy-pagemap-"));
    try {
      const goodPath = join(dir, "pagemap-42.img");
      const ignorePath = join(dir, "pages-42.img");
      const otherPath = join(dir, "core-42.img");
      const sneakyPath = join(dir, "pagemap-extra.img"); // non-numeric — must skip
      const mmPath = join(dir, "mm-42.img");

      const goodInput = buildPagemap([
        pagemapHead(1),
        pagemapEntry({ vaddr: 0x1000, nr_pages: 1, flags: PE_PRESENT }),
      ]);
      const mmInput = buildMm([vmaEntry({ start: 0x1000, end: 0x2000, status: VMA_ANON_PRIVATE })]);
      const ignoreInput = Buffer.from("not a pagemap, must not be touched");
      const otherInput = Buffer.from("also not a pagemap");
      const sneakyInput = Buffer.from("non-digit suffix — leave alone");

      writeFileSync(goodPath, goodInput);
      writeFileSync(mmPath, mmInput);
      writeFileSync(ignorePath, ignoreInput);
      writeFileSync(otherPath, otherInput);
      writeFileSync(sneakyPath, sneakyInput);

      const result = markPagemapsLazy(dir);
      expect(result.filesRewritten).toBe(1);
      expect(result.entriesFlagged).toBe(1);

      const goodAfter = readFileSync(goodPath);
      expect(goodAfter.equals(goodInput)).toBe(false);
      expect(readFileSync(ignorePath).equals(ignoreInput)).toBe(true);
      expect(readFileSync(otherPath).equals(otherInput)).toBe(true);
      expect(readFileSync(sneakyPath).equals(sneakyInput)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns counts that match what changed across multiple files", () => {
    const dir = mkdtempSync(join(tmpdir(), "lazy-pagemap-multi-"));
    try {
      writeFileSync(
        join(dir, "pagemap-1.img"),
        buildPagemap([
          pagemapHead(1),
          pagemapEntry({ vaddr: 0x1000, nr_pages: 1, flags: PE_PRESENT }),
          pagemapEntry({ vaddr: 0x2000, nr_pages: 1, flags: PE_PRESENT }),
        ]),
      );
      writeFileSync(
        join(dir, "mm-1.img"),
        buildMm([vmaEntry({ start: 0x1000, end: 0x3000, status: VMA_ANON_PRIVATE })]),
      );
      writeFileSync(
        join(dir, "pagemap-2.img"),
        buildPagemap([
          pagemapHead(2),
          pagemapEntry({ vaddr: 0x3000, nr_pages: 1, flags: PE_PRESENT }),
          pagemapEntry({ vaddr: 0x4000, nr_pages: 1, flags: PE_PRESENT | PE_LAZY }),
        ]),
      );
      writeFileSync(
        join(dir, "mm-2.img"),
        buildMm([vmaEntry({ start: 0x3000, end: 0x5000, status: VMA_ANON_PRIVATE })]),
      );
      const result = markPagemapsLazy(dir);
      expect(result.filesRewritten).toBe(2);
      expect(result.entriesFlagged).toBe(3); // 2 from pagemap-1 + 1 from pagemap-2
      expect(result.entriesAlreadyLazy).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("leaves the pagemap untouched when no matching mm-<pid> exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "lazy-pagemap-no-mm-"));
    try {
      const path = join(dir, "pagemap-7.img");
      const input = buildPagemap([
        pagemapHead(1),
        pagemapEntry({ vaddr: 0x1000, nr_pages: 1, flags: PE_PRESENT }),
      ]);
      writeFileSync(path, input);
      const result = markPagemapsLazy(dir);
      expect(result.filesRewritten).toBe(0);
      expect(readFileSync(path).equals(input)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("ignores empty bundle dirs without throwing", () => {
    const dir = mkdtempSync(join(tmpdir(), "lazy-pagemap-empty-"));
    try {
      const result = markPagemapsLazy(dir);
      expect(result.filesRewritten).toBe(0);
      expect(result.entriesFlagged).toBe(0);
      // Sanity: dir is still empty.
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
