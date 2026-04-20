/* arm64-linux /init.
   Mount /dev, /proc, /sys. Open /dev/console (retrying until the
   PL011 tty is up), dup to fds 0/1/2, exec node with an inline
   script. */

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

#define SYS_dup3      24
#define SYS_mkdirat   34
#define SYS_mount     40
#define SYS_openat    56
#define SYS_write     64
#define SYS_nanosleep 101
#define SYS_execve    221
#define AT_FDCWD      -100
#define O_WRONLY      1
#define O_RDWR        2

struct timespec { long tv_sec; long tv_nsec; };

static void msleep(long ms) {
    struct timespec t = { .tv_sec = ms / 1000, .tv_nsec = (ms % 1000) * 1000000 };
    sys(SYS_nanosleep, (long)&t, 0, 0);
}

static long open_w(const char *path) {
    return sys5(SYS_openat, AT_FDCWD, (long)path, O_WRONLY, 0, 0);
}

static long open_rw(const char *path) {
    return sys5(SYS_openat, AT_FDCWD, (long)path, O_RDWR, 0, 0);
}

static void mkdir_p(const char *path) {
    (void)sys(SYS_mkdirat, AT_FDCWD, (long)path, 0755);
}

static void mount_fs(const char *src, const char *dst, const char *fs) {
    (void)sys5(SYS_mount, (long)src, (long)dst, (long)fs, 0, 0);
}

static long strlen_(const char *s) {
    long n = 0;
    while (s[n]) n++;
    return n;
}

static void write_str(long fd, const char *s) {
    sys(SYS_write, fd, (long)s, strlen_(s));
}

void _start(void) {
    mkdir_p("/proc");
    mkdir_p("/sys");
    mount_fs("devtmpfs", "/dev", "devtmpfs");
    mount_fs("proc", "/proc", "proc");
    mount_fs("sysfs", "/sys", "sysfs");

    // Wait for a real tty. Prefer /dev/ttyAMA0 (the real PL011 tty)
    // over /dev/console (which can be a kernel-only write-only path).
    long console = -1;
    for (int i = 0; i < 100 && console < 0; i++) {
        console = open_rw("/dev/ttyAMA0");
        if (console < 0) console = open_rw("/dev/console");
        if (console < 0) console = open_w("/dev/kmsg");
        if (console >= 0) break;
        msleep(50);
    }
    if (console < 0) {
        for (;;) msleep(60000);
    }

    // Rewire fds 0/1/2 to the console so node inherits them.
    sys(SYS_dup3, console, 0, 0);
    sys(SYS_dup3, console, 1, 0);
    sys(SYS_dup3, console, 2, 0);

    write_str(1,
        "\n=============================================\n"
        "  hello from userspace!\n"
        "  about to exec node ...\n"
        "=============================================\n");

    // Tell the kernel to drop printk rate-limiting of our writes
    // (harmless if the knob doesn't exist in this kernel).
    long rl = open_w("/proc/sys/kernel/printk_ratelimit");
    if (rl >= 0) { write_str(rl, "0\n"); }

    // Hand off to /demo.sh via /bin/sh. The demo launches node,
    // checkpoints it with CRIU, restores it, and sleeps forever.
    static char *argv[] = {
        "/bin/sh",
        "/demo.sh",
        (char *)0,
    };
    static char *envp[] = {
        "PATH=/usr/local/bin:/usr/bin:/bin:/sbin",
        "NODE_NO_WARNINGS=1",
        "HOME=/root",
        "TERM=linux",
        (char *)0,
    };
    sys(SYS_execve, (long)argv[0], (long)argv, (long)envp);

    // If exec returned, it failed. Report and sleep.
    write_str(1, "execve /bin/sh /demo.sh failed\n");
    for (;;) msleep(60000);
}
