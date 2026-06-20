#define _DARWIN_C_SOURCE
#define _GNU_SOURCE
#define _XOPEN_SOURCE 600

#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <termios.h>
#include <unistd.h>

#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

#define CONTROL_FD 3
#define BUF_SIZE 4096
#define CONTROL_BUF_SIZE 256

static int write_all(int fd, const char *buf, ssize_t len) {
  ssize_t off = 0;
  while (off < len) {
    ssize_t n = write(fd, buf + off, (size_t)(len - off));
    if (n < 0) {
      if (errno == EINTR) {
        continue;
      }
      return -1;
    }
    off += n;
  }
  return 0;
}

static int parse_uint16(const char *text, unsigned short *out) {
  char *end = NULL;
  errno = 0;
  long value = strtol(text, &end, 10);
  if (errno != 0 || end == text || value <= 0 || value > 65535) {
    return -1;
  }
  *out = (unsigned short)value;
  return 0;
}

static void resize_pty(int master_fd, pid_t child_pid, unsigned short cols, unsigned short rows) {
  (void)child_pid;
  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;
  (void)ioctl(master_fd, TIOCSWINSZ, &ws);
}

static void handle_control_line(char *line, int master_fd, pid_t child_pid) {
  if (line[0] == 'R' && (line[1] == ' ' || line[1] == '\t')) {
    char *cols_text = line + 2;
    while (*cols_text == ' ' || *cols_text == '\t') {
      cols_text++;
    }
    char *rows_text = cols_text;
    while (*rows_text != '\0' && *rows_text != ' ' && *rows_text != '\t') {
      rows_text++;
    }
    if (*rows_text == '\0') {
      return;
    }
    *rows_text++ = '\0';
    while (*rows_text == ' ' || *rows_text == '\t') {
      rows_text++;
    }
    unsigned short cols = 0;
    unsigned short rows = 0;
    if (parse_uint16(cols_text, &cols) == 0 && parse_uint16(rows_text, &rows) == 0) {
      resize_pty(master_fd, child_pid, cols, rows);
    }
    return;
  }
  if (strcmp(line, "K") == 0) {
    if (child_pid > 0) {
      (void)kill(child_pid, SIGKILL);
    }
  }
}

static void process_control_bytes(
  char *control_buf,
  size_t *control_len,
  const char *buf,
  ssize_t n,
  int master_fd,
  pid_t child_pid
) {
  for (ssize_t i = 0; i < n; i++) {
    char c = buf[i];
    if (c == '\r') {
      continue;
    }
    if (c == '\n') {
      control_buf[*control_len] = '\0';
      handle_control_line(control_buf, master_fd, child_pid);
      *control_len = 0;
      continue;
    }
    if (*control_len + 1 < CONTROL_BUF_SIZE) {
      control_buf[(*control_len)++] = c;
    } else {
      *control_len = 0;
    }
  }
}

static int child_exit_code(int status) {
  if (WIFEXITED(status)) {
    return WEXITSTATUS(status);
  }
  if (WIFSIGNALED(status)) {
    return 128 + WTERMSIG(status);
  }
  return 1;
}

static void usage(const char *argv0) {
  fprintf(stderr, "usage: %s --cols <cols> --rows <rows> --term <term> -- <binary> [args...]\n", argv0);
}

