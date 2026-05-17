// vmstate timer smoke-test helper.
//
// Built by scripts/smoke/vmstate/common.sh with:
//   zig cc -target aarch64-linux-musl -static -O2
//
// The helper prints a READY marker after arming a guest timer, then a DONE
// marker when that timer completes after a vmstate restore. Host-side smoke
// scripts assert that guest CLOCK_MONOTONIC did not include host downtime and
// that pending deadlines did not fire immediately on resume.

#define _GNU_SOURCE
#include <errno.h>
#include <inttypes.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/timerfd.h>
#include <time.h>
#include <unistd.h>

static uint64_t monotonic_ms(void) {
  struct timespec ts;
  if (clock_gettime(CLOCK_MONOTONIC, &ts) != 0) {
    perror("clock_gettime(CLOCK_MONOTONIC)");
    exit(2);
  }
  return ((uint64_t)ts.tv_sec * 1000ULL) + ((uint64_t)ts.tv_nsec / 1000000ULL);
}

static long parse_ms(const char *s) {
  char *end = NULL;
  errno = 0;
  long v = strtol(s, &end, 10);
  if (errno != 0 || end == s || *end != '\0' || v <= 0) {
    fprintf(stderr, "vmstate-timer-probe: invalid milliseconds: %s\n", s);
    exit(2);
  }
  return v;
}

static void sleep_ms_interruptible(long ms) {
  struct timespec req = {
    .tv_sec = ms / 1000,
    .tv_nsec = (ms % 1000) * 1000000L,
  };
  while (nanosleep(&req, &req) != 0) {
    if (errno != EINTR) {
      perror("nanosleep");
      exit(2);
    }
  }
}

static int mode_monotonic(void) {
  printf("VMSTATE_MONOTONIC now_ms=%" PRIu64 "\n", monotonic_ms());
  fflush(stdout);
  return 0;
}

static int mode_nanosleep(long ms) {
  const uint64_t before = monotonic_ms();
  printf("VMSTATE_TIMER_READY kind=nanosleep sleep_ms=%ld before_ms=%" PRIu64 "\n", ms, before);
  fflush(stdout);

  sleep_ms_interruptible(ms);

  const uint64_t after = monotonic_ms();
  printf("VMSTATE_TIMER_DONE kind=nanosleep sleep_ms=%ld elapsed_ms=%" PRIu64 " after_ms=%" PRIu64 "\n",
         ms, after - before, after);
  fflush(stdout);
  return 0;
}

static int mode_timerfd(long ms) {
  const int fd = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC);
  if (fd < 0) {
    perror("timerfd_create");
    return 2;
  }

  struct itimerspec spec;
  memset(&spec, 0, sizeof(spec));
  spec.it_value.tv_sec = ms / 1000;
  spec.it_value.tv_nsec = (ms % 1000) * 1000000L;
  if (timerfd_settime(fd, 0, &spec, NULL) != 0) {
    perror("timerfd_settime");
    close(fd);
    return 2;
  }

  const uint64_t before = monotonic_ms();
  printf("VMSTATE_TIMER_READY kind=timerfd sleep_ms=%ld before_ms=%" PRIu64 "\n", ms, before);
  fflush(stdout);

  struct pollfd pfd = { .fd = fd, .events = POLLIN };
  int prc;
  do {
    prc = poll(&pfd, 1, -1);
  } while (prc < 0 && errno == EINTR);
  if (prc < 0) {
    perror("poll(timerfd)");
    close(fd);
    return 2;
  }

  uint64_t expirations = 0;
  ssize_t n;
  do {
    n = read(fd, &expirations, sizeof(expirations));
  } while (n < 0 && errno == EINTR);
  if (n != (ssize_t)sizeof(expirations)) {
    perror("read(timerfd)");
    close(fd);
    return 2;
  }
  close(fd);

  const uint64_t after = monotonic_ms();
  printf("VMSTATE_TIMER_DONE kind=timerfd sleep_ms=%ld elapsed_ms=%" PRIu64 " expirations=%" PRIu64 " after_ms=%" PRIu64 "\n",
         ms, after - before, expirations, after);
  fflush(stdout);
  return 0;
}

static void usage(const char *argv0) {
  fprintf(stderr,
          "usage:\n"
          "  %s monotonic\n"
          "  %s nanosleep <milliseconds>\n"
          "  %s timerfd <milliseconds>\n",
          argv0, argv0, argv0);
}

int main(int argc, char **argv) {
  if (argc < 2) {
    usage(argv[0]);
    return 2;
  }
  if (strcmp(argv[1], "monotonic") == 0) {
    return mode_monotonic();
  }
  if (strcmp(argv[1], "nanosleep") == 0) {
    if (argc != 3) {
      usage(argv[0]);
      return 2;
    }
    return mode_nanosleep(parse_ms(argv[2]));
  }
  if (strcmp(argv[1], "timerfd") == 0) {
    if (argc != 3) {
      usage(argv[0]);
      return 2;
    }
    return mode_timerfd(parse_ms(argv[2]));
  }
  usage(argv[0]);
  return 2;
}
