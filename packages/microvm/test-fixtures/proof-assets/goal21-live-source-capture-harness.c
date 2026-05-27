#define _GNU_SOURCE
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/eventfd.h>
#include <sys/socket.h>
#include <sys/timerfd.h>
#include <time.h>
#include <unistd.h>

static int make_eventfd_fixture(void) {
  int fd = eventfd(1, EFD_CLOEXEC | EFD_NONBLOCK);
  if (fd < 0) {
    perror("eventfd");
    return 1;
  }
  printf("GOAL21_LIVE_CAPTURE_EVENTFD fd=%d\n", fd);
  return 0;
}

static int make_timerfd_fixture(void) {
  int fd = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC | TFD_NONBLOCK);
  if (fd < 0) {
    perror("timerfd_create");
    return 1;
  }
  printf("GOAL21_LIVE_CAPTURE_TIMERFD fd=%d\n", fd);
  return 0;
}

static int make_socket_fixture(void) {
  int fds[2];
  if (socketpair(AF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0, fds) < 0) {
    perror("socketpair");
    return 1;
  }
  const char payload[] = "goal21";
  if (write(fds[0], payload, sizeof(payload)) < 0) {
    perror("write socketpair");
    return 1;
  }
  printf("GOAL21_LIVE_CAPTURE_SOCKET fd0=%d fd1=%d bytes=%zu\n", fds[0], fds[1], sizeof(payload));
  return 0;
}

int main(int argc, char **argv) {
  const char *profile = argc > 1 ? argv[1] : "goal21-live-capture";
  if (strstr(profile, "eventfd") != NULL) {
    return make_eventfd_fixture();
  }
  if (strstr(profile, "timerfd") != NULL) {
    return make_timerfd_fixture();
  }
  if (strstr(profile, "socket") != NULL || strstr(profile, "udp") != NULL ||
      strstr(profile, "tcp") != NULL || strstr(profile, "icmp") != NULL ||
      strstr(profile, "ping") != NULL) {
    return make_socket_fixture();
  }
  printf("GOAL21_LIVE_CAPTURE_GENERIC profile=%s pid=%ld\n", profile, (long)getpid());
  return 0;
}