int main(int argc, char **argv) {
  unsigned short cols = 80;
  unsigned short rows = 24;
  const char *term = "xterm-256color";
  int command_index = -1;

  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) {
      command_index = i + 1;
      break;
    }
    if (strcmp(argv[i], "--cols") == 0 && i + 1 < argc) {
      if (parse_uint16(argv[++i], &cols) != 0) {
        usage(argv[0]);
        return 2;
      }
      continue;
    }
    if (strcmp(argv[i], "--rows") == 0 && i + 1 < argc) {
      if (parse_uint16(argv[++i], &rows) != 0) {
        usage(argv[0]);
        return 2;
      }
      continue;
    }
    if (strcmp(argv[i], "--term") == 0 && i + 1 < argc) {
      term = argv[++i];
      continue;
    }
    usage(argv[0]);
    return 2;
  }

  if (command_index < 0 || command_index >= argc) {
    usage(argv[0]);
    return 2;
  }

  struct winsize ws;
  memset(&ws, 0, sizeof(ws));
  ws.ws_col = cols;
  ws.ws_row = rows;

  int master_fd = -1;
  pid_t child_pid = forkpty(&master_fd, NULL, NULL, &ws);
  if (child_pid < 0) {
    perror("forkpty");
    return 1;
  }

  if (child_pid == 0) {
    setenv("TERM", term, 1);
    execvp(argv[command_index], &argv[command_index]);
    perror("execvp");
    _exit(127);
  }

  char buf[BUF_SIZE];
  char control_buf[CONTROL_BUF_SIZE];
  size_t control_len = 0;
  bool stdin_open = true;
  bool control_open = fcntl(CONTROL_FD, F_GETFD) != -1 || errno != EBADF;
  bool master_open = true;
  int status = 0;
  bool child_done = false;

  while (master_open || !child_done) {
    int waited = waitpid(child_pid, &status, WNOHANG);
    if (waited == child_pid) {
      child_done = true;
    }

    struct pollfd fds[3];
    nfds_t nfds = 0;
    if (stdin_open) {
      fds[nfds++] = (struct pollfd){ .fd = STDIN_FILENO, .events = POLLIN | POLLHUP };
    }
    if (control_open) {
      fds[nfds++] = (struct pollfd){ .fd = CONTROL_FD, .events = POLLIN | POLLHUP };
    }
    if (master_open) {
      fds[nfds++] = (struct pollfd){ .fd = master_fd, .events = POLLIN | POLLHUP };
    }

    if (nfds == 0) {
      break;
    }

    int rc = poll(fds, nfds, child_done ? 50 : -1);
    if (rc < 0) {
      if (errno == EINTR) {
        continue;
      }
      break;
    }
    if (rc == 0) {
      if (child_done && master_open) {
        close(master_fd);
        master_open = false;
      }
      continue;
    }

    nfds_t idx = 0;
    if (stdin_open) {
      short revents = fds[idx++].revents;
      if (revents & POLLIN) {
        ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
        if (n > 0) {
          (void)write_all(master_fd, buf, n);
        } else if (n == 0 || errno != EINTR) {
          stdin_open = false;
        }
      }
      if (revents & (POLLHUP | POLLERR | POLLNVAL)) {
        stdin_open = false;
      }
    }

    if (control_open) {
      short revents = fds[idx++].revents;
      if (revents & POLLIN) {
        ssize_t n = read(CONTROL_FD, buf, sizeof(buf));
        if (n > 0) {
          process_control_bytes(control_buf, &control_len, buf, n, master_fd, child_pid);
        } else if (n == 0 || errno != EINTR) {
          control_open = false;
        }
      }
      if (revents & (POLLHUP | POLLERR | POLLNVAL)) {
        control_open = false;
      }
    }

    if (master_open) {
      short revents = fds[idx++].revents;
      if (revents & POLLIN) {
        ssize_t n = read(master_fd, buf, sizeof(buf));
        if (n > 0) {
          if (write_all(STDOUT_FILENO, buf, n) != 0) {
            master_open = false;
          }
        } else if (n == 0 || errno != EINTR) {
          master_open = false;
        }
      }
      if (revents & (POLLHUP | POLLERR | POLLNVAL)) {
        master_open = false;
      }
    }
  }

  if (!child_done) {
    while (waitpid(child_pid, &status, 0) < 0) {
      if (errno != EINTR) {
        return 1;
      }
    }
  }
  if (master_fd >= 0) {
    close(master_fd);
  }
  return child_exit_code(status);
}
