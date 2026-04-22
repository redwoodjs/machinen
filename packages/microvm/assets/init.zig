//! /init for machinen microVM bundles.
//!
//! Mounts /proc, /sys, /dev. Opens the serial console. Reads
//! /machinen-config.json. Execs the cmd from the config with the
//! declared env and cwd. Deliberately tiny — no supervisor, no
//! signal forwarding yet; if cmd exits, init exits and the kernel
//! panics (same as today's init.c).
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/init.zig \
//!     -target aarch64-linux-musl -static -O ReleaseSmall \
//!     -lc -femit-bin=test-fixtures/init
//!
//! Companion of `.docs/learnings/microvm/rootfs-contract.md`.

const std = @import("std");

// --- libc bindings (same idiom as src/blk.zig — std.posix / std.fs
//     are in flux in Zig 0.16). We compile with -lc so these resolve
//     against musl.
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn read(fd: c_int, buf: [*]u8, count: usize) isize;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn dup2(oldfd: c_int, newfd: c_int) c_int;
extern "c" fn mkdir(path: [*:0]const u8, mode: c_uint) c_int;
extern "c" fn chdir(path: [*:0]const u8) c_int;
extern "c" fn execve(
    path: [*:0]const u8,
    argv: [*:null]const ?[*:0]const u8,
    envp: [*:null]const ?[*:0]const u8,
) c_int;
extern "c" fn mount(
    src: [*:0]const u8,
    dst: [*:0]const u8,
    fstype: [*:0]const u8,
    flags: c_ulong,
    data: ?*const anyopaque,
) c_int;
extern "c" fn nanosleep(req: *const timespec, rem: ?*timespec) c_int;
extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
extern "c" fn fork() c_int;
extern "c" fn waitpid(pid: c_int, status: ?*c_int, options: c_int) c_int;
extern "c" fn _exit(status: c_int) noreturn;
extern "c" fn clock_settime(clk_id: c_int, tp: *const timespec) c_int;

const CLOCK_REALTIME: c_int = 0;

const timespec = extern struct { tv_sec: i64, tv_nsec: i64 };

const O_RDONLY: c_int = 0;
const O_RDWR: c_int = 2;
const SEEK_END: c_int = 2;
const SEEK_SET: c_int = 0;

const CONFIG_PATH = "/machinen-config.json";

fn writeStr(fd: c_int, s: []const u8) void {
    _ = write(fd, s.ptr, s.len);
}

fn logLine(s: []const u8) void {
    writeStr(2, s);
    writeStr(2, "\n");
}

fn sleepMs(ms: i64) void {
    var ts: timespec = .{
        .tv_sec = @divTrunc(ms, 1000),
        .tv_nsec = @mod(ms, 1000) * 1_000_000,
    };
    _ = nanosleep(&ts, null);
}

fn die(msg: []const u8) noreturn {
    logLine(msg);
    while (true) sleepMs(60_000);
}

fn mountIgnore(src: [*:0]const u8, dst: [*:0]const u8, fstype: [*:0]const u8) void {
    _ = mount(src, dst, fstype, 0, null);
}

fn mkdirIgnore(path: [*:0]const u8) void {
    _ = mkdir(path, 0o755);
}

// Set the realtime clock from /etc/machinen-boot-epoch. mkinitramfs.ts
// bakes the host's wall-clock epoch into the cpio at pack time; without
// this the guest boots at 1970 and TLS / apt date checks fail.
fn setBootClock() void {
    const fd = open("/etc/machinen-boot-epoch", O_RDONLY);
    if (fd < 0) return;
    defer _ = close(fd);
    var buf: [32]u8 = undefined;
    const n = read(fd, &buf, buf.len);
    if (n <= 0) return;
    var sec: i64 = 0;
    for (buf[0..@intCast(n)]) |b| {
        if (b < '0' or b > '9') break;
        sec = sec * 10 + @as(i64, b - '0');
    }
    if (sec <= 0) return;
    const ts: timespec = .{ .tv_sec = sec, .tv_nsec = 0 };
    _ = clock_settime(CLOCK_REALTIME, &ts);
}

