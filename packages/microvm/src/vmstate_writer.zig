//! Async `.vmstate` writer.
//!
//! The backend run loops must stop the vCPU while they capture live
//! state (registers, sparse RAM payload, GIC, virtio transport state),
//! but compression and disk I/O only need an immutable copy of that
//! captured state. This helper owns that copy in a per-snapshot arena
//! and writes it on a joinable background thread so the guest can
//! resume as soon as capture finishes.

const std = @import("std");
const builtin = @import("builtin");
const snapshot = @import("snapshot.zig");
const vmstate_zip = @import("vmstate_zip.zig");

const thread_spawn_config = std.Thread.SpawnConfig{
    .stack_size = std.Thread.SpawnConfig.default_stack_size,
    .allocator = null,
};

pub const Job = struct {
    allocator: std.mem.Allocator,
    arena: std.heap.ArenaAllocator,
    label: []const u8,
    path: []const u8,
    arch: u32,
    topology_hash: [32]u8,
    sections: []const snapshot.Section,

    /// Allocate a job and copy the output path into the job arena.
    /// Backend-specific capture code should allocate every section
    /// payload and the final `sections` slice from `arenaAllocator()`;
    /// the writer thread deinitializes the arena after the atomic
    /// rename completes (or fails).
    pub fn create(
        allocator: std.mem.Allocator,
        label: []const u8,
        path: []const u8,
        topology_hash: [32]u8,
    ) !*Job {
        return create_with_arch(allocator, label, path, snapshot.ARCH_AARCH64, topology_hash);
    }

    pub fn create_with_arch(
        allocator: std.mem.Allocator,
        label: []const u8,
        path: []const u8,
        arch: u32,
        topology_hash: [32]u8,
    ) !*Job {
        const job = try allocator.create(Job);
        job.* = .{
            .allocator = allocator,
            .arena = std.heap.ArenaAllocator.init(allocator),
            .label = label,
            .path = undefined,
            .arch = arch,
            .topology_hash = topology_hash,
            .sections = &.{},
        };
        errdefer {
            job.arena.deinit();
            allocator.destroy(job);
        }
        job.path = try job.arena.allocator().dupe(u8, path);
        return job;
    }

    pub fn arena_allocator(self: *Job) std.mem.Allocator {
        return self.arena.allocator();
    }

    pub fn destroy(self: *Job) void {
        self.arena.deinit();
        self.allocator.destroy(self);
    }
};

pub const Writer = struct {
    handle: ?std.Thread = null,
    done: std.atomic.Value(bool) = .init(true),

    pub const StartError = std.Thread.SpawnError || error{SnapshotInFlight};

    /// Start a background encode/compress/write. Takes ownership of
    /// `job` on success; on error, the caller still owns it and can
    /// fall back to `writeAndDestroy(job)`.
    pub fn start(self: *Writer, job: *Job) StartError!void {
        self.reap_finished();
        if (self.handle != null) return error.SnapshotInFlight;

        self.done.store(false, .release);
        const handle = std.Thread.spawn(
            thread_spawn_config,
            worker_main,
            .{ job, &self.done },
        ) catch |err| {
            self.done.store(true, .release);
            return err;
        };
        self.handle = handle;
    }

    /// Join a completed worker without blocking the vCPU thread. Call
    /// this opportunistically before accepting a new snapshot request.
    pub fn reap_finished(self: *Writer) void {
        if (self.handle) |handle| {
            if (self.done.load(.acquire)) {
                handle.join();
                self.handle = null;
            }
        }
    }

    pub fn busy(self: *Writer) bool {
        self.reap_finished();
        return self.handle != null;
    }

    /// Block until the in-flight write exits. Used only when the VMM is
    /// about to leave the run loop; otherwise a process exit could kill
    /// the writer before it renames the complete `.vmstate` into place.
    pub fn wait(self: *Writer) void {
        if (self.handle) |handle| {
            handle.join();
            self.handle = null;
        }
    }
};

fn worker_main(job: *Job, done: *std.atomic.Value(bool)) void {
    const label = job.label;
    write(job) catch |err| {
        std.debug.print("{s}: snapshot async write failed: {s}\n", .{ label, @errorName(err) });
    };
    job.destroy();
    done.store(true, .release);
}

/// Synchronous fallback used if the background thread cannot be
/// spawned. Consumes `job` either way.
pub fn write_and_destroy(job: *Job) !void {
    defer job.destroy();
    try write(job);
}

