//! machinen-page-server — host-side serving of CRIU `pages-*.img` content
//! to an in-guest `criu lazy-pages` client over the gvproxy network.
//!
//! Why this exists: PR #265 found that running `criu --lazy-pages` against
//! a guest-mounted bundle still settles at full N-GiB host RSS — the dump
//! bytes end up in both guest pagecache and workload anon mappings within
//! ~10 s as CRIU's prefetcher fills in. Issue #266 fixes that by routing
//! pages over the network instead, so they only flow into the workload's
//! anon on actual UFFD faults.
//!
//! CRIU's own page-server is Linux-only (it pulls in pstree, page-pipe,
//! parasite-syscall, etc.). For macOS hosts we'd need to either ship a
//! Linux helper VM or reimplement just enough of the protocol to serve
//! a `criu lazy-pages --page-server` client. This is the latter — small
//! enough to maintain ourselves; the protocol surface for lazy-pages
//! recv-only is just `PS_IOV_GET` + `PS_IOV_CLOSE`.
//!
//! Wire protocol (from `criu/page-xfer.c` v4.2):
//!   struct page_server_iov {
//!       u32 cmd;        // 4 bytes
//!       u64 nr_pages;   // 8 bytes (with 4-byte pad after cmd)
//!       u64 vaddr;
//!       u64 dst_id;     // for GET: the dumped task's vpid
//!   };                  // 32 bytes wire-side
//!
//!   client → server: PS_IOV_GET(nr_pages, vaddr, dst_id=vpid)
//!   server → client: PS_IOV_ADD_F | (PE_PRESENT << 16) header,
//!                    then nr_pages * 4096 bytes of page content.
//!   client → server: PS_IOV_CLOSE / PS_IOV_FORCE_CLOSE on shutdown,
//!                    server replies with int32 status (0 = ok).
//!
//! Image format (`criu/image.c` v4.2): every image opens with
//! `IMG_COMMON_MAGIC = 0x54564319` (LE u32) followed by a per-type
//! magic. Pagemap is `0x56084025`; pages is `0` (raw — no per-message
//! framing, just page bytes). After the type magic, pagemap files are
//! a stream of `(u32 size) + (size bytes protobuf)` records.
//!
//! Pagemap proto:
//!   message pagemap_head { uint32 pages_id = 1; }
//!   message pagemap_entry {
//!       uint64 vaddr            = 1;
//!       uint32 compat_nr_pages  = 2;
//!       bool   in_parent        = 3;
//!       uint32 flags            = 4;
//!       uint64 nr_pages         = 5;
//!   }
//!
//! Only `PE_PRESENT` (1<<2) entries consume bytes in `pages-<id>.img`.
//! Offsets are computed by walking pagemap entries in order and
//! accumulating `nr_pages * PAGE_SIZE` for each present entry.
//!
//! Implementation note: we go through libc directly for I/O rather
//! than std.Io.Dir / std.Io.File. The latter changed substantially in
//! Zig 0.16 and the rest of this codebase already follows the libc
//! pattern (see `packages/microvm/assets/exec-agent.zig`).

const std = @import("std");

const PAGE_SIZE: usize = 4096;

const IMG_COMMON_MAGIC: u32 = 0x54564319;
const PAGEMAP_MAGIC: u32 = 0x56084025;
const PAGES_MAGIC: u32 = 0x0; // RAW_IMAGE_MAGIC

// page_server_iov.cmd values (criu/page-xfer.c v4.2). Lazy-pages recv
// flow only sends GET / CLOSE / FORCE_CLOSE.
const PS_IOV_OPEN: u32 = 3;
const PS_IOV_OPEN2: u32 = 4;
const PS_IOV_PARENT: u32 = 5;
const PS_IOV_ADD_F: u32 = 6;
const PS_IOV_GET: u32 = 7;
const PS_IOV_CLOSE: u32 = 0x1023;
const PS_IOV_FORCE_CLOSE: u32 = 0x1024;

// PS_IOV_ADD_F encodes flags in the upper 16 bits.
const PS_CMD_BITS: u5 = 16;
const PS_CMD_MASK: u32 = (1 << PS_CMD_BITS) - 1;

// pagemap_entry.flags values (criu/include/pagemap.h v4.2).
const PE_PARENT: u32 = 1 << 0;
const PE_LAZY: u32 = 1 << 1;
const PE_PRESENT: u32 = 1 << 2;

