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
//! Companion of `../docs/rootfs.md`.

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
extern "c" fn ioctl(fd: c_int, req: c_ulong, arg: *anyopaque) c_int;

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
// ioctl(2) numbers used during the rootdisk pivot's online ext4 grow
// (#131). Encodings are arch-independent for these particular calls:
//   BLKGETSIZE64 = _IOR(0x12, 114, size_t)  → device size in bytes.
//   EXT4_IOC_RESIZE_FS = _IOW('f', 16, __u64) → grow the mounted ext4
//     to the new block count. Same value as resize2fs(8) issues, so
//     no need to ship the userspace tool in the rootfs.
const BLKGETSIZE64: c_ulong = 0x80081272;
const EXT4_IOC_RESIZE_FS: c_ulong = 0x40086610;

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

// #272: virtio-blk slots 5 and 6 carry the `--mount` overlay's RO
// lower (squashfs) and RW upper (ext4). DTB probe order maps them to
// /dev/vdc and /dev/vdd when rootdisk + scratch are also present;
// without rootdisk + scratch the letters shift down. We wait for
// either pair (one rootdisk + scratch + lower + upper, or rootdisk +
// lower + upper, or just lower + upper) to bind by walking
// /sys/block for any virtio-blk device whose first 4 bytes are the
// squashfs magic. See bringUpMountDisk() below.
const MOUNTDISK_GUEST_PATH = "/etc/machinen-mountdisk-guest";
// Workdir for the overlay's atomic-rename machinery. Must live on the
// same fs as the upperdir; ext4 satisfies that.
const OVERLAY_LOWER_MNT = "/run/.mountdisk-lower";
const OVERLAY_UPPER_MNT = "/run/.mountdisk-upper";
const OVERLAY_UPPER_DIR = "/run/.mountdisk-upper/upper";
const OVERLAY_WORK_DIR = "/run/.mountdisk-upper/work";

fn writeStr(fd: c_int, s: []const u8) void {
    _ = write(fd, s.ptr, s.len);
}

// /dev/kmsg cache. Opened lazily on first klog() and reused. If the
// open fails (devtmpfs not mounted yet, /dev/kmsg unavailable), klog
// is a no-op — we don't want a missing diag channel to mask the real
// log path.
var kmsg_fd: c_int = -1;

// Mirror a log line to the kernel printk ring buffer. Survives anything
// the tty / chroot / MS_MOVE path can do to fd 1+2 — the bytes go
// through `/dev/kmsg → printk → registered consoles`, on the level we
// pick. <2> = KERN_CRIT, which prints under both the default
// `loglevel=3 quiet` and a user's `loglevel=8 ignore_loglevel debug`.
//
// Recovery from issue #129: a tty-side bug between /init's first
// writeStr and its final die() silently swallows intermediate writes
// on the rootDisk path. Routing every logLine through klog as well
// gives a parallel diagnostic stream so `dmesg` (or the host's
// stderr echo from boot_hvf.zig's PL011 DR-write handler) shows
// every reached checkpoint regardless.
fn klog(s: []const u8) void {
    if (kmsg_fd < 0) {
        kmsg_fd = open("/dev/kmsg", O_RDWR);
        if (kmsg_fd < 0) return;
    }
    var buf: [512]u8 = undefined;
    const out = std.fmt.bufPrint(&buf, "<2>init: {s}\n", .{s}) catch return;
    _ = write(kmsg_fd, out.ptr, out.len);
}

