// End-to-end tests for the live-share mount server against a real
// filesystem fixture. We don't spin up a VM here — instead we drive
// the server through a Unix socket pair, sending synthetic FUSE
// requests and asserting the response bytes parse back to the
// expected struct.
//
// This is the closest we get to verifying the protocol without a
// guest kernel in the loop. The guest smoke test (follow-up commit)
// exercises the actual mount → read path.

import { connect as netConnect } from "node:net";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FUSE_IN_HEADER_SIZE,
  FUSE_KERNEL_MINOR_VERSION,
  FUSE_KERNEL_VERSION,
  FUSE_OP,
  readAttr,
} from "../mount-fuse-protocol.ts";
import { type LiveMountServerHandle, serveLiveMount } from "../mount-server.ts";

// Two directories per test:
//   scratch/
//     root/        <- mounted
//       hello.txt   ("world\n")
//       sub/
//         nested.txt ("deep")
//       link-inside -> sub
//       link-outside -> ../outside
//     outside/
//       secret.txt ("nope")

let scratch: string;
let root: string;
let udsPath: string;
let handle: LiveMountServerHandle | undefined;

beforeEach(async () => {
  scratch = mkdtempSync(join(tmpdir(), "machinen-mount-server-"));
  root = join(scratch, "root");
  const outside = join(scratch, "outside");
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(join(root, "hello.txt"), "world\n");
  mkdirSync(join(root, "sub"));
  writeFileSync(join(root, "sub/nested.txt"), "deep");
  writeFileSync(join(outside, "secret.txt"), "nope");
  symlinkSync("sub", join(root, "link-inside"));
  symlinkSync(join(scratch, "outside"), join(root, "link-outside"));
  udsPath = join(scratch, "fuse.sock");
  // Default fixture is :ro — most tests in this file probe read paths
  // or assert EROFS on mutations. The :rw write-through block below
  // builds its own server.
  handle = await serveLiveMount(udsPath, { rootAbs: root, mode: "ro" });
});

afterEach(async () => {
  await handle?.stop();
  handle = undefined;
  rmSync(scratch, { recursive: true, force: true });
});

describe("live mount server — FUSE_INIT handshake", () => {
  it("negotiates 7.31 down from a newer kernel advertisement", async () => {
    await withConnection(async (conn) => {
      const reply = await conn.request(FUSE_OP.INIT, {
        unique: 1n,
        nodeid: 0n,
        payload: buildInitIn({ major: 7, minor: 37, flags: 0 }),
      });
      expect(reply.header.error).toBe(0);
      const dv = new DataView(reply.payload.buffer, reply.payload.byteOffset, reply.payload.length);
      expect(dv.getUint32(0, true)).toBe(FUSE_KERNEL_VERSION);
      expect(dv.getUint32(4, true)).toBe(FUSE_KERNEL_MINOR_VERSION);
    });
  });

  it("negotiates down to the kernel's minor when the kernel is older", async () => {
    await withConnection(async (conn) => {
      const reply = await conn.request(FUSE_OP.INIT, {
        unique: 1n,
        nodeid: 0n,
        payload: buildInitIn({ major: 7, minor: 23, flags: 0 }),
      });
      const dv = new DataView(reply.payload.buffer, reply.payload.byteOffset, reply.payload.length);
      expect(dv.getUint32(4, true)).toBe(23);
    });
  });
});

describe("live mount server — LOOKUP / GETATTR", () => {
  it("looks up a file under root and returns regular-file mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      expect(reply.header.error).toBe(0);
      // payload is fuse_entry_out: 40 bytes header + 88-byte attr
      expect(reply.payload.length).toBe(128);
      const attr = readAttr(reply.payload, 40);
      expect(attr.size).toBe(6n); // "world\n"
      expect(attr.mode & 0o170000).toBe(0o100000); // S_IFREG
    });
  });

  it("looks up a subdirectory and returns dir mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("sub"),
      });
      expect(reply.header.error).toBe(0);
      const attr = readAttr(reply.payload, 40);
      expect(attr.mode & 0o170000).toBe(0o040000); // S_IFDIR
    });
  });

  it("returns ENOENT for a missing name", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("does-not-exist"),
      });
      expect(reply.header.error).toBe(-2); // -ENOENT
      expect(reply.payload.length).toBe(0);
    });
  });

  it("returns ENOENT for a symlink that escapes the mount root", async () => {
    // Critical security assertion: the guest cannot distinguish a
    // successful escape from a missing file. MountError maps to ENOENT.
    await withConnection(async (conn) => {
      await doInit(conn);
      // LOOKUP the escape-link directory — lstat of the link itself
      // succeeds (it's a link), so this might return. But reading
      // *through* the link is where the resolver trips.
      const linkReply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("link-outside"),
      });
      // `lstat` of the symlink node itself is inside root — this
      // resolves to the link's own inode. But following into it
      // escapes, so a subsequent read/lookup beyond it must ENOENT.
      // (The LOOKUP here succeeds because we never deref the target.)
      expect(linkReply.header.error).toBe(0);

      // Now try to read via the link — ENOENT.
      const deep = await conn.request(FUSE_OP.LOOKUP, {
        unique: 3n,
        nodeid: bigintFromEntry(linkReply.payload),
        payload: nameBuf("secret.txt"),
      });
      expect(deep.header.error).toBe(-2);
    });
  });

  it("GETATTR on root nodeid=1 returns dir mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.GETATTR, {
        unique: 2n,
        nodeid: 1n,
        payload: new Uint8Array(16), // fuse_getattr_in is all zeros
      });
      expect(reply.header.error).toBe(0);
      expect(reply.payload.length).toBe(104);
      const attr = readAttr(reply.payload, 16);
      expect(attr.mode & 0o170000).toBe(0o040000);
    });
  });
});

