// Host side of the #82 gvproxy probe. Three scenarios share one
// server: the guest's first line on each connection selects which.
//
//   PP <N>    Ping-pong. Echo bytes as they arrive until client closes.
//             Used with N 1-byte sends/recvs on the guest side — the
//             guest measures round-trip latency through gvproxy.
//   RX <N>    Bulk rx. Write N bytes of zeros to the client, then close.
//             Guest measures host->guest throughput.
//   TX <N>    Bulk tx. Read until N bytes received (or peer closes),
//             send a single '.' ack byte, close. Guest measures
//             guest->host throughput and times until the ack arrives
//             so it knows the data drained all the way through.
//
// Listens on 127.0.0.1:<port>, accepts connections in a loop with a
// 60s overall idle timeout. Exits on timeout or first fatal error.
//
// Usage: bench-net-echo <port>
//
// Built by scripts/bench-net.sh; invoked via `pnpm bench-net`.
// Raw: zig cc -O2 -o bench-net-echo bench-net-echo.c
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/wait.h>
#include <unistd.h>

// Read bytes from fd until we see '\n' or the buffer fills. Returns
// number of bytes read into out (without the '\n'), or -1 on error.
static ssize_t read_line(int fd, char *out, size_t cap) {
    size_t used = 0;
    while (used < cap) {
        char c;
        ssize_t n = recv(fd, &c, 1, 0);
        if (n <= 0) return -1;
        if (c == '\n') { out[used] = 0; return (ssize_t)used; }
        out[used++] = c;
    }
    return -1;
}

static void handle_pp(int conn) {
    char buf[4096];
    for (;;) {
        ssize_t n = recv(conn, buf, sizeof(buf), 0);
        if (n <= 0) break;
        ssize_t off = 0;
        while (off < n) {
            ssize_t w = send(conn, buf + off, (size_t)(n - off), 0);
            if (w <= 0) return;
            off += w;
        }
    }
}

static void handle_rx(int conn, long long n) {
    static char zero[65536];
    long long remaining = n;
    while (remaining > 0) {
        size_t chunk = remaining > (long long)sizeof(zero)
            ? sizeof(zero) : (size_t)remaining;
        ssize_t w = send(conn, zero, chunk, 0);
        if (w <= 0) return;
        remaining -= w;
    }
}

static void handle_tx(int conn, long long n) {
    char buf[65536];
    long long remaining = n;
    while (remaining > 0) {
        ssize_t r = recv(conn, buf, sizeof(buf), 0);
        if (r <= 0) break;
        remaining -= r;
    }
    // Signal "all your bytes arrived" so the client can stop its timer.
    const char ack = '.';
    (void)send(conn, &ack, 1, 0);
}

int main(int argc, char **argv) {
    if (argc < 2) { fprintf(stderr, "usage: %s <port>\n", argv[0]); return 2; }
    int port = atoi(argv[1]);
    if (port <= 0 || port > 65535) { fprintf(stderr, "bad port: %s\n", argv[1]); return 2; }

    int srv = socket(AF_INET, SOCK_STREAM, 0);
    if (srv < 0) { perror("socket"); return 1; }

    int one = 1;
    setsockopt(srv, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

    struct sockaddr_in sa;
    memset(&sa, 0, sizeof(sa));
    sa.sin_family = AF_INET;
    sa.sin_port = htons((uint16_t)port);
    sa.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    if (bind(srv, (struct sockaddr *)&sa, sizeof(sa)) < 0) { perror("bind"); return 3; }
    if (listen(srv, 64) < 0) { perror("listen"); return 4; }

    struct timeval tv = { .tv_sec = 60, .tv_usec = 0 };
    setsockopt(srv, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

    // Reap child processes so they don't pile up as zombies.
    signal(SIGCHLD, SIG_IGN);

    for (;;) {
        int conn = accept(srv, NULL, NULL);
        if (conn < 0) break;  // timeout or error — we're done.

        // fork-per-connection so parallel guest dials run truly in
        // parallel on the host. Sequential accept/handle/close would
        // let only one connection at a time exercise the RX path,
        // hiding the per-connection scaling story.
        pid_t p = fork();
        if (p == 0) {
            close(srv);
            setsockopt(conn, IPPROTO_TCP, TCP_NODELAY, &one, sizeof(one));
            setsockopt(conn, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));

            char hdr[64];
            ssize_t hlen = read_line(conn, hdr, sizeof(hdr));
            if (hlen <= 0) { close(conn); _exit(0); }

            if (hdr[0] == 'P' && hdr[1] == 'P') {
                handle_pp(conn);
            } else if (hdr[0] == 'R' && hdr[1] == 'X') {
                long long n = strtoll(hdr + 3, NULL, 10);
                if (n > 0) handle_rx(conn, n);
            } else if (hdr[0] == 'T' && hdr[1] == 'X') {
                long long n = strtoll(hdr + 3, NULL, 10);
                if (n > 0) handle_tx(conn, n);
            }
            close(conn);
            _exit(0);
        }
        close(conn);  // parent doesn't need the connection fd
    }
    close(srv);
    return 0;
}