// Bring up the user-mode network by fork+execing /sbin/machinen-netup
// (a static helper shipped in the base rootfs). Best-effort: if the
// helper is missing or fails, log and continue — the user cmd still
// runs, just without networking.
fn bringUpNetwork() void {
    const pid = fork();
    if (pid < 0) {
        logLine("init: fork failed — skipping network bring-up");
        return;
    }
    if (pid == 0) {
        const path: [*:0]const u8 = "/sbin/machinen-netup";
        const argv = [_:null]?[*:0]const u8{path};
        const envp = [_:null]?[*:0]const u8{};
        _ = execve(path, &argv, &envp);
        _exit(127);
    }
    var status: c_int = 0;
    _ = waitpid(pid, &status, 0);
    if (status != 0) logLine("init: machinen-netup exited non-zero — network may not be up");
}

// Load kernel modules that every machinen workload assumes are usable:
//   virtio_blk — /dev/vda, for snapshot disks + persistent workspaces
//   vsock stack — AF_VSOCK sockets; the exec-agent + file/secrets/winsize
//                 agents all bind here. modprobe resolves the transport
//                 dep chain (pulls in the _common module).
//
// All are in the base rootfs (whitelisted in scripts/build-base-assets.sh).
// Best-effort: if a module is missing or fails to insert, log and move
// on — the user cmd may still work depending on what it needs.
// machinen-netup handles virtio_mmio + virtio_net separately so this
// function stays focused on the non-network plumbing.
fn loadPlumbingModules() void {
    const mods = [_][*:0]const u8{
        "virtio_blk",
        "vmw_vsock_virtio_transport",
    };
    for (mods) |mod| {
        const pid = fork();
        if (pid < 0) continue;
        if (pid == 0) {
            const argv = [_:null]?[*:0]const u8{
                "modprobe",
                "-q",
                mod,
            };
            const envp = [_:null]?[*:0]const u8{};
            _ = execve("/sbin/modprobe", &argv, &envp);
            _exit(127);
        }
        var status: c_int = 0;
        _ = waitpid(pid, &status, 0);
    }
}

fn waitForConsole() c_int {
    var i: u32 = 0;
    while (i < 100) : (i += 1) {
        const fd = open("/dev/ttyAMA0", O_RDWR);
        if (fd >= 0) return fd;
        const fd2 = open("/dev/console", O_RDWR);
        if (fd2 >= 0) return fd2;
        sleepMs(50);
    }
    return -1;
}

fn readConfigFile(arena: std.mem.Allocator) ![]u8 {
    const fd = open(CONFIG_PATH, O_RDONLY);
    if (fd < 0) return error.ConfigOpenFailed;
    defer _ = close(fd);

    const size = lseek(fd, 0, SEEK_END);
    if (size < 0) return error.ConfigStatFailed;
    _ = lseek(fd, 0, SEEK_SET);

    const usize_size: usize = @intCast(size);
    const buf = try arena.alloc(u8, usize_size);
    var off: usize = 0;
    while (off < usize_size) {
        const n = read(fd, buf.ptr + off, usize_size - off);
        if (n <= 0) return error.ConfigReadFailed;
        off += @intCast(n);
    }
    return buf;
}

fn dupZ(arena: std.mem.Allocator, s: []const u8) ![*:0]const u8 {
    const buf = try arena.alloc(u8, s.len + 1);
    @memcpy(buf[0..s.len], s);
    buf[s.len] = 0;
    return @ptrCast(buf.ptr);
}

const Config = struct {
    // Null-terminated arrays for execve.
    argv: [*:null]const ?[*:0]const u8,
    envp: [*:null]const ?[*:0]const u8,
    // argv[0] for the path arg of execve.
    path: [*:0]const u8,
    cwd_z: ?[*:0]const u8,
};

