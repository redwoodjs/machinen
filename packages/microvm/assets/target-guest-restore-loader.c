// Portable machine target-guest restore loader.
//
// The loader is intentionally small: it validates a line-oriented descriptor,
// refuses unsupported resources before target code can run, then runs the
// native resume trampoline with the validated continuation arguments. The
// trampoline still performs the low-level mmap/stack/jump work.

#include <errno.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#ifndef PATH_MAX
#define PATH_MAX 4096
#endif

#define LOADER_PREFIX "MACHINEN_TARGET_GUEST_RESTORE_LOADER "

struct Options {
  const char *descriptor_path;
  const char *trampoline_path;
};

struct Descriptor {
  bool saw_kind;
  bool saw_arch;
  bool saw_code_file;
  char code_file[PATH_MAX];
  uint64_t file_offset;
  uint64_t code_size;
  uint64_t target_address;
  uint64_t timeout_seconds;
  uint64_t stack_target_start;
  uint64_t stack_size;
  uint64_t stack_pointer;
  int pipe_read_fd;
  int pipe_write_fd;
  int event_fd;
};

static bool streq(const char *left, const char *right) {
  return strcmp(left, right) == 0;
}

static bool starts_with(const char *value, const char *prefix) {
  return strncmp(value, prefix, strlen(prefix)) == 0;
}

static void print_refusal(const char *code, const char *message) {
  printf(LOADER_PREFIX "{\"status\":\"refused\",\"code\":\"%s\",\"message\":\"%s\"}\n",
      code,
      message);
}

static void refuse(const char *code, const char *message) {
  print_refusal(code, message);
  exit(2);
}

static void usage(void) {
  fprintf(stderr,
      "usage: machinen-target-guest-restore-loader --descriptor path --trampoline path\n");
  exit(2);
}

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {0};
  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--descriptor")) {
      if (++i >= argc) {
        usage();
      }
      opts.descriptor_path = argv[i];
    } else if (streq(argv[i], "--trampoline")) {
      if (++i >= argc) {
        usage();
      }
      opts.trampoline_path = argv[i];
    } else {
      usage();
    }
  }
  if (!opts.descriptor_path || !opts.trampoline_path) {
    usage();
  }
  return opts;
}

static void trim_line(char *line) {
  size_t length = strlen(line);
  while (length > 0 && (line[length - 1] == '\n' || line[length - 1] == '\r' ||
                           line[length - 1] == ' ' || line[length - 1] == '\t')) {
    line[--length] = '\0';
  }
  char *start = line;
  while (*start == ' ' || *start == '\t') {
    start++;
  }
  if (start != line) {
    memmove(line, start, strlen(start) + 1u);
  }
}

static uint64_t parse_u64(const char *value, const char *field) {
  errno = 0;
  char *end = NULL;
  uint64_t parsed = strtoull(value, &end, 0);
  if (errno != 0 || end == value || *end != '\0') {
    (void)field;
    refuse("target-guest-loader-descriptor-invalid", "integer field is invalid");
  }
  return parsed;
}

static int parse_fd(const char *value) {
  uint64_t parsed = parse_u64(value, "fd");
  if (parsed > 1024u) {
    refuse("target-guest-loader-invalid-fd", "fd is outside supported range");
  }
  return (int)parsed;
}

static void copy_code_file(struct Descriptor *descriptor, const char *value) {
  size_t length = strlen(value);
  if (length == 0 || length >= sizeof(descriptor->code_file)) {
    refuse("target-guest-loader-descriptor-invalid", "codeFile is invalid");
  }
  memcpy(descriptor->code_file, value, length + 1u);
  descriptor->saw_code_file = true;
}

