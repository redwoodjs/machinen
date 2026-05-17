//! Triggers a clean VMM exit.
//!
//! The normal arm64 path asks the kernel to call PSCI SYSTEM_OFF via
//! `reboot(LINUX_REBOOT_CMD_POWER_OFF)`. Nested guests are different:
//! once Linux owns EL2, that HVC conduit terminates inside the L1 guest
//! instead of at the L0 VMM. In that case we write a machinen-private
//! console marker that the VMM treats as a paravirtualized shutdown.
//! Letting /init exit panics the kernel (which fires PSCI SYSTEM_RESET
//! on arm64 virt — the VMM restarts the guest instead of exiting).
//! sysvinit-utils' `poweroff` would do this but pulls in ~500 KB of
//! binaries we otherwise don't use.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/poweroff.zig \
//!     -target aarch64-linux-musl -static -O ReleaseSmall \
//!     -lc -femit-bin=<out>/machinen-poweroff

// Magic numbers from <linux/reboot.h>. Stable ABI since forever.
const LINUX_REBOOT_MAGIC1: c_int = @bitCast(@as(u32, 0xfee1dead));
const LINUX_REBOOT_MAGIC2: c_int = 672274793;
const LINUX_REBOOT_CMD_POWER_OFF: c_int = @bitCast(@as(u32, 0x4321fedc));

const O_WRONLY: c_int = 1;
const F_OK: c_int = 0;
const nested_poweroff_marker = "\n::machinen-nested-poweroff::\n";

extern "c" fn reboot(cmd: c_int) c_int;
extern "c" fn sync() void;
extern "c" fn access(path: [*:0]const u8, mode: c_int) c_int;
extern "c" fn open(path: [*:0]const u8, flags: c_int, ...) c_int;
extern "c" fn close(fd: c_int) c_int;
extern "c" fn write(fd: c_int, buf: [*]const u8, count: usize) isize;
extern "c" fn pause() c_int;

fn write_console(bytes: []const u8) void {
    const fd = open("/dev/console", O_WRONLY, @as(c_int, 0));
    if (fd >= 0) {
        _ = write(fd, bytes.ptr, bytes.len);
        _ = close(fd);
    }
    // Fallback for early/minimal environments where /dev/console is
    // absent but stdout still points at the serial console.
    _ = write(1, bytes.ptr, bytes.len);
}

pub fn main() u8 {
    // Flush any in-flight disk writes before pulling the plug. Matters
    // for the CRIU images on /dev/vda — the restore boot needs them
    // fully on-disk.
    sync();

    if (access("/dev/kvm", F_OK) == 0) {
        write_console(nested_poweroff_marker);
        // Intentional park: the L0 VMM exits after seeing the marker.
        // If that handoff fails, pause() keeps PID 1 from returning
        // without burning CPU.
        while (true) {
            _ = pause();
        }
    }

    // glibc's reboot(3) wrapper uses only the cmd; musl forwards it to
    // SYS_reboot(MAGIC1, MAGIC2, cmd, NULL). Either way we pass the
    // POWER_OFF command and the kernel handles the magic check.
    _ = reboot(LINUX_REBOOT_CMD_POWER_OFF);

    // Shouldn't return on success. If it does, the kernel refused;
    // park so /init doesn't exit and panic the machine.
    while (true) {
        _ = pause();
    }
}
