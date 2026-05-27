#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <sys/eventfd.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

int main(void) {
  int fd = eventfd(0, EFD_CLOEXEC);
  if (fd < 0) {
    perror("eventfd");
    return errno == 0 ? 1 : errno;
  }

  struct pollfd poll_fd = {.fd = fd, .events = POLLIN, .revents = 0};
  struct timespec timeout = {.tv_sec = 2, .tv_nsec = 0};
  long rc = syscall(SYS_ppoll, &poll_fd, 1, &timeout, NULL, 0);
  if (rc == 0) {
    close(fd);
    return 0;
  }
  int saved_errno = errno;
  perror("ppoll");
  close(fd);
  return saved_errno == 0 ? 1 : saved_errno;
}