// --- libc bindings. Same idiom as init.zig / exec-agent.zig — we
// don't use std.posix / std.Io directly because their API is in flux
// in Zig 0.16.

const O_RDONLY: c_int = 0;

// Cross-platform open: 2-arg variant (no mode) for read-only access.
extern "c" fn open(path: [*:0]const u8, flags: c_int) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn pread(fd: c_int, buf: [*]u8, count: usize, offset: i64) isize;
extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
extern "c" fn socket(domain: c_int, sock_type: c_int, protocol: c_int) c_int;
extern "c" fn bind(fd: c_int, addr: *const anyopaque, addrlen: c_uint) c_int;
extern "c" fn listen(fd: c_int, backlog: c_int) c_int;
extern "c" fn accept(fd: c_int, addr: ?*anyopaque, addrlen: ?*c_uint) c_int;
extern "c" fn send(fd: c_int, buf: [*]const u8, len: usize, flags: c_int) isize;
extern "c" fn recv(fd: c_int, buf: [*]u8, len: usize, flags: c_int) isize;
extern "c" fn setsockopt(fd: c_int, level: c_int, optname: c_int, optval: *const anyopaque, optlen: c_uint) c_int;
extern "c" fn htons(host: u16) u16;
extern "c" fn htonl(host: u32) u32;
extern "c" fn inet_pton(family: c_int, src: [*:0]const u8, dst: *anyopaque) c_int;
extern "c" fn opendir(path: [*:0]const u8) ?*anyopaque;
extern "c" fn readdir(dir: *anyopaque) ?*Dirent;
extern "c" fn closedir(dir: *anyopaque) c_int;

const AF_INET: c_int = 2;
const SOCK_STREAM: c_int = 1;
const SOL_SOCKET: c_int = switch (@import("builtin").os.tag) {
    .macos, .ios, .tvos, .watchos, .visionos => 0xffff,
    else => 1, // Linux
};
const SO_REUSEADDR: c_int = switch (@import("builtin").os.tag) {
    .macos, .ios, .tvos, .watchos, .visionos => 0x0004,
    else => 2, // Linux
};

// macOS struct dirent (BSD layout). On Linux, glibc's `struct dirent`
// has a different field ordering, but `d_name` is the only field we
// read so a naïve cast would access the wrong bytes.
//
// Both kernels expose `d_name` as the trailing field of a variable-
// length record; the offset differs. We use the macOS layout here
// because the host runtime targets darwin first; when this binary
// is compiled for Linux we'd need a Linux-shaped Dirent. That's a
// follow-up — covered by the runtime spawn gating step 2 lands with.
const Dirent = extern struct {
    d_ino: u64,
    d_seekoff: u64,
    d_reclen: u16,
    d_namlen: u16,
    d_type: u8,
    d_name: [1024]u8, // macOS: __DARWIN_MAXPATHLEN (1024)
};

// In-network sockaddr_in (BSD-shaped). macOS prefixes a 1-byte length
// before sin_family; Linux doesn't. macOS first because that's the
// build target; Linux support arrives with the runtime gating below.
const SockAddrIn = extern struct {
    sin_len: u8 = @sizeOf(SockAddrIn),
    sin_family: u8 = AF_INET,
    sin_port: u16, // network byte order
    sin_addr: u32, // network byte order
    sin_zero: [8]u8 = @splat(0),
};

const log = std.log.scoped(.page_server);

// --- in-memory bundle index

/// One pagemap_entry's contribution to the index. We only keep
/// PE_PRESENT entries — anything else has no bytes in pages-*.img.
const Entry = struct {
    vaddr_lo: u64,
    vaddr_hi: u64, // exclusive
    pages_off: u64, // byte offset into pages-<pages_id>.img
};

/// Per-pid index. `entries` is sorted ascending by vaddr_lo (CRIU
/// already writes pagemap entries in vaddr order).
const PidIndex = struct {
    pid: u64,
    pages_id: u32,
    pages_fd: c_int,
    entries: []Entry,
};

