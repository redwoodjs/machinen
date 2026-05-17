// Single-syscall APFS directory clone via clonefile(2).
//
// `cp -c -R` walks the tree and calls clonefile() per file (~135us each
// of metadata work). For a 42k-file repo that's ~5s. Calling clonefile(2)
// once on the source directory clones the whole subtree in the kernel,
// ~10x faster.
//
// Build: zig build-exe -O ReleaseSmall scripts/clonefile.zig -femit-bin=scripts/clonefile
// Usage: clonefile <src> <dst>

const std = @import("std");

extern "c" fn clonefile(src: [*:0]const u8, dst: [*:0]const u8, flags: u32) c_int;
extern "c" fn write(fd: c_int, buf: [*]const u8, n: usize) isize;
extern "c" fn __error() *c_int;

fn err_out(msg: []const u8, rc: u8) u8 {
    _ = write(2, msg.ptr, msg.len);
    return rc;
}

pub fn main(init: std.process.Init.Minimal) u8 {
    var it = init.args.iterate();
    _ = it.next(); // argv[0]
    const src = it.next() orelse return err_out("usage: clonefile <src> <dst>\n", 2);
    const dst = it.next() orelse return err_out("usage: clonefile <src> <dst>\n", 2);
    if (it.next() != null) return err_out("usage: clonefile <src> <dst>\n", 2);

    if (clonefile(src.ptr, dst.ptr, 0) != 0) {
        const e = __error().*;
        var buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "clonefile failed: errno={d}\n", .{e}) catch "clonefile failed\n";
        _ = write(2, msg.ptr, msg.len);
        return 1;
    }
    return 0;
}
