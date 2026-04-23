// Guest side of the #82 libslirp probe. Runs three scenarios in
// sequence against the host echo server at 10.0.2.2:<port>:
//
//   latency  100x 1-byte ping-pongs (PP protocol). us_per_ping is
//            dominated by libslirp's pump tick (~10 ms by default).
//   rx       Bulk host->guest (RX protocol). Host streams N bytes to
//            the guest; guest times until the last byte arrives.
//   tx       Bulk guest->host (TX protocol). Guest sends N bytes,
//            then reads a 1-byte ack so it knows the data drained
//            all the way through libslirp to the host.
//
// Each scenario prints a machine-parseable line the harness greps:
//
//   bench-net: mode=latency pings=N total_ms=M us_per_ping=U
//   bench-net: mode=rx bytes=N total_ms=M mb_per_sec=R
//   bench-net: mode=tx bytes=N total_ms=M mb_per_sec=R
//
// /init has already run /sbin/machinen-netup, so eth0 is up with
// 10.0.2.15/24 and a default route through 10.0.2.2.
//
// Usage: bench-net-demo [mode] [size] [iterations]
//   mode        latency | rx | tx | rx-par | all    (default: all)
//                 rx-par forks `iterations` children and runs them
//                 in parallel against the same host echo. Each child
//                 does one RX of `size` bytes; parent prints one
//                 `mode=rx-par concurrency=N ...` summary with
//                 aggregate throughput.
//   size        overrides per-mode default (or "0" / "" for default):
//                 latency default: 100 pings
//                 rx / tx / rx-par default: 4194304 (4 MiB)
//   iterations  run each selected scenario this many times (default: 1)
//               In rx-par mode, this is the number of parallel children.
//
// Built by scripts/bench-net.sh; invoked via `pnpm bench-net`.
// Raw: zig cc -target aarch64-linux-musl -static -Os -o bench-net-demo bench-net-demo.c
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define HOST "10.0.2.2"
#define PORT 38080
#define DEFAULT_PINGS 100
#define DEFAULT_BULK  (4LL * 1024 * 1024)

static long long monotonic_ns(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long long)ts.tv_sec * 1000000000LL + ts.tv_nsec;
}

static int dial(void) {
    int s = socket(AF_INET, SOCK_STREAM, 0);
    if (s < 0) return -1;
    struct sockaddr_in sa;
    memset(&sa, 0, sizeof(sa));
    sa.sin_family = AF_INET;
    sa.sin_port = htons(PORT);
    if (inet_pton(AF_INET, HOST, &sa.sin_addr) != 1) { close(s); return -1; }

    struct timeval tv = { .tv_sec = 20, .tv_usec = 0 };
    setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
    setsockopt(s, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));

    if (connect(s, (struct sockaddr *)&sa, sizeof(sa)) < 0) { close(s); return -1; }
    int one = 1;
    setsockopt(s, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
    return s;
}

static int send_all(int s, const char *buf, size_t n) {
    size_t off = 0;
    while (off < n) {
        ssize_t w = send(s, buf + off, n - off, 0);
        if (w <= 0) return -1;
        off += (size_t)w;
    }
    return 0;
}

static void do_latency(long long pings) {
    int s = dial();
    if (s < 0) { printf("bench-net: mode=latency error=connect\n"); return; }

    char hdr[32];
    int hlen = snprintf(hdr, sizeof(hdr), "PP %lld\n", pings);
    if (send_all(s, hdr, (size_t)hlen) < 0) {
        printf("bench-net: mode=latency error=send_hdr\n");
        close(s); return;
    }

    long long t0 = monotonic_ns();
    for (long long i = 0; i < pings; i++) {
        char b = 'x';
        if (send(s, &b, 1, 0) != 1) {
            printf("bench-net: mode=latency error=send_at=%lld\n", i);
            close(s); return;
        }
        ssize_t n = recv(s, &b, 1, 0);
        if (n != 1) {
            printf("bench-net: mode=latency error=%s_at=%lld\n",
                   n == 0 ? "eof" : "recv", i);
            close(s); return;
        }
    }
    long long dt_ns = monotonic_ns() - t0;
    close(s);

    long long total_ms = dt_ns / 1000000LL;
    long long us_per_ping = (dt_ns / 1000LL) / pings;
    printf("bench-net: mode=latency pings=%lld total_ms=%lld us_per_ping=%lld\n",
           pings, total_ms, us_per_ping);
    fflush(stdout);
}