const Bundle = struct {
    allocator: std.mem.Allocator,
    indexes: std.AutoHashMapUnmanaged(u64, PidIndex) = .{},

    fn deinit(self: *Bundle) void {
        var it = self.indexes.iterator();
        while (it.next()) |kv| {
            self.allocator.free(kv.value_ptr.entries);
            _ = close(kv.value_ptr.pages_fd);
        }
        self.indexes.deinit(self.allocator);
    }

    fn lookup(self: *const Bundle, pid: u64, vaddr: u64, nr_pages: u64) ?struct {
        fd: c_int,
        offset: u64,
        len: u64,
    } {
        const idx = self.indexes.getPtr(pid) orelse return null;
        const want_lo = vaddr;
        const want_len = nr_pages * PAGE_SIZE;
        const want_hi = want_lo + want_len;

        // Binary search: find entry that contains want_lo.
        var lo: usize = 0;
        var hi: usize = idx.entries.len;
        while (lo < hi) {
            const mid = lo + (hi - lo) / 2;
            const e = idx.entries[mid];
            if (want_lo < e.vaddr_lo) {
                hi = mid;
            } else if (want_lo >= e.vaddr_hi) {
                lo = mid + 1;
            } else {
                if (want_hi > e.vaddr_hi) return null;
                const within = want_lo - e.vaddr_lo;
                return .{
                    .fd = idx.pages_fd,
                    .offset = e.pages_off + within,
                    .len = want_len,
                };
            }
        }
        return null;
    }
};

// --- protobuf varint / tag decode (proto2, only what we need)

const ProtoErr = error{ Truncated, Overflow, BadWireType };

const ProtoReader = struct {
    buf: []const u8,
    pos: usize = 0,

    fn remaining(self: *const ProtoReader) usize {
        return self.buf.len - self.pos;
    }

    fn readVarint(self: *ProtoReader) ProtoErr!u64 {
        var result: u64 = 0;
        var shift: u6 = 0;
        while (true) {
            if (self.pos >= self.buf.len) return ProtoErr.Truncated;
            const b = self.buf[self.pos];
            self.pos += 1;
            result |= @as(u64, b & 0x7f) << shift;
            if (b & 0x80 == 0) return result;
            if (shift >= 63) return ProtoErr.Overflow;
            shift += 7;
        }
    }

    fn skipField(self: *ProtoReader, wire_type: u3) ProtoErr!void {
        switch (wire_type) {
            0 => _ = try self.readVarint(),
            1 => {
                if (self.remaining() < 8) return ProtoErr.Truncated;
                self.pos += 8;
            },
            2 => {
                const len = try self.readVarint();
                if (len > self.remaining()) return ProtoErr.Truncated;
                self.pos += @intCast(len);
            },
            5 => {
                if (self.remaining() < 4) return ProtoErr.Truncated;
                self.pos += 4;
            },
            else => return ProtoErr.BadWireType,
        }
    }
};

const PagemapHead = struct {
    pages_id: u32,
};

fn parsePagemapHead(buf: []const u8) ProtoErr!PagemapHead {
    var r = ProtoReader{ .buf = buf };
    var pages_id: ?u32 = null;
    while (r.pos < r.buf.len) {
        const tag_v = try r.readVarint();
        const wire_type: u3 = @intCast(tag_v & 0x7);
        const field: u32 = @intCast(tag_v >> 3);
        if (field == 1 and wire_type == 0) {
            pages_id = @intCast(try r.readVarint());
        } else {
            try r.skipField(wire_type);
        }
    }
    return .{ .pages_id = pages_id orelse return ProtoErr.Truncated };
}

const PagemapEntryRaw = struct {
    vaddr: u64,
    nr_pages: u64,
    flags: u32,
};

fn parsePagemapEntry(buf: []const u8) ProtoErr!PagemapEntryRaw {
    var r = ProtoReader{ .buf = buf };
    var vaddr: ?u64 = null;
    var compat_nr_pages: ?u32 = null;
    var nr_pages: ?u64 = null;
    var flags: u32 = 0;
    while (r.pos < r.buf.len) {
        const tag_v = try r.readVarint();
        const wire_type: u3 = @intCast(tag_v & 0x7);
        const field: u32 = @intCast(tag_v >> 3);
        switch (field) {
            1 => { // vaddr
                if (wire_type != 0) return ProtoErr.BadWireType;
                vaddr = try r.readVarint();
            },
            2 => { // compat_nr_pages
                if (wire_type != 0) return ProtoErr.BadWireType;
                compat_nr_pages = @intCast(try r.readVarint());
            },
            3 => { // in_parent — ignored
                if (wire_type != 0) return ProtoErr.BadWireType;
                _ = try r.readVarint();
            },
            4 => { // flags
                if (wire_type != 0) return ProtoErr.BadWireType;
                flags = @intCast(try r.readVarint());
            },
            5 => { // nr_pages (preferred over compat_nr_pages when set)
                if (wire_type != 0) return ProtoErr.BadWireType;
                nr_pages = try r.readVarint();
            },
            else => try r.skipField(wire_type),
        }
    }
    return .{
        .vaddr = vaddr orelse return ProtoErr.Truncated,
        .nr_pages = nr_pages orelse @as(u64, compat_nr_pages orelse return ProtoErr.Truncated),
        .flags = flags,
    };
}