fn loadConfig(arena: std.mem.Allocator) !Config {
    const data = try readConfigFile(arena);
    const parsed = try std.json.parseFromSlice(std.json.Value, arena, data, .{});
    const root = parsed.value;
    if (root != .object) return error.ConfigNotObject;
    const obj = root.object;

    // cmd — required, array of strings, non-empty.
    const cmd_val = obj.get("cmd") orelse return error.MissingCmd;
    if (cmd_val != .array) return error.CmdNotArray;
    const cmd_arr = cmd_val.array;
    if (cmd_arr.items.len == 0) return error.CmdEmpty;

    const argv_buf = try arena.alloc(?[*:0]const u8, cmd_arr.items.len + 1);
    for (cmd_arr.items, 0..) |item, i| {
        if (item != .string) return error.CmdItemNotString;
        argv_buf[i] = try dupZ(arena, item.string);
    }
    argv_buf[cmd_arr.items.len] = null;
    const argv: [*:null]const ?[*:0]const u8 = @ptrCast(argv_buf.ptr);

    // env — optional object of string→string.
    var env_count: usize = 0;
    var saw_term = false;
    if (obj.get("env")) |env_val| {
        if (env_val != .object) return error.EnvNotObject;
        env_count = env_val.object.count();
    }

    const envp_buf = try arena.alloc(?[*:0]const u8, env_count + 2); // +TERM +null sentinel slack
    var env_idx: usize = 0;
    if (obj.get("env")) |env_val| {
        var it = env_val.object.iterator();
        while (it.next()) |e| {
            if (e.value_ptr.* != .string) return error.EnvValueNotString;
            const kv = try std.fmt.allocPrint(arena, "{s}={s}", .{ e.key_ptr.*, e.value_ptr.string });
            envp_buf[env_idx] = try dupZ(arena, kv);
            env_idx += 1;
            if (std.mem.eql(u8, e.key_ptr.*, "TERM")) saw_term = true;
        }
    }
    if (!saw_term) {
        envp_buf[env_idx] = try dupZ(arena, "TERM=linux");
        env_idx += 1;
    }
    envp_buf[env_idx] = null;
    const envp: [*:null]const ?[*:0]const u8 = @ptrCast(envp_buf.ptr);

    // cwd — optional string.
    var cwd_z: ?[*:0]const u8 = null;
    if (obj.get("cwd")) |cwd_val| {
        if (cwd_val != .string) return error.CwdNotString;
        cwd_z = try dupZ(arena, cwd_val.string);
    }

    return Config{
        .argv = argv,
        .envp = envp,
        .path = argv_buf[0].?,
        .cwd_z = cwd_z,
    };
}

pub fn main() noreturn {
    // Basic FS mounts. Ignore failures — the kernel might have mounted
    // some already, or we might be in a stripped rootfs.
    mkdirIgnore("/proc");
    mkdirIgnore("/sys");
    mountIgnore("devtmpfs", "/dev", "devtmpfs");
    mountIgnore("proc", "/proc", "proc");
    mountIgnore("sysfs", "/sys", "sysfs");

    // Wire up the serial console.
    const console = waitForConsole();
    if (console >= 0) {
        _ = dup2(console, 0);
        _ = dup2(console, 1);
        _ = dup2(console, 2);
    }

    writeStr(1, "\n=== machinen /init: reading /machinen-config.json ===\n");

    setBootClock();
    loadPlumbingModules();
    bringUpNetwork();

    // Page allocator works on musl via mmap.
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const cfg = loadConfig(arena) catch |err| {
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "init: config error: {s}", .{@errorName(err)}) catch "init: config error";
        die(msg);
    };

    if (cfg.cwd_z) |p| {
        if (chdir(p) < 0) logLine("init: chdir failed; staying in /");
    }

    _ = execve(cfg.path, cfg.argv, cfg.envp);
    // execve only returns on failure.
    die("init: execve failed");
}