describe("live mount server — OPEN / READ / RELEASE", () => {
  it("reads a file end-to-end", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      const fileIno = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: fileIno,
        payload: u32u32(0, 0), // flags=O_RDONLY, open_flags=0
      });
      expect(open.header.error).toBe(0);
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);

      const read = await conn.request(FUSE_OP.READ, {
        unique: 4n,
        nodeid: fileIno,
        payload: buildReadIn({ fh, offset: 0n, size: 64 }),
      });
      expect(read.header.error).toBe(0);
      expect(new TextDecoder().decode(read.payload)).toBe("world\n");

      const rel = await conn.request(FUSE_OP.RELEASE, {
        unique: 5n,
        nodeid: fileIno,
        payload: buildReleaseIn({ fh }),
      });
      expect(rel.header.error).toBe(0);
    });
  });

  it("rejects OPEN with O_WRONLY in RO mode (EROFS)", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      const fileIno = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: fileIno,
        payload: u32u32(1, 0), // O_WRONLY
      });
      expect(open.header.error).toBe(-30); // -EROFS
    });
  });

  it("counts bytes served from pages-*.img toward the lazy-pages metric (#274)", async () => {
    // Drop a CRIU-shaped pages file into the mount root and read it.
    // Bytes served on pages-*.img count; bytes from any other file
    // don't.
    writeFileSync(join(root, "pages-1234.img"), Buffer.alloc(8192, 0xab));

    expect(handle!.bytesServedOnPagesImg()).toBe(0);

    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("pages-1234.img"),
      });
      const ino = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: ino,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const read = await conn.request(FUSE_OP.READ, {
        unique: 4n,
        nodeid: ino,
        payload: buildReadIn({ fh, offset: 0n, size: 4096 }),
      });
      expect(read.header.error).toBe(0);
      expect(read.payload.length).toBe(4096);
      expect(handle!.bytesServedOnPagesImg()).toBe(4096);

      // Reads from a non-pages file shouldn't bump the counter.
      const helloLookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 5n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      const helloIno = bigintFromEntry(helloLookup.payload);
      const helloOpen = await conn.request(FUSE_OP.OPEN, {
        unique: 6n,
        nodeid: helloIno,
        payload: u32u32(0, 0),
      });
      const helloFh = new DataView(
        helloOpen.payload.buffer,
        helloOpen.payload.byteOffset,
        helloOpen.payload.length,
      ).getBigUint64(0, true);
      await conn.request(FUSE_OP.READ, {
        unique: 7n,
        nodeid: helloIno,
        payload: buildReadIn({ fh: helloFh, offset: 0n, size: 64 }),
      });
      expect(handle!.bytesServedOnPagesImg()).toBe(4096);
    });
  });

  it("READ at offset past EOF returns zero bytes", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      const fileIno = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: fileIno,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const read = await conn.request(FUSE_OP.READ, {
        unique: 4n,
        nodeid: fileIno,
        payload: buildReadIn({ fh, offset: 1000n, size: 64 }),
      });
      expect(read.header.error).toBe(0);
      expect(read.payload.length).toBe(0);
    });
  });
});

describe("live mount server — OPENDIR / READDIR / RELEASEDIR", () => {
  it("lists root contents", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const open = await conn.request(FUSE_OP.OPENDIR, {
        unique: 2n,
        nodeid: 1n,
        payload: u32u32(0, 0),
      });
      expect(open.header.error).toBe(0);
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const read = await conn.request(FUSE_OP.READDIR, {
        unique: 3n,
        nodeid: 1n,
        payload: buildReadIn({ fh, offset: 0n, size: 4096 }),
      });
      expect(read.header.error).toBe(0);
      const names = parseDirentNames(read.payload);
      // Fixture contains: hello.txt, sub, link-inside, link-outside
      expect(new Set(names)).toEqual(new Set(["hello.txt", "sub", "link-inside", "link-outside"]));
      const rel = await conn.request(FUSE_OP.RELEASEDIR, {
        unique: 4n,
        nodeid: 1n,
        payload: buildReleaseIn({ fh }),
      });
      expect(rel.header.error).toBe(0);
    });
  });

  it("READDIR respects the size limit and resumes on the next offset", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const open = await conn.request(FUSE_OP.OPENDIR, {
        unique: 2n,
        nodeid: 1n,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      // First call: tiny size, only fits one entry.
      const firstSize = 40; // 24-byte dirent + up to 16 bytes of name+pad
      const read1 = await conn.request(FUSE_OP.READDIR, {
        unique: 3n,
        nodeid: 1n,
        payload: buildReadIn({ fh, offset: 0n, size: firstSize }),
      });
      expect(read1.header.error).toBe(0);
      const firstBatch = parseDirentNames(read1.payload);
      expect(firstBatch.length).toBe(1);

      // Second call: start from the off the first batch's last entry ended at.
      const nextOffset = parseLastOff(read1.payload);
      const read2 = await conn.request(FUSE_OP.READDIR, {
        unique: 4n,
        nodeid: 1n,
        payload: buildReadIn({ fh, offset: nextOffset, size: 4096 }),
      });
      const secondBatch = parseDirentNames(read2.payload);
      expect(new Set([...firstBatch, ...secondBatch])).toEqual(
        new Set(["hello.txt", "sub", "link-inside", "link-outside"]),
      );
    });
  });
});

describe("live mount server — symlink semantics", () => {
  it("LOOKUP returns S_IFLNK for a symlink, without following it", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("link-inside"),
      });
      expect(reply.header.error).toBe(0);
      const attr = readAttr(reply.payload, 40);
      expect(attr.mode & 0o170000).toBe(0o120000); // S_IFLNK
    });
  });

  it("READLINK returns the raw target bytes (no NUL terminator)", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("link-inside"),
      });
      const linkIno = bigintFromEntry(lookup.payload);
      const reply = await conn.request(FUSE_OP.READLINK, {
        unique: 3n,
        nodeid: linkIno,
        payload: new Uint8Array(0),
      });
      expect(reply.header.error).toBe(0);
      // fixture symlink target is "sub" — bytes only, no trailing NUL
      expect(new TextDecoder().decode(reply.payload)).toBe("sub");
    });
  });

  it("rejects LOOKUP with `..` as name (EINVAL)", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf(".."),
      });
      expect(reply.header.error).toBe(-22); // -EINVAL
    });
  });

  it("rejects LOOKUP with a slash in the name (EINVAL)", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("sub/nested.txt"),
      });
      expect(reply.header.error).toBe(-22); // -EINVAL
    });
  });
});

// ---------------- unimplemented-op coverage (#165) ----------------

// Opcode -> minimal payload that the dispatcher will see. We never reach
// the per-op decoder for these ops (the dispatch switch's default case
// fires first), so payload size only has to clear the FUSE framing min.
// Numbers are from Linux v6.1 uapi/linux/fuse.h. If any of these gets
// implemented later, move it out of this list and add a happy-path test
// in the same change (per AGENTS.md).
const UNIMPLEMENTED_OPS = [
  { name: "MKNOD", op: 8 },
  { name: "SETXATTR", op: 21 },
  { name: "GETXATTR", op: 22 },
  { name: "LISTXATTR", op: 23 },
  { name: "REMOVEXATTR", op: 24 },
  { name: "GETLK", op: 31 },
  { name: "SETLK", op: 32 },
  { name: "SETLKW", op: 33 },
  { name: "READDIRPLUS", op: 44 },
  { name: "RENAME2", op: 45 },
] as const;

// Tight enough to flag a wedge but loose enough not to flake on a busy
// CI runner. The dispatcher hits the default case synchronously, so the
// real bound is socket round-trip, which is sub-millisecond locally.
const OP_REPLY_DEADLINE_MS = 250;

describe("live mount server — unimplemented ops reply ENOSYS without wedging (#165)", () => {
  // The wedge class we're catching: a request that the dispatcher
  // accepts but never replies to. The mount-server today routes every
  // non-listed opcode through the default case, which builds a
  // synchronous error response — but if anyone wires up an op without
  // a reply path (or accidentally awaits a never-resolving promise),
  // the kernel hangs the syscall forever. A bounded race turns that
  // hang into a loud test failure.
  it.each(UNIMPLEMENTED_OPS)("$name (op=$op) returns -ENOSYS within deadline", async ({ op }) => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        conn.request(op, {
          unique: 100n + BigInt(op),
          nodeid: 1n,
          // Most missing ops have non-zero-size structs in the wire
          // protocol, but the dispatcher never decodes them. 16 bytes
          // is wide enough that even an op with a u64 fh + u64 something
          // wouldn't underflow the framing checks.
          payload: new Uint8Array(16),
        }),
        `op=${op}`,
      );
      expect(reply.header.error).toBe(-38); // -ENOSYS
      expect(reply.payload.length).toBe(0);
    });
  });
});

