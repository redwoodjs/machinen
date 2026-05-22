#define _GNU_SOURCE
#include <errno.h>
#include <poll.h>
#include <stdio.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

int main(void) {
  struct timespec timeout = {.tv_sec = 30, .tv_nsec = 0};
  long rc = syscall(SYS_ppoll, NULL, 0, &timeout, NULL, 0);
  if (rc == 0) {
    return 0;
  }
  int saved_errno = errno;
  perror("ppoll");
  return saved_errno == 0 ? 1 : saved_errno;
}
