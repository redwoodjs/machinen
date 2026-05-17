//! Tiny in-place patcher for the FDT (Flattened Device Tree) blob
//! the runtime ships in `assets/virt.dtb`. The DTB is compiled from
//! `virt.dts` once and shipped as a static asset; values that depend
//! on per-boot config (initrd size, RAM ceiling) are rewritten here
//! before the guest kernel reads them.
//!
//! Two patches today:
//!   * `linux,initrd-end` — caps the kernel's initramfs scan window
//!     to the actual cpio length (#50, sub-second spawn).
//!   * `memory@40000000`'s `reg` size cells — tells the guest the
//!     real RAM ceiling so `MACHINEN_MEMORY` / `boot({ memory })`
//!     actually changes what the kernel sees (#263 phase A).
//!
//! Both walk the FDT structure block themselves rather than depending
//! on libfdt — keeps the dependency surface to zero and the code easy
//! to read alongside the DTB layout in `assets/virt.dts`.

const std = @import("std");

const assert = std.debug.assert;

// FDT tokens (all big-endian u32, per the spec).
const FDT_BEGIN_NODE: u32 = 1;
const FDT_END_NODE: u32 = 2;
const FDT_PROP: u32 = 3;
const FDT_NOP: u32 = 4;
const FDT_END: u32 = 9;

const FDT_HEADER_BYTES: usize = 40;
const FDT_MAGIC: u32 = 0xd00dfeed;

// Defensive ceilings on what the walker will tolerate from a malformed
// FDT before bailing out. The Devicetree spec doesn't impose either —
// these are sized to the only DTB we ship (assets/virt.dtb: <8 KiB, max
// depth ~3, longest name ~16 bytes). Bumping them is safe; the point is
// that *some* finite cap exists so a corrupted blob can't wedge boot.
const MAX_FDT_DEPTH: i32 = 64;
const MAX_NAME_BYTES: usize = 256;

comptime {
    // Token values are fixed by the Devicetree spec §5.4.1. If any of
    // these constants drifts, the wire format we walk is no longer FDT
    // and our hand-rolled parser would silently misread real DTBs.
    assert(FDT_BEGIN_NODE == 1);
    assert(FDT_END_NODE == 2);
    assert(FDT_PROP == 3);
    assert(FDT_NOP == 4);
    assert(FDT_END == 9);
    // We read fields up to dtb[36..40]; the header constant must cover them.
    assert(FDT_HEADER_BYTES >= 40);
    assert(MAX_FDT_DEPTH > 0);
    assert(MAX_NAME_BYTES > 0);
}

/// Header view of the FDT blob — just enough to walk struct/strings
/// blocks. All values are big-endian on the wire; this struct holds
/// them in host-native order after one read.
const Header = struct {
    off_struct: u32,
    off_strings: u32,
    size_strings: u32,

    fn read(dtb: []const u8) !Header {
        assert(dtb.len > 0);
        if (dtb.len < FDT_HEADER_BYTES) return error.DtbTooSmall;
        assert(dtb.len >= FDT_HEADER_BYTES);
        const magic = std.mem.readInt(u32, dtb[0..4], .big);
        if (magic != FDT_MAGIC) return error.DtbBadMagic;
        const h: Header = .{
            .off_struct = std.mem.readInt(u32, dtb[8..12], .big),
            .off_strings = std.mem.readInt(u32, dtb[12..16], .big),
            .size_strings = std.mem.readInt(u32, dtb[32..36], .big),
        };
        if (@as(usize, h.off_strings) + @as(usize, h.size_strings) > dtb.len) return error.DtbOutOfBounds;
        if (h.off_struct > dtb.len) return error.DtbOutOfBounds;
        if (h.size_strings == 0) return error.DtbBadStrings;
        // Spec §5.2: struct/strings blocks live past the header. A
        // header that points either offset back inside itself can't
        // be a real FDT — our walker would read header bytes as tokens.
        if (h.off_struct < FDT_HEADER_BYTES) return error.DtbBadStruct;
        if (h.off_strings < FDT_HEADER_BYTES) return error.DtbBadStrings;
        // Pair the parse-time defenses with assertions so the rest of
        // the file can rely on them without re-checking.
        assert(h.off_struct >= FDT_HEADER_BYTES);
        assert(h.off_struct <= dtb.len);
        assert(h.off_strings >= FDT_HEADER_BYTES);
        assert(@as(usize, h.off_strings) + @as(usize, h.size_strings) <= dtb.len);
        assert(h.size_strings > 0);
        return h;
    }

    fn string_offset(self: Header, dtb: []const u8, needle: []const u8) ?u32 {
        assert(needle.len > 0);
        assert(@as(usize, self.off_strings) + @as(usize, self.size_strings) <= dtb.len);
        const strings = dtb[self.off_strings..][0..self.size_strings];
        const pos = std.mem.indexOf(u8, strings, needle) orelse return null;
        // size_strings is u32, so any in-range position fits in u32.
        assert(pos < self.size_strings);
        return @intCast(pos);
    }
};