describe("live mount server — defined-op coverage (#165)", () => {
  it("STATFS returns a kstatfs payload", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.STATFS, { unique: 2n, nodeid: 1n, payload: new Uint8Array(0) }),
        "STATFS",
      );
      expect(reply.header.error).toBe(0);
      // fuse_kstatfs is 80 bytes
      expect(reply.payload.length).toBe(80);
    });
  });

  it("FLUSH replies success (no-op) within deadline", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        // fuse_flush_in is { fh, unused, padding, lock_owner } = 24 bytes,
        // but the dispatcher sends FLUSH straight to the success branch
        // without decoding, so any payload is fine.
        conn.request(FUSE_OP.FLUSH, { unique: 2n, nodeid: 1n, payload: new Uint8Array(24) }),
        "FLUSH",
      );
      expect(reply.header.error).toBe(0);
    });
  });

  it("ACCESS replies success (no-op) within deadline", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.ACCESS, { unique: 2n, nodeid: 1n, payload: new Uint8Array(8) }),
        "ACCESS",
      );
      expect(reply.header.error).toBe(0);
    });
  });

  it("DESTROY replies success (no-op) within deadline", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.DESTROY, { unique: 2n, nodeid: 0n, payload: new Uint8Array(0) }),
        "DESTROY",
      );
      expect(reply.header.error).toBe(0);
    });
  });

  it("LOOKUP with empty name → EINVAL", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf(""),
      });
      expect(reply.header.error).toBe(-22); // -EINVAL
    });
  });

  it("GETATTR on a stale (never-allocated) inode → ESTALE", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.GETATTR, {
        unique: 2n,
        nodeid: 9_999_999n, // never minted
        payload: new Uint8Array(16),
      });
      expect(reply.header.error).toBe(-116); // -ESTALE
    });
  });

  // ---------------- FSYNCDIR (op 30) ----------------
  // Per CLAUDE.md: happy / EBADF / :ro-allowed / wedge guard.

  it("FSYNCDIR on an open dir handle returns success", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const open = await conn.request(FUSE_OP.OPENDIR, {
        unique: 2n,
        nodeid: 1n,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      // fuse_fsync_in shared layout: u64 fh + u32 fsync_flags + u32 pad
      const buf = new Uint8Array(16);
      new DataView(buf.buffer).setBigUint64(0, fh, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.FSYNCDIR, { unique: 3n, nodeid: 1n, payload: buf }),
        "FSYNCDIR",
      );
      expect(reply.header.error).toBe(0);
    });
  });

  it("FSYNCDIR with an unknown fh returns EBADF", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const buf = new Uint8Array(16);
      new DataView(buf.buffer).setBigUint64(0, 9_999n, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.FSYNCDIR, { unique: 2n, nodeid: 1n, payload: buf }),
        "FSYNCDIR bad fh",
      );
      expect(reply.header.error).toBe(-9); // -EBADF
    });
  });

  // ---------------- LSEEK (op 46) ----------------

  it("LSEEK SEEK_END returns the file size", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      const ino = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: ino,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.LSEEK, {
          unique: 4n,
          nodeid: ino,
          payload: buildLseekIn({ fh, offset: 0n, whence: 2 /* SEEK_END */ }),
        }),
        "LSEEK end",
      );
      expect(reply.header.error).toBe(0);
      // fuse_lseek_out: u64 offset
      const offset = new DataView(reply.payload.buffer, reply.payload.byteOffset, 8).getBigUint64(
        0,
        true,
      );
      expect(offset).toBe(6n); // "world\n"
    });
  });

  it("LSEEK with bogus fh returns EBADF", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.LSEEK, {
          unique: 2n,
          nodeid: 1n,
          payload: buildLseekIn({ fh: 9_999n, offset: 0n, whence: 0 }),
        }),
        "LSEEK bad fh",
      );
      expect(reply.header.error).toBe(-9); // -EBADF
    });
  });

  it("LSEEK SEEK_HOLE returns ENOSYS (graceful fallback)", async () => {
    // SEEK_HOLE / SEEK_DATA need sparse-aware filesystem support we
    // can't reach from Node. Returning ENOSYS — *not* EIO — lets
    // guest userspace fall back to treating the whole file as data,
    // which is always correct.
    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      const ino = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: ino,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.LSEEK, {
          unique: 4n,
          nodeid: ino,
          payload: buildLseekIn({ fh, offset: 0n, whence: 4 /* SEEK_HOLE */ }),
        }),
        "LSEEK hole",
      );
      expect(reply.header.error).toBe(-38); // -ENOSYS
    });
  });

  it("FSYNCDIR is allowed in :ro mode (sync is a read-side guarantee)", async () => {
    // The default fixture is :ro. Sync still has to succeed — it's the
    // durability flush of already-committed reads/writes, not itself
    // a write op. Mirrors how onFsync omits the EROFS gate.
    await withConnection(async (conn) => {
      await doInit(conn);
      const open = await conn.request(FUSE_OP.OPENDIR, {
        unique: 2n,
        nodeid: 1n,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const buf = new Uint8Array(16);
      new DataView(buf.buffer).setBigUint64(0, fh, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.FSYNCDIR, { unique: 3n, nodeid: 1n, payload: buf }),
        "FSYNCDIR ro",
      );
      expect(reply.header.error).toBe(0); // NOT -EROFS
    });
  });

  it("INTERRUPT yields no reply at all (silent op)", async () => {
    // FUSE_INTERRUPT MUST never be answered — the kernel uses it as a
    // unidirectional signal. If we reply, the kernel mismatches `unique`
    // on the next op. Assert by waiting a bounded window and seeing
    // *nothing* arrive on the socket.
    await withConnection(async (conn) => {
      await doInit(conn);
      const interruptUnique = 99n;
      let gotReply = false;
      const inflight = conn
        .request(0x24 /* FUSE_INTERRUPT = 36 */, {
          unique: interruptUnique,
          nodeid: 0n,
          payload: new Uint8Array(8),
        })
        .then(() => {
          gotReply = true;
        });
      // Race against a short window. If the reply landed (gotReply
      // flipped), the test fails. If the deadline wins, INTERRUPT was
      // correctly silent.
      await new Promise((done) => setTimeout(done, 75));
      expect(gotReply).toBe(false);
      // Don't await `inflight` — it would never resolve, by design.
      void inflight;
    });
  });
});

