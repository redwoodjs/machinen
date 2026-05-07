// Rewrites pagemap-*.img files in a CRIU bundle so every PE_PRESENT
// entry that lives in an anon-private VMA also carries PE_LAZY.
// Without this, `criu restore --lazy-pages` finds no lazy entries
// (because `criu dump` was invoked without `--lazy-pages`), registers
// no UFFD handlers, and loads every page eagerly — defeating #266
// entirely. Marking the dump lazy on the host before it ships makes
// the in-guest lazy-pages daemon actually fault pages on demand from
// the live-mounted bundle.
//
// Why only anon-private and not every PE_PRESENT entry: criu restore
// errors out when asked to register UFFD on a VMA it can't UFFD
// (file-mapped, vdso, vvar, shared, etc.). The selection mirrors
// criu's own `--lazy-pages` dump path — which marks only anon-private
// pages PE_LAZY — so this rewriter produces a bundle equivalent to
// what criu would have written if dump had been invoked with
// `--lazy-pages`.
//
// Wire format (criu/image.c v4.2):
//   pagemap-*.img: u32 IMG_COMMON_MAGIC + u32 PAGEMAP_MAGIC, then a
//     stream of (u32 size) + (size bytes protobuf message). The first
//     message is pagemap_head; the rest are pagemap_entry { vaddr,
//     compat_nr_pages, in_parent, flags, nr_pages }.
//   mm-*.img: u32 IMG_COMMON_MAGIC + u32 MM_MAGIC, then a single
//     (u32 size) + (size bytes) of mm_entry. Field 27 of mm_entry is
//     `repeated VmaEntry vmas`; each vma_entry has start (1), end (2),
//     and status (7) — status carries the VMA_ANON_PRIVATE bit.
//
// PE_PRESENT lives in pagemap_entry field 4 (varint). A regular dump
// emits flags = PE_PRESENT (4); we OR in PE_LAZY (2) → 6. Both fit
// in one byte so the varint length doesn't change in practice, but
// the code handles re-encoding generally.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// criu/image.c v4.2
const IMG_COMMON_MAGIC = 0x54564319;
const PAGEMAP_MAGIC = 0x56084025;
const MM_MAGIC = 0x57492820;

// criu/include/pagemap.h v4.2
const PE_LAZY = 1 << 1;
const PE_PRESENT = 1 << 2;

// criu/include/vma.h v4.2 — bit positions in VmaEntry.status. Only
// VMA_ANON_PRIVATE is lazy-eligible; the rest never qualify (file
// mappings can't be UFFD'd, vdso/vvar are kernel-injected pages we
// must not touch on restore).
const VMA_ANON_PRIVATE = 1 << 4;
const VMA_AREA_VSYSCALL = 1 << 7;
const VMA_AREA_VDSO = 1 << 8;
const VMA_AREA_VVAR = 1 << 11;
const VMA_LAZY_INELIGIBLE = VMA_AREA_VSYSCALL | VMA_AREA_VDSO | VMA_AREA_VVAR;

const PAGEMAP_RE = /^pagemap-(\d+)\.img$/;
const MM_RE = /^mm-(\d+)\.img$/;

export interface MarkPagemapsLazyResult {
  /** Number of pagemap-*.img files modified on disk. */
  filesRewritten: number;
  /** Number of PE_PRESENT entries that gained PE_LAZY. */
  entriesFlagged: number;
  /** Number of PE_PRESENT entries already lazy (skipped). */
  entriesAlreadyLazy: number;
}

/**
 * Walk every `pagemap-<pid>.img` in `imgDir` and OR-in `PE_LAZY` on
 * each `PE_PRESENT` entry whose vaddr falls inside an anon-private VMA
 * (per the matching `mm-<pid>.img`). Idempotent. Throws if a pagemap
 * or mm image is malformed.
 */
export function markPagemapsLazy(imgDir: string): MarkPagemapsLazyResult {
  let filesRewritten = 0;
  let entriesFlagged = 0;
  let entriesAlreadyLazy = 0;

  // Pre-load anon-private VMA ranges keyed by pid. Pagemap entries
  // are matched against the same pid's range list.
  const lazyRangesByPid = new Map<string, VmaRange[]>();
  for (const name of readdirSync(imgDir)) {
    const m = MM_RE.exec(name);
    if (!m) {
      continue;
    }
    const pid = m[1];
    const ranges = parseLazyRangesFromMm(readFileSync(join(imgDir, name)));
    lazyRangesByPid.set(pid, ranges);
  }

  for (const name of readdirSync(imgDir)) {
    const m = PAGEMAP_RE.exec(name);
    if (!m) {
      continue;
    }
    const pid = m[1];
    const ranges = lazyRangesByPid.get(pid) ?? [];
    const path = join(imgDir, name);
    const input = readFileSync(path);
    const result = rewritePagemap(input, ranges);
    entriesAlreadyLazy += result.entriesAlreadyLazy;
    if (result.changed) {
      writeFileSync(path, result.out);
      filesRewritten++;
      entriesFlagged += result.entriesFlagged;
    }
  }

  return { filesRewritten, entriesFlagged, entriesAlreadyLazy };
}

