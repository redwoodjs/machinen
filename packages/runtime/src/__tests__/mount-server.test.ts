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
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
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

function buildWriteInWithData(opts: { fh: bigint; offset: bigint; data: Uint8Array }): Uint8Array {
  const buf = new Uint8Array(40 + opts.data.length);
  const dv = new DataView(buf.buffer);
  dv.setBigUint64(0, opts.fh, true);
  dv.setBigUint64(8, opts.offset, true);
  dv.setUint32(16, opts.data.length, true);
  buf.set(opts.data, 40);
  return buf;
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