describe("live mount server — :ro mounts reject mutations", () => {
  it("WRITE returns EROFS in :ro mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.WRITE, {
        unique: 2n,
        nodeid: 1n,
        payload: new Uint8Array(40),
      });
      expect(reply.header.error).toBe(-30); // -EROFS
    });
  });

  it("CREATE returns EROFS in :ro mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const payload = new Uint8Array(16 + "new.txt\0".length);
      const dv = new DataView(payload.buffer);
      dv.setUint32(0, 0o100, true); // O_CREAT
      dv.setUint32(4, 0o644, true); // mode
      payload.set(new TextEncoder().encode("new.txt\0"), 16);
      const reply = await conn.request(FUSE_OP.CREATE, {
        unique: 2n,
        nodeid: 1n,
        payload,
      });
      expect(reply.header.error).toBe(-30); // -EROFS
    });
  });

  it("UNLINK returns EROFS in :ro mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.UNLINK, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("hello.txt"),
      });
      expect(reply.header.error).toBe(-30);
    });
  });

  it("SYMLINK returns EROFS in :ro mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.SYMLINK, {
        unique: 2n,
        nodeid: 1n,
        payload: twoNulStrings("new-link", "target"),
      });
      expect(reply.header.error).toBe(-30);
    });
  });

  it("FALLOCATE returns EROFS in :ro mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.FALLOCATE, {
        unique: 2n,
        nodeid: 1n,
        payload: buildFallocateIn({ fh: 1n, offset: 0n, length: 16n, mode: 0 }),
      });
      expect(reply.header.error).toBe(-30); // -EROFS
    });
  });

  it("COPY_FILE_RANGE returns EROFS in :ro mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.COPY_FILE_RANGE, {
        unique: 2n,
        nodeid: 1n,
        payload: buildCopyFileRangeIn({
          fhIn: 1n,
          offIn: 0n,
          nodeidOut: 1n,
          fhOut: 1n,
          offOut: 0n,
          len: 4n,
          flags: 0n,
        }),
      });
      expect(reply.header.error).toBe(-30); // -EROFS
    });
  });

  it("SETATTR mtime on a symlink returns EROFS in :ro mode (#317)", async () => {
    // The :ro fixture already has link-inside → "sub". SETATTR on it
    // must EROFS before we ever touch the host fs.
    await withConnection(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("link-inside"),
      });
      const linkIno = bigintFromEntry(lookup.payload);
      const linkMtimeBefore = lstatSync(join(root, "link-inside")).mtimeMs;
      const reply = await conn.request(FUSE_OP.SETATTR, {
        unique: 3n,
        nodeid: linkIno,
        payload: buildSetattrIn({ valid: 1 << 5 /* FATTR_MTIME */, mtime: 1_700_000_000n }),
      });
      expect(reply.header.error).toBe(-30); // -EROFS
      // Host link untouched.
      expect(lstatSync(join(root, "link-inside")).mtimeMs).toBe(linkMtimeBefore);
    });
  });

  it("LINK returns EROFS in :ro mode", async () => {
    await withConnection(async (conn) => {
      await doInit(conn);
      // body: u64 oldnodeid + name\0
      const buf = new Uint8Array(8 + "lnk\0".length);
      const dv = new DataView(buf.buffer);
      dv.setBigUint64(0, 1n, true); // oldnodeid (ignored on EROFS)
      buf.set(new TextEncoder().encode("lnk\0"), 8);
      const reply = await conn.request(FUSE_OP.LINK, {
        unique: 2n,
        nodeid: 1n,
        payload: buf,
      });
      expect(reply.header.error).toBe(-30);
    });
  });
});

// ---------------- default mode is :rw ----------------

describe("live mount server — bare options default to :rw (#156)", () => {
  it("a server with no mode flag accepts WRITE without EROFS", async () => {
    const localScratch = mkdtempSync(join(tmpdir(), "machinen-mount-server-default-"));
    const localRoot = join(localScratch, "root");
    mkdirSync(localRoot);
    const localUds = join(localScratch, "fuse.sock");
    // No `mode` — assert the default is rw, not ro.
    const localHandle = await serveLiveMount(localUds, { rootAbs: localRoot });
    try {
      await withConnectionTo(localUds, async (conn) => {
        await doInit(conn);
        const reply = await conn.request(FUSE_OP.WRITE, {
          unique: 2n,
          nodeid: 1n,
          payload: new Uint8Array(40),
        });
        // RW with no FH yields EBADF, not EROFS — that's the ro→rw signal.
        expect(reply.header.error).toBe(-9); // -EBADF
      });
    } finally {
      await localHandle.stop();
      rmSync(localScratch, { recursive: true, force: true });
    }
  });
});

// ---------------- :rw write-through ----------------