// --- bundle loading

/// Fully drain `count` bytes from `fd`. Errors on EOF before count.
fn readExact(fd: c_int, buf: []u8) !void {
    var off: usize = 0;
    while (off < buf.len) {
        const n = read(fd, buf[off..].ptr, buf.len - off);
        if (n < 0) return error.IoError;
        if (n == 0) return error.UnexpectedEof;
        off += @intCast(n);
    }
}

fn readU32LE(fd: c_int) !u32 {
    var buf: [4]u8 = undefined;
    try readExact(fd, &buf);
    return std.mem.readInt(u32, &buf, .little);
}

fn readU32LEorEof(fd: c_int) !?u32 {
    var buf: [4]u8 = undefined;
    var off: usize = 0;
    while (off < buf.len) {
        const n = read(fd, buf[off..].ptr, buf.len - off);
        if (n < 0) return error.IoError;
        if (n == 0) {
            if (off == 0) return null;
            return error.UnexpectedEof;
        }
        off += @intCast(n);
    }
    return std.mem.readInt(u32, &buf, .little);
}

fn parsePidFromName(name: []const u8) ?u64 {
    const prefix = "pagemap-";
    const suffix = ".img";
    if (!std.mem.startsWith(u8, name, prefix)) return null;
    if (!std.mem.endsWith(u8, name, suffix)) return null;
    const inner = name[prefix.len .. name.len - suffix.len];
    return std.fmt.parseInt(u64, inner, 10) catch null;
}

/// Build a 0-terminated copy of `parent + "/" + child` in `buf`. Returns
/// a sentinel slice into `buf`.
fn joinZ(buf: []u8, parent: []const u8, child: []const u8) ![:0]u8 {
    if (parent.len + 1 + child.len + 1 > buf.len) return error.PathTooLong;
    @memcpy(buf[0..parent.len], parent);
    buf[parent.len] = '/';
    @memcpy(buf[parent.len + 1 ..][0..child.len], child);
    buf[parent.len + 1 + child.len] = 0;
    return buf[0 .. parent.len + 1 + child.len :0];
}

fn loadBundle(allocator: std.mem.Allocator, dir_path: []const u8) !Bundle {
    var bundle: Bundle = .{ .allocator = allocator };
    errdefer bundle.deinit();

    var dir_path_buf: [1024]u8 = undefined;
    if (dir_path.len + 1 > dir_path_buf.len) return error.PathTooLong;
    @memcpy(dir_path_buf[0..dir_path.len], dir_path);
    dir_path_buf[dir_path.len] = 0;

    const dir = opendir(@ptrCast(&dir_path_buf)) orelse return error.OpenDirFailed;
    defer _ = closedir(dir);

    while (readdir(dir)) |dent| {
        const name_len: usize = @intCast(dent.d_namlen);
        const name = dent.d_name[0..name_len];
        const pid = parsePidFromName(name) orelse continue;
        try loadPagemap(allocator, &bundle, dir_path, name, pid);
    }
    return bundle;
}