// Compute MB/s (million bytes per second) scaled to an integer. We
// avoid floats to keep the binary tiny and printf-safe under musl.
static long long mb_per_sec(long long bytes, long long ns) {
    if (ns <= 0) return 0;
    // bytes / seconds / 1e6 = bytes * 1000 / (ns / 1e6) / 1e6
    //                      = bytes * 1000 / ns_ms / 1e6
    // Simpler: round to 1 decimal, x10: (bytes*10 / ns) * 1e9 / 1e6
    // Just keep it integer (MB/s floor).
    // bytes/s = bytes * 1e9 / ns
    long long bytes_per_sec = (bytes * 1000000000LL) / ns;
    return bytes_per_sec / 1000000LL;
}

static void do_rx(long long bytes) {
    int s = dial();
    if (s < 0) { printf("bench-net: mode=rx error=connect\n"); return; }

    char hdr[32];
    int hlen = snprintf(hdr, sizeof(hdr), "RX %lld\n", bytes);
    if (send_all(s, hdr, (size_t)hlen) < 0) {
        printf("bench-net: mode=rx error=send_hdr\n");
        close(s); return;
    }

    static char buf[65536];
    long long t0 = monotonic_ns();
    long long got = 0;
    while (got < bytes) {
        ssize_t n = recv(s, buf, sizeof(buf), 0);
        if (n <= 0) break;
        got += n;
    }
    long long dt_ns = monotonic_ns() - t0;
    close(s);

    if (got < bytes) {
        printf("bench-net: mode=rx error=short got=%lld want=%lld\n", got, bytes);
        return;
    }
    long long total_ms = dt_ns / 1000000LL;
    printf("bench-net: mode=rx bytes=%lld total_ms=%lld mb_per_sec=%lld\n",
           got, total_ms, mb_per_sec(got, dt_ns));
    fflush(stdout);
}

static void do_tx(long long bytes) {
    int s = dial();
    if (s < 0) { printf("bench-net: mode=tx error=connect\n"); return; }

    char hdr[32];
    int hlen = snprintf(hdr, sizeof(hdr), "TX %lld\n", bytes);
    if (send_all(s, hdr, (size_t)hlen) < 0) {
        printf("bench-net: mode=tx error=send_hdr\n");
        close(s); return;
    }

    static char zero[65536];
    long long t0 = monotonic_ns();
    long long sent = 0;
    while (sent < bytes) {
        size_t chunk = bytes - sent > (long long)sizeof(zero)
            ? sizeof(zero) : (size_t)(bytes - sent);
        ssize_t w = send(s, zero, chunk, 0);
        if (w <= 0) {
            printf("bench-net: mode=tx error=send_at=%lld\n", sent);
            close(s); return;
        }
        sent += w;
    }
    // Wait for the host's 1-byte ack — this is what marks "all my
    // bytes actually made it through libslirp" for the timer.
    char ack;
    ssize_t n = recv(s, &ack, 1, 0);
    long long dt_ns = monotonic_ns() - t0;
    close(s);

    if (n != 1) {
        printf("bench-net: mode=tx error=no_ack\n");
        return;
    }
    long long total_ms = dt_ns / 1000000LL;
    printf("bench-net: mode=tx bytes=%lld total_ms=%lld mb_per_sec=%lld\n",
           sent, total_ms, mb_per_sec(sent, dt_ns));
    fflush(stdout);
}

