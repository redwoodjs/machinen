// Small non-cooperative process used by the native process capture proof.
//
// The program has no Machinen checkpoint ABI and never writes a capture bundle.
// It opens an optional resource file and then stays in user-space work until an
// external capturer stops it with ptrace.

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>
#include <unistd.h>

static volatile uint64_t native_capture_counter = 0;

static void die(const char *message) {
  fprintf(stderr, "machinen-native-capture-target: %s: %s\n", message, strerror(errno));
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

static int open_resource_file(const char *path) {
  if (!path) {
    return -1;
  }
  int fd = open(path, O_CREAT | O_TRUNC | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) {
    die("open resource file");
  }
  const char payload[] = "machinen-native-process-capture\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write resource file");
  }
  if (lseek(fd, 9, SEEK_SET) < 0) {
    die("seek resource file");
  }
  return fd;
}

int main(int argc, char **argv) {
  int resource_fd = open_resource_file(resource_file_arg(argc, argv));
  printf("MACHINEN_NATIVE_CAPTURE_TARGET pid=%ld resource_fd=%d\n", (long)getpid(), resource_fd);
  fflush(stdout);

  for (;;) {
    native_capture_counter++;
    if ((native_capture_counter & 0xfffffu) == 0) {
      __asm__ __volatile__("" ::: "memory");
    }
  }
}
