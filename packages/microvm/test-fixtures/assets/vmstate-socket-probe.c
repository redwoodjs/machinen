// vmstate socket smoke-test helper.
//
// Built by scripts/smoke/vmstate/common.sh with:
//   zig cc -target aarch64-linux-musl -static -O2
//
// Modes:
//   tcp-listen <port> <label>
//     Guest TCP listener used to prove a restored VM can accept through a
//     freshly declared host port forward.
//
//   tcp-client-stale <host-ip> <port> <label>
//     Opens an outbound TCP connection, prints READY, waits for
//     /tmp/vmstate-socket-go, then tries to use the old stream. A restored
//     or forked VM should report STALE_CLOSED; the still-running source
//     should report STALE_STILL_OPEN.
//
//   uds-pair
//     Creates an in-guest Unix socketpair, prints READY, waits for
//     /tmp/vmstate-socket-go, then proves the socketpair still works after
//     restore.

#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/types.h>
#include <time.h>
#include <unistd.h>

#define GO_FILE "/tmp/vmstate-socket-go"

static int parse_port(const char *s) {
  char *end = NULL;
  errno = 0;
  long v = strtol(s, &end, 10);
  if (errno != 0 || end == s || *end != '\0' || v < 1 || v > 65535) {
    fprintf(stderr, "vmstate-socket-probe: invalid port: %s\n", s);
    exit(2);
  }
  return (int)v;
}

static void wait_for_go_file(void) {
  struct stat st;
  while (stat(GO_FILE, &st) != 0) {
    struct timespec ts = { .tv_sec = 0, .tv_nsec = 100 * 1000 * 1000 };
    nanosleep(&ts, NULL);
  }
}

static void set_io_timeouts(int fd, int seconds) {
  struct timeval tv = { .tv_sec = seconds, .tv_usec = 0 };
  setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv));
  setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv));
}

static int tcp_listen(int port, const char *label) {
  signal(SIGPIPE, SIG_IGN);
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    perror("socket");
    return 2;
  }
  int one = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one));

  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)port);
  addr.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    perror("bind");
    close(fd);
    return 2;
  }
  if (listen(fd, 16) != 0) {
    perror("listen");
    close(fd);
    return 2;
  }

  printf("VMSTATE_SOCKET_READY kind=tcp-listen port=%d label=%s\n", port, label);
  fflush(stdout);

  for (;;) {
    int c = accept(fd, NULL, NULL);
    if (c < 0) {
      if (errno == EINTR) continue;
      perror("accept");
      return 2;
    }
    char in[256];
    (void)read(c, in, sizeof(in));
    dprintf(c, "VMSTATE_TCP_OK label=%s\n", label);
    close(c);
  }
}

static int connect_tcp(const char *host, int port) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) {
    perror("socket");
    return -1;
  }
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)port);
  if (inet_pton(AF_INET, host, &addr.sin_addr) != 1) {
    fprintf(stderr, "vmstate-socket-probe: invalid IPv4 address: %s\n", host);
    close(fd);
    return -1;
  }
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    perror("connect");
    close(fd);
    return -1;
  }
  return fd;
}

static int tcp_client_stale(const char *host, int port, const char *label) {
  signal(SIGPIPE, SIG_IGN);
  int fd = connect_tcp(host, port);
  if (fd < 0) return 2;
  set_io_timeouts(fd, 3);

  dprintf(fd, "hello-before-snapshot label=%s\n", label);
  char buf[256];
  ssize_t n = read(fd, buf, sizeof(buf) - 1);
  if (n <= 0) {
    printf("VMSTATE_SOCKET_ERROR kind=tcp-client-stale stage=initial-read label=%s errno=%d\n", label, errno);
    fflush(stdout);
    close(fd);
    return 2;
  }
  buf[n] = 0;
  printf("VMSTATE_SOCKET_READY kind=tcp-client-stale label=%s\n", label);
  fflush(stdout);

  wait_for_go_file();

  const char *after = "hello-after-restore\n";
  ssize_t w = write(fd, after, strlen(after));
  if (w < 0) {
    printf("VMSTATE_SOCKET_STALE_CLOSED label=%s op=write errno=%d\n", label, errno);
    fflush(stdout);
    close(fd);
    return 0;
  }
  n = read(fd, buf, sizeof(buf) - 1);
  if (n <= 0) {
    printf("VMSTATE_SOCKET_STALE_CLOSED label=%s op=read errno=%d\n", label, errno);
    fflush(stdout);
    close(fd);
    return 0;
  }
  buf[n] = 0;
  printf("VMSTATE_SOCKET_STALE_STILL_OPEN label=%s bytes=%zd\n", label, n);
  fflush(stdout);
  close(fd);
  return 0;
}

static int uds_pair(void) {
  signal(SIGPIPE, SIG_IGN);
  int sv[2];
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, sv) != 0) {
    perror("socketpair");
    return 2;
  }
  printf("VMSTATE_SOCKET_READY kind=uds-pair\n");
  fflush(stdout);
  wait_for_go_file();

  const char *msg = "uds-after-restore";
  if (write(sv[0], msg, strlen(msg)) != (ssize_t)strlen(msg)) {
    printf("VMSTATE_SOCKET_UDS_FAIL op=write errno=%d\n", errno);
    fflush(stdout);
    return 2;
  }
  char buf[64];
  ssize_t n = read(sv[1], buf, sizeof(buf));
  if (n != (ssize_t)strlen(msg) || memcmp(buf, msg, strlen(msg)) != 0) {
    printf("VMSTATE_SOCKET_UDS_FAIL op=read n=%zd errno=%d\n", n, errno);
    fflush(stdout);
    return 2;
  }
  printf("VMSTATE_SOCKET_UDS_OK bytes=%zd\n", n);
  fflush(stdout);
  return 0;
}

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage:\n"
          "  %s tcp-listen <port> <label>\n"
          "  %s tcp-client-stale <host-ip> <port> <label>\n"
          "  %s uds-pair\n",
          argv0, argv0, argv0);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    usage(argv[0]);
    return 2;
  }
  if (strcmp(argv[1], "tcp-listen") == 0) {
    if (argc != 4) {
      usage(argv[0]);
      return 2;
    }
    return tcp_listen(parse_port(argv[2]), argv[3]);
  }
  if (strcmp(argv[1], "tcp-client-stale") == 0) {
    if (argc != 5) {
      usage(argv[0]);
      return 2;
    }
    return tcp_client_stale(argv[2], parse_port(argv[3]), argv[4]);
  }
  if (strcmp(argv[1], "uds-pair") == 0) {
    if (argc != 2) {
      usage(argv[0]);
      return 2;
    }
    return uds_pair();
  }
  usage(argv[0]);
  return 2;
}
