// vmstate entropy smoke-test helper.
//
// Built by scripts/smoke/vmstate/common.sh with:
//   zig cc -target aarch64-linux-musl -static -O2
//
// Reads bytes from either /dev/urandom or getrandom(2) and prints a stable
// one-line hex record so host smoke tests can compare two restores/forks of
// the same vmstate bundle.

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/random.h>
#include <sys/syscall.h>
#include <unistd.h>

static long parse_len(const char *s) {
  char *end = NULL;
  errno = 0;
  long v = strtol(s, &end, 10);
  if (errno != 0 || end == s || *end != '\0' || v <= 0 || v > 4096) {
    fprintf(stderr, "vmstate-entropy-probe: invalid byte count: %s\n", s);
    exit(2);
  }
  return v;
}

static void read_full_fd(int fd, unsigned char *buf, size_t len) {
  size_t off = 0;
  while (off < len) {
    ssize_t n = read(fd, buf + off, len - off);
    if (n < 0 && errno == EINTR) {
      continue;
    }
    if (n <= 0) {
      perror("read(/dev/urandom)");
      exit(2);
    }
    off += (size_t)n;
  }
}

static void read_urandom(unsigned char *buf, size_t len) {
  int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  if (fd < 0) {
    perror("open(/dev/urandom)");
    exit(2);
  }
  read_full_fd(fd, buf, len);
  close(fd);
}

static void read_getrandom(unsigned char *buf, size_t len) {
  size_t off = 0;
  while (off < len) {
    ssize_t n = getrandom(buf + off, len - off, 0);
    if (n < 0 && errno == ENOSYS) {
      n = syscall(SYS_getrandom, buf + off, len - off, 0);
    }
    if (n < 0 && errno == EINTR) {
      continue;
    }
    if (n <= 0) {
      perror("getrandom");
      exit(2);
    }
    off += (size_t)n;
  }
}

static void print_hex(const char *kind, const unsigned char *buf, size_t len) {
  printf("VMSTATE_ENTROPY kind=%s bytes=%zu hex=", kind, len);
  for (size_t i = 0; i < len; i++) {
    printf("%02x", buf[i]);
  }
  printf("\n");
  fflush(stdout);
}

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage:\n"
          "  %s urandom [bytes]\n"
          "  %s getrandom [bytes]\n",
          argv0, argv0);
}

int main(int argc, char **argv) {
  if (argc < 2 || argc > 3) {
    usage(argv[0]);
    return 2;
  }
  const long len = argc == 3 ? parse_len(argv[2]) : 64;
  unsigned char *buf = calloc((size_t)len, 1);
  if (!buf) {
    perror("calloc");
    return 2;
  }

  if (strcmp(argv[1], "urandom") == 0) {
    read_urandom(buf, (size_t)len);
    print_hex("urandom", buf, (size_t)len);
  } else if (strcmp(argv[1], "getrandom") == 0) {
    read_getrandom(buf, (size_t)len);
    print_hex("getrandom", buf, (size_t)len);
  } else {
    free(buf);
    usage(argv[0]);
    return 2;
  }

  free(buf);
  return 0;
}