describe("live mount server — :rw write-through", () => {
  let rwScratch: string;
  let rwRoot: string;
  let rwUds: string;
  let rwHandle: LiveMountServerHandle | undefined;

  beforeEach(async () => {
    rwScratch = mkdtempSync(join(tmpdir(), "machinen-mount-server-rw-"));
    rwRoot = join(rwScratch, "root");
    mkdirSync(rwRoot);
    writeFileSync(join(rwRoot, "existing.txt"), "old\n");
    mkdirSync(join(rwRoot, "dir"));
    writeFileSync(join(rwRoot, "dir/file.txt"), "x");
    rwUds = join(rwScratch, "fuse.sock");
    rwHandle = await serveLiveMount(rwUds, { rootAbs: rwRoot, mode: "rw" });
  });

  afterEach(async () => {
    await rwHandle?.stop();
    rwHandle = undefined;
    rmSync(rwScratch, { recursive: true, force: true });
  });

  async function rwConn(fn: (c: TestConnection) => Promise<void>): Promise<void> {
    await withConnectionTo(rwUds, fn);
  }

  it("CREATE makes a new file and writes land on the host", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      // CREATE "new.txt" under root
      const create = await conn.request(FUSE_OP.CREATE, {
        unique: 2n,
        nodeid: 1n,
        payload: buildCreateInWithName({ flags: 0o102, mode: 0o644, name: "new.txt" }),
      });
      expect(create.header.error).toBe(0);
      // payload = entry_out (128) + open_out (16) = 144
      expect(create.payload.length).toBe(144);
      const fh = new DataView(
        create.payload.buffer,
        create.payload.byteOffset + 128,
        16,
      ).getBigUint64(0, true);
      const inode = bigintFromEntry(create.payload);

      // WRITE bytes
      const data = new TextEncoder().encode("hello write\n");
      const writeBody = buildWriteInWithData({ fh, offset: 0n, data });
      const w = await conn.request(FUSE_OP.WRITE, {
        unique: 3n,
        nodeid: inode,
        payload: writeBody,
      });
      expect(w.header.error).toBe(0);
      // fuse_write_out: u32 size, u32 padding
      expect(new DataView(w.payload.buffer, w.payload.byteOffset, 8).getUint32(0, true)).toBe(
        data.length,
      );

      const rel = await conn.request(FUSE_OP.RELEASE, {
        unique: 4n,
        nodeid: inode,
        payload: buildReleaseIn({ fh }),
      });
      expect(rel.header.error).toBe(0);

      // The host file should exist with the bytes we wrote.
      const onDisk = readFileSync(join(rwRoot, "new.txt"), "utf8");
      expect(onDisk).toBe("hello write\n");
    });
  });

  it("UNLINK removes a file from the host", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.UNLINK, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("existing.txt"),
      });
      expect(reply.header.error).toBe(0);
      expect(existsSync(join(rwRoot, "existing.txt"))).toBe(false);
    });
  });

  it("MKDIR + RMDIR round-trips on the host", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      // fuse_mkdir_in: u32 mode, u32 umask, then NUL-terminated name
      const name = "new-dir";
      const buf = new Uint8Array(8 + name.length + 1);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, 0o755, true);
      dv.setUint32(4, 0, true);
      buf.set(new TextEncoder().encode(name), 8);
      const mk = await conn.request(FUSE_OP.MKDIR, {
        unique: 2n,
        nodeid: 1n,
        payload: buf,
      });
      expect(mk.header.error).toBe(0);
      expect(statSync(join(rwRoot, name)).isDirectory()).toBe(true);

      const rm = await conn.request(FUSE_OP.RMDIR, {
        unique: 3n,
        nodeid: 1n,
        payload: nameBuf(name),
      });
      expect(rm.header.error).toBe(0);
      expect(existsSync(join(rwRoot, name))).toBe(false);
    });
  });

  it("RENAME moves a file under the host", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      // fuse_rename_in: u64 newdir, then "old\0new\0"
      const buf = new Uint8Array(8 + "existing.txt\0renamed.txt\0".length);
      const dv = new DataView(buf.buffer);
      dv.setBigUint64(0, 1n, true); // newdir = root
      buf.set(new TextEncoder().encode("existing.txt\0renamed.txt\0"), 8);
      const reply = await conn.request(FUSE_OP.RENAME, {
        unique: 2n,
        nodeid: 1n,
        payload: buf,
      });
      expect(reply.header.error).toBe(0);
      expect(existsSync(join(rwRoot, "existing.txt"))).toBe(false);
      expect(readFileSync(join(rwRoot, "renamed.txt"), "utf8")).toBe("old\n");
    });
  });

  it("SETATTR with FATTR_SIZE truncates the file", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("existing.txt"),
      });
      const ino = bigintFromEntry(lookup.payload);
      // fuse_setattr_in: 88 bytes. We set FATTR_SIZE (1<<3) and size=0.
      const buf = new Uint8Array(88);
      const dv = new DataView(buf.buffer);
      dv.setUint32(0, 1 << 3, true); // valid = FATTR_SIZE
      dv.setBigUint64(16, 0n, true); // size = 0
      const reply = await conn.request(FUSE_OP.SETATTR, {
        unique: 3n,
        nodeid: ino,
        payload: buf,
      });
      expect(reply.header.error).toBe(0);
      expect(readFileSync(join(rwRoot, "existing.txt"), "utf8")).toBe("");
    });
  });

  // ---------------- SETATTR on symlinks (#317) ----------------
  //
  // Symptom: `tar -xzf` of any archive with symlinks fails with
  // "Input/output error" on `lutime` / `lchown` because the server
  // tries to realpath the symlink's basename (dangling mid-extract)
  // and uses path-following variants that update the target instead
  // of the link.
  //
  // Per CLAUDE.md FUSE-op rules: happy path, error path, :ro gate,
  // and a wedge guard (raceWithDeadline) on the mutating operations.

  it("SETATTR FATTR_MTIME on a symlink updates the link, not the target (#317)", async () => {
    // Symlink → existing.txt. Set the link's mtime; the target's mtime
    // must stay at its original value (proves we used lutimes, not
    // utimes which would have followed the link).
    symlinkSync("existing.txt", join(rwRoot, "link-to-existing"));
    // Pin the target's mtime to a recognisable epoch so we can detect
    // accidental writes through the link.
    const targetMtime = new Date("2020-01-01T00:00:00Z");
    utimesSync(join(rwRoot, "existing.txt"), targetMtime, targetMtime);
    const linkMtimeOriginal = lstatSync(join(rwRoot, "link-to-existing")).mtimeMs;

    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("link-to-existing"),
      });
      const linkIno = bigintFromEntry(lookup.payload);
      const newMtime = 1_700_000_000n; // 2023-11-14
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.SETATTR, {
          unique: 3n,
          nodeid: linkIno,
          payload: buildSetattrIn({ valid: 1 << 5 /* FATTR_MTIME */, mtime: newMtime }),
        }),
        "SETATTR mtime on symlink",
      );
      expect(reply.header.error).toBe(0);
    });

    // Target's mtime is untouched (lutimes didn't follow the link).
    const targetAfter = statSync(join(rwRoot, "existing.txt"));
    expect(Math.floor(targetAfter.mtimeMs / 1000)).toBe(targetMtime.getTime() / 1000);

    // Link's own mtime moved (best-effort — some filesystems coarsen
    // symlink-mtime precision, but the value must have changed off the
    // pre-test reading).
    const linkAfter = lstatSync(join(rwRoot, "link-to-existing"));
    expect(linkAfter.mtimeMs).not.toBe(linkMtimeOriginal);
  });

  it("SETATTR on a symlink with a dangling target succeeds — no EIO (#317)", async () => {
    // The tar-extracts-symlinks-first repro: the link points at a
    // path that doesn't exist yet, then tar lutimes/lchowns it.
    // Pre-#317, absPathForTraversal would realpath and ENOENT before
    // the handler even ran — and the surfaced errno was EIO from
    // libuv on some hosts. Now we use absPathForLstat + lutimes so
    // the missing target never matters.
    symlinkSync("does-not-exist-yet.txt", join(rwRoot, "dangling-link"));

    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("dangling-link"),
      });
      const linkIno = bigintFromEntry(lookup.payload);

      // lutimes on the dangling link
      const utimeReply = await raceWithDeadline(
        conn.request(FUSE_OP.SETATTR, {
          unique: 3n,
          nodeid: linkIno,
          payload: buildSetattrIn({
            valid: (1 << 4) | (1 << 5) /* FATTR_ATIME | FATTR_MTIME */,
            atime: 1_700_000_000n,
            mtime: 1_700_000_000n,
          }),
        }),
        "SETATTR utimes on dangling symlink",
      );
      expect(utimeReply.header.error).toBe(0);

      // lchown on the dangling link
      const chownReply = await raceWithDeadline(
        conn.request(FUSE_OP.SETATTR, {
          unique: 4n,
          nodeid: linkIno,
          payload: buildSetattrIn({
            valid: (1 << 1) | (1 << 2) /* FATTR_UID | FATTR_GID */,
            uid: 1001,
            gid: 1001,
          }),
        }),
        "SETATTR chown on dangling symlink",
      );
      expect(chownReply.header.error).toBe(0);
    });
  });

  it("SETATTR FATTR_SIZE on a symlink rejects with EINVAL (#317)", async () => {
    // Truncating a symlink is undefined; never silently chase the
    // target. The kernel shouldn't issue this for a known S_IFLNK
    // inode but a malformed userspace request could.
    symlinkSync("existing.txt", join(rwRoot, "size-target-link"));
    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("size-target-link"),
      });
      const linkIno = bigintFromEntry(lookup.payload);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.SETATTR, {
          unique: 3n,
          nodeid: linkIno,
          payload: buildSetattrIn({ valid: 1 << 3 /* FATTR_SIZE */, size: 0n }),
        }),
        "SETATTR size on symlink",
      );
      expect(reply.header.error).toBe(-22); // -EINVAL
      // Target file is unchanged in size — proves we didn't follow.
      expect(readFileSync(join(rwRoot, "existing.txt"), "utf8")).toBe("old\n");
    });
  });

  it("SYMLINK creates a symlink with the exact target bytes (#163)", async () => {
    // pnpm install builds node_modules/.pnpm out of relative symlinks
    // like "../../ms@2.1.3/node_modules/ms". Critical: target is
    // stored verbatim, not realpath'd through the host fs.
    await rwConn(async (conn) => {
      await doInit(conn);
      const target = "../../ms@2.1.3/node_modules/ms";
      const reply = await conn.request(FUSE_OP.SYMLINK, {
        unique: 2n,
        nodeid: 1n,
        payload: twoNulStrings("ms", target),
      });
      expect(reply.header.error).toBe(0);
      const attr = readAttr(reply.payload, 40);
      expect(attr.mode & 0o170000).toBe(0o120000); // S_IFLNK
      const onDisk = join(rwRoot, "ms");
      expect(lstatSync(onDisk).isSymbolicLink()).toBe(true);
      expect(readlinkSync(onDisk)).toBe(target);
    });
  });

  it("SYMLINK then READLINK round-trips the target (#163)", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const target = "./dir/file.txt";
      const sym = await conn.request(FUSE_OP.SYMLINK, {
        unique: 2n,
        nodeid: 1n,
        payload: twoNulStrings("link", target),
      });
      expect(sym.header.error).toBe(0);
      const linkIno = bigintFromEntry(sym.payload);
      const reply = await conn.request(FUSE_OP.READLINK, {
        unique: 3n,
        nodeid: linkIno,
        payload: new Uint8Array(0),
      });
      expect(reply.header.error).toBe(0);
      expect(new TextDecoder().decode(reply.payload)).toBe(target);
    });
  });

  it("SYMLINK rejects an empty target with EINVAL", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.SYMLINK, {
        unique: 2n,
        nodeid: 1n,
        payload: twoNulStrings("bad", ""),
      });
      expect(reply.header.error).toBe(-22); // -EINVAL
    });
  });

  it("SYMLINK refuses a name with `..` (EINVAL)", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.SYMLINK, {
        unique: 2n,
        nodeid: 1n,
        payload: twoNulStrings("..", "target"),
      });
      expect(reply.header.error).toBe(-22);
    });
  });

  it("LINK creates a hard link to an existing file (#163)", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      // First LOOKUP existing.txt to get its inode.
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("existing.txt"),
      });
      const oldIno = bigintFromEntry(lookup.payload);
      // body: u64 oldnodeid + "hardlink\0"
      const name = "hardlink";
      const body = new Uint8Array(8 + name.length + 1);
      const dv = new DataView(body.buffer);
      dv.setBigUint64(0, oldIno, true);
      body.set(new TextEncoder().encode(name), 8);
      const reply = await conn.request(FUSE_OP.LINK, {
        unique: 3n,
        nodeid: 1n,
        payload: body,
      });
      expect(reply.header.error).toBe(0);
      const attr = readAttr(reply.payload, 40);
      expect(attr.mode & 0o170000).toBe(0o100000); // S_IFREG
      // Same content, same inode on host.
      expect(readFileSync(join(rwRoot, name), "utf8")).toBe("old\n");
      expect(statSync(join(rwRoot, name)).ino).toBe(statSync(join(rwRoot, "existing.txt")).ino);
    });
  });

  it("RENAME with no NUL between old and new names → EINVAL (#165)", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      // u64 newdir + bytes WITHOUT a NUL terminator anywhere — the
      // server scans for the first NUL and rejects when it can't find
      // one. Catches malformed-frame handling on a write-side op.
      const buf = new Uint8Array(8 + 4);
      const dv = new DataView(buf.buffer);
      dv.setBigUint64(0, 1n, true);
      buf.set(new TextEncoder().encode("AAAA"), 8);
      const reply = await conn.request(FUSE_OP.RENAME, {
        unique: 2n,
        nodeid: 1n,
        payload: buf,
      });
      expect(reply.header.error).toBe(-22); // -EINVAL
    });
  });

  it("CREATE refuses a malformed name (slash in basename → EINVAL)", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const reply = await conn.request(FUSE_OP.CREATE, {
        unique: 2n,
        nodeid: 1n,
        payload: buildCreateInWithName({
          flags: 0o102,
          mode: 0o644,
          name: "../escape.txt",
        }),
      });
      expect(reply.header.error).toBe(-22); // -EINVAL
    });
  });

  // ---------------- FALLOCATE (op 43) ----------------

  it("FALLOCATE mode=0 extends the file to offset+length", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("existing.txt"),
      });
      const ino = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: ino,
        payload: u32u32(2 /* O_RDWR */, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.FALLOCATE, {
          unique: 4n,
          nodeid: ino,
          payload: buildFallocateIn({ fh, offset: 0n, length: 1024n, mode: 0 }),
        }),
        "FALLOCATE extend",
      );
      expect(reply.header.error).toBe(0);
      expect(statSync(join(rwRoot, "existing.txt")).size).toBe(1024);
    });
  });

  it("FALLOCATE with PUNCH_HOLE returns ENOSYS (graceful)", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("existing.txt"),
      });
      const ino = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: ino,
        payload: u32u32(2, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.FALLOCATE, {
          unique: 4n,
          nodeid: ino,
          payload: buildFallocateIn({
            fh,
            offset: 0n,
            length: 16n,
            mode: 0x01 | 0x02 /* KEEP_SIZE | PUNCH_HOLE */,
          }),
        }),
        "FALLOCATE punch",
      );
      expect(reply.header.error).toBe(-38); // -ENOSYS
    });
  });

  it("FALLOCATE with bogus fh returns EBADF", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.FALLOCATE, {
          unique: 2n,
          nodeid: 1n,
          payload: buildFallocateIn({ fh: 9_999n, offset: 0n, length: 16n, mode: 0 }),
        }),
        "FALLOCATE bad fh",
      );
      expect(reply.header.error).toBe(-9); // -EBADF
    });
  });

  // ---------------- COPY_FILE_RANGE (op 47) ----------------

  it("COPY_FILE_RANGE copies bytes from src fh to dst fh", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      // src = existing.txt (content "old\n"). dst = new file
      // created via CREATE.
      const srcLookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("existing.txt"),
      });
      const srcIno = bigintFromEntry(srcLookup.payload);
      const srcOpen = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: srcIno,
        payload: u32u32(0, 0),
      });
      const srcFh = new DataView(
        srcOpen.payload.buffer,
        srcOpen.payload.byteOffset,
        srcOpen.payload.length,
      ).getBigUint64(0, true);

      const dstCreate = await conn.request(FUSE_OP.CREATE, {
        unique: 4n,
        nodeid: 1n,
        payload: buildCreateInWithName({ flags: 0o102, mode: 0o644, name: "copied.txt" }),
      });
      const dstIno = bigintFromEntry(dstCreate.payload);
      const dstFh = new DataView(
        dstCreate.payload.buffer,
        dstCreate.payload.byteOffset + 128,
        16,
      ).getBigUint64(0, true);

      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.COPY_FILE_RANGE, {
          unique: 5n,
          nodeid: srcIno,
          payload: buildCopyFileRangeIn({
            fhIn: srcFh,
            offIn: 0n,
            nodeidOut: dstIno,
            fhOut: dstFh,
            offOut: 0n,
            len: 4n,
            flags: 0n,
          }),
        }),
        "COPY_FILE_RANGE",
      );
      expect(reply.header.error).toBe(0);
      // fuse_write_out: u32 size
      const copied = new DataView(reply.payload.buffer, reply.payload.byteOffset, 4).getUint32(
        0,
        true,
      );
      expect(copied).toBe(4);
      // Need to RELEASE the dst fh so the host flushes before we read.
      await conn.request(FUSE_OP.RELEASE, {
        unique: 6n,
        nodeid: dstIno,
        payload: buildReleaseIn({ fh: dstFh }),
      });
      expect(readFileSync(join(rwRoot, "copied.txt"), "utf8")).toBe("old\n");
    });
  });

  it("COPY_FILE_RANGE with unknown dst fh returns EBADF", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("existing.txt"),
      });
      const ino = bigintFromEntry(lookup.payload);
      const open = await conn.request(FUSE_OP.OPEN, {
        unique: 3n,
        nodeid: ino,
        payload: u32u32(0, 0),
      });
      const fh = new DataView(
        open.payload.buffer,
        open.payload.byteOffset,
        open.payload.length,
      ).getBigUint64(0, true);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.COPY_FILE_RANGE, {
          unique: 4n,
          nodeid: ino,
          payload: buildCopyFileRangeIn({
            fhIn: fh,
            offIn: 0n,
            nodeidOut: 1n,
            fhOut: 9_999n,
            offOut: 0n,
            len: 4n,
            flags: 0n,
          }),
        }),
        "COPY_FILE_RANGE bad fh",
      );
      expect(reply.header.error).toBe(-9); // -EBADF
    });
  });

  it("COPY_FILE_RANGE with non-zero flags returns EINVAL", async () => {
    await rwConn(async (conn) => {
      await doInit(conn);
      const reply = await raceWithDeadline(
        conn.request(FUSE_OP.COPY_FILE_RANGE, {
          unique: 2n,
          nodeid: 1n,
          payload: buildCopyFileRangeIn({
            fhIn: 1n,
            offIn: 0n,
            nodeidOut: 1n,
            fhOut: 1n,
            offOut: 0n,
            len: 4n,
            flags: 1n /* reserved */,
          }),
        }),
        "COPY_FILE_RANGE flags",
      );
      expect(reply.header.error).toBe(-22); // -EINVAL
    });
  });

  it("CREATE through a symlink that escapes the root → ENOENT", async () => {
    // Plant a symlink inside the mount that points to a directory
    // outside it, then try to CREATE a file under that link's inode.
    // The resolver realpath's the parent through the symlink, sees
    // the result is outside `rwRoot`, and throws MountError →
    // ENOENT on the wire. The host's outside dir must stay untouched.
    const outside = join(rwScratch, "outside");
    mkdirSync(outside);
    symlinkSync(outside, join(rwRoot, "escape-link"));
    await rwConn(async (conn) => {
      await doInit(conn);
      const lookup = await conn.request(FUSE_OP.LOOKUP, {
        unique: 2n,
        nodeid: 1n,
        payload: nameBuf("escape-link"),
      });
      expect(lookup.header.error).toBe(0);
      const linkIno = bigintFromEntry(lookup.payload);
      const create = await conn.request(FUSE_OP.CREATE, {
        unique: 3n,
        nodeid: linkIno,
        payload: buildCreateInWithName({
          flags: 0o102,
          mode: 0o644,
          name: "planted.txt",
        }),
      });
      expect(create.header.error).toBe(-2); // -ENOENT
      expect(existsSync(join(outside, "planted.txt"))).toBe(false);
    });
  });
});