/// Overwrite the `linux,initrd-end` u32 cell in a DTB with `new_end`.
///
/// Linux treats [initrd-start, initrd-end) as the initramfs region and
/// scans the whole window for cpio / compressed archives. Patching the
/// end pointer to match the actual cpio length stops the kernel from
/// burning wall-clock walking dead tail.
pub fn patch_initrd_end(dtb: []u8, new_end: u32) !void {
    assert(dtb.len > 0);
    const h = try Header.read(dtb);
    const needle = "linux,initrd-end\x00";
    const name_offset = h.string_offset(dtb, needle) orelse return error.InitrdEndNotFound;

    // Each loop iteration consumes at least 4 bytes (one token), so
    // dtb.len/4 is a hard upper bound on iterations. +1 covers the
    // trailing exit check. Tigerstyle: every loop bounded.
    const max_iters: usize = (dtb.len / 4) + 1;
    var iters: usize = 0;
    var i: usize = h.off_struct;
    while (i + 4 <= dtb.len) : (iters += 1) {
        if (iters >= max_iters) return error.DtbTruncated;
        assert(i + 4 <= dtb.len);
        const tok = std.mem.readInt(u32, dtb[i..][0..4], .big);
        i += 4;
        switch (tok) {
            FDT_BEGIN_NODE => i = try skip_name(dtb, i),
            FDT_END_NODE, FDT_NOP => {},
            FDT_PROP => {
                if (i + 8 > dtb.len) return error.DtbTruncated;
                const plen = std.mem.readInt(u32, dtb[i..][0..4], .big);
                const nameoff = std.mem.readInt(u32, dtb[i + 4 ..][0..4], .big);
                i += 8;
                if (nameoff == name_offset) {
                    if (plen != 4) return error.InitrdEndWrongSize;
                    if (i + 4 > dtb.len) return error.DtbTruncated;
                    std.mem.writeInt(u32, dtb[i..][0..4], new_end, .big);
                    return;
                }
                if (@as(usize, plen) > dtb.len - i) return error.DtbTruncated;
                i += plen;
                i = std.mem.alignForward(usize, i, 4);
                if (i > dtb.len) return error.DtbTruncated;
                assert(i <= dtb.len);
            },
            FDT_END => return error.InitrdEndNotFound,
            else => return error.DtbBadToken,
        }
    }
    assert(iters <= max_iters);
    return error.DtbTruncated;
}

