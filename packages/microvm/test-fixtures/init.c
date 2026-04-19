/* Minimal arm64-linux /init.
   Mounts /dev and /proc, opens /dev/kmsg for writing, prints our
   hello + the guest's /proc/cpuinfo, then sleeps forever. */

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
#define SYS_close     57
#define SYS_read      63
#define SYS_write     64
#define SYS_mount     40
#define SYS_mkdirat   34
#define SYS_nanosleep 101
#define AT_FDCWD      -100
#define O_RDONLY      0
#define O_WRONLY      1

struct timespec { long tv_sec; long tv_nsec; };

static long open_write(const char *path) {
    return sys5(SYS_openat, AT_FDCWD, (long)path, O_WRONLY, 0, 0);
}

static long open_read(const char *path) {
    return sys5(SYS_openat, AT_FDCWD, (long)path, O_RDONLY, 0, 0);
}

static void mkdir(const char *path) {
    (void)sys(SYS_mkdirat, AT_FDCWD, (long)path, 0755);
}

static void mount(const char *src, const char *dst, const char *fs) {
    (void)sys5(SYS_mount, (long)src, (long)dst, (long)fs, 0, 0);
}

static void write_all(long fd, const char *buf, long len) {
    long off = 0;
    while (off < len) {
        long n = sys(SYS_write, fd, (long)(buf + off), len - off);
        if (n <= 0) return;
        off += n;
    }
}

static long strlen_(const char *s) {
    long n = 0;
    while (s[n]) n++;
    return n;
}

void _start(void) {
    mkdir("/proc");
    mount("devtmpfs", "/dev", "devtmpfs");
    mount("proc", "/proc", "proc");

    // Retry-open the kernel message buffer until it's there.
    long fd = -1;
    struct timespec wait = { .tv_sec = 0, .tv_nsec = 50 * 1000 * 1000 };
    for (int i = 0; i < 50 && fd < 0; i++) {
        fd = open_write("/dev/kmsg");
        if (fd < 0) fd = open_write("/dev/console");
        if (fd < 0) fd = open_write("/dev/ttyAMA0");
        if (fd >= 0) break;
        sys(SYS_nanosleep, (long)&wait, 0, 0);
    }
    if (fd < 0) goto sleep_forever;

    static const char hello[] =
        "\n"
        "=============================================\n"
        "  hello from userspace!\n"
        "  running inside machinen-microvm,\n"
        "  a Zig-native VMM on macOS HVF.\n"
        "=============================================\n";
    write_all(fd, hello, sizeof(hello) - 1);

    // Dump /proc/cpuinfo to prove we have a working kernel
    // and userspace can talk to it.
    static const char banner[] = "\n/proc/cpuinfo:\n\n";
    write_all(fd, banner, sizeof(banner) - 1);
    long info = open_read("/proc/cpuinfo");
    if (info >= 0) {
        char buf[512];
        for (;;) {
            long n = sys(SYS_read, info, (long)buf, sizeof(buf));
            if (n <= 0) break;
            write_all(fd, buf, n);
        }
        sys(SYS_close, info, 0, 0);
    }

    static const char done[] = "\n=== init done — sleeping forever ===\n";
    write_all(fd, done, sizeof(done) - 1);

sleep_forever:
    for (;;) {
        struct timespec sleep_long = { .tv_sec = 60, .tv_nsec = 0 };
        sys(SYS_nanosleep, (long)&sleep_long, 0, 0);
    }
}