// ---------------- helpers ----------------

interface TestConnection {
  request(
    opcode: number,
    req: { unique: bigint; nodeid: bigint; payload: Uint8Array },
  ): Promise<{
    header: { len: number; error: number; unique: bigint };
    payload: Uint8Array;
  }>;
  close(): void;
}

async function withConnection(fn: (c: TestConnection) => Promise<void>): Promise<void> {
  return withConnectionTo(udsPath, fn);
}

async function withConnectionTo(
  path: string,
  fn: (c: TestConnection) => Promise<void>,
): Promise<void> {
  const sock = await new Promise<Awaited<ReturnType<typeof netConnect>>>((done, fail) => {
    const s = netConnect(path);
    s.once("error", fail);
    s.once("connect", () => {
      s.off("error", fail);
      done(s);
    });
  });
  const pending = new Map<string, (r: any) => void>();
  let inbox = Buffer.alloc(0);
  sock.on("data", (chunk) => {
    inbox = Buffer.concat([inbox, chunk]);
    while (inbox.length >= 16) {
      const len = inbox.readUInt32LE(0);
      if (inbox.length < len) {
        break;
      }
      const frame = inbox.subarray(0, len);
      inbox = inbox.subarray(len);
      const error = frame.readInt32LE(4);
      const unique = frame.readBigUInt64LE(8).toString();
      const payload = new Uint8Array(frame.subarray(16).slice());
      const resolver = pending.get(unique);
      if (resolver) {
        pending.delete(unique);
        resolver({ header: { len, error, unique: BigInt(unique) }, payload });
      }
    }
  });

  const conn: TestConnection = {
    request: (opcode, req) =>
      new Promise((done) => {
        pending.set(req.unique.toString(), done);
        const frame = buildRequest(opcode, req.unique, req.nodeid, req.payload);
        sock.write(frame);
      }),
    close: () => sock.destroy(),
  };
  try {
    await fn(conn);
  } finally {
    sock.destroy();
  }
}

