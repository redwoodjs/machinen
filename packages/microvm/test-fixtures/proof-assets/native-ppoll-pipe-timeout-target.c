#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

int main(void) {
  int fds[2];
  if (pipe(fds) != 0) {
    perror("pipe");
    return errno == 0 ? 1 : errno;
  }

  struct pollfd poll_fd = {.fd = fds[0], .events = POLLIN, .revents = 0};
  struct timespec timeout = {.tv_sec = 30, .tv_nsec = 0};
  long rc = syscall(SYS_ppoll, &poll_fd, 1, &timeout, NULL, 0);
  if (rc == 0) {
    close(fds[0]);
    close(fds[1]);
    return 0;
  }
  int saved_errno = errno;
  perror("ppoll");
  close(fds[0]);
  close(fds[1]);
  return saved_errno == 0 ? 1 : saved_errno;
}