/// Overwrite the size cells of the top-level `memory@...` node's `reg`
/// property so the guest kernel sees `size_bytes` of RAM. Assumes
/// `#address-cells = 2` and `#size-cells = 2` (the layout `virt.dts`
/// uses) — i.e. `reg` is exactly 16 bytes (4×u32 BE), the first 8
/// bytes being the address and the last 8 the size as a big-endian
/// u64.
///
/// Only patches a `memory@...` node that's a *direct child of the
/// root*. The FDT root is itself a node (with an empty name), so
/// "child of root" means depth == 2 in the BEGIN_NODE/END_NODE
/// counter. `reserved-memory`'s inner `memory@...` entries live at
/// depth 3 and are correctly skipped.
pub fn patch_memory_size(dtb: []u8, size_bytes: u64) !void {
    assert(dtb.len > 0);
    if (size_bytes == 0) return error.MemorySizeZero;
    const h = try Header.read(dtb);
    const reg_offset = h.string_offset(dtb, "reg\x00") orelse return error.RegPropNotFound;

    // Walk the struct block. `depth` counts open BEGIN_NODE tokens;
    // root sits at depth 1, its children at depth 2.
    const ROOT_CHILD_DEPTH: i32 = 2;
    const max_iters: usize = (dtb.len / 4) + 1;
    var iters: usize = 0;
    var i: usize = h.off_struct;
    var depth: i32 = 0;
    var in_memory_node: bool = false;
    while (i + 4 <= dtb.len) : (iters += 1) {
        if (iters >= max_iters) return error.DtbTruncated;
        assert(i + 4 <= dtb.len);
        assert(depth >= 0);
        assert(depth < MAX_FDT_DEPTH);
        const tok = std.mem.readInt(u32, dtb[i..][0..4], .big);
        i += 4;
        switch (tok) {
            FDT_BEGIN_NODE => {
                if (depth >= MAX_FDT_DEPTH) return error.DtbTooDeep;
                const name_start = i;
                i = try skip_name(dtb, i);
                depth += 1;
                assert(depth > 0);
                assert(depth <= MAX_FDT_DEPTH);
                if (depth == ROOT_CHILD_DEPTH) {
                    const name = name_slice(dtb, name_start);
                    in_memory_node = is_memory_node_name(name);
                }
            },
            FDT_END_NODE => {
                if (depth == 0) return error.DtbBadToken;
                if (in_memory_node and depth == ROOT_CHILD_DEPTH) {
                    // Left the memory@ node without finding `reg`.
                    return error.MemoryRegNotFound;
                }
                depth -= 1;
                assert(depth >= 0);
            },
            FDT_NOP => {},
            FDT_PROP => {
                if (i + 8 > dtb.len) return error.DtbTruncated;
                const plen = std.mem.readInt(u32, dtb[i..][0..4], .big);
                const nameoff = std.mem.readInt(u32, dtb[i + 4 ..][0..4], .big);
                i += 8;
                if (in_memory_node and depth == ROOT_CHILD_DEPTH and nameoff == reg_offset) {
                    if (plen != 16) return error.MemoryRegWrongSize;
                    if (i + 16 > dtb.len) return error.DtbTruncated;
                    // Address cells (0..8) stay at 0x4000_0000 base;
                    // size cells (8..16) become the new size.
                    std.mem.writeInt(u64, dtb[i + 8 ..][0..8], size_bytes, .big);
                    return;
                }
                if (@as(usize, plen) > dtb.len - i) return error.DtbTruncated;
                i += plen;
                i = std.mem.alignForward(usize, i, 4);
                if (i > dtb.len) return error.DtbTruncated;
                assert(i <= dtb.len);
            },
            FDT_END => return error.MemoryRegNotFound,
            else => return error.DtbBadToken,
        }
    }
    assert(iters <= max_iters);
    assert(depth >= 0);
    return error.DtbTruncated;
}

fn skip_name(dtb: []const u8, start: usize) !usize {
    assert(start <= dtb.len);
    var i = start;
    while (i < dtb.len and dtb[i] != 0) : (i += 1) {
        if (i - start >= MAX_NAME_BYTES) return error.DtbBadName;
    }
    if (i >= dtb.len) return error.DtbTruncated;
    assert(i < dtb.len);
    assert(dtb[i] == 0);
    i += 1; // consume null
    const aligned = std.mem.alignForward(usize, i, 4);
    if (aligned > dtb.len) return error.DtbTruncated;
    assert(aligned >= i);
    assert(aligned <= dtb.len);
    return aligned;
}

fn name_slice(dtb: []const u8, start: usize) []const u8 {
    assert(start <= dtb.len);
    var end = start;
    // Always reached after skipName succeeded, so the name is bounded
    // by MAX_NAME_BYTES. Asserting it here keeps the helper self-checking.
    while (end < dtb.len and dtb[end] != 0) : (end += 1) {}
    assert(end >= start);
    assert(end - start <= MAX_NAME_BYTES);
    return dtb[start..end];
}

/// True for both bare `memory` and `memory@<unit-address>` (the
/// canonical name for a real DTS-compiled node).
fn is_memory_node_name(name: []const u8) bool {
    assert(name.len <= MAX_NAME_BYTES);
    if (std.mem.eql(u8, name, "memory")) return true;
    if (std.mem.startsWith(u8, name, "memory@")) return true;
    return false;
}

// --- tests ---

test "patchInitrdEnd round-trips a minimal hand-built DTB" {
    var buf = minimal_single_prop_dtb("linux,initrd-end\x00", 4, &[_]u8{ 0xaa, 0xbb, 0xcc, 0xdd });
    try patch_initrd_end(buf.bytes(), 0x12345678);
    // Layout from `minimalSinglePropDtb` (offset relative to struct_off):
    //   0..4   BEGIN_NODE
    //   4..8   empty name + pad
    //   8..12  PROP token
    //   12..16 plen
    //   16..20 nameoff
    //   20..24 value
    const data_off = buf.struct_off + 20;
    const got = std.mem.readInt(u32, buf.storage[data_off..][0..4], .big);
    try std.testing.expectEqual(@as(u32, 0x12345678), got);
}