async function doInit(conn: TestConnection): Promise<void> {
  await conn.request(FUSE_OP.INIT, {
    unique: 1n,
    nodeid: 0n,
    payload: buildInitIn({ major: 7, minor: 31, flags: 0 }),
  });
}

function buildRequest(
  opcode: number,
  unique: bigint,
  nodeid: bigint,
  payload: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(FUSE_IN_HEADER_SIZE + payload.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, out.length, true);
  dv.setUint32(4, opcode, true);
  dv.setBigUint64(8, unique, true);
  dv.setBigUint64(16, nodeid, true);
  dv.setUint32(24, 0, true); // uid
  dv.setUint32(28, 0, true); // gid
  dv.setUint32(32, 0, true); // pid
  out.set(payload, FUSE_IN_HEADER_SIZE);
  return out;
}

function buildInitIn(opts: { major: number; minor: number; flags: number }): Uint8Array {
  const buf = new Uint8Array(64);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, opts.major, true);
  dv.setUint32(4, opts.minor, true);
  dv.setUint32(8, 131072, true); // max_readahead
  dv.setUint32(12, opts.flags, true);
  return buf;
}

function buildReadIn(opts: { fh: bigint; offset: bigint; size: number }): Uint8Array {
  const buf = new Uint8Array(40);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(0, opts.fh, true);
  dv.setBigUint64(8, opts.offset, true);
  dv.setUint32(16, opts.size, true);
  return buf;
}