fn loadPagemap(
    allocator: std.mem.Allocator,
    bundle: *Bundle,
    dir_path: []const u8,
    name: []const u8,
    pid: u64,
) !void {
    var path_buf: [2048]u8 = undefined;
    const pmpath = try joinZ(&path_buf, dir_path, name);
    const pmfd = open(pmpath.ptr, O_RDONLY);
    if (pmfd < 0) return error.OpenFailed;
    defer _ = close(pmfd);

    if (try readU32LE(pmfd) != IMG_COMMON_MAGIC) {
        log.err("{s}: bad common magic", .{name});
        return error.BadMagic;
    }
    if (try readU32LE(pmfd) != PAGEMAP_MAGIC) {
        log.err("{s}: bad pagemap magic", .{name});
        return error.BadMagic;
    }

    // First message: pagemap_head { pages_id }.
    const head_size = try readU32LE(pmfd);
    if (head_size > 4096) return error.HeadTooLarge;
    var head_buf: [4096]u8 = undefined;
    try readExact(pmfd, head_buf[0..head_size]);
    const head = try parsePagemapHead(head_buf[0..head_size]);

    // Subsequent messages: pagemap_entry, until EOF.
    var entries: std.ArrayList(Entry) = .empty;
    defer entries.deinit(allocator);
    var pages_off: u64 = 0;
    while (true) {
        const maybe_size = try readU32LEorEof(pmfd);
        if (maybe_size == null) break;
        const size = maybe_size.?;
        if (size > 4096) return error.EntryTooLarge;
        var entry_buf: [4096]u8 = undefined;
        try readExact(pmfd, entry_buf[0..size]);
        const pe = try parsePagemapEntry(entry_buf[0..size]);
        const len_bytes = pe.nr_pages * PAGE_SIZE;
        if (pe.flags & PE_PRESENT != 0) {
            try entries.append(allocator, .{
                .vaddr_lo = pe.vaddr,
                .vaddr_hi = pe.vaddr + len_bytes,
                .pages_off = pages_off,
            });
            pages_off += len_bytes;
        }
        // PE_LAZY-only / PE_PARENT entries don't consume bytes in pages-*.img.
    }

    // Open the matching pages-<pages_id>.img.
    var pages_name_buf: [64]u8 = undefined;
    const pages_name = try std.fmt.bufPrint(&pages_name_buf, "pages-{d}.img", .{head.pages_id});
    var pages_path_buf: [2048]u8 = undefined;
    const pages_path = try joinZ(&pages_path_buf, dir_path, pages_name);
    const pages_fd = open(pages_path.ptr, O_RDONLY);
    if (pages_fd < 0) {
        log.err("can't open {s}: errno={}", .{ pages_path, std.posix.errno(@as(c_int, -1)) });
        return error.OpenFailed;
    }
    errdefer _ = close(pages_fd);

    // Verify pages magic (8 bytes header: COMMON + RAW_IMAGE_MAGIC=0).
    if (try readU32LE(pages_fd) != IMG_COMMON_MAGIC) {
        log.err("{s}: bad common magic", .{pages_name});
        return error.BadMagic;
    }
    if (try readU32LE(pages_fd) != PAGES_MAGIC) {
        log.err("{s}: bad pages magic", .{pages_name});
        return error.BadMagic;
    }
    // After the 8-byte header, the file is raw page bytes. Patch all
    // entries to absolute file offsets so callers don't need to know
    // about the framing.
    const HEADER_BYTES: u64 = 8;
    for (entries.items) |*e| e.pages_off += HEADER_BYTES;

    const owned_entries = try entries.toOwnedSlice(allocator);

    try bundle.indexes.put(allocator, pid, .{
        .pid = pid,
        .pages_id = head.pages_id,
        .pages_fd = pages_fd,
        .entries = owned_entries,
    });
    log.info("loaded pid={} pages_id={} entries={} from {s}/{s}", .{
        pid,
        head.pages_id,
        owned_entries.len,
        dir_path,
        name,
    });
}

// --- TCP server

/// 32-byte wire layout matching `struct page_server_iov` in CRIU. We
/// hand-pack it instead of relying on `extern struct` so endianness
/// (always little on the platforms we care about — arm64 / x86_64)
/// and padding are explicit and reviewable.
const PSI_BYTES: usize = 32;

