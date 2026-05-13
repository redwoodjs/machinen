// Round-trip tests for FUSE struct codecs.
//
// We can't verify against a live kernel from a unit test — that's the
// smoke-test's job. What we can verify cheaply: the byte offsets
// round-trip (write then read returns the same struct), sizes match
// the Linux v6.1 uapi/linux/fuse.h definitions, and numeric constants
// match the kernel.

import { describe, expect, it } from "vitest";
import {
  DT,
  F_LCK,
  FUSE_ATTR_OUT_SIZE,
  FUSE_ATTR_SIZE,
  FUSE_CAP,
  FUSE_ENTRY_OUT_SIZE,
  FUSE_FILE_LOCK_SIZE,
  FUSE_INIT_OUT_SIZE,
  FUSE_IN_HEADER_SIZE,
  FUSE_KERNEL_MINOR_VERSION,
  FUSE_KERNEL_VERSION,
  FUSE_LK_IN_SIZE,
  FUSE_LK_OUT_SIZE,
  FUSE_OP,
  FUSE_OUT_HEADER_SIZE,
  buildAttrOut,
  buildDirent,
  buildEntryOut,
  buildErrorResponse,
  buildInitOut,
  buildLkOut,
  buildOpenOut,
  buildResponse,
  payloadOf,
  readAttr,
  readBatchForgetIn,
  readForgetIn,
  readGetattrIn,
  readInHeader,
  readInitIn,
  readLkIn,
  readOpenIn,
  readReadIn,
  readReleaseIn,
  writeAttr,
  writeOutHeader,
} from "../mount-fuse-protocol.ts";

describe("FUSE protocol — struct sizes", () => {
  it("fuse_in_header is 40 bytes", () => {
    expect(FUSE_IN_HEADER_SIZE).toBe(40);
  });

  it("fuse_out_header is 16 bytes", () => {
    expect(FUSE_OUT_HEADER_SIZE).toBe(16);
  });

  it("fuse_attr is 88 bytes", () => {
    expect(FUSE_ATTR_SIZE).toBe(88);
  });

  it("fuse_entry_out is 128 bytes", () => {
    expect(FUSE_ENTRY_OUT_SIZE).toBe(128);
  });

  it("fuse_attr_out is 104 bytes", () => {
    expect(FUSE_ATTR_OUT_SIZE).toBe(104);
  });

  it("fuse_init_out is 64 bytes", () => {
    expect(FUSE_INIT_OUT_SIZE).toBe(64);
  });
});

describe("FUSE protocol — opcodes match Linux 6.1", () => {
  it.each([
    ["LOOKUP", 1],
    ["FORGET", 2],
    ["GETATTR", 3],
    ["OPEN", 14],
    ["READ", 15],
    ["WRITE", 16],
    ["STATFS", 17],
    ["RELEASE", 18],
    ["INIT", 26],
    ["OPENDIR", 27],
    ["READDIR", 28],
    ["RELEASEDIR", 29],
    ["GETLK", 31],
    ["SETLK", 32],
    ["SETLKW", 33],
    ["DESTROY", 38],
    ["BATCH_FORGET", 42],
    ["READDIRPLUS", 44],
  ])("%s = %d", (name, value) => {
    expect(FUSE_OP[name as keyof typeof FUSE_OP]).toBe(value);
  });
});