fn write(job: *Job) !void {
    const allocator = job.arena.allocator();
    const bytes = try snapshot.encode_with_arch(allocator, job.arch, job.topology_hash, job.sections);
    const compression = vmstate_zip.write_compression();
    const out: []const u8 = switch (compression) {
        .none => bytes,
        .gzip => try vmstate_zip.compress(allocator, bytes),
    };
    std.debug.print("{s}: snapshot {d} bytes -> {d} {s}\n", .{ job.label, bytes.len, out.len, @tagName(compression) });
    try write_atomic(allocator, job.path, out);
    std.debug.print("{s}: snapshot write done\n", .{job.label});
}

const c = struct {
    extern "c" fn open(path: [*:0]const u8, flags: c_int, mode: c_int) c_int;
    extern "c" fn close(fd: c_int) c_int;
    extern "c" fn write(fd: c_int, buf: *const anyopaque, count: usize) isize;
    extern "c" fn chmod(path: [*:0]const u8, mode: c_int) c_int;
    extern "c" fn rename(old: [*:0]const u8, new: [*:0]const u8) c_int;
};

const O_WRONLY: c_int = 1;
const O_CREAT: c_int = if (builtin.os.tag == .macos) 0x200 else 64;
const O_TRUNC: c_int = if (builtin.os.tag == .macos) 0x400 else 512;

fn write_atomic(allocator: std.mem.Allocator, path: []const u8, data: []const u8) !void {
    // Write atomically: dump into `<path>.tmp`, then rename() onto the
    // final path. The runtime polls for the final path's existence as
    // the "dump complete" signal, so a partial file must never be
    // observable there.
    const path_z = try allocator.dupeZ(u8, path);
    const tmp_z = try std.fmt.allocPrintSentinel(allocator, "{s}.tmp", .{path}, 0);

    const fd = c.open(tmp_z, O_WRONLY | O_CREAT | O_TRUNC, 0o644);
    if (fd < 0) return error.OpenFailed;
    {
        defer _ = c.close(fd);
        var off: usize = 0;
        while (off < data.len) {
            const rc = c.write(fd, data.ptr + off, data.len - off);
            if (rc <= 0) return error.WriteFailed;
            off += @intCast(rc);
        }
    }
    // open()'s variadic mode arg doesn't reliably stick on macOS;
    // post-chmod is the safe path.
    _ = c.chmod(tmp_z, 0o644);
    if (c.rename(tmp_z, path_z) != 0) return error.WriteFailed;
}

fn test_tmp_path(gpa: std.mem.Allocator, tmp: *const std.testing.TmpDir, name: []const u8) ![]u8 {
    const cwd = try std.process.currentPathAlloc(std.testing.io, gpa);
    defer gpa.free(cwd);
    return std.fs.path.join(gpa, &.{ cwd, ".zig-cache", "tmp", &tmp.sub_path, name });
}

test "Writer writes a complete vmstate asynchronously" {
    const gpa = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();

    const path = try test_tmp_path(gpa, &tmp, "state.vmstate");
    defer gpa.free(path);

    const topo: [32]u8 = @splat(0xAB);
    const job = try Job.create(gpa, "test", path, topo);
    const a = job.arena_allocator();
    const payload = try a.dupe(u8, "payload");
    var sections = std.ArrayList(snapshot.Section).empty;
    try sections.append(a, .{ .tag = .vcpu, .id = 0, .payload = payload });
    job.sections = try sections.toOwnedSlice(a);

    var writer: Writer = .{};
    try writer.start(job);
    writer.wait();

    try tmp.dir.access(std.testing.io, "state.vmstate", .{});
    const raw = try std.Io.Dir.cwd().readFileAlloc(std.testing.io, path, gpa, .limited(1 << 20));
    defer gpa.free(raw);
    const plain = try vmstate_zip.decompress(gpa, raw);
    defer gpa.free(plain);
    var decoded = try snapshot.decode(gpa, plain);
    defer decoded.deinit();

    try std.testing.expectEqual(@as(u32, 1), decoded.header.section_count);
    try std.testing.expectEqualSlices(u8, &topo, &decoded.header.topology_hash);
    try std.testing.expectEqual(snapshot.SectionTag.vcpu, decoded.sections[0].tag);
    try std.testing.expectEqualSlices(u8, "payload", decoded.sections[0].payload);
}