test "patchInitrdEnd rejects bad magic" {
    var bytes = [_]u8{0} ** 40;
    try std.testing.expectError(error.DtbBadMagic, patch_initrd_end(&bytes, 0));
}

test "patchInitrdEnd rejects header with off_struct inside header" {
    // off_struct < FDT_HEADER_BYTES means the struct block would
    // overlap the header — walking from there would read FDT_MAGIC
    // bytes as tokens. The defense lives in Header.read.
    var bytes = [_]u8{0} ** 80;
    std.mem.writeInt(u32, bytes[0..4], FDT_MAGIC, .big);
    std.mem.writeInt(u32, bytes[4..8], 80, .big); // totalsize
    std.mem.writeInt(u32, bytes[8..12], 8, .big); // off_struct (BAD)
    std.mem.writeInt(u32, bytes[12..16], 40, .big); // off_strings
    std.mem.writeInt(u32, bytes[32..36], 1, .big); // size_strings
    try std.testing.expectError(error.DtbBadStruct, patch_initrd_end(&bytes, 0));
}

test "patchInitrdEnd reports a missing property" {
    var buf = minimal_single_prop_dtb("some,other\x00", 4, &[_]u8{ 0, 0, 0, 0 });
    try std.testing.expectError(error.InitrdEndNotFound, patch_initrd_end(buf.bytes(), 0x1));
}

test "patchMemorySize rewrites the reg size cells of memory@..." {
    var buf = minimal_memory_node_dtb(0x4000_0000, 0x1_0000_0000);
    try patch_memory_size(buf.bytes(), 0x4_0000_0000);
    // reg property data sits 4 bytes (PROP-len) + 4 bytes (PROP-nameoff)
    // past the FDT_PROP token. minimalMemoryNodeDtb places the PROP at
    // a known offset inside the struct block; the helper exposes it.
    const data_off = buf.reg_data_off;
    const got_addr = std.mem.readInt(u64, buf.storage[data_off..][0..8], .big);
    const got_size = std.mem.readInt(u64, buf.storage[data_off + 8 ..][0..8], .big);
    try std.testing.expectEqual(@as(u64, 0x4000_0000), got_addr);
    try std.testing.expectEqual(@as(u64, 0x4_0000_0000), got_size);
}

test "patchMemorySize refuses size_bytes == 0" {
    var buf = minimal_memory_node_dtb(0x4000_0000, 0x1_0000_0000);
    try std.testing.expectError(error.MemorySizeZero, patch_memory_size(buf.bytes(), 0));
}

test "patchMemorySize ignores a depth>1 memory node (e.g. reserved-memory)" {
    // Build a DTB where the only node named "memory" lives at depth 2;
    // depth-1 walk should never enter it, so the patch reports
    // MemoryRegNotFound rather than corrupting an unrelated node.
    var buf = nested_memory_node_dtb();
    try std.testing.expectError(error.MemoryRegNotFound, patch_memory_size(buf.bytes(), 0x1000));
}

// Real-fixture coverage (DTB shape match against `assets/virt.dtb`)
// is exercised end-to-end by the boot_hvf / boot_kvm smoke tests in
// `pnpm smoke-tests`, where a DTS-shape regression surfaces as a
// guest with the wrong MemTotal. The synthetic-DTB tests above cover
// the FDT walker logic itself.

// ---- test fixture builders ----

const FixtureBuf = struct {
    storage: [256]u8,
    total_len: usize,
    struct_off: usize,
    reg_data_off: usize = 0,

    fn bytes(self: *FixtureBuf) []u8 {
        return self.storage[0..self.total_len];
    }
};