describe("FUSE protocol — POSIX lock constants and codecs (#322)", () => {
  it("F_LCK type values match Linux fcntl.h", () => {
    expect(F_LCK.RDLCK).toBe(0);
    expect(F_LCK.WRLCK).toBe(1);
    expect(F_LCK.UNLCK).toBe(2);
  });

  it("fuse_file_lock is 24 bytes", () => {
    expect(FUSE_FILE_LOCK_SIZE).toBe(24);
  });

  it("fuse_lk_in is 48 bytes", () => {
    expect(FUSE_LK_IN_SIZE).toBe(48);
  });

  it("fuse_lk_out is 24 bytes (just the embedded fuse_file_lock)", () => {
    expect(FUSE_LK_OUT_SIZE).toBe(24);
  });

  it("readLkIn round-trips a synthetic struct", () => {
    // Hand-pack a fuse_lk_in: fh=0x1122..., owner=0xaaaa..., lk{
    //   start=100, end=200, type=WRLCK, pid=4242 }, lk_flags=0.
    const buf = new Uint8Array(FUSE_LK_IN_SIZE);
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(0, 0x1122334455667788n, true); // fh
    dv.setBigUint64(8, 0xaaaabbbbccccddddn, true); // owner
    dv.setBigUint64(16, 100n, true); // lk.start
    dv.setBigUint64(24, 200n, true); // lk.end
    dv.setUint32(32, F_LCK.WRLCK, true); // lk.type
    dv.setUint32(36, 4242, true); // lk.pid
    dv.setUint32(40, 0, true); // lk_flags
    const got = readLkIn(buf);
    expect(got.fh).toBe(0x1122334455667788n);
    expect(got.owner).toBe(0xaaaabbbbccccddddn);
    expect(got.lk.start).toBe(100n);
    expect(got.lk.end).toBe(200n);
    expect(got.lk.type).toBe(F_LCK.WRLCK);
    expect(got.lk.pid).toBe(4242);
    expect(got.lk_flags).toBe(0);
  });

  it("buildLkOut writes the embedded fuse_file_lock at offset 0", () => {
    const out = buildLkOut({ start: 0n, end: 0xffffffffffffffffn, type: F_LCK.UNLCK, pid: 0 });
    expect(out.length).toBe(FUSE_LK_OUT_SIZE);
    const dv = new DataView(out.buffer);
    expect(dv.getBigUint64(0, true)).toBe(0n);
    expect(dv.getBigUint64(8, true)).toBe(0xffffffffffffffffn);
    expect(dv.getUint32(16, true)).toBe(F_LCK.UNLCK);
    expect(dv.getUint32(20, true)).toBe(0);
  });
});

describe("FUSE protocol — capability flags", () => {
  it.each([
    ["ASYNC_READ", 1 << 0],
    ["POSIX_LOCKS", 1 << 1],
    ["BIG_WRITES", 1 << 5],
    ["DO_READDIRPLUS", 1 << 13],
    ["MAX_PAGES", 1 << 22],
  ])("%s = 0x%x", (name, value) => {
    expect(FUSE_CAP[name as keyof typeof FUSE_CAP]).toBe(value);
  });
});

describe("FUSE protocol — version constants", () => {
  it("target 7.31", () => {
    expect(FUSE_KERNEL_VERSION).toBe(7);
    expect(FUSE_KERNEL_MINOR_VERSION).toBe(31);
  });
});

describe("FUSE protocol — in_header codec", () => {
  it("reads a synthetic header back", () => {
    const buf = new Uint8Array(FUSE_IN_HEADER_SIZE);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 40 + 16, true); // len
    dv.setUint32(4, FUSE_OP.GETATTR, true); // opcode
    dv.setBigUint64(8, 0x123456789abcdef0n, true); // unique
    dv.setBigUint64(16, 42n, true); // nodeid
    dv.setUint32(24, 1000, true); // uid
    dv.setUint32(28, 1000, true); // gid
    dv.setUint32(32, 99, true); // pid
    const h = readInHeader(buf);
    expect(h).toEqual({
      len: 56,
      opcode: FUSE_OP.GETATTR,
      unique: 0x123456789abcdef0n,
      nodeid: 42n,
      uid: 1000,
      gid: 1000,
      pid: 99,
    });
  });

  it("throws on truncated header", () => {
    expect(() => readInHeader(new Uint8Array(10))).toThrow(/underflow/);
  });
});

describe("FUSE protocol — out_header + response builders", () => {
  it("buildErrorResponse is exactly a 16-byte header", () => {
    const r = buildErrorResponse(7n, -2);
    expect(r).toHaveLength(16);
    const dv = new DataView(r.buffer);
    expect(dv.getUint32(0, true)).toBe(16);
    expect(dv.getInt32(4, true)).toBe(-2);
    expect(dv.getBigUint64(8, true)).toBe(7n);
  });

  it("buildResponse concatenates header + payload", () => {
    const payload = new Uint8Array([1, 2, 3, 4]);
    const r = buildResponse(42n, payload);
    expect(r).toHaveLength(20);
    const dv = new DataView(r.buffer);
    expect(dv.getUint32(0, true)).toBe(20);
    expect(dv.getInt32(4, true)).toBe(0);
    expect(dv.getBigUint64(8, true)).toBe(42n);
    expect(r.slice(16)).toEqual(payload);
  });

  it("writeOutHeader writes at arbitrary offsets", () => {
    const buf = new Uint8Array(100);
    writeOutHeader(buf, 20, 8, -5, 99n);
    const dv = new DataView(buf.buffer);
    expect(dv.getUint32(20, true)).toBe(24);
    expect(dv.getInt32(24, true)).toBe(-5);
    expect(dv.getBigUint64(28, true)).toBe(99n);
  });
});

