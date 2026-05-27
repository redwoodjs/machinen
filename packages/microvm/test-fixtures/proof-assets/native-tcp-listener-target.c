#define _GNU_SOURCE

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

#define TARGET_FILE_FD 38
#define DATA_FILE "/tmp/machinen-native-tcp-listener-target-data.txt"

static char file_read_buffer[4] __attribute__((used));

static void die(const char *what) {
  fprintf(stderr, "machinen-native-tcp-listener-target: %s: %s\n", what, strerror(errno));
  _exit(1);
}

static void clear_simd_fpu_state(void) {
#if defined(__aarch64__)
  __asm__ __volatile__(
      "movi v0.16b, #0\n"
      "movi v1.16b, #0\n"
      "movi v2.16b, #0\n"
      "movi v3.16b, #0\n"
      "movi v4.16b, #0\n"
      "movi v5.16b, #0\n"
      "movi v6.16b, #0\n"
      "movi v7.16b, #0\n"
      "movi v8.16b, #0\n"
      "movi v9.16b, #0\n"
      "movi v10.16b, #0\n"
      "movi v11.16b, #0\n"
      "movi v12.16b, #0\n"
      "movi v13.16b, #0\n"
      "movi v14.16b, #0\n"
      "movi v15.16b, #0\n"
      "movi v16.16b, #0\n"
      "movi v17.16b, #0\n"
      "movi v18.16b, #0\n"
      "movi v19.16b, #0\n"
      "movi v20.16b, #0\n"
      "movi v21.16b, #0\n"
      "movi v22.16b, #0\n"
      "movi v23.16b, #0\n"
      "movi v24.16b, #0\n"
      "movi v25.16b, #0\n"
      "movi v26.16b, #0\n"
      "movi v27.16b, #0\n"
      "movi v28.16b, #0\n"
      "movi v29.16b, #0\n"
      "movi v30.16b, #0\n"
      "movi v31.16b, #0\n"
      "msr fpsr, xzr\n"
      "msr fpcr, xzr\n"
      ::: "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10",
      "v11", "v12", "v13", "v14", "v15", "v16", "v17", "v18", "v19", "v20",
      "v21", "v22", "v23", "v24", "v25", "v26", "v27", "v28", "v29", "v30",
      "v31", "memory");
#endif
}

static void setup_file_fd(void) {
  int fd = open(DATA_FILE, O_CREAT | O_TRUNC | O_WRONLY, 0644);
  if (fd < 0) die("open write file");
  const char bytes[] = "HEADER-FILE-READ-PROOF\n";
  if (write(fd, bytes, sizeof(bytes) - 1u) != (ssize_t)(sizeof(bytes) - 1u)) die("write file");
  close(fd);
  fd = open(DATA_FILE, O_RDONLY);
  if (fd < 0) die("open read file");
  if (dup2(fd, TARGET_FILE_FD) < 0) die("dup2 file");
  if (fd != TARGET_FILE_FD) close(fd);
  if (lseek(TARGET_FILE_FD, 7, SEEK_SET) < 0) die("lseek file");
}

int main(void) {
  setup_file_fd();
  int fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) die("socket");
  int yes = 1;
  if (setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes)) != 0) die("setsockopt");
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_port = htons(0);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) die("bind");
  if (listen(fd, 8) != 0) die("listen");
  if (dup2(fd, 55) < 0) die("dup2 listener");
  if (fd != 55) close(fd);
  fprintf(stderr, "MACHINEN_NATIVE_TCP_LISTENER_READY fd=55\n");
  fflush(stderr);
  clear_simd_fpu_state();
  long rc = syscall(SYS_read, TARGET_FILE_FD, file_read_buffer, 4);
  if (rc < 0) die("read");
  for (;;) pause();
}
