// Native terminal-size forwarder used by VsockWinsize.
//
// The guest winsize agent is reached through a host Unix socket created by the
// VMM vsock bridge. This helper retries that socket connect, prints READY once
// connected, then relays validated `cols rows` lines from stdin to the bridge
// while dropping duplicates. Keeping the loop native removes per-resize JS
// socket churn and packages the path with the other host helper binaries.

#define _DARWIN_C_SOURCE
#define _GNU_SOURCE
#define _XOPEN_SOURCE 700

#include <errno.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/un.h>
#include <unistd.h>

#define LINE_BUF_SIZE 128
#define IO_BUF_SIZE 4096

static uint64_t now_ms(void) {
  struct timeval tv;
  gettimeofday(&tv, NULL);
  return ((uint64_t)tv.tv_sec * 1000u) + ((uint64_t)tv.tv_usec / 1000u);
}

static int parse_int_arg(const char *text, int min, int max, int *out) {
  char *end = NULL;
  errno = 0;
  long value = strtol(text, &end, 10);
  if (errno != 0 || end == text || *end != '\0' || value < min || value > max) {
    return -1;
  }
  *out = (int)value;
  return 0;
}

static int write_all(int fd, const char *buf, size_t len) {
  size_t off = 0;
  while (off < len) {
    ssize_t n = write(fd, buf + off, len - off);
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    if (n == 0) {
      return -1;
    }
    off += (size_t)n;
  }
  return 0;
}

static int connect_uds_once(const char *path) {
  if (strlen(path) >= sizeof(((struct sockaddr_un *)0)->sun_path)) {
    errno = ENAMETOOLONG;
    return -1;
  }
  int fd = socket(AF_UNIX, SOCK_STREAM, 0);
  if (fd < 0) {
    return -1;
  }
  struct sockaddr_un addr;
  memset(&addr, 0, sizeof(addr));
  addr.sun_family = AF_UNIX;
  strncpy(addr.sun_path, path, sizeof(addr.sun_path) - 1);
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) == 0) {
    return fd;
  }
  int saved = errno;
  close(fd);
  errno = saved;
  return -1;
}

static int connect_with_retry(const char *path, int timeout_ms, int retry_ms) {
  const uint64_t deadline = now_ms() + (uint64_t)timeout_ms;
  int last_errno = 0;
  while (now_ms() < deadline) {
    int fd = connect_uds_once(path);
    if (fd >= 0) {
      return fd;
    }
    last_errno = errno;
    usleep((useconds_t)retry_ms * 1000u);
  }
  errno = last_errno ? last_errno : ETIMEDOUT;
  return -1;
}

static bool valid_size_line(const char *line) {
  char *end = NULL;
  errno = 0;
  long cols = strtol(line, &end, 10);
  if (errno != 0 || end == line || cols <= 0 || cols > 65535) {
    return false;
  }
  while (*end == ' ' || *end == '\t') {
    end++;
  }
  char *rows_start = end;
  errno = 0;
  long rows = strtol(rows_start, &end, 10);
  if (errno != 0 || end == rows_start || rows <= 0 || rows > 65535) {
    return false;
  }
  while (*end == ' ' || *end == '\t') {
    end++;
  }
  return *end == '\0';
}

static void process_line(int sock, char *line, char *last_sent) {
  if (!valid_size_line(line)) {
    return;
  }
  if (strcmp(line, last_sent) == 0) {
    return;
  }
  if (write_all(sock, line, strlen(line)) == 0 && write_all(sock, "\n", 1) == 0) {
    strncpy(last_sent, line, LINE_BUF_SIZE - 1);
    last_sent[LINE_BUF_SIZE - 1] = '\0';
  }
}

static void process_stdin_bytes(
  int sock,
  const char *buf,
  ssize_t n,
  char *line,
  size_t *line_len,
  char *last_sent
) {
  for (ssize_t i = 0; i < n; i++) {
    char c = buf[i];
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      line[*line_len] = '\0';
      process_line(sock, line, last_sent);
      *line_len = 0;
      continue;
    }
    if (*line_len + 1 < LINE_BUF_SIZE) {
      line[(*line_len)++] = c;
    } else {
      *line_len = 0;
    }
  }
}

static void usage(const char *argv0) {
  fprintf(stderr, "usage: %s --timeout-ms <ms> --retry-ms <ms> -- <uds-path>\n", argv0);
}

int main(int argc, char **argv) {
  int timeout_ms = 10000;
  int retry_ms = 250;
  int path_index = -1;

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) {
      path_index = i + 1;
      break;
    }
    if (strcmp(argv[i], "--timeout-ms") == 0 && i + 1 < argc) {
      if (parse_int_arg(argv[++i], 1, 3600000, &timeout_ms) != 0) {
        usage(argv[0]);
        return 2;
      }
      continue;
    }
    if (strcmp(argv[i], "--retry-ms") == 0 && i + 1 < argc) {
      if (parse_int_arg(argv[++i], 1, 60000, &retry_ms) != 0) {
        usage(argv[0]);
        return 2;
      }
      continue;
    }
    usage(argv[0]);
    return 2;
  }

  if (path_index < 0 || path_index >= argc) {
    usage(argv[0]);
    return 2;
  }

  int sock = connect_with_retry(argv[path_index], timeout_ms, retry_ms);
  if (sock < 0) {
    fprintf(stderr, "machinen-winsize: connect(%s) failed after %dms: %s\n", argv[path_index], timeout_ms, strerror(errno));
    return 1;
  }

  if (write_all(STDOUT_FILENO, "READY\n", 6) != 0) {
    close(sock);
    return 1;
  }

  char io_buf[IO_BUF_SIZE];
  char line[LINE_BUF_SIZE] = {0};
  char last_sent[LINE_BUF_SIZE] = {0};
  size_t line_len = 0;
  bool stdin_open = true;
  bool sock_open = true;

  while (stdin_open && sock_open) {
    struct pollfd fds[2];
    fds[0] = (struct pollfd){ .fd = STDIN_FILENO, .events = POLLIN | POLLHUP };
    fds[1] = (struct pollfd){ .fd = sock, .events = POLLIN | POLLHUP };
    int rc = poll(fds, 2, -1);
    if (rc < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }
    if (fds[0].revents & POLLIN) {
      ssize_t n = read(STDIN_FILENO, io_buf, sizeof(io_buf));
      if (n > 0) {
        process_stdin_bytes(sock, io_buf, n, line, &line_len, last_sent);
      } else if (n == 0 || errno != EINTR) {
        stdin_open = false;
      }
    }
    if (fds[0].revents & (POLLHUP | POLLERR | POLLNVAL)) {
      stdin_open = false;
    }
    if (fds[1].revents & POLLIN) {
      ssize_t n = read(sock, io_buf, sizeof(io_buf));
      if (n <= 0 && (n == 0 || errno != EINTR)) {
        sock_open = false;
      }
    }
    if (fds[1].revents & (POLLHUP | POLLERR | POLLNVAL)) {
      sock_open = false;
    }
  }

  close(sock);
  return 0;
}