describe("FUSE protocol — attr codec", () => {
  it("round-trips every field", () => {
    const a = {
      ino: 1234n,
      size: 9001n,
      blocks: 18n,
      atime: 1_700_000_000n,
      mtime: 1_700_000_100n,
      ctime: 1_700_000_200n,
      atimensec: 111,
      mtimensec: 222,
      ctimensec: 333,
      mode: 0o100644,
      nlink: 1,
      uid: 501,
      gid: 20,
      rdev: 0,
      blksize: 4096,
      flags: 0,
    };
    const buf = new Uint8Array(FUSE_ATTR_SIZE);
    writeAttr(buf, 0, a);
    expect(readAttr(buf)).toEqual(a);
  });
});

describe("FUSE protocol — entry/attr/open replies", () => {
  it("buildEntryOut: 128 bytes, writes nodeid + attrs", () => {
    const e = buildEntryOut({
      nodeid: 7n,
      generation: 0n,
      entry_valid: 1n,
      attr_valid: 1n,
      entry_valid_nsec: 0,
      attr_valid_nsec: 0,
      attr: zeroAttr(7n),
    });
    expect(e).toHaveLength(FUSE_ENTRY_OUT_SIZE);
    expect(new DataView(e.buffer).getBigUint64(0, true)).toBe(7n);
    expect(readAttr(e, 40).ino).toBe(7n);
  });

  it("buildAttrOut: 104 bytes, attrs at offset 16", () => {
    const a = buildAttrOut({
      attr_valid: 1n,
      attr_valid_nsec: 0,
      attr: zeroAttr(5n),
    });
    expect(a).toHaveLength(FUSE_ATTR_OUT_SIZE);
    expect(readAttr(a, 16).ino).toBe(5n);
  });

  it("buildOpenOut: fh + open_flags at expected offsets", () => {
    const o = buildOpenOut({ fh: 0xdeadbeefn, open_flags: 7 });
    expect(o).toHaveLength(16);
    const dv = new DataView(o.buffer);
    expect(dv.getBigUint64(0, true)).toBe(0xdeadbeefn);
    expect(dv.getUint32(8, true)).toBe(7);
  });
});

describe("FUSE protocol — INIT codec", () => {
  it("reads a full init_in", () => {
    const buf = new Uint8Array(64);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 7, true);
    dv.setUint32(4, 31, true);
    dv.setUint32(8, 131072, true);
    dv.setUint32(12, FUSE_CAP.ASYNC_READ | FUSE_CAP.MAX_PAGES, true);
    dv.setUint32(16, 0, true);
    expect(readInitIn(buf)).toEqual({
      major: 7,
      minor: 31,
      max_readahead: 131072,
      flags: FUSE_CAP.ASYNC_READ | FUSE_CAP.MAX_PAGES,
      flags2: 0,
    });
  });

  it("handles a pre-7.23 short init_in (only major/minor)", () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setUint32(0, 7, true);
    new DataView(buf.buffer).setUint32(4, 22, true);
    const i = readInitIn(buf);
    expect(i.major).toBe(7);
    expect(i.minor).toBe(22);
    expect(i.flags).toBe(0);
  });

  it("buildInitOut serializes all fields", () => {
    const out = buildInitOut({
      major: 7,
      minor: 31,
      max_readahead: 131072,
      flags: FUSE_CAP.BIG_WRITES,
      max_background: 12,
      congestion_threshold: 9,
      max_write: 131072,
      time_gran: 1,
      max_pages: 256,
      map_alignment: 0,
      flags2: 0,
    });
    expect(out).toHaveLength(FUSE_INIT_OUT_SIZE);
    const dv = new DataView(out.buffer);
    expect(dv.getUint32(0, true)).toBe(7);
    expect(dv.getUint32(4, true)).toBe(31);
    expect(dv.getUint32(8, true)).toBe(131072);
    expect(dv.getUint32(12, true)).toBe(FUSE_CAP.BIG_WRITES);
    expect(dv.getUint16(16, true)).toBe(12);
    expect(dv.getUint16(18, true)).toBe(9);
    expect(dv.getUint32(20, true)).toBe(131072);
    expect(dv.getUint16(28, true)).toBe(256);
  });
});