// rx-par: fork `n` children, each does one RX of `bytes`. Parent
// times the whole batch and prints aggregate MB/s. Each child does a
// silent RX (no per-child print) so the parent's summary is the only
// line the harness greps.
static int do_rx_silent(long long bytes) {
    int s = dial();
    if (s < 0) return -1;
    char hdr[32];
    int hlen = snprintf(hdr, sizeof(hdr), "RX %lld\n", bytes);
    if (send_all(s, hdr, (size_t)hlen) < 0) { close(s); return -1; }
    static char buf[65536];
    long long got = 0;
    while (got < bytes) {
        ssize_t n = recv(s, buf, sizeof(buf), 0);
        if (n <= 0) break;
        got += n;
    }
    close(s);
    return got == bytes ? 0 : -1;
}

static void do_rx_parallel(long long bytes, long long n) {
    long long t0 = monotonic_ns();
    pid_t *pids = malloc(sizeof(pid_t) * (size_t)n);
    if (!pids) { printf("bench-net: mode=rx-par error=alloc\n"); return; }

    for (long long i = 0; i < n; i++) {
        pid_t p = fork();
        if (p == 0) {
            int rc = do_rx_silent(bytes);
            _exit(rc == 0 ? 0 : 1);
        }
        pids[i] = p;
    }

    int failed = 0;
    for (long long i = 0; i < n; i++) {
        int st = 0;
        waitpid(pids[i], &st, 0);
        if (!WIFEXITED(st) || WEXITSTATUS(st) != 0) failed++;
    }
    free(pids);

    long long dt_ns = monotonic_ns() - t0;
    long long total_bytes = bytes * n;
    long long total_ms = dt_ns / 1000000LL;
    printf("bench-net: mode=rx-par concurrency=%lld bytes=%lld total_ms=%lld mb_per_sec=%lld failed=%d\n",
           n, total_bytes, total_ms, mb_per_sec(total_bytes, dt_ns), failed);
    fflush(stdout);
}

int main(int argc, char **argv) {
    const char *mode = argc > 1 ? argv[1] : "all";
    long long size_override = argc > 2 ? strtoll(argv[2], NULL, 10) : 0;
    long long iterations = argc > 3 ? strtoll(argv[3], NULL, 10) : 1;
    if (iterations < 1) iterations = 1;

    // Let the RX queue settle after machinen-netup posted buffers.
    sleep(1);

    printf("=== bench-net: tcp://%s:%d mode=%s iterations=%lld ===\n",
           HOST, PORT, mode, iterations);
    fflush(stdout);

    if (strcmp(mode, "rx-par") == 0) {
        long long bytes = size_override > 0 ? size_override : DEFAULT_BULK;
        do_rx_parallel(bytes, iterations);
        printf("=== done ===\n");
        fflush(stdout);
        sleep(1);
        return 0;
    }

    int want_latency = strcmp(mode, "all") == 0 || strcmp(mode, "latency") == 0;
    int want_rx      = strcmp(mode, "all") == 0 || strcmp(mode, "rx") == 0;
    int want_tx      = strcmp(mode, "all") == 0 || strcmp(mode, "tx") == 0;

    long long latency_size = size_override > 0 && strcmp(mode, "latency") == 0
        ? size_override : DEFAULT_PINGS;
    long long rx_size = size_override > 0 && strcmp(mode, "rx") == 0
        ? size_override : DEFAULT_BULK;
    long long tx_size = size_override > 0 && strcmp(mode, "tx") == 0
        ? size_override : DEFAULT_BULK;

    for (long long i = 0; i < iterations; i++) {
        if (want_latency) do_latency(latency_size);
        if (want_rx)      do_rx(rx_size);
        if (want_tx)      do_tx(tx_size);
    }

    printf("=== done ===\n");
    fflush(stdout);
    sleep(1);
    return 0;
}