fn logLine(s: []const u8) void {
    klog(s);
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

// Power off the guest via PSCI SYSTEM_OFF (function ID 0x84000008,
// invoked through HVC #0 per the arm64 PSCI 1.0 spec). The VMM's HVF
// loop matches on this and exits cleanly (boot_hvf.zig handles
// PSCI .system_off → saw_off = true → main.zig std.process.exit(0)),
// which lets the host process Node sees terminate so the user gets
// their terminal back. Without this, /init looping forever in
// nanosleep would keep the VMM running indefinitely — Ctrl-C from the
// host's stdin is forwarded through to the guest where nothing reads
// it, so the user has to pgrep+kill the VMM by hand. See issue #135.
fn psciSystemOff() noreturn {
    while (true) {
        asm volatile ("hvc #0"
            :
            : [fid] "{x0}" (@as(usize, 0x8400_0008)),
            : .{ .memory = true, .nzcv = true });
        // PSCI SYSTEM_OFF is supposed to never return. If it does
        // (older kernel without PSCI? hypervisor refused?), fall
        // through and try again rather than spinning the CPU at 100%.
        sleepMs(60_000);
    }
}

fn die(msg: []const u8) noreturn {
    logLine(msg);
    // Give the kernel printk + pl011 TX FIFO a beat to drain so the
    // failure message reaches the host before SYSTEM_OFF tears the
    // VM down. 100ms is overkill for a virtual UART but cheap.
    sleepMs(100);
    psciSystemOff();
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

/// Bring up every live-share mount declared in config. Forks
/// /fuse-agent per entry, then waits for each mount to show up in
/// /proc/self/mounts before returning so the user cmd sees the mount
/// already populated. The fuse driver is built into the kernel
/// (CONFIG_FUSE_FS=y) so no module load is needed first.
fn bringUpLiveMounts(mounts: []LiveMount, arena: std.mem.Allocator) void {
    if (mounts.len == 0) return;
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

// Online-grow the ext4 rootdisk to fill /dev/vda. The host file is
// often sparse-extended past the original mke2fs size — either because
// `boot({ rootDiskSizeBytes })` requested more, or because the
// materializer's defaults grew between releases — and the on-disk
// filesystem stays at the smaller original size until we resize.
// EXT4_IOC_RESIZE_FS does the work that resize2fs(8) would; doing it
// here avoids dragging e2fsprogs into the guest rootfs. See #131.
//
// Failures are logged and ignored — a too-small filesystem is an
// ENOSPC headache later, not a boot blocker, and we'd rather boot
// with the existing capacity than refuse to come up. The current size
// check via statfs(2) skips the ioctl when the fs already fills the
// device, which is the steady-state cache-hit case.
fn growRootdiskFs(mount_point: [*:0]const u8) void {
    const dev_fd = open(ROOTDISK_DEV, O_RDONLY);
    if (dev_fd < 0) {
        logLine("init: rootdisk grow skip: cannot open /dev/vda");
        return;
    }
    defer _ = close(dev_fd);

    var dev_bytes: u64 = 0;
    if (ioctl(dev_fd, BLKGETSIZE64, &dev_bytes) != 0) {
        logLine("init: rootdisk grow skip: BLKGETSIZE64 failed");
        return;
    }
    // 4 KiB blocks — matches the materializer's `mke2fs -b 4096`.
    const new_blocks: u64 = dev_bytes / 4096;
    if (new_blocks == 0) return;

    // Open the mount point read-only — EXT4_IOC_RESIZE_FS only needs
    // an fd that points at the filesystem, not write access.
    const mount_fd = open(mount_point, O_RDONLY);
    if (mount_fd < 0) {
        logLine("init: rootdisk grow skip: cannot open mount point");
        return;
    }
    defer _ = close(mount_fd);

    var blocks: u64 = new_blocks;
    const r = ioctl(mount_fd, EXT4_IOC_RESIZE_FS, &blocks);
    if (r != 0) {
        // Likely outcomes: -EBUSY if the fs already fills the device
        // (no-op) or -EINVAL if the filesystem doesn't support online
        // grow. Either way we keep going — boot succeeds at the
        // existing size.
        var buf: [128]u8 = undefined;
        const msg = std.fmt.bufPrint(
            &buf,
            "init: rootdisk grow ioctl rc={d} blocks={d} bytes={d}",
            .{ r, blocks, dev_bytes },
        ) catch "init: rootdisk grow ioctl failed";
        logLine(msg);
        return;
    }
    var ok_buf: [96]u8 = undefined;
    const ok_msg = std.fmt.bufPrint(
        &ok_buf,
        "init: rootdisk grew to {d} 4K blocks ({d} bytes)",
        .{ blocks, dev_bytes },
    ) catch "init: rootdisk grew";
    logLine(ok_msg);
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
//   * The kernel has virtio_mmio + virtio_blk + ext4 built in
//     (scripts/build-kernel-arm64.sh enforces this), so /dev/vda binds
//     before /init runs.
//   * /machinen-config.json exists in the cpio rootfs at /.
//   * /etc/machinen-boot-epoch may exist in the cpio rootfs at /.
//
// On success the function copies the per-boot ephemera that lived in
// the cpio (machinen-config.json, machinen-boot-epoch) into the
// freshly-mounted rootfs, moves /proc, /sys, /dev across, then calls
// chroot(NEWROOT) + chdir("/"). Subsequent code runs against the
// on-disk rootfs.
fn tryRootDiskPivot() bool {
    // Wait for the device node. The kernel finishes binding /dev/vda
    // within a few tens of ms after devtmpfs mounts. Cap the wait at
    // 2s in case the device is genuinely missing (no rootDisk attached).
    // sched_yield rather than nanosleep because with a single guest
    // vCPU, nanosleep parks the whole guest and the kernel's
    // deferred-probe workqueue can't progress.
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

    // Online-grow the ext4 fs to fill /dev/vda. See growRootdiskFs.
    growRootdiskFs(NEWROOT);

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

    // #113: carry /fuse-agent from the cpio across the pivot so the
    // freshest binary always wins, mirroring the /init injection
    // pattern (#147). Cached rootdisks materialized from older
    // rootfs tarballs may carry a stale /fuse-agent (or none at all);
    // packBundle drops the current one at /fuse-agent in the cpio
    // and we overwrite the disk version here. No-op when liveMounts
    // wasn't requested (cpio /fuse-agent absent).
    copyExecBest("/fuse-agent", "/newroot/fuse-agent");

    // #272: the `--mount` payload no longer rides in the cpio. It now
    // lives on /dev/vdc (squashfs RO lower) + /dev/vdd (ext4 RW upper),
    // mounted as an overlayfs after the chroot below by
    // bringUpMountDisk(). Nothing to copy across the pivot.

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

// #272: bring up the `--mount` overlay. The runtime fd-passes a
// content-addressed squashfs lower and a per-VM ext4 upper through
// MACHINEN_MOUNTDISK_{LOWER,UPPER}_FD; the VMM exposes both as
// virtio-blk devices on slots 5+6. We:
//
//   1. Read the desired guest mountpoint from /etc/machinen-mountdisk-guest
//      (a few bytes baked in by the cpio; absent → no mount payload).
//   2. Walk /dev for virtio-blk devices and identify which one is the
//      squashfs (magic "hsqs") vs the ext4 (magic 0xEF53 at offset 1080).
//      We don't hardcode /dev/vdc/vdd because the letter assignment
//      shifts based on which other slots are present.
//   3. Mount the squashfs read-only at OVERLAY_LOWER_MNT.
//   4. Mount the ext4 with discard at OVERLAY_UPPER_MNT, online-grow it
//      to fill the device, then ensure upper/ + work/ exist.
//   5. Mount overlayfs(lowerdir, upperdir, workdir) at the user's
//      guest path (created mkdir -p).
//
// Failures are surfaced via klog and the boot continues — a broken
// mount is not worth refusing the whole boot, and the user cmd will
// fail with a clear ENOENT against /mnt/<guest>/ anyway. The
// happy-path flow assumes the kernel ships SQUASHFS + OVERLAY_FS
// (scripts/build-kernel-arm64.sh enforces this).
fn bringUpMountDisk() void {
    // 1. Guest path. Absent → no mount was requested by the runtime.
    const guest = readGuestMountpoint() orelse return;
    klog("checkpoint: mountdisk: guest path read");

    // 2. Identify the two virtio-blk devices. squashfs lower first,
    //    ext4 upper second.
    var lower_dev_buf: [64]u8 = undefined;
    var upper_dev_buf: [64]u8 = undefined;
    const found = identifyMountDiskDevices(&lower_dev_buf, &upper_dev_buf, 5_000) catch {
        logLine("init: mountdisk: device probe failed");
        return;
    };
    if (!found) {
        logLine("init: mountdisk: lower or upper device not found within 5s — skipping");
        return;
    }
    const lower_dev_z: [*:0]const u8 = @ptrCast(&lower_dev_buf[0]);
    const upper_dev_z: [*:0]const u8 = @ptrCast(&upper_dev_buf[0]);
    klog("checkpoint: mountdisk: devices identified");

    // 3. Mount squashfs RO. MS_RDONLY = 1 on Linux/musl.
    mkdirIgnore(OVERLAY_LOWER_MNT);
    if (mount(lower_dev_z, OVERLAY_LOWER_MNT, "squashfs", 1, null) != 0) {
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "init: mountdisk: squashfs mount failed dev={s}", .{std.mem.span(lower_dev_z)}) catch "init: mountdisk: squashfs mount failed";
        logLine(msg);
        return;
    }
    klog("checkpoint: mountdisk: lower mounted");

    // 4. Mount ext4 RW with discard. The `data` arg of mount(2) is the
    //    options string; "discard" tells ext4 to issue VIRTIO_BLK_T_DISCARD
    //    on file deletes so the host backing file releases bytes via
    //    fallocate(PUNCH_HOLE).
    mkdirIgnore(OVERLAY_UPPER_MNT);
    const ext4_opts: [*:0]const u8 = "discard";
    if (mount(upper_dev_z, OVERLAY_UPPER_MNT, "ext4", 0, @ptrCast(ext4_opts)) != 0) {
        // First ext4 mount on a freshly-mke2fs'd image sometimes needs
        // a no-options retry on older kernels — try once without
        // `discard` before giving up. Logged either way.
        if (mount(upper_dev_z, OVERLAY_UPPER_MNT, "ext4", 0, null) != 0) {
            logLine("init: mountdisk: ext4 mount failed");
            _ = umount2(OVERLAY_LOWER_MNT, MNT_DETACH);
            return;
        }
        logLine("init: mountdisk: ext4 mount succeeded only without `discard`");
    }
    growMountDiskUpperFs(OVERLAY_UPPER_MNT, upper_dev_z);
    mkdirIgnore(OVERLAY_UPPER_DIR);
    mkdirIgnore(OVERLAY_WORK_DIR);
    klog("checkpoint: mountdisk: upper mounted");

    // 5. mkdir -p the user's guest path, then layer the overlay on top.
    //    We walk and mkdir each segment by hand because the on-disk
    //    rootfs may not have any of these directories yet (typical:
    //    /mnt exists, /mnt/<sub> doesn't).
    mkdirParents(guest);

    // overlayfs options string. lowerdir is the squashfs mount,
    // upperdir lives inside the ext4 mount (so writes survive
    // snapshot/restore via the virtio-blk file), workdir is its
    // sibling per overlayfs requirements.
    var opts_buf: [512]u8 = undefined;
    const opts = std.fmt.bufPrintZ(
        &opts_buf,
        "lowerdir={s},upperdir={s},workdir={s}",
        .{ OVERLAY_LOWER_MNT, OVERLAY_UPPER_DIR, OVERLAY_WORK_DIR },
    ) catch {
        logLine("init: mountdisk: overlay opts buffer overrun");
        return;
    };
    var guest_buf: [512]u8 = undefined;
    @memcpy(guest_buf[0..guest.len], guest);
    guest_buf[guest.len] = 0;
    const guest_z: [*:0]const u8 = @ptrCast(&guest_buf[0]);
    if (mount("overlay", guest_z, "overlay", 0, opts.ptr) != 0) {
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "init: mountdisk: overlay mount failed at {s}", .{guest}) catch "init: mountdisk: overlay mount failed";
        logLine(msg);
        return;
    }
    klog("checkpoint: mountdisk: overlay mounted");

    var ok_buf: [256]u8 = undefined;
    const ok_msg = std.fmt.bufPrint(&ok_buf, "init: mountdisk overlay live at {s}", .{guest}) catch "init: mountdisk overlay live";
    logLine(ok_msg);
}

/// Read /etc/machinen-mountdisk-guest into a static buffer.
/// Returns the guest path slice (without trailing whitespace) or
/// null when the file is absent / empty.
fn readGuestMountpoint() ?[]const u8 {
    const Static = struct {
        var buf: [512]u8 = undefined;
    };
    const fd = open(MOUNTDISK_GUEST_PATH, O_RDONLY);
    if (fd < 0) return null;
    defer _ = close(fd);
    const n = read(fd, &Static.buf, Static.buf.len - 1);
    if (n <= 0) return null;
    Static.buf[@intCast(n)] = 0;
    var len: usize = @intCast(n);
    // Trim trailing whitespace (newline, CR, spaces).
    while (len > 0 and (Static.buf[len - 1] == '\n' or Static.buf[len - 1] == '\r' or Static.buf[len - 1] == ' ' or Static.buf[len - 1] == '\t')) {
        len -= 1;
    }
    if (len == 0) return null;
    if (Static.buf[0] != '/') return null; // Must be absolute.
    return Static.buf[0..len];
}

/// Walk /dev/vd? until we find a virtio-blk device whose first 4
/// bytes match squashfs magic (lower) and another whose ext4
/// superblock magic (offset 1080, u16 LE 0xEF53) matches (upper),
/// with a deadline. `lower_buf` and `upper_buf` are filled with the
/// resolved /dev/vdN paths (NUL-terminated). Returns true when both
/// are found, false on timeout.
///
/// Skips /dev/vda (rootdisk) and the configured /dev/vdb (scratch
/// snapshot disk) — both could in theory carry an ext4 fs whose
/// magic would otherwise confuse us. They were mounted before /init
/// reached this code (rootdisk pivot) or are reserved for the CRIU
/// scratch volume; identifying them via the negative list is simpler
/// than holding a list of "candidate" letters that shifts with which
/// slots happen to be populated.
fn identifyMountDiskDevices(
    lower_buf: *[64]u8,
    upper_buf: *[64]u8,
    timeout_ms: i64,
) !bool {
    // We probe a fixed candidate list that covers every layout the
    // VMM produces today: slot 5 always lands at vdc, vdd, or vde
    // depending on which earlier slots are populated. /dev/vdf is
    // included as headroom in case future slots shift letters again.
    const candidates = [_][]const u8{ "/dev/vdc", "/dev/vdd", "/dev/vde", "/dev/vdf" };

    const deadline_ms = nowMs() + timeout_ms;
    while (nowMs() < deadline_ms) {
        var lower_idx: ?usize = null;
        var upper_idx: ?usize = null;
        for (candidates, 0..) |c, i| {
            // Use a stack buffer for the NUL-terminated form.
            var path_buf: [64]u8 = undefined;
            @memcpy(path_buf[0..c.len], c);
            path_buf[c.len] = 0;
            const path_z: [*:0]const u8 = @ptrCast(&path_buf[0]);
            if (access(path_z, F_OK) != 0) continue;
            const fd = open(path_z, O_RDONLY);
            if (fd < 0) continue;
            defer _ = close(fd);

            // Read the first 4 bytes for squashfs magic.
            var magic_buf: [4]u8 = undefined;
            _ = lseek(fd, 0, SEEK_SET);
            if (read(fd, &magic_buf, 4) == 4) {
                // squashfs little-endian magic: 0x73717368 ("hsqs").
                if (magic_buf[0] == 0x68 and magic_buf[1] == 0x73 and magic_buf[2] == 0x71 and magic_buf[3] == 0x73) {
                    if (lower_idx == null) lower_idx = i;
                    continue;
                }
            }

            // Read the ext4 superblock magic at offset 1080.
            _ = lseek(fd, 1080, SEEK_SET);
            var ext4_magic: [2]u8 = undefined;
            if (read(fd, &ext4_magic, 2) == 2) {
                if (ext4_magic[0] == 0x53 and ext4_magic[1] == 0xEF) {
                    if (upper_idx == null) upper_idx = i;
                }
            }
        }

        if (lower_idx) |li| {
            if (upper_idx) |ui| {
                const lower = candidates[li];
                const upper = candidates[ui];
                @memcpy(lower_buf[0..lower.len], lower);
                lower_buf[lower.len] = 0;
                @memcpy(upper_buf[0..upper.len], upper);
                upper_buf[upper.len] = 0;
                return true;
            }
        }

        sleepMs(25);
    }
    return false;
}

/// Online-grow the ext4 upper fs to fill its backing device. Same
/// trick as growRootdiskFs (#131) — the host file is sparse and may
/// have been extended past the fs size since the last boot.
/// Failures are logged and ignored: the caller falls back to
/// whatever capacity the on-disk fs already has.
fn growMountDiskUpperFs(mount_point: [*:0]const u8, dev: [*:0]const u8) void {
    const dev_fd = open(dev, O_RDONLY);
    if (dev_fd < 0) return;
    defer _ = close(dev_fd);

    var dev_bytes: u64 = 0;
    if (ioctl(dev_fd, BLKGETSIZE64, &dev_bytes) != 0) return;
    const new_blocks: u64 = dev_bytes / 4096;
    if (new_blocks == 0) return;

    const mount_fd = open(mount_point, O_RDONLY);
    if (mount_fd < 0) return;
    defer _ = close(mount_fd);

    var blocks: u64 = new_blocks;
    _ = ioctl(mount_fd, EXT4_IOC_RESIZE_FS, &blocks);
}

/// mkdir -p for an absolute path. Walks from the root, mkdir-ing
/// each segment with mode 0755. Existing dirs are tolerated. Used to
/// stage the user's guest mountpoint before the overlay mount.
fn mkdirParents(path: []const u8) void {
    if (path.len == 0 or path[0] != '/') return;
    var i: usize = 1;
    while (i <= path.len) : (i += 1) {
        if (i == path.len or path[i] == '/') {
            if (i == 0) continue;
            var seg_buf: [512]u8 = undefined;
            if (i >= seg_buf.len) return;
            @memcpy(seg_buf[0..i], path[0..i]);
            seg_buf[i] = 0;
            const seg_z: [*:0]const u8 = @ptrCast(&seg_buf[0]);
            mkdirIgnore(seg_z);
        }
    }
}

/// Best-effort `cp src dst`. Used to bring the per-boot config + epoch
/// files across the pivot. Failures are silent — the boot continues
/// without them and the caller deals with the consequences.
fn copyFileBest(src: [*:0]const u8, dst: [*:0]const u8) void {
    copyFileWithMode(src, dst, 0o644);
}

/// Same as copyFileBest but creates the destination with mode 0755.
/// Used for /fuse-agent — without the executable bit, /init's
/// fork+exec of /fuse-agent fails with EACCES on first boot against a
/// rootfs that doesn't already carry the binary.
fn copyExecBest(src: [*:0]const u8, dst: [*:0]const u8) void {
    copyFileWithMode(src, dst, 0o755);
}

fn copyFileWithMode(src: [*:0]const u8, dst: [*:0]const u8, mode: c_uint) void {
    const in_fd = open(src, O_RDONLY);
    if (in_fd < 0) return;
    defer _ = close(in_fd);
    // O_WRONLY | O_CREAT | O_TRUNC = 1 | 64 | 512 on Linux/musl.
    const out_fd = open(dst, 0o1 | 0o100 | 0o1000, mode);
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
    // /dev/pts is the slave-side namespace for pseudoterminals.
    // Without it, anything that allocates a PTY pair via /dev/ptmx
    // (e.g. forkpty(3) in the exec-agent's PTY path — #133, or
    // `script` / `screen` / `tmux` invoked by the user) fails to
    // open the slave node, because the slave name /dev/pts/<n> only
    // resolves once devpts is mounted there. /dev/ptmx itself is
    // already in /dev (devtmpfs creates it).
    mkdirIgnore("/dev/pts");
    mountIgnore("devpts", "/dev/pts", "devpts");
    // Fresh tmpfs on /run, matching the systemd / Debian default.
    // Many maintainer scripts assume /run is a writable tmpfs:
    // adduser/addgroup take a flock on /run/adduser, apt parks lock
    // files in /run/lock, openssh-server's postinst expects /run/sshd,
    // cron / dbus / etc. drop pid files there. Without this mount the
    // user's rootfs tarball's /run is exposed as-is — any quirk in its
    // permissions, ownership, or contents (a leftover lock from a
    // previous provision, an unexpected symlink, root-not-owning the
    // dir) breaks postinst flows mid-install. tmpfs gives every boot
    // a clean, root-owned, writable /run regardless of what's on disk.
    mkdirIgnore("/run");
    mountIgnore("tmpfs", "/run", "tmpfs");

    // Wire up the serial console.
    const console = waitForConsole();
    if (console >= 0) {
        _ = dup2(console, 0);
        _ = dup2(console, 1);
        _ = dup2(console, 2);
    }

    writeStr(1, "\n=== machinen /init: reading /machinen-config.json ===\n");
    // Mirror the boot banner to /dev/kmsg so post-pivot debug shows
    // both channels in dmesg / the host stderr echo. See klog() above.
    klog("=== machinen /init: reading /machinen-config.json ===");

    // #114: try the virtio-blk-root pivot before doing any other setup.
    // If /dev/vda has a machinen rootfs (ext4 + marker), we mount it +
    // chroot into it; subsequent setup runs against the on-disk rootfs
    // rather than the cpio-extracted tmpfs. Falls through silently to
    // the legacy path if /dev/vda isn't a rootdisk.
    const pivoted = tryRootDiskPivot();
    klog(if (pivoted) "checkpoint: post-tryRootDiskPivot pivoted=true" else "checkpoint: post-tryRootDiskPivot pivoted=false");

    setBootClock();
    klog("checkpoint: post-setBootClock");
    bringUpNetwork();
    klog("checkpoint: post-bringUpNetwork");

    // Page allocator works on musl via mmap.
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();

    const cfg = loadConfig(arena) catch |err| {
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "init: config error: {s}", .{@errorName(err)}) catch "init: config error";
        die(msg);
    };
    klog("checkpoint: post-loadConfig");

    // #272: bring up the `--mount` overlay (squashfs RO + ext4 RW).
    // Goes up before live mounts and the user cmd so the user's guest
    // path is populated when their code touches it. No-op when the
    // runtime didn't pass mountdisk fds.
    bringUpMountDisk();
    klog("checkpoint: post-bringUpMountDisk");

    // Live-share FUSE mounts go up before the user cmd so the mount
    // points are populated when user code touches them. Each agent
    // lives for the VM lifetime; we don't reap them.
    bringUpLiveMounts(cfg.live_mounts, arena);
    klog("checkpoint: post-bringUpLiveMounts");

    if (cfg.cwd_z) |p| {
        if (chdir(p) < 0) logLine("init: chdir failed; staying in /");
    }

    {
        var buf: [512]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "checkpoint: about to execve path={s}", .{std.mem.span(cfg.path)}) catch "checkpoint: about to execve";
        klog(msg);
    }
    _ = execve(cfg.path, cfg.argv, cfg.envp);
    // execve only returns on failure. errno is set; report it on the
    // diag channel because the tty path may have eaten the message.
    {
        const e = errnoValue();
        var buf: [256]u8 = undefined;
        const msg = std.fmt.bufPrint(&buf, "init: execve failed errno={d} path={s}", .{ e, std.mem.span(cfg.path) }) catch "init: execve failed";
        die(msg);
    }
}

// musl exposes errno via a per-thread `__errno_location()` returning
// a pointer to the TLS slot. We read it directly so the execve failure
// message can include the real reason — ENOENT (2) tells us the path
// is missing (rootfs pivot incomplete?), EACCES (13) flags a perms
// issue, ENOEXEC (8) means the binary is malformed, etc.
extern "c" fn __errno_location() *c_int;
fn errnoValue() c_int {
    return __errno_location().*;
}