describe("FUSE protocol — small request codecs", () => {
  it("readGetattrIn", () => {
    const buf = new Uint8Array(16);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 1, true); // getattr_flags
    dv.setBigUint64(8, 7n, true); // fh
    expect(readGetattrIn(buf)).toEqual({ getattr_flags: 1, fh: 7n });
  });

  it("readForgetIn", () => {
    const buf = new Uint8Array(8);
    new DataView(buf.buffer).setBigUint64(0, 999n, true);
    expect(readForgetIn(buf)).toEqual({ nlookup: 999n });
  });

  it("readBatchForgetIn walks entry array", () => {
    const buf = new Uint8Array(8 + 16 * 2);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 2, true); // count
    dv.setBigUint64(8, 10n, true); // entries[0].nodeid
    dv.setBigUint64(16, 3n, true); // entries[0].nlookup
    dv.setBigUint64(24, 11n, true);
    dv.setBigUint64(32, 4n, true);
    expect(readBatchForgetIn(buf)).toEqual({
      count: 2,
      entries: [
        { nodeid: 10n, nlookup: 3n },
        { nodeid: 11n, nlookup: 4n },
      ],
    });
  });

  it("readOpenIn", () => {
    const buf = new Uint8Array(8);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0o2, true); // flags (O_RDWR)
    dv.setUint32(4, 0, true); // open_flags
    expect(readOpenIn(buf)).toEqual({ flags: 2, open_flags: 0 });
  });

  it("readReadIn", () => {
    const buf = new Uint8Array(40);
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(0, 17n, true); // fh
    dv.setBigUint64(8, 1024n, true); // offset
    dv.setUint32(16, 4096, true); // size
    dv.setUint32(20, 0, true); // read_flags
    dv.setBigUint64(24, 0n, true); // lock_owner
    dv.setUint32(32, 0, true); // flags
    expect(readReadIn(buf)).toEqual({
      fh: 17n,
      offset: 1024n,
      size: 4096,
      read_flags: 0,
      lock_owner: 0n,
      flags: 0,
    });
  });

  it("readReleaseIn", () => {
    const buf = new Uint8Array(24);
    const dv = new DataView(buf.buffer);
    dv.setBigUint64(0, 17n, true); // fh
    dv.setUint32(8, 0, true); // flags
    dv.setUint32(12, 0, true); // release_flags
    dv.setBigUint64(16, 0n, true); // lock_owner
    expect(readReleaseIn(buf)).toEqual({
      fh: 17n,
      flags: 0,
      release_flags: 0,
      lock_owner: 0n,
    });
  });
});

describe("FUSE protocol — dirent packing", () => {
  it("3-byte name padded to 8-byte boundary", () => {
    const d = buildDirent({ ino: 7n, off: 1n, type: DT.REG, name: "abc" });
    expect(d).toHaveLength(24 + 8);
    const dv = new DataView(d.buffer);
    expect(dv.getBigUint64(0, true)).toBe(7n);
    expect(dv.getBigUint64(8, true)).toBe(1n);
    expect(dv.getUint32(16, true)).toBe(3); // namelen
    expect(dv.getUint32(20, true)).toBe(DT.REG);
    expect(d.slice(24, 27)).toEqual(new TextEncoder().encode("abc"));
    // trailing bytes within padding zero
    expect(Array.from(d.slice(27, 32))).toEqual([0, 0, 0, 0, 0]);
  });

  it("8-byte name: no padding added", () => {
    const d = buildDirent({ ino: 1n, off: 2n, type: DT.DIR, name: "12345678" });
    expect(d).toHaveLength(24 + 8);
  });

  it("unicode name encodes as UTF-8", () => {
    const d = buildDirent({ ino: 1n, off: 2n, type: DT.REG, name: "café" });
    const nameBytes = new TextEncoder().encode("café");
    expect(nameBytes).toHaveLength(5);
    const dv = new DataView(d.buffer);
    expect(dv.getUint32(16, true)).toBe(5);
    expect(d.slice(24, 29)).toEqual(nameBytes);
    expect(d).toHaveLength(24 + 8);
  });
});

describe("FUSE protocol — payloadOf", () => {
  it("returns bytes after the header", () => {
    const msg = new Uint8Array(FUSE_IN_HEADER_SIZE + 4);
    msg.set([1, 2, 3, 4], FUSE_IN_HEADER_SIZE);
    expect(Array.from(payloadOf(msg))).toEqual([1, 2, 3, 4]);
  });

  it("throws on truncated message", () => {
    expect(() => payloadOf(new Uint8Array(10))).toThrow(/too short/);
  });
});

function zeroAttr(ino: bigint) {
  return {
    ino,
    size: 0n,
    blocks: 0n,
    atime: 0n,
    mtime: 0n,
    ctime: 0n,
    atimensec: 0,
    mtimensec: 0,
    ctimensec: 0,
    mode: 0o100644,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: 0,
    blksize: 4096,
    flags: 0,
  };
}
