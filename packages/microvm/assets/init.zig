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
extern "c" fn chroot(path: [*:0]const u8) c_int;
extern "c" fn access(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn umount2(target: [*:0]const u8, flags: c_int) c_int;
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
extern "c" fn sched_yield() c_int;
extern "c" fn lseek(fd: c_int, offset: i64, whence: c_int) i64;
extern "c" fn fork() c_int;
extern "c" fn waitpid(pid: c_int, status: ?*c_int, options: c_int) c_int;
extern "c" fn _exit(status: c_int) noreturn;
extern "c" fn clock_settime(clk_id: c_int, tp: *const timespec) c_int;
extern "c" fn clock_gettime(clk_id: c_int, tp: *timespec) c_int;
extern "c" fn opendir(path: [*:0]const u8) ?*anyopaque;
extern "c" fn closedir(dirp: *anyopaque) c_int;
extern "c" fn readdir(dirp: *anyopaque) ?*Dirent;
extern "c" fn readlink(path: [*:0]const u8, buf: [*]u8, bufsize: usize) isize;
extern "c" fn symlink(target: [*:0]const u8, linkpath: [*:0]const u8) c_int;

// finit_module(2) — load a kernel module from an open file descriptor.
// musl doesn't ship a wrapper, so we issue the syscall directly.
// Empty params = no module options. Number 273 is aarch64-specific
// (matches the kernel's UAPI for arm64); the rest of /init is already
// arm64-only so a hardcoded number is fine.
fn finit_module(fd: c_int, params: [*:0]const u8, flags: u32) isize {
    return asm volatile ("svc #0"
        : [ret] "={x0}" (-> isize),
        : [number] "{x8}" (@as(usize, 273)),
          [arg0] "{x0}" (@as(usize, @bitCast(@as(isize, fd)))),
          [arg1] "{x1}" (@intFromPtr(params)),
          [arg2] "{x2}" (@as(usize, flags)),
        : "memory", "cc"
    );
}

const CLOCK_REALTIME: c_int = 0;

const timespec = extern struct { tv_sec: i64, tv_nsec: i64 };

// musl dirent layout. d_type + d_name are the only fields we touch.
const Dirent = extern struct {
    d_ino: u64,
    d_off: i64,
    d_reclen: u16,
    d_type: u8,
    d_name: [256]u8,
};

const DT_DIR: u8 = 4;
const DT_REG: u8 = 8;
const DT_LNK: u8 = 10;

const O_RDONLY: c_int = 0;
const O_RDWR: c_int = 2;
const SEEK_END: c_int = 2;
const SEEK_SET: c_int = 0;
const F_OK: c_int = 0;
const MS_MOVE: c_ulong = 8192;
const MNT_DETACH: c_int = 2;

const CONFIG_PATH = "/machinen-config.json";

// Where the rootdisk gets mounted before the chroot. Anything not
// already in use under / works; we pick a name unlikely to collide with
// a user-visible directory inside the rootfs.
const ROOTDISK_DEV = "/dev/vda";
const NEWROOT = "/newroot";
// Marker file we expect to find inside the rootfs to know "yes, this
// is a machinen rootfs and we should pivot into it." machinen-supervisor
// is shipped by every machinen base rootfs (scripts/build-base-assets.sh)
// so its presence is a reliable signal. See #114.
const ROOTFS_MARKER = "/newroot/sbin/machinen-supervisor";

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

// Load every kernel module the boot path needs by finit_module(2)'ing
// the .ko files staged at /modules/*.ko in the cpio. Order matters:
// virtio + virtio_ring expose the symbols virtio_mmio binds against,
// jbd2 + mbcache are deps of ext4, failover is a dep of net_failover,
// and the vsock transports layer on the vsock core.
//
// The list is duplicated against scripts/build-base-assets.sh; if you
// add or remove a .ko there you have to update it here too. We chose
// a fixed list rather than walking /modules/ alphabetically because
// load order is load-bearing and `ls`-order isn't load-order.
//
// Per-module failure is logged and skipped — a missing virtio_net hurts
// networking but not the rootdisk pivot, and we'd rather boot degraded
// than panic. fuse is loaded later from bringUpLiveMounts only when a
// liveMount entry actually needs it.
fn loadPlumbingModules() void {
    const mods = [_][*:0]const u8{
        "virtio",
        "virtio_ring",
        "virtio_mmio",
        "virtio_blk",
        "mbcache",
        "jbd2",
        "ext4",
        "failover",
        "net_failover",
        "virtio_net",
        "vsock",
        "vmw_vsock_virtio_transport_common",
        "vmw_vsock_virtio_transport",
    };
    for (mods) |mod| loadModule(mod);
}

// Load /modules/<name>.ko via finit_module(2). Best-effort — return
// without complaint if the file is absent (the module may already be
// built into the kernel) and log a single line if the syscall errors.
fn loadModule(name: [*:0]const u8) void {
    var path_buf: [128]u8 = undefined;
    const name_slice = std.mem.span(name);
    const path = std.fmt.bufPrintZ(&path_buf, "/modules/{s}.ko", .{name_slice}) catch return;
    const fd = open(path.ptr, O_RDONLY);
    if (fd < 0) return;
    defer _ = close(fd);
    const r = finit_module(fd, "", 0);
    if (r != 0) {
        var msg_buf: [192]u8 = undefined;
        const msg = std.fmt.bufPrint(
            &msg_buf,
            "init: finit_module {s} failed: errno-ish={d}",
            .{ name_slice, r },
        ) catch return;
        logLine(msg);
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

const LiveMount = struct {
    port: u32,
    guest_z: [*:0]const u8,
    guest: []const u8,
};

const Config = struct {
    // Null-terminated arrays for execve.
    argv: [*:null]const ?[*:0]const u8,
    envp: [*:null]const ?[*:0]const u8,
    // argv[0] for the path arg of execve.
    path: [*:0]const u8,
    cwd_z: ?[*:0]const u8,
    // Live-share FUSE mounts (#78). Each entry tells init to fork
    // /fuse-agent with the given port + guest path before exec'ing the
    // user cmd.
    live_mounts: []LiveMount,
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

    // liveMounts — optional array of {guest: string, port: int}.
    var live_mounts: []LiveMount = &.{};
    if (obj.get("liveMounts")) |lm_val| {
        if (lm_val != .array) return error.LiveMountsNotArray;
        const lm_arr = lm_val.array;
        const buf = try arena.alloc(LiveMount, lm_arr.items.len);
        for (lm_arr.items, 0..) |entry, i| {
            if (entry != .object) return error.LiveMountItemNotObject;
            const eobj = entry.object;
            const guest_val = eobj.get("guest") orelse return error.LiveMountMissingGuest;
            if (guest_val != .string) return error.LiveMountGuestNotString;
            const port_val = eobj.get("port") orelse return error.LiveMountMissingPort;
            if (port_val != .integer) return error.LiveMountPortNotInteger;
            if (port_val.integer < 0 or port_val.integer > 0xFFFFFFFF) return error.LiveMountPortOutOfRange;
            buf[i] = .{
                .port = @intCast(port_val.integer),
                .guest = guest_val.string,
                .guest_z = try dupZ(arena, guest_val.string),
            };
        }
        live_mounts = buf;
    }

    return Config{
        .argv = argv,
        .envp = envp,
        .path = argv_buf[0].?,
        .cwd_z = cwd_z,
        .live_mounts = live_mounts,
    };
}

// --- live-share mount bring-up (#78) -------------------------------------

/// Bring up every live-share mount declared in config. Loads the fuse
/// module once, forks /fuse-agent per entry, then waits for each mount
/// to show up in /proc/self/mounts before returning so the user cmd
/// sees the mount already populated.
fn bringUpLiveMounts(mounts: []LiveMount, arena: std.mem.Allocator) void {
    if (mounts.len == 0) return;
    loadModule("fuse");
    for (mounts) |lm| {
        startFuseAgent(lm.port, lm.guest_z, arena) catch {
            logLine("init: failed to fork fuse-agent");
            continue;
        };
    }
    for (mounts) |lm| {
        if (!waitForFuseMount(lm.guest, 5_000)) {
            var buf: [256]u8 = undefined;
            const msg = std.fmt.bufPrint(
                &buf,
                "init: live mount {s} never appeared in /proc/self/mounts",
                .{lm.guest},
            ) catch "init: live mount never appeared";
            logLine(msg);
        }
    }
}

/// Fork /fuse-agent with `<port> <guest>`. Non-blocking — the agent
/// lives for the VM's lifetime and we never reap it, same pattern as
/// file-agent/exec-agent.
fn startFuseAgent(port: u32, guest_z: [*:0]const u8, arena: std.mem.Allocator) !void {
    const port_str = try std.fmt.allocPrintSentinel(arena, "{d}", .{port}, 0);
    const argv = [_:null]?[*:0]const u8{ "/fuse-agent", port_str.ptr, guest_z };
    const envp = [_:null]?[*:0]const u8{};
    const pid = fork();
    if (pid < 0) return error.ForkFailed;
    if (pid == 0) {
        _ = execve("/fuse-agent", &argv, &envp);
        _exit(127);
    }
    // parent: keep going
}

/// Wait for `guest` to report itself as a fuse-typed filesystem. We
/// open /proc/self/mounts and match lines starting with `fuse <guest>`
/// since statfs() on AArch64 musl requires a struct we'd have to
/// redeclare, while /proc parsing needs no extra bindings.
fn waitForFuseMount(guest: []const u8, timeout_ms: i64) bool {
    const deadline_ms = nowMs() + timeout_ms;
    while (nowMs() < deadline_ms) {
        if (fuseMountPresent(guest)) return true;
        sleepMs(25);
    }
    return false;
}

fn fuseMountPresent(guest: []const u8) bool {
    // /proc/self/mounts is mountinfo-like: `<src> <target> <fstype> ...`
    // fuse-agent issues mount(src="fuse", target=guest, fstype="fuse"),
    // so we look for "fuse <guest> fuse".
    const fd = open("/proc/self/mounts", O_RDONLY);
    if (fd < 0) return false;
    defer _ = close(fd);
    var buf: [4096]u8 = undefined;
    const bufPtr: [*]u8 = &buf;
    var scanned: usize = 0;
    while (scanned < buf.len) {
        const n = read(fd, bufPtr + scanned, buf.len - scanned);
        if (n <= 0) break;
        scanned += @intCast(n);
    }
    const text = buf[0..scanned];
    // Pick through lines; trivial split.
    var i: usize = 0;
    while (i < text.len) {
        const eol = std.mem.indexOfScalarPos(u8, text, i, '\n') orelse text.len;
        const line = text[i..eol];
        i = eol + 1;
        // Expect "fuse <target> fuse ..." — leading token "fuse ".
        if (!std.mem.startsWith(u8, line, "fuse ")) continue;
        const after_src = line[5..];
        if (after_src.len < guest.len + 1) continue;
        if (!std.mem.startsWith(u8, after_src, guest)) continue;
        if (after_src[guest.len] != ' ') continue;
        return true;
    }
    return false;
}

fn nowMs() i64 {
    // Simple, portable-enough elapsed source. Only used for mount wait
    // timeout; jitter is fine.
    var ts: timespec = .{ .tv_sec = 0, .tv_nsec = 0 };
    _ = clock_gettime(CLOCK_REALTIME, &ts);
    return ts.tv_sec * 1000 + @divTrunc(ts.tv_nsec, 1_000_000);
}

// Try to mount /dev/vda as ext4 and chroot into it. Returns true if the
// pivot happened (the caller's view of `/` has changed), false if we
// fell through to the legacy initramfs-as-rootfs path.
//
// Detection is conservative: we mount, then check for /sbin/machinen-
// supervisor inside the candidate root. If the marker is missing we
// unmount and fall through. That way a CRIU scratch disk attached as
// /dev/vda (legacy behavior) doesn't accidentally become the rootfs.
//
// Pre-conditions:
//   * loadPlumbingModules() has already run (virtio_blk loaded so /dev/vda
//     can appear).
//   * /machinen-config.json exists in the cpio rootfs at /.
//   * /etc/machinen-boot-epoch may exist in the cpio rootfs at /.
//
// On success the function copies the per-boot ephemera that lived in
// the cpio (machinen-config.json, machinen-boot-epoch) into the
// freshly-mounted rootfs, moves /proc, /sys, /dev across, then calls
// chroot(NEWROOT) + chdir("/"). Subsequent code runs against the
// on-disk rootfs.
fn tryRootDiskPivot() bool {
    // Wait for the device node. virtio_mmio + virtio_blk are loaded by
    // loadPlumbingModules() right above; the kernel finishes binding
    // /dev/vda within a few tens of ms. We cap the wait at 2s in case
    // modprobe failed silently. sched_yield rather than nanosleep
    // because with a single guest vCPU, nanosleep parks the whole
    // guest and the kernel's deferred-probe workqueue can't progress.
    {
        const deadline_ms = nowMs() + 2_000;
        var found = false;
        while (nowMs() < deadline_ms) {
            if (access(ROOTDISK_DEV, F_OK) == 0) {
                found = true;
                break;
            }
            _ = sched_yield();
        }
        if (!found) {
            logLine("init: rootdisk skip: /dev/vda did not appear");
            return false;
        }
    }

    mkdirIgnore(NEWROOT);
    if (mount(ROOTDISK_DEV, NEWROOT, "ext4", 0, null) != 0) {
        // /dev/vda isn't ext4 — assume legacy CRIU scratch mode.
        logLine("init: rootdisk skip: mount /dev/vda failed");
        return false;
    }
    if (access(ROOTFS_MARKER, F_OK) != 0) {
        // Mounted, but no machinen rootfs inside — assume CRIU scratch.
        logLine("init: rootdisk skip: marker /sbin/machinen-supervisor missing");
        _ = umount2(NEWROOT, MNT_DETACH);
        return false;
    }

    // Hand off /proc, /sys, /dev to the new root via MS_MOVE so the
    // already-mounted filesystems stay live across the chroot. mkdir
    // first in case the on-disk rootfs is too lean to ship them.
    mkdirIgnore("/newroot/proc");
    mkdirIgnore("/newroot/sys");
    mkdirIgnore("/newroot/dev");
    _ = mount("/proc", "/newroot/proc", "", MS_MOVE, null);
    _ = mount("/sys", "/newroot/sys", "", MS_MOVE, null);
    _ = mount("/dev", "/newroot/dev", "", MS_MOVE, null);

    // Carry the per-boot ephemera the cpio packed at root level. The
    // on-disk rootfs is shared across boots and intentionally doesn't
    // bake these in.
    copyFileBest("/machinen-config.json", "/newroot/machinen-config.json");
    copyFileBest("/etc/machinen-boot-epoch", "/newroot/etc/machinen-boot-epoch");

    // #125: carry the user's `mount: { host, guest }` payload across
    // the pivot. mkinitramfs.ts overlays it under /mnt/<guest>/ in
    // the cpio; without this copy it would be stranded on the
    // discarded initramfs tmpfs after the chroot below. No-op when
    // the user didn't pass a mount.
    copyTreeBest("/mnt", "/newroot/mnt");

    if (chroot(NEWROOT) != 0) {
        // chroot can't really fail at PID 1 with valid args, but if it
        // does we'd be in a half-broken state. Best-effort fall-through.
        return false;
    }
    if (chdir("/") != 0) {
        // Same: shouldn't happen post-chroot.
    }
    writeStr(1, "init: pivoted into /dev/vda rootfs\n");
    return true;
}

/// Wait up to `timeout_ms` for `path` to exist. Used to bridge the gap
/// between modprobe and devtmpfs creating the matching device node.
fn waitForPath(path: [*:0]const u8, timeout_ms: i64) bool {
    const deadline_ms = nowMs() + timeout_ms;
    while (nowMs() < deadline_ms) {
        if (access(path, F_OK) == 0) return true;
        sleepMs(25);
    }
    return false;
}

/// Best-effort `cp src dst`. Used to bring the per-boot config + epoch
/// files across the pivot. Failures are silent — the boot continues
/// without them and the caller deals with the consequences.
fn copyFileBest(src: [*:0]const u8, dst: [*:0]const u8) void {
    const in_fd = open(src, O_RDONLY);
    if (in_fd < 0) return;
    defer _ = close(in_fd);
    // O_WRONLY | O_CREAT | O_TRUNC = 1 | 64 | 512 on Linux/musl.
    const out_fd = open(dst, 0o1 | 0o100 | 0o1000, @as(c_uint, 0o644));
    if (out_fd < 0) return;
    defer _ = close(out_fd);
    var buf: [8192]u8 = undefined;
    while (true) {
        const n = read(in_fd, &buf, buf.len);
        if (n <= 0) return;
        var off: usize = 0;
        const total: usize = @intCast(n);
        while (off < total) {
            const w = write(out_fd, buf[off..].ptr, total - off);
            if (w <= 0) return;
            off += @intCast(w);
        }
    }
}

// Best-effort recursive `cp -a` of the `src` directory into `dst`.
// Used to bring the `mount: { host, guest }` payload (overlaid into
// the initramfs at /mnt/<guest>/ by mkinitramfs.ts) across the
// rootdisk pivot — the chroot to /newroot would otherwise strand it
// on the discarded initramfs tmpfs. See #125.
//
// Failures are silent on a per-entry basis: a missing source dir, a
// symlink whose target overruns PATH_MAX, or a single-file copy
// failure does not abort the walk. The caller takes the resulting
// "best-effort partial" mount as-is, mirroring copyFileBest's policy
// for the per-boot ephemera the pivot also carries across.
fn copyTreeBest(src: [*:0]const u8, dst: [*:0]const u8) void {
    if (access(src, F_OK) != 0) return;
    mkdirIgnore(dst);
    const dir = opendir(src) orelse return;
    defer _ = closedir(dir);

    const src_str = std.mem.span(src);
    const dst_str = std.mem.span(dst);

    while (readdir(dir)) |ent| {
        const name_ptr: [*:0]const u8 = @ptrCast(&ent.d_name);
        const name = std.mem.span(name_ptr);
        if (name.len == 0) continue;
        if (std.mem.eql(u8, name, ".") or std.mem.eql(u8, name, "..")) continue;

        // PATH_MAX on Linux is 4096; cap each path here regardless of
        // the initial src/dst length. bufPrintZ failure means the
        // path overruns, which we silently skip.
        var src_buf: [4096]u8 = undefined;
        var dst_buf: [4096]u8 = undefined;
        const src_path = std.fmt.bufPrintZ(&src_buf, "{s}/{s}", .{ src_str, name }) catch continue;
        const dst_path = std.fmt.bufPrintZ(&dst_buf, "{s}/{s}", .{ dst_str, name }) catch continue;

        switch (ent.d_type) {
            DT_DIR => copyTreeBest(src_path.ptr, dst_path.ptr),
            DT_REG => copyFileBest(src_path.ptr, dst_path.ptr),
            DT_LNK => {
                var tgt_buf: [4096]u8 = undefined;
                const n = readlink(src_path.ptr, &tgt_buf, tgt_buf.len - 1);
                if (n <= 0) continue;
                tgt_buf[@intCast(n)] = 0;
                const tgt_ptr: [*:0]const u8 = @ptrCast(&tgt_buf[0]);
                _ = symlink(tgt_ptr, dst_path.ptr);
            },
            else => {},
        }
    }
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

    // virtio_blk has to load before we can probe /dev/vda for a
    // rootdisk. The legacy path (no rootdisk) doesn't care about ordering
    // — virtio_blk just shows up by the time provision()'s tar-to-disk
    // runs. The pivot path needs it loaded right now.
    loadPlumbingModules();

    // #114: try the virtio-blk-root pivot before doing any other setup.
    // If /dev/vda has a machinen rootfs (ext4 + marker), we mount it +
    // chroot into it; subsequent setup runs against the on-disk rootfs
    // rather than the cpio-extracted tmpfs. Falls through silently to
    // the legacy path if /dev/vda isn't a rootdisk.
    _ = tryRootDiskPivot();

    setBootClock();
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

    // Live-share FUSE mounts go up before the user cmd so the mount
    // points are populated when user code touches them. Each agent
    // lives for the VM lifetime; we don't reap them.
    bringUpLiveMounts(cfg.live_mounts, arena);

    if (cfg.cwd_z) |p| {
        if (chdir(p) < 0) logLine("init: chdir failed; staying in /");
    }

    _ = execve(cfg.path, cfg.argv, cfg.envp);
    // execve only returns on failure.
    die("init: execve failed");
}