static void parse_field(struct Descriptor *descriptor, char *line) {
  char *equals = strchr(line, '=');
  if (!equals || equals == line) {
    refuse("target-guest-loader-descriptor-invalid", "descriptor line must be key=value");
  }
  *equals = '\0';
  const char *key = line;
  const char *value = equals + 1;
  if (streq(key, "kind")) {
    if (!streq(value, "machinen.target-guest-restore")) {
      refuse("target-guest-loader-descriptor-invalid", "descriptor kind is not supported");
    }
    descriptor->saw_kind = true;
  } else if (streq(key, "targetArch")) {
    if (!streq(value, "amd64")) {
      refuse("target-guest-loader-target-arch-unsupported", "target guest must be amd64");
    }
    descriptor->saw_arch = true;
  } else if (streq(key, "codeFile")) {
    copy_code_file(descriptor, value);
  } else if (streq(key, "fileOffset")) {
    descriptor->file_offset = parse_u64(value, key);
  } else if (streq(key, "codeSize")) {
    descriptor->code_size = parse_u64(value, key);
  } else if (streq(key, "targetAddress")) {
    descriptor->target_address = parse_u64(value, key);
  } else if (streq(key, "timeoutSeconds")) {
    descriptor->timeout_seconds = parse_u64(value, key);
  } else if (streq(key, "stackTargetStart")) {
    descriptor->stack_target_start = parse_u64(value, key);
  } else if (streq(key, "stackSize")) {
    descriptor->stack_size = parse_u64(value, key);
  } else if (streq(key, "stackPointer")) {
    descriptor->stack_pointer = parse_u64(value, key);
  } else {
    refuse("target-guest-loader-descriptor-invalid", "descriptor field is not supported");
  }
}

static const char *find_token_value(char *line, const char *name) {
  size_t name_length = strlen(name);
  char *save = NULL;
  for (char *token = strtok_r(line, " ", &save); token; token = strtok_r(NULL, " ", &save)) {
    if (starts_with(token, name) && token[name_length] == '=') {
      return token + name_length + 1u;
    }
  }
  return NULL;
}

static void parse_pipe_resource(struct Descriptor *descriptor, char *fields) {
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *read_fd = find_token_value(scratch, "readFd");
  if (!read_fd) {
    refuse("target-guest-loader-descriptor-invalid", "pipe readFd is required");
  }
  descriptor->pipe_read_fd = parse_fd(read_fd);
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *write_fd = find_token_value(scratch, "writeFd");
  if (write_fd) {
    descriptor->pipe_write_fd = parse_fd(write_fd);
  }
  if (descriptor->pipe_write_fd == descriptor->pipe_read_fd) {
    refuse("target-guest-loader-invalid-fd", "pipe read/write fds must differ");
  }
}

static void parse_eventfd_resource(struct Descriptor *descriptor, char *fields) {
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *fd = find_token_value(scratch, "fd");
  if (!fd) {
    refuse("target-guest-loader-descriptor-invalid", "eventfd fd is required");
  }
  descriptor->event_fd = parse_fd(fd);
}

static void parse_resource(struct Descriptor *descriptor, char *line) {
  if (starts_with(line, "resource=synthetic-empty-pipe")) {
    parse_pipe_resource(descriptor, line + strlen("resource=synthetic-empty-pipe"));
  } else if (starts_with(line, "resource=synthetic-empty-eventfd")) {
    parse_eventfd_resource(descriptor, line + strlen("resource=synthetic-empty-eventfd"));
  } else {
    refuse("target-guest-loader-resource-unsupported", "resource recipe is not supported");
  }
}

static struct Descriptor read_descriptor(const char *path) {
  struct Descriptor descriptor = {0};
  descriptor.pipe_read_fd = -1;
  descriptor.pipe_write_fd = -1;
  descriptor.event_fd = -1;
  FILE *file = fopen(path, "r");
  if (!file) {
    refuse("target-guest-loader-descriptor-invalid", "descriptor cannot be opened");
  }
  char line[4096];
  while (fgets(line, sizeof(line), file)) {
    trim_line(line);
    if (line[0] == '\0' || line[0] == '#') {
      continue;
    }
    if (starts_with(line, "resource=")) {
      parse_resource(&descriptor, line);
    } else {
      parse_field(&descriptor, line);
    }
  }
  fclose(file);
  return descriptor;
}

static void validate_descriptor(const struct Descriptor *descriptor) {
  if (!descriptor->saw_kind || !descriptor->saw_arch || !descriptor->saw_code_file) {
    refuse("target-guest-loader-descriptor-invalid", "descriptor is missing required fields");
  }
  if (descriptor->code_size == 0 || descriptor->target_address == 0 ||
      descriptor->timeout_seconds == 0 || descriptor->stack_target_start == 0 ||
      descriptor->stack_size == 0 || descriptor->stack_pointer == 0) {
    refuse("target-guest-loader-invalid-continuation", "continuation fields are incomplete");
  }
}

static void push_arg(char **argv, size_t *argc, char *value) {
  argv[*argc] = value;
  *argc += 1u;
}