/// Build a 1-node DTB with one property. Property name lives in the
/// strings block (via `name_with_nul`), value is `value` (length
/// `plen`). Layout is the same minimal shape as the boot_hvf test
/// fixture, just generalized.
fn minimal_single_prop_dtb(name_with_nul: []const u8, plen: u32, value: []const u8) FixtureBuf {
    var fb: FixtureBuf = undefined;
    fb.storage = [_]u8{0} ** 256;

    // 0x00 header (40 bytes), 0x28 rsvmap terminator (16 bytes),
    // 0x38 struct block, 0x?? strings block. Struct breakdown:
    //   BEGIN_NODE token (4) + empty name "" + 3 pad   = 8
    //   PROP token (4) + plen (4) + nameoff (4)        = 12
    //   value, padded to a 4-byte boundary             = padded
    //   END_NODE (4) + END (4)                         = 8
    const struct_off: u32 = 0x38;
    const padded_value_len = std.mem.alignForward(usize, plen, 4);
    const struct_size: u32 = @intCast(8 + 12 + padded_value_len + 4 + 4);
    const strings_off: u32 = struct_off + struct_size;
    const strings_size: u32 = @intCast(name_with_nul.len);
    const total: u32 = strings_off + strings_size;

    // header
    std.mem.writeInt(u32, fb.storage[0..4], FDT_MAGIC, .big);
    std.mem.writeInt(u32, fb.storage[4..8], total, .big);
    std.mem.writeInt(u32, fb.storage[8..12], struct_off, .big);
    std.mem.writeInt(u32, fb.storage[12..16], strings_off, .big);
    std.mem.writeInt(u32, fb.storage[16..20], 0x28, .big); // off_mem_rsvmap
    std.mem.writeInt(u32, fb.storage[20..24], 17, .big); // version
    std.mem.writeInt(u32, fb.storage[24..28], 16, .big); // last_comp_version
    std.mem.writeInt(u32, fb.storage[28..32], 0, .big); // boot_cpuid
    std.mem.writeInt(u32, fb.storage[32..36], strings_size, .big);
    std.mem.writeInt(u32, fb.storage[36..40], struct_size, .big);

    // struct block: BEGIN_NODE "" / PROP / value / END_NODE / END
    var off: usize = struct_off;
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_BEGIN_NODE, .big);
    off += 4;
    fb.storage[off] = 0; // empty node name
    off += 4; // skip nul + 3 pad

    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_PROP, .big);
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], plen, .big);
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], 0, .big); // nameoff = 0
    off += 4;
    @memcpy(fb.storage[off..][0..plen], value[0..plen]);
    off += padded_value_len;

    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END_NODE, .big);
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END, .big);
    off += 4;

    // strings block: just `name_with_nul`.
    @memcpy(fb.storage[strings_off..][0..name_with_nul.len], name_with_nul);

    fb.total_len = total;
    fb.struct_off = struct_off;
    return fb;
}

/// Build a DTB shaped like a real one: root "/" wrapping a single
/// `memory@40000000` child with one `reg` property (16 bytes;
/// address+size, 2 cells each). Matches the shape patchMemorySize
/// expects to walk in `assets/virt.dtb`.
fn minimal_memory_node_dtb(addr: u64, size: u64) FixtureBuf {
    var fb: FixtureBuf = undefined;
    fb.storage = [_]u8{0} ** 256;

    const node_name = "memory@40000000\x00"; // 16 bytes incl. nul
    const reg_str = "reg\x00";

    const struct_off: u32 = 0x38;
    // Layout (byte counts):
    //   BEGIN_NODE root (4) + "" + 3 pad                 = 8
    //   BEGIN_NODE memory (4) + name (16, aligned)       = 20
    //   PROP token (4) + head plen+nameoff (8)           = 12
    //   reg payload                                       = 16
    //   END_NODE memory (4) + END_NODE root (4) + END(4) = 12
    const struct_size: u32 = 8 + 20 + 12 + 16 + 12;
    const strings_off: u32 = struct_off + struct_size;
    const strings_size: u32 = @intCast(reg_str.len);
    const total: u32 = strings_off + strings_size;

    std.mem.writeInt(u32, fb.storage[0..4], FDT_MAGIC, .big);
    std.mem.writeInt(u32, fb.storage[4..8], total, .big);
    std.mem.writeInt(u32, fb.storage[8..12], struct_off, .big);
    std.mem.writeInt(u32, fb.storage[12..16], strings_off, .big);
    std.mem.writeInt(u32, fb.storage[16..20], 0x28, .big);
    std.mem.writeInt(u32, fb.storage[20..24], 17, .big);
    std.mem.writeInt(u32, fb.storage[24..28], 16, .big);
    std.mem.writeInt(u32, fb.storage[28..32], 0, .big);
    std.mem.writeInt(u32, fb.storage[32..36], strings_size, .big);
    std.mem.writeInt(u32, fb.storage[36..40], struct_size, .big);

    var off: usize = struct_off;
    // BEGIN root, empty name (1 byte nul + 3 pad).
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_BEGIN_NODE, .big);
    off += 4;
    fb.storage[off] = 0;
    off += 4;

    // BEGIN memory@40000000 (16 bytes including nul, 4-aligned).
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_BEGIN_NODE, .big);
    off += 4;
    @memcpy(fb.storage[off..][0..node_name.len], node_name);
    off += node_name.len;

    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_PROP, .big);
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], 16, .big); // plen
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], 0, .big); // nameoff = 0 (reg\0 at strings[0])
    off += 4;
    fb.reg_data_off = off;
    std.mem.writeInt(u64, fb.storage[off..][0..8], addr, .big);
    std.mem.writeInt(u64, fb.storage[off + 8 ..][0..8], size, .big);
    off += 16;

    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END_NODE, .big); // close memory
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END_NODE, .big); // close root
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END, .big);
    off += 4;

    @memcpy(fb.storage[strings_off..][0..reg_str.len], reg_str);

    fb.total_len = total;
    fb.struct_off = struct_off;
    return fb;
}