/** A half-open vaddr range [lo, hi) covered by an anon-private VMA. */
export interface VmaRange {
  lo: bigint;
  hi: bigint;
}

/**
 * Parse `mm-<pid>.img` and return the ranges of anon-private VMAs
 * eligible for lazy restore. Exported for tests.
 */
export function parseLazyRangesFromMm(input: Buffer): VmaRange[] {
  if (input.length < 8) {
    throw new Error("mm: file too short for magic header");
  }
  if (input.readUInt32LE(0) !== IMG_COMMON_MAGIC) {
    throw new Error(`mm: bad common magic 0x${input.readUInt32LE(0).toString(16)}`);
  }
  if (input.readUInt32LE(4) !== MM_MAGIC) {
    throw new Error(`mm: bad mm magic 0x${input.readUInt32LE(4).toString(16)}`);
  }
  if (input.length < 12) {
    throw new Error("mm: missing message size prefix");
  }
  const size = input.readUInt32LE(8);
  if (12 + size > input.length) {
    throw new Error("mm: truncated mm_entry");
  }
  const body = input.subarray(12, 12 + size);

  // mm_entry walk — we only care about field 27 (repeated VmaEntry vmas).
  const ranges: VmaRange[] = [];
  let pos = 0;
  while (pos < body.length) {
    const t = readVarint(body, pos);
    const wireType = Number(t.value & 0x7n);
    const field = Number(t.value >> 3n);
    pos = t.next;
    if (field === 27 && wireType === 2) {
      const len = readVarint(body, pos);
      pos = len.next;
      const vmaBytes = body.subarray(pos, pos + Number(len.value));
      pos += Number(len.value);
      const vma = parseVmaEntry(vmaBytes);
      if (
        vma.status !== null &&
        (vma.status & VMA_ANON_PRIVATE) !== 0 &&
        (vma.status & VMA_LAZY_INELIGIBLE) === 0 &&
        vma.start !== null &&
        vma.end !== null
      ) {
        ranges.push({ lo: vma.start, hi: vma.end });
      }
    } else {
      pos = skipField(body, pos, wireType);
    }
  }
  return ranges;
}

interface ParsedVma {
  start: bigint | null;
  end: bigint | null;
  status: number | null;
}

function parseVmaEntry(buf: Buffer): ParsedVma {
  let pos = 0;
  let start: bigint | null = null;
  let end: bigint | null = null;
  let status: number | null = null;
  while (pos < buf.length) {
    const t = readVarint(buf, pos);
    const wireType = Number(t.value & 0x7n);
    const field = Number(t.value >> 3n);
    pos = t.next;
    if (wireType === 0) {
      const v = readVarint(buf, pos);
      if (field === 1) {
        start = v.value;
      } else if (field === 2) {
        end = v.value;
      } else if (field === 7) {
        status = Number(v.value);
      }
      pos = v.next;
    } else {
      pos = skipField(buf, pos, wireType);
    }
  }
  return { start, end, status };
}

function vaddrInLazyRange(vaddr: bigint, len: bigint, ranges: VmaRange[]): boolean {
  // Linear scan — VMA counts are small (dozens to low hundreds), and
  // pagemap entry counts are bounded by present anon pages. A binary
  // search would shave microseconds for outliers; the simple loop
  // here costs nothing on real bundles.
  const hi = vaddr + len;
  for (const r of ranges) {
    if (vaddr >= r.lo && hi <= r.hi) {
      return true;
    }
  }
  return false;
}

interface RewriteResult {
  out: Buffer;
  changed: boolean;
  entriesFlagged: number;
  entriesAlreadyLazy: number;
}

/**
 * Pure function on the in-memory bytes. `lazyRanges` constrains which
 * entries are eligible — only those whose `[vaddr, vaddr + nr_pages*4096)`
 * fits inside one of the ranges get PE_LAZY OR'd in. Pass an empty
 * array to leave the pagemap untouched. Exported for tests.
 */