const PsIov = struct {
    cmd: u32,
    nr_pages: u64,
    vaddr: u64,
    dst_id: u64,

    fn fromWire(bytes: *const [PSI_BYTES]u8) PsIov {
        return .{
            .cmd = std.mem.readInt(u32, bytes[0..4], .little),
            // bytes[4..8] is the C struct's alignment pad after `cmd`.
            .nr_pages = std.mem.readInt(u64, bytes[8..16], .little),
            .vaddr = std.mem.readInt(u64, bytes[16..24], .little),
            .dst_id = std.mem.readInt(u64, bytes[24..32], .little),
        };
    }

    fn toWire(self: PsIov) [PSI_BYTES]u8 {
        var out: [PSI_BYTES]u8 = @splat(0);
        std.mem.writeInt(u32, out[0..4], self.cmd, .little);
        std.mem.writeInt(u64, out[8..16], self.nr_pages, .little);
        std.mem.writeInt(u64, out[16..24], self.vaddr, .little);
        std.mem.writeInt(u64, out[24..32], self.dst_id, .little);
        return out;
    }
};

fn recvAll(fd: c_int, buf: []u8) !void {
    var off: usize = 0;
    while (off < buf.len) {
        const n = recv(fd, buf[off..].ptr, buf.len - off, 0);
        if (n < 0) return error.IoError;
        if (n == 0) return error.EndOfStream;
        off += @intCast(n);
    }
}

fn sendAll(fd: c_int, buf: []const u8) !void {
    var off: usize = 0;
    while (off < buf.len) {
        const n = send(fd, buf[off..].ptr, buf.len - off, 0);
        if (n < 0) return error.IoError;
        if (n == 0) return error.WriteZero;
        off += @intCast(n);
    }
}

fn preadExact(fd: c_int, buf: []u8, offset: u64) !void {
    var off: usize = 0;
    while (off < buf.len) {
        const n = pread(fd, buf[off..].ptr, buf.len - off, @intCast(offset + off));
        if (n < 0) return error.IoError;
        if (n == 0) return error.UnexpectedEof;
        off += @intCast(n);
    }
}

fn handleConnection(bundle: *const Bundle, fd: c_int) !void {
    var page_buf: [PAGE_SIZE * 64]u8 = undefined; // 256 KiB per fault batch
    while (true) {
        var iov_buf: [PSI_BYTES]u8 = undefined;
        recvAll(fd, &iov_buf) catch |err| switch (err) {
            error.EndOfStream => return,
            else => return err,
        };
        const iov = PsIov.fromWire(&iov_buf);
        const cmd = iov.cmd & PS_CMD_MASK;
        switch (cmd) {
            PS_IOV_GET => try serveGet(bundle, fd, iov, &page_buf),
            PS_IOV_CLOSE, PS_IOV_FORCE_CLOSE => {
                var status: [4]u8 = @splat(0);
                try sendAll(fd, &status);
                return;
            },
            // Non-lazy clients can send these; respond stub-ily so a
            // misconfigured caller fails loudly rather than hangs.
            PS_IOV_OPEN, PS_IOV_OPEN2 => {
                var has_parent: [1]u8 = .{0};
                try sendAll(fd, &has_parent);
            },
            PS_IOV_PARENT => {
                var no: [4]u8 = @splat(0);
                try sendAll(fd, &no);
            },
            else => {
                log.warn("unsupported page-server cmd: 0x{x}", .{cmd});
                return error.UnsupportedCommand;
            },
        }
    }
}

fn serveGet(
    bundle: *const Bundle,
    fd: c_int,
    iov: PsIov,
    scratch: []u8,
) !void {
    const hit = bundle.lookup(iov.dst_id, iov.vaddr, iov.nr_pages);
    if (hit == null) {
        log.warn("GET miss: pid={} vaddr=0x{x} nr_pages={}", .{
            iov.dst_id, iov.vaddr, iov.nr_pages,
        });
        return error.PagesNotFound;
    }
    const h = hit.?;
    log.debug("GET pid={} vaddr=0x{x} nr={} → off=0x{x} len={}", .{
        iov.dst_id, iov.vaddr, iov.nr_pages, h.offset, h.len,
    });

    const reply_iov = PsIov{
        .cmd = PS_IOV_ADD_F | (PE_PRESENT << PS_CMD_BITS),
        .nr_pages = iov.nr_pages,
        .vaddr = iov.vaddr,
        .dst_id = iov.dst_id,
    };
    const header_bytes = reply_iov.toWire();
    try sendAll(fd, &header_bytes);

    // Page data: read in scratch-sized chunks from the pages file.
    var off = h.offset;
    var remaining = h.len;
    while (remaining > 0) {
        const chunk = @min(scratch.len, remaining);
        try preadExact(h.fd, scratch[0..chunk], off);
        try sendAll(fd, scratch[0..chunk]);
        off += chunk;
        remaining -= chunk;
    }
}