/// Build a DTB shaped like `root → reserved-memory → memory@40000000`
/// — i.e. the memory-named node lives at depth 3 (grandchild of root).
/// patchMemorySize should not touch it; only direct children of root
/// (depth 2) are valid candidates.
fn nested_memory_node_dtb() FixtureBuf {
    var fb: FixtureBuf = undefined;
    fb.storage = [_]u8{0} ** 256;

    const wrap_name = "wrap\x00\x00\x00\x00"; // padded to 8
    const inner_name = "memory@40000000\x00"; // 16 bytes
    const reg_str = "reg\x00";

    const struct_off: u32 = 0x38;
    // Layout:
    //   BEGIN_NODE root (4) + "" + pad                = 8
    //   BEGIN_NODE wrap (4) + name (8)                = 12
    //   BEGIN_NODE memory (4) + name (16)             = 20
    //   PROP head (4) + plen (4) + nameoff (4)        = 12
    //   reg payload                                    = 16
    //   END_NODE × 3 (4 each) + END (4)               = 16
    const struct_size: u32 = 8 + 12 + 20 + 12 + 16 + 16;
    const strings_off: u32 = struct_off + struct_size;
    const strings_size: u32 = @intCast(reg_str.len);
    const total: u32 = strings_off + strings_size;

    std.mem.writeInt(u32, fb.storage[0..4], FDT_MAGIC, .big);
    std.mem.writeInt(u32, fb.storage[4..8], total, .big);
    std.mem.writeInt(u32, fb.storage[8..12], struct_off, .big);
    std.mem.writeInt(u32, fb.storage[12..16], strings_off, .big);
    std.mem.writeInt(u32, fb.storage[16..20], 0x28, .big);
    std.mem.writeInt(u32, fb.storage[20..24], 17, .big);
    std.mem.writeInt(u32, fb.storage[24..28], 16, .big);
    std.mem.writeInt(u32, fb.storage[28..32], 0, .big);
    std.mem.writeInt(u32, fb.storage[32..36], strings_size, .big);
    std.mem.writeInt(u32, fb.storage[36..40], struct_size, .big);

    var off: usize = struct_off;
    // BEGIN root, empty name.
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_BEGIN_NODE, .big);
    off += 4;
    fb.storage[off] = 0;
    off += 4;

    // BEGIN wrap.
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_BEGIN_NODE, .big);
    off += 4;
    @memcpy(fb.storage[off..][0..wrap_name.len], wrap_name);
    off += wrap_name.len;

    // BEGIN memory@40000000.
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_BEGIN_NODE, .big);
    off += 4;
    @memcpy(fb.storage[off..][0..inner_name.len], inner_name);
    off += inner_name.len;

    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_PROP, .big);
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], 16, .big);
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], 0, .big);
    off += 4;
    fb.reg_data_off = off;
    std.mem.writeInt(u64, fb.storage[off..][0..8], 0x4000_0000, .big);
    std.mem.writeInt(u64, fb.storage[off + 8 ..][0..8], 0x1000, .big);
    off += 16;

    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END_NODE, .big); // close memory
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END_NODE, .big); // close wrap
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END_NODE, .big); // close root
    off += 4;
    std.mem.writeInt(u32, fb.storage[off..][0..4], FDT_END, .big);
    off += 4;

    @memcpy(fb.storage[strings_off..][0..reg_str.len], reg_str);

    fb.total_len = total;
    fb.struct_off = struct_off;
    return fb;
}