export function rewritePagemap(input: Buffer, lazyRanges: VmaRange[] = []): RewriteResult {
  if (input.length < 8) {
    throw new Error("pagemap: file too short for magic header");
  }
  if (input.readUInt32LE(0) !== IMG_COMMON_MAGIC) {
    throw new Error(`pagemap: bad common magic 0x${input.readUInt32LE(0).toString(16)}`);
  }
  if (input.readUInt32LE(4) !== PAGEMAP_MAGIC) {
    throw new Error(`pagemap: bad pagemap magic 0x${input.readUInt32LE(4).toString(16)}`);
  }

  const out: Buffer[] = [input.subarray(0, 8)];
  let pos = 8;
  let entriesFlagged = 0;
  let entriesAlreadyLazy = 0;
  let changed = false;
  let isFirstMessage = true;

  while (pos < input.length) {
    if (pos + 4 > input.length) {
      throw new Error("pagemap: truncated size prefix");
    }
    const size = input.readUInt32LE(pos);
    pos += 4;
    if (pos + size > input.length) {
      throw new Error("pagemap: truncated message body");
    }
    const msg = input.subarray(pos, pos + size);
    pos += size;

    let outMsg: Buffer = msg;
    if (!isFirstMessage) {
      const result = rewriteEntry(msg, lazyRanges);
      if (result.alreadyLazy) {
        entriesAlreadyLazy++;
      }
      if (result.changed) {
        outMsg = result.out;
        entriesFlagged++;
        changed = true;
      }
    }
    isFirstMessage = false;

    const sizeBuf = Buffer.alloc(4);
    sizeBuf.writeUInt32LE(outMsg.length, 0);
    out.push(sizeBuf, outMsg);
  }

  return { out: Buffer.concat(out), changed, entriesFlagged, entriesAlreadyLazy };
}

interface EntryRewriteResult {
  out: Buffer;
  changed: boolean;
  alreadyLazy: boolean;
}

function rewriteEntry(msg: Buffer, lazyRanges: VmaRange[]): EntryRewriteResult {
  // Walk the entry's protobuf fields. We need: vaddr (1), nr_pages (5),
  // compat_nr_pages (2) as fallback, flags (4). nr_pages * 4096 sets
  // the byte length of this entry's range.
  let pos = 0;
  let flagsValPos = -1;
  let flagsValLen = 0;
  let flags = 0;
  let vaddr: bigint | null = null;
  let nrPages: bigint | null = null;
  let compatNrPages: bigint | null = null;

  while (pos < msg.length) {
    const t = readVarint(msg, pos);
    const wireType = Number(t.value & 0x7n);
    const field = Number(t.value >> 3n);
    pos = t.next;

    if (wireType !== 0) {
      pos = skipField(msg, pos, wireType);
      continue;
    }
    const fStart = pos;
    const v = readVarint(msg, pos);
    pos = v.next;
    if (field === 1) {
      vaddr = v.value;
    } else if (field === 2) {
      compatNrPages = v.value;
    } else if (field === 4) {
      flagsValPos = fStart;
      flagsValLen = v.next - fStart;
      flags = Number(v.value);
    } else if (field === 5) {
      nrPages = v.value;
    }
  }

  const isPresent = (flags & PE_PRESENT) !== 0;
  const isLazy = (flags & PE_LAZY) !== 0;
  if (!isPresent) {
    return { out: msg, changed: false, alreadyLazy: false };
  }
  if (isLazy) {
    return { out: msg, changed: false, alreadyLazy: true };
  }
  if (vaddr === null) {
    return { out: msg, changed: false, alreadyLazy: false };
  }
  const pages = nrPages ?? compatNrPages ?? 0n;
  const len = pages * 4096n;
  if (lazyRanges.length === 0 || !vaddrInLazyRange(vaddr, len, lazyRanges)) {
    return { out: msg, changed: false, alreadyLazy: false };
  }

  const newFlags = flags | PE_LAZY;
  const newFlagsBytes = Buffer.from(encodeVarint(newFlags));
  const out = Buffer.concat([
    msg.subarray(0, flagsValPos),
    newFlagsBytes,
    msg.subarray(flagsValPos + flagsValLen),
  ]);
  return { out, changed: true, alreadyLazy: false };
}

function readVarint(buf: Buffer, pos: number): { value: bigint; next: number } {
  let result = 0n;
  let shift = 0n;
  let p = pos;
  while (true) {
    if (p >= buf.length) {
      throw new Error("varint: truncated");
    }
    const b = buf[p++];
    result |= BigInt(b & 0x7f) << shift;
    if ((b & 0x80) === 0) {
      return { value: result, next: p };
    }
    shift += 7n;
    if (shift > 63n) {
      throw new Error("varint: overflow (>10 bytes)");
    }
  }
}

function encodeVarint(value: number): number[] {
  if (value < 0) {
    throw new Error("varint: negative not supported here");
  }
  const out: number[] = [];
  let v = value;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v = v >>> 7;
  }
  out.push(v & 0x7f);
  return out;
}

function skipField(buf: Buffer, pos: number, wireType: number): number {
  switch (wireType) {
    case 0: {
      const v = readVarint(buf, pos);
      return v.next;
    }
    case 1:
      return pos + 8;
    case 2: {
      const len = readVarint(buf, pos);
      return len.next + Number(len.value);
    }
    case 5:
      return pos + 4;
    default:
      throw new Error(`protobuf: unsupported wire type ${wireType}`);
  }
}
