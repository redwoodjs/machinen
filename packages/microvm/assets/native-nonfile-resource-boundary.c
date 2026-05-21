// Native resource-boundary target with one regular file and several non-file fds.

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/timerfd.h>
#include <time.h>
#include <unistd.h>

#define SOURCE_MARKER UINT64_C(0x534f555243454a50)

struct NativeNonfileResourceState {
  uint64_t self;
  uint64_t marker;
  uint64_t regular_fd;
  uint64_t pipe_read_fd;
  uint64_t socket_fd;
  uint64_t epoll_fd;
  uint64_t event_fd;
  uint64_t timer_fd;
  uint64_t padding[56];
};

static struct NativeNonfileResourceState native_nonfile_resource_state
    __attribute__((aligned(4096)));

static void die(const char *message) {
  fprintf(stderr, "machinen-native-nonfile-resource-boundary: %s: %s\n", message, strerror(errno));
  exit(1);
}

static const char *resource_file_arg(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--resource-file") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "--resource-file requires a path\n");
        exit(2);
      }
      return argv[i + 1];
    }
  }
  return NULL;
}

static int open_regular_file(const char *path) {
  if (!path) {
    return -1;
  }
  int fd = open(path, O_CREAT | O_TRUNC | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) {
    die("open regular file");
  }
  const char payload[] = "machinen-native-nonfile-resource-boundary\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write regular file");
  }
  if (lseek(fd, 9, SEEK_SET) < 0) {
    die("seek regular file");
  }
  return fd;
}

static int make_pipe(int out[2]) {
  if (pipe2(out, O_CLOEXEC) != 0) {
    die("pipe2");
  }
  return out[0];
}

static int make_socketpair(int out[2]) {
  if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0, out) != 0) {
    die("socketpair");
  }
  return out[0];
}

static int make_epoll(int watched_fd) {
  int fd = epoll_create1(EPOLL_CLOEXEC);
  if (fd < 0) {
    die("epoll_create1");
  }
  struct epoll_event event = {.events = EPOLLIN, .data.u64 = 0x484848u};
  if (epoll_ctl(fd, EPOLL_CTL_ADD, watched_fd, &event) != 0) {
    die("epoll_ctl");
  }
  return fd;
}

static int make_eventfd(void) {
  int fd = eventfd(7, EFD_CLOEXEC | EFD_NONBLOCK);
  if (fd < 0) {
    die("eventfd");
  }
  return fd;
}

static int make_timerfd(void) {
  int fd = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC | TFD_NONBLOCK);
  if (fd < 0) {
    die("timerfd_create");
  }
  struct itimerspec spec = {0};
  spec.it_value.tv_sec = 60;
  if (timerfd_settime(fd, 0, &spec, NULL) != 0) {
    die("timerfd_settime");
  }
  return fd;
}

#if defined(__aarch64__)
void machinen_native_nonfile_resource_active(struct NativeNonfileResourceState *state)
    __attribute__((noreturn));
__asm__(
    ".text\n"
    ".global machinen_native_nonfile_resource_active\n"
    ".type machinen_native_nonfile_resource_active, %function\n"
    "machinen_native_nonfile_resource_active:\n"
    "1:\n"
    "  ldr x1, [x0, #16]\n"
    "  add x1, x1, #1\n"
    "  str x1, [x0, #16]\n"
    "  b 1b\n"
    ".size machinen_native_nonfile_resource_active, .-machinen_native_nonfile_resource_active\n");
#else
__attribute__((noinline, noreturn)) void machinen_native_nonfile_resource_active(
    struct NativeNonfileResourceState *state) {
  for (;;) {
    state->regular_fd++;
  }
}
#endif

int main(int argc, char **argv) {
  int pipe_fds[2] = {-1, -1};
  int socket_fds[2] = {-1, -1};
  int regular_fd = open_regular_file(resource_file_arg(argc, argv));
  int pipe_read_fd = make_pipe(pipe_fds);
  int socket_fd = make_socketpair(socket_fds);
  int epoll_fd = make_epoll(pipe_read_fd);
  int event_fd = make_eventfd();
  int timer_fd = make_timerfd();

  native_nonfile_resource_state.self = (uint64_t)(uintptr_t)&native_nonfile_resource_state;
  native_nonfile_resource_state.marker = SOURCE_MARKER;
  native_nonfile_resource_state.regular_fd = (uint64_t)regular_fd;
  native_nonfile_resource_state.pipe_read_fd = (uint64_t)pipe_read_fd;
  native_nonfile_resource_state.socket_fd = (uint64_t)socket_fd;
  native_nonfile_resource_state.epoll_fd = (uint64_t)epoll_fd;
  native_nonfile_resource_state.event_fd = (uint64_t)event_fd;
  native_nonfile_resource_state.timer_fd = (uint64_t)timer_fd;

  printf(
      "MACHINEN_NATIVE_NONFILE_RESOURCE_BOUNDARY pid=%ld file=%d pipe=%d socket=%d epoll=%d eventfd=%d timerfd=%d\n",
      (long)getpid(),
      regular_fd,
      pipe_read_fd,
      socket_fd,
      epoll_fd,
      event_fd,
      timer_fd);
  fflush(stdout);
  machinen_native_nonfile_resource_active(&native_nonfile_resource_state);
}