fn runServer(bundle: *const Bundle, addr_str: []const u8, port: u16) !void {
    var addr_buf: [64]u8 = undefined;
    if (addr_str.len + 1 > addr_buf.len) return error.AddrTooLong;
    @memcpy(addr_buf[0..addr_str.len], addr_str);
    addr_buf[addr_str.len] = 0;

    var sin: SockAddrIn = .{
        .sin_port = htons(port),
        .sin_addr = 0,
    };
    if (inet_pton(AF_INET, @ptrCast(&addr_buf), &sin.sin_addr) != 1) {
        log.err("invalid bind address: {s}", .{addr_str});
        return error.InvalidAddress;
    }

    const sk = socket(AF_INET, SOCK_STREAM, 0);
    if (sk < 0) return error.SocketFailed;
    defer _ = close(sk);

    const yes: c_int = 1;
    _ = setsockopt(sk, SOL_SOCKET, SO_REUSEADDR, @ptrCast(&yes), @sizeOf(c_int));

    if (bind(sk, @ptrCast(&sin), @sizeOf(SockAddrIn)) != 0) return error.BindFailed;
    if (listen(sk, 1) != 0) return error.ListenFailed;
    log.info("listening on {s}:{d}", .{ addr_str, port });

    while (true) {
        const cfd = accept(sk, null, null);
        if (cfd < 0) {
            log.warn("accept failed", .{});
            continue;
        }
        log.info("accepted client (fd={})", .{cfd});
        handleConnection(bundle, cfd) catch |err| {
            log.warn("connection error: {s}", .{@errorName(err)});
        };
        _ = close(cfd);
    }
}

// --- CLI

const Args = struct {
    images_dir: []const u8,
    addr: []const u8 = "0.0.0.0",
    port: u16,
};

fn usage() noreturn {
    std.debug.print(
        \\Usage: machinen-page-server -D <images-dir> --port <port> [--addr <addr>]
        \\
        \\Serves CRIU pages-*.img content from <images-dir> to a connecting
        \\`criu lazy-pages --page-server <addr>:<port>` client. Bundles are
        \\produced by `vm.snapshot()`; run this against the bundle's `img/`
        \\subdirectory.
        \\
        \\
    , .{});
    std.process.exit(2);
}

fn parseArgs(allocator: std.mem.Allocator, args_in: std.process.Args) !Args {
    var it = try std.process.Args.Iterator.initAllocator(args_in, allocator);
    defer it.deinit();
    _ = it.next(); // argv[0]

    var images_dir: ?[]const u8 = null;
    var addr: []const u8 = "0.0.0.0";
    var port: ?u16 = null;
    while (it.next()) |raw| {
        if (std.mem.eql(u8, raw, "-D") or std.mem.eql(u8, raw, "--images-dir")) {
            images_dir = try allocator.dupe(u8, it.next() orelse usage());
        } else if (std.mem.eql(u8, raw, "--port")) {
            port = std.fmt.parseInt(u16, it.next() orelse usage(), 10) catch usage();
        } else if (std.mem.eql(u8, raw, "--addr")) {
            addr = try allocator.dupe(u8, it.next() orelse usage());
        } else if (std.mem.eql(u8, raw, "--help") or std.mem.eql(u8, raw, "-h")) {
            usage();
        } else {
            std.debug.print("unknown argument: {s}\n", .{raw});
            usage();
        }
    }
    return .{
        .images_dir = images_dir orelse usage(),
        .addr = addr,
        .port = port orelse usage(),
    };
}

pub fn main(init: std.process.Init) !void {
    const allocator = init.gpa;
    const args = try parseArgs(allocator, init.minimal.args);

    var bundle = try loadBundle(allocator, args.images_dir);
    defer bundle.deinit();
    log.info("loaded {} pid index(es) from {s}", .{ bundle.indexes.count(), args.images_dir });

    try runServer(&bundle, args.addr, args.port);
}

// --- Tests

const testing = std.testing;

