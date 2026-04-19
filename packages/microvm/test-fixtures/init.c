/* Minimal arm64-linux /init.
   Mounts devtmpfs so /dev/console exists, opens it, prints a line,
   then loops forever. No libc; direct syscalls only. */

static long sys(long nr, long a0, long a1, long a2) {
    register long x8 asm("x8") = nr;
    register long x0 asm("x0") = a0;
    register long x1 asm("x1") = a1;
    register long x2 asm("x2") = a2;
    asm volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2) : "memory");
    return x0;
}

static long sys5(long nr, long a0, long a1, long a2, long a3, long a4) {
    register long x8 asm("x8") = nr;
    register long x0 asm("x0") = a0;
    register long x1 asm("x1") = a1;
    register long x2 asm("x2") = a2;
    register long x3 asm("x3") = a3;
    register long x4 asm("x4") = a4;
    asm volatile("svc #0" : "+r"(x0) : "r"(x8), "r"(x1), "r"(x2), "r"(x3), "r"(x4) : "memory");
    return x0;
}

#define SYS_openat    56
#define SYS_write     64
#define SYS_mount     40
#define SYS_nanosleep 101
#define SYS_exit      93
#define AT_FDCWD      -100
#define O_WRONLY      1

struct timespec { long tv_sec; long tv_nsec; };

static long open_write(const char *path) {
    return sys5(SYS_openat, AT_FDCWD, (long)path, O_WRONLY, 0, 0);
}

void _start(void) {
    // Try to mount devtmpfs on /dev. If this fails it's fine — /dev
    // might already have the entries we need (our initramfs creates
    // /dev/console), or the kernel is configured to auto-mount it.
    (void)sys5(SYS_mount, (long)"devtmpfs", (long)"/dev", (long)"devtmpfs", 0, 0);

    // Retry-open /dev/console. The PL011 tty driver may still be in
    // deferred probe when init first runs.
    long fd = -1;
    struct timespec wait = { .tv_sec = 0, .tv_nsec = 100 * 1000 * 1000 }; // 100ms
    for (int i = 0; i < 50 && fd < 0; i++) {
        fd = open_write("/dev/console");
        if (fd < 0) fd = open_write("/dev/ttyAMA0");
        if (fd < 0) fd = open_write("/dev/kmsg");
        if (fd >= 0) break;
        sys(SYS_nanosleep, (long)&wait, 0, 0);
    }

    static const char msg[] =
        "\n"
        "=============================================\n"
        "  hello from userspace!\n"
        "  we are running inside machinen-microvm,\n"
        "  a Zig-native VMM on macOS HVF.\n"
        "=============================================\n"
        "\n";
    if (fd >= 0) {
        sys(SYS_write, fd, (long)msg, sizeof(msg) - 1);
    }

    // Don't exit — the kernel panics if init exits.
    for (;;) {
        struct timespec sleep_long = { .tv_sec = 60, .tv_nsec = 0 };
        sys(SYS_nanosleep, (long)&sleep_long, 0, 0);
    }
}