function buildReleaseIn(opts: { fh: bigint }): Uint8Array {
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(0, opts.fh, true);
  return buf;
}

function buildCreateInWithName(opts: { flags: number; mode: number; name: string }): Uint8Array {
  const nameBytes = new TextEncoder().encode(opts.name);
  const buf = new Uint8Array(16 + nameBytes.length + 1);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, opts.flags, true);
  dv.setUint32(4, opts.mode, true);
  // umask + open_flags = 0
  buf.set(nameBytes, 16);
  return buf;
}

function buildSetattrIn(opts: {
  valid: number;
  fh?: bigint;
  size?: bigint;
  atime?: bigint;
  mtime?: bigint;
  atimensec?: number;
  mtimensec?: number;
  mode?: number;
  uid?: number;
  gid?: number;
}): Uint8Array {
  // fuse_setattr_in layout (88 bytes). Field offsets from
  // uapi/linux/fuse.h: valid(0), fh(8), size(16), lock_owner(24),
  // atime(32), mtime(40), ctime(48), atimensec(56), mtimensec(60),
  // ctimensec(64), mode(68), uid(76), gid(80).
  const buf = new Uint8Array(88);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, opts.valid, true);
  if (opts.fh !== undefined) {
    dv.setBigUint64(8, opts.fh, true);
  }
  if (opts.size !== undefined) {
    dv.setBigUint64(16, opts.size, true);
  }
  if (opts.atime !== undefined) {
    dv.setBigUint64(32, opts.atime, true);
  }
  if (opts.mtime !== undefined) {
    dv.setBigUint64(40, opts.mtime, true);
  }
  if (opts.atimensec !== undefined) {
    dv.setUint32(56, opts.atimensec, true);
  }
  if (opts.mtimensec !== undefined) {
    dv.setUint32(60, opts.mtimensec, true);
  }
  if (opts.mode !== undefined) {
    dv.setUint32(68, opts.mode, true);
  }
  if (opts.uid !== undefined) {
    dv.setUint32(76, opts.uid, true);
  }
  if (opts.gid !== undefined) {
    dv.setUint32(80, opts.gid, true);
  }
  return buf;
}

function buildLseekIn(opts: { fh: bigint; offset: bigint; whence: number }): Uint8Array {
  // fuse_lseek_in: u64 fh + u64 offset + u32 whence + u32 padding = 24
  const buf = new Uint8Array(24);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(0, opts.fh, true);
  dv.setBigUint64(8, opts.offset, true);
  dv.setUint32(16, opts.whence, true);
  return buf;
}

function buildFallocateIn(opts: {
  fh: bigint;
  offset: bigint;
  length: bigint;
  mode: number;
}): Uint8Array {
  // fuse_fallocate_in: u64 fh + u64 offset + u64 length + u32 mode +
  // u32 padding = 32
  const buf = new Uint8Array(32);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(0, opts.fh, true);
  dv.setBigUint64(8, opts.offset, true);
  dv.setBigUint64(16, opts.length, true);
  dv.setUint32(24, opts.mode, true);
  return buf;
}

function buildCopyFileRangeIn(opts: {
  fhIn: bigint;
  offIn: bigint;
  nodeidOut: bigint;
  fhOut: bigint;
  offOut: bigint;
  len: bigint;
  flags: bigint;
}): Uint8Array {
  // fuse_copy_file_range_in: 7 u64s = 56 bytes
  const buf = new Uint8Array(56);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(0, opts.fhIn, true);
  dv.setBigUint64(8, opts.offIn, true);
  dv.setBigUint64(16, opts.nodeidOut, true);
  dv.setBigUint64(24, opts.fhOut, true);
  dv.setBigUint64(32, opts.offOut, true);
  dv.setBigUint64(40, opts.len, true);
  dv.setBigUint64(48, opts.flags, true);
  return buf;
}

function buildWriteInWithData(opts: { fh: bigint; offset: bigint; data: Uint8Array }): Uint8Array {
  const buf = new Uint8Array(40 + opts.data.length);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(0, opts.fh, true);
  dv.setBigUint64(8, opts.offset, true);
  dv.setUint32(16, opts.data.length, true);
  buf.set(opts.data, 40);
  return buf;
}

/**
 * Race a request reply against a hard deadline. Catches the wedge
 * class — an op the server accepts but never replies to — by turning
 * an indefinite hang into a fast, specific test failure. See #165.
 */
async function raceWithDeadline<T>(p: Promise<T>, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, fail) => {
    timer = setTimeout(
      () => fail(new Error(`${label} did not reply within ${OP_REPLY_DEADLINE_MS}ms`)),
      OP_REPLY_DEADLINE_MS,
    );
  });
  try {
    return await Promise.race([p, deadline]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function twoNulStrings(a: string, b: string): Uint8Array {
  const aBytes = new TextEncoder().encode(a);
  const bBytes = new TextEncoder().encode(b);
  const out = new Uint8Array(aBytes.length + 1 + bBytes.length + 1);
  out.set(aBytes, 0);
  out.set(bBytes, aBytes.length + 1);
  // trailing NULs already zero
  return out;
}

function nameBuf(name: string): Uint8Array {
  const bytes = new TextEncoder().encode(name);
  const out = new Uint8Array(bytes.length + 1);
  out.set(bytes, 0);
  // trailing NUL already zero
  return out;
}

function u32u32(a: number, b: number): Uint8Array {
  const buf = new Uint8Array(8);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, a, true);
  dv.setUint32(4, b, true);
  return buf;
}

function bigintFromEntry(entry: Uint8Array): bigint {
  return new DataView(entry.buffer, entry.byteOffset, 8).getBigUint64(0, true);
}

function parseDirentNames(buf: Uint8Array): string[] {
  const names: string[] = [];
  let cursor = 0;
  while (cursor + 24 <= buf.length) {
    const dv = new DataView(buf.buffer, buf.byteOffset + cursor, 24);
    const namelen = dv.getUint32(16, true);
    const paddedNameLen = (namelen + 7) & ~7;
    const name = new TextDecoder().decode(buf.subarray(cursor + 24, cursor + 24 + namelen));
    names.push(name);
    cursor += 24 + paddedNameLen;
  }
  return names;
}

function parseLastOff(buf: Uint8Array): bigint {
  let lastOff = 0n;
  let cursor = 0;
  while (cursor + 24 <= buf.length) {
    const dv = new DataView(buf.buffer, buf.byteOffset + cursor, 24);
    lastOff = dv.getBigUint64(8, true);
    const namelen = dv.getUint32(16, true);
    const paddedNameLen = (namelen + 7) & ~7;
    cursor += 24 + paddedNameLen;
  }
  return lastOff;
}