static int run_trampoline(const struct Options *opts, const struct Descriptor *descriptor) {
  char file_offset[32];
  char code_size[32];
  char target_address[32];
  char timeout_seconds[32];
  char stack_target_start[32];
  char stack_size[32];
  char stack_pointer[32];
  char pipe_read_fd[16];
  char pipe_write_fd[16];
  char event_fd[16];
  snprintf(file_offset, sizeof(file_offset), "0x%" PRIx64, descriptor->file_offset);
  snprintf(code_size, sizeof(code_size), "0x%" PRIx64, descriptor->code_size);
  snprintf(target_address, sizeof(target_address), "0x%" PRIx64, descriptor->target_address);
  snprintf(timeout_seconds, sizeof(timeout_seconds), "0x%" PRIx64, descriptor->timeout_seconds);
  snprintf(stack_target_start, sizeof(stack_target_start), "0x%" PRIx64, descriptor->stack_target_start);
  snprintf(stack_size, sizeof(stack_size), "0x%" PRIx64, descriptor->stack_size);
  snprintf(stack_pointer, sizeof(stack_pointer), "0x%" PRIx64, descriptor->stack_pointer);
  snprintf(pipe_read_fd, sizeof(pipe_read_fd), "%d", descriptor->pipe_read_fd);
  snprintf(pipe_write_fd, sizeof(pipe_write_fd), "%d", descriptor->pipe_write_fd);
  snprintf(event_fd, sizeof(event_fd), "%d", descriptor->event_fd);

  char *child_argv[32];
  size_t child_argc = 0;
  push_arg(child_argv, &child_argc, (char *)opts->trampoline_path);
  push_arg(child_argv, &child_argc, "--code-file");
  push_arg(child_argv, &child_argc, (char *)descriptor->code_file);
  push_arg(child_argv, &child_argc, "--file-offset");
  push_arg(child_argv, &child_argc, file_offset);
  push_arg(child_argv, &child_argc, "--code-size");
  push_arg(child_argv, &child_argc, code_size);
  push_arg(child_argv, &child_argc, "--target-address");
  push_arg(child_argv, &child_argc, target_address);
  push_arg(child_argv, &child_argc, "--timeout-seconds");
  push_arg(child_argv, &child_argc, timeout_seconds);
  push_arg(child_argv, &child_argc, "--stack-target-start");
  push_arg(child_argv, &child_argc, stack_target_start);
  push_arg(child_argv, &child_argc, "--stack-size");
  push_arg(child_argv, &child_argc, stack_size);
  push_arg(child_argv, &child_argc, "--stack-pointer");
  push_arg(child_argv, &child_argc, stack_pointer);
  if (descriptor->pipe_read_fd >= 0) {
    push_arg(child_argv, &child_argc, "--synthetic-empty-pipe-read-fd");
    push_arg(child_argv, &child_argc, pipe_read_fd);
  }
  if (descriptor->pipe_write_fd >= 0) {
    push_arg(child_argv, &child_argc, "--synthetic-empty-pipe-write-fd");
    push_arg(child_argv, &child_argc, pipe_write_fd);
  }
  if (descriptor->event_fd >= 0) {
    push_arg(child_argv, &child_argc, "--synthetic-empty-eventfd");
    push_arg(child_argv, &child_argc, event_fd);
  }
  child_argv[child_argc] = NULL;

  pid_t child = fork();
  if (child < 0) {
    refuse("target-guest-loader-descriptor-invalid", "fork failed");
  }
  if (child == 0) {
    execv(opts->trampoline_path, child_argv);
    perror("machinen-target-guest-restore-loader: execv");
    _exit(127);
  }
  int status = 0;
  if (waitpid(child, &status, 0) < 0) {
    refuse("target-guest-loader-descriptor-invalid", "waitpid failed");
  }
  if (WIFEXITED(status)) {
    int exit_code = WEXITSTATUS(status);
    printf(LOADER_PREFIX "{\"status\":\"completed\",\"exitCode\":%d}\n", exit_code);
    return exit_code;
  }
  if (WIFSIGNALED(status)) {
    int signal = WTERMSIG(status);
    printf(LOADER_PREFIX "{\"status\":\"signaled\",\"signal\":%d}\n", signal);
    return 128 + signal;
  }
  printf(LOADER_PREFIX "{\"status\":\"unknown\"}\n");
  return 1;
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  struct Descriptor descriptor = read_descriptor(opts.descriptor_path);
  validate_descriptor(&descriptor);
  return run_trampoline(&opts, &descriptor);
}