test "parsePagemapEntry: vaddr+nr_pages+flags" {
    // Build a protobuf message by hand:
    //   tag 1 wire 0 (varint), value 0xdeadbeef       → 08 ef fd b6 f5 0d
    //   tag 5 wire 0 (varint), value 4                 → 28 04
    //   tag 4 wire 0 (varint), value PE_PRESENT|PE_LAZY=6 → 20 06
    const buf = [_]u8{
        0x08, 0xef, 0xfd, 0xb6, 0xf5, 0x0d,
        0x28, 0x04,
        0x20, 0x06,
    };
    const pe = try parsePagemapEntry(&buf);
    try testing.expectEqual(@as(u64, 0xdeadbeef), pe.vaddr);
    try testing.expectEqual(@as(u64, 4), pe.nr_pages);
    try testing.expectEqual(@as(u32, 6), pe.flags);
}

test "parsePagemapEntry: falls back to compat_nr_pages when nr_pages missing" {
    // tag 1 = vaddr = 0, tag 2 = compat_nr_pages = 7.
    const buf = [_]u8{ 0x08, 0x00, 0x10, 0x07 };
    const pe = try parsePagemapEntry(&buf);
    try testing.expectEqual(@as(u64, 0), pe.vaddr);
    try testing.expectEqual(@as(u64, 7), pe.nr_pages);
}

test "parsePagemapHead: pages_id" {
    const buf = [_]u8{ 0x08, 0x2a }; // tag 1, value 42
    const head = try parsePagemapHead(&buf);
    try testing.expectEqual(@as(u32, 42), head.pages_id);
}

test "PsIov round-trip" {
    const orig = PsIov{
        .cmd = PS_IOV_ADD_F | (PE_PRESENT << PS_CMD_BITS),
        .nr_pages = 1234,
        .vaddr = 0xdeadbeefcafebabe,
        .dst_id = 999,
    };
    const wire = orig.toWire();
    const back = PsIov.fromWire(&wire);
    try testing.expectEqual(orig.cmd, back.cmd);
    try testing.expectEqual(orig.nr_pages, back.nr_pages);
    try testing.expectEqual(orig.vaddr, back.vaddr);
    try testing.expectEqual(orig.dst_id, back.dst_id);
}

test "Bundle.lookup binary search" {
    var bundle: Bundle = .{ .allocator = testing.allocator };
    defer bundle.deinit();

    // Three multi-page entries with gaps between them, so partial-
    // offset lookups inside a single entry can be exercised.
    const entries = try testing.allocator.alloc(Entry, 3);
    entries[0] = .{ .vaddr_lo = 0x1000, .vaddr_hi = 0x3000, .pages_off = 0x100 }; // 2 pages
    entries[1] = .{ .vaddr_lo = 0x4000, .vaddr_hi = 0x6000, .pages_off = 0x200 }; // 2 pages
    entries[2] = .{ .vaddr_lo = 0x7000, .vaddr_hi = 0x9000, .pages_off = 0x300 }; // 2 pages
    try bundle.indexes.put(testing.allocator, 42, .{
        .pid = 42,
        .pages_id = 1,
        .pages_fd = -1, // sentinel — close(-1) is harmless
        .entries = entries,
    });

    // Hit at the start of an entry.
    const a = bundle.lookup(42, 0x1000, 1).?;
    try testing.expectEqual(@as(u64, 0x100), a.offset);
    try testing.expectEqual(@as(u64, PAGE_SIZE), a.len);

    // Hit at a non-zero offset within an entry.
    const b = bundle.lookup(42, 0x5000, 1).?;
    try testing.expectEqual(@as(u64, 0x200 + 0x1000), b.offset);

    // Hit spanning the full remainder of an entry.
    const c = bundle.lookup(42, 0x4000, 2).?;
    try testing.expectEqual(@as(u64, 0x200), c.offset);
    try testing.expectEqual(@as(u64, 2 * PAGE_SIZE), c.len);

    // Range that would extend past the entry's end is a miss (CRIU
    // lazy-pages doesn't request across entries; we refuse rather
    // than splice).
    try testing.expect(bundle.lookup(42, 0x4000, 3) == null);
    // Miss in the gap between entries.
    try testing.expect(bundle.lookup(42, 0x3500, 1) == null);
    // Miss before all entries.
    try testing.expect(bundle.lookup(42, 0x0, 1) == null);
    // Miss past last entry.
    try testing.expect(bundle.lookup(42, 0x9000, 1) == null);
    // Wrong pid.
    try testing.expect(bundle.lookup(99, 0x1000, 1) == null);
}
