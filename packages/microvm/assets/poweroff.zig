//! Triggers PSCI SYSTEM_OFF so the VMM exits cleanly.
//!
//! The only way a userspace process on arm64 can ask the kernel to
//! call PSCI SYSTEM_OFF is `reboot(LINUX_REBOOT_CMD_POWER_OFF)`.
//! Letting /init exit panics the kernel (which fires PSCI SYSTEM_RESET
//! on arm64 virt — the VMM restarts the guest instead of exiting).
//! sysvinit-utils' `poweroff` would do this but pulls in ~500 KB of
//! binaries we otherwise don't use. This is ~15 lines of Zig instead.
//!
//! Build (from packages/microvm):
//!   zig build-exe assets/poweroff.zig \
//!     -target aarch64-linux-musl -static -O ReleaseSmall \
//!     -lc -femit-bin=<out>/machinen-poweroff

// Magic numbers from <linux/reboot.h>. Stable ABI since forever.
const LINUX_REBOOT_MAGIC1: c_int = @bitCast(@as(u32, 0xfee1dead));
const LINUX_REBOOT_MAGIC2: c_int = 672274793;
const LINUX_REBOOT_CMD_POWER_OFF: c_int = @bitCast(@as(u32, 0x4321fedc));

extern "c" fn reboot(cmd: c_int) c_int;
extern "c" fn sync() void;

pub fn main() u8 {
    // Flush any in-flight disk writes before pulling the plug. Matters
    // for the CRIU images on /dev/vda — the restore boot needs them
    // fully on-disk.
    sync();

    // glibc's reboot(3) wrapper uses only the cmd; musl forwards it to
    // SYS_reboot(MAGIC1, MAGIC2, cmd, NULL). Either way we pass the
    // POWER_OFF command and the kernel handles the magic check.
    _ = reboot(LINUX_REBOOT_CMD_POWER_OFF);

    // Shouldn't return on success. If it does, the kernel refused;
    // loop so /init doesn't exit and panic the machine.
    while (true) {}
}
