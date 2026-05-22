// Portable machine target-guest restore loader.
//
// The loader is intentionally small: it validates a line-oriented descriptor,
// refuses unsupported resources before target code can run, then runs the
// native resume trampoline with the validated continuation arguments. The
// trampoline still performs the low-level mmap/stack/jump work.

#include <errno.h>
#include <fcntl.h>
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
#define MAX_MATERIALIZED_MAPPINGS 32
#define MAX_FD_RECIPES 64

struct Options {
  const char *descriptor_path;
  const char *trampoline_path;
};

struct ReopenFileRecipe {
  int fd;
  char path[PATH_MAX];
  uint64_t offset;
  int access;
};

struct Descriptor {
  bool saw_kind;
  bool saw_arch;
  bool saw_code_file;
  char code_file[PATH_MAX];
  uint64_t file_offset;
  uint64_t code_size;
  uint64_t target_address;
  bool has_argument0;
  uint64_t argument0;
  uint64_t timeout_seconds;
  uint64_t stack_target_start;
  uint64_t stack_size;
  uint64_t stack_pointer;
  int pipe_read_fd;
  int pipe_write_fd;
  int event_fd;
  int timer_fd;
  int cloexec_fds[MAX_FD_RECIPES];
  size_t cloexec_fd_count;
  int close_fds[MAX_FD_RECIPES];
  size_t close_fd_count;
  int inherit_fds[MAX_FD_RECIPES];
  size_t inherit_fd_count;
  struct ReopenFileRecipe reopen_files[MAX_FD_RECIPES];
  size_t reopen_file_count;
  char memory_specs[MAX_MATERIALIZED_MAPPINGS][PATH_MAX * 2];
  size_t memory_spec_count;
  char guard_specs[MAX_MATERIALIZED_MAPPINGS][128];
  size_t guard_spec_count;
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
  } else if (streq(key, "argument0")) {
    descriptor->argument0 = parse_u64(value, key);
    descriptor->has_argument0 = true;
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

static void add_cloexec_if_requested(struct Descriptor *descriptor, char *fields, int fd);

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
  add_cloexec_if_requested(descriptor, fields, descriptor->pipe_read_fd);
}

static int parse_single_fd_resource(char *fields, const char *label) {
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *fd = find_token_value(scratch, "fd");
  if (!fd) {
    refuse("target-guest-loader-descriptor-invalid", label);
  }
  return parse_fd(fd);
}

static bool parse_close_on_exec(char *fields) {
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *value = find_token_value(scratch, "closeOnExec");
  if (!value || streq(value, "false")) {
    return false;
  }
  if (streq(value, "true")) {
    return true;
  }
  refuse("target-guest-loader-descriptor-invalid", "closeOnExec must be true or false");
  return false;
}

static void add_cloexec_fd(struct Descriptor *descriptor, int fd) {
  if (descriptor->cloexec_fd_count >= MAX_FD_RECIPES) {
    refuse("target-guest-loader-resource-unsupported", "too many cloexec fd recipes");
  }
  descriptor->cloexec_fds[descriptor->cloexec_fd_count++] = fd;
}

static void add_cloexec_if_requested(struct Descriptor *descriptor, char *fields, int fd) {
  if (parse_close_on_exec(fields)) {
    add_cloexec_fd(descriptor, fd);
  }
}

static void parse_eventfd_resource(struct Descriptor *descriptor, char *fields) {
  descriptor->event_fd = parse_single_fd_resource(fields, "eventfd fd is required");
  add_cloexec_if_requested(descriptor, fields, descriptor->event_fd);
}

static void parse_timerfd_resource(struct Descriptor *descriptor, char *fields) {
  descriptor->timer_fd = parse_single_fd_resource(fields, "timerfd fd is required");
  add_cloexec_if_requested(descriptor, fields, descriptor->timer_fd);
}

static void parse_close_fd_resource(struct Descriptor *descriptor, char *fields) {
  if (descriptor->close_fd_count >= MAX_FD_RECIPES) {
    refuse("target-guest-loader-resource-unsupported", "too many fd close recipes");
  }
  descriptor->close_fds[descriptor->close_fd_count++] = parse_single_fd_resource(fields, "close fd is required");
}

static void parse_inherit_stdio_resource(struct Descriptor *descriptor, char *fields) {
  if (descriptor->inherit_fd_count >= MAX_FD_RECIPES) {
    refuse("target-guest-loader-resource-unsupported", "too many inherited stdio recipes");
  }
  int fd = parse_single_fd_resource(fields, "stdio fd is required");
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *stream = find_token_value(scratch, "stream");
  if (!stream || !((fd == 1 && streq(stream, "stdout")) || (fd == 2 && streq(stream, "stderr")))) {
    refuse("target-guest-loader-invalid-fd", "stdio fd and stream do not match");
  }
  descriptor->inherit_fds[descriptor->inherit_fd_count++] = fd;
  add_cloexec_if_requested(descriptor, fields, fd);
}

static int parse_access(char *fields) {
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *access = find_token_value(scratch, "access");
  if (!access) {
    refuse("target-guest-loader-descriptor-invalid", "file access is required");
  }
  int parsed = (int)parse_u64(access, "access");
  if (parsed < 0 || parsed > 2) {
    refuse("target-guest-loader-descriptor-invalid", "file access is invalid");
  }
  return parsed;
}

static void parse_reopen_file_resource(struct Descriptor *descriptor, char *fields) {
  if (descriptor->reopen_file_count >= MAX_FD_RECIPES) {
    refuse("target-guest-loader-resource-unsupported", "too many file reopen recipes");
  }
  struct ReopenFileRecipe *recipe = &descriptor->reopen_files[descriptor->reopen_file_count++];
  recipe->fd = parse_single_fd_resource(fields, "file fd is required");
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *path = find_token_value(scratch, "path");
  if (!path || strlen(path) == 0 || strlen(path) >= sizeof(recipe->path)) {
    refuse("target-guest-loader-descriptor-invalid", "file path is invalid");
  }
  snprintf(recipe->path, sizeof(recipe->path), "%s", path);
  snprintf(scratch, sizeof(scratch), "%s", fields);
  const char *offset = find_token_value(scratch, "offset");
  if (!offset) {
    refuse("target-guest-loader-descriptor-invalid", "file offset is required");
  }
  recipe->offset = parse_u64(offset, "offset");
  recipe->access = parse_access(fields);
  add_cloexec_if_requested(descriptor, fields, recipe->fd);
}

static const char *required_token(char *scratch, size_t scratch_size, char *fields, const char *name) {
  snprintf(scratch, scratch_size, "%s", fields);
  const char *value = find_token_value(scratch, name);
  if (!value) {
    refuse("target-guest-loader-descriptor-invalid", "memory field is required");
  }
  return value;
}

static void append_memory_spec(struct Descriptor *descriptor, char *fields) {
  if (descriptor->memory_spec_count >= MAX_MATERIALIZED_MAPPINGS) {
    refuse("target-guest-loader-memory-unsupported", "too many memory mappings");
  }
  char scratch[4096];
  const char *source_file = required_token(scratch, sizeof(scratch), fields, "sourceFile");
  char source_file_copy[PATH_MAX];
  snprintf(source_file_copy, sizeof(source_file_copy), "%s", source_file);
  const char *source_offset = required_token(scratch, sizeof(scratch), fields, "sourceOffset");
  char source_offset_copy[32];
  snprintf(source_offset_copy, sizeof(source_offset_copy), "%s", source_offset);
  const char *target_start = required_token(scratch, sizeof(scratch), fields, "targetStart");
  char target_start_copy[32];
  snprintf(target_start_copy, sizeof(target_start_copy), "%s", target_start);
  const char *size = required_token(scratch, sizeof(scratch), fields, "sizeBytes");
  char size_copy[32];
  snprintf(size_copy, sizeof(size_copy), "%s", size);
  const char *permissions = required_token(scratch, sizeof(scratch), fields, "permissions");
  if (strchr(permissions, 'x')) {
    refuse("target-guest-loader-invalid-continuation", "memory mappings must be non-executable");
  }
  snprintf(descriptor->memory_specs[descriptor->memory_spec_count++],
      sizeof(descriptor->memory_specs[0]),
      "%s:%s:%s:%s:%s",
      source_file_copy,
      source_offset_copy,
      target_start_copy,
      size_copy,
      permissions);
}

static void append_guard_spec(struct Descriptor *descriptor, char *fields) {
  if (descriptor->guard_spec_count >= MAX_MATERIALIZED_MAPPINGS) {
    refuse("target-guest-loader-memory-unsupported", "too many guard mappings");
  }
  char scratch[4096];
  const char *target_start = required_token(scratch, sizeof(scratch), fields, "targetStart");
  char target_start_copy[32];
  snprintf(target_start_copy, sizeof(target_start_copy), "%s", target_start);
  const char *size = required_token(scratch, sizeof(scratch), fields, "sizeBytes");
  snprintf(descriptor->guard_specs[descriptor->guard_spec_count++],
      sizeof(descriptor->guard_specs[0]),
      "%s:%s",
      target_start_copy,
      size);
}

static void parse_memory(struct Descriptor *descriptor, char *line) {
  if (starts_with(line, "memory=copy-captured-bytes")) {
    append_memory_spec(descriptor, line + strlen("memory=copy-captured-bytes"));
  } else if (starts_with(line, "memory=recreate-guard")) {
    append_guard_spec(descriptor, line + strlen("memory=recreate-guard"));
  } else {
    refuse("target-guest-loader-memory-unsupported", "memory materialization is not supported");
  }
}

static void parse_resource(struct Descriptor *descriptor, char *line) {
  if (starts_with(line, "resource=close-fd")) {
    parse_close_fd_resource(descriptor, line + strlen("resource=close-fd"));
  } else if (starts_with(line, "resource=inherit-stdio")) {
    parse_inherit_stdio_resource(descriptor, line + strlen("resource=inherit-stdio"));
  } else if (starts_with(line, "resource=reopen-file")) {
    parse_reopen_file_resource(descriptor, line + strlen("resource=reopen-file"));
  } else if (starts_with(line, "resource=synthetic-empty-pipe")) {
    parse_pipe_resource(descriptor, line + strlen("resource=synthetic-empty-pipe"));
  } else if (starts_with(line, "resource=synthetic-empty-eventfd")) {
    parse_eventfd_resource(descriptor, line + strlen("resource=synthetic-empty-eventfd"));
  } else if (starts_with(line, "resource=synthetic-timerfd")) {
    parse_timerfd_resource(descriptor, line + strlen("resource=synthetic-timerfd"));
  } else {
    refuse("target-guest-loader-resource-unsupported", "resource recipe is not supported");
  }
}

static struct Descriptor read_descriptor(const char *path) {
  struct Descriptor descriptor = {0};
  descriptor.pipe_read_fd = -1;
  descriptor.pipe_write_fd = -1;
  descriptor.event_fd = -1;
  descriptor.timer_fd = -1;
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
    } else if (starts_with(line, "memory=")) {
      parse_memory(&descriptor, line);
    } else {
      parse_field(&descriptor, line);
    }
  }
  fclose(file);
  return descriptor;
}

static void mark_fd(bool *seen, int fd) {
  if (fd < 0) {
    return;
  }
  if (seen[fd]) {
    refuse("target-guest-loader-invalid-fd", "fd is assigned by multiple recipes");
  }
  seen[fd] = true;
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
  bool seen[1025] = {0};
  mark_fd(seen, descriptor->pipe_read_fd);
  mark_fd(seen, descriptor->pipe_write_fd);
  mark_fd(seen, descriptor->event_fd);
  mark_fd(seen, descriptor->timer_fd);
  for (size_t i = 0; i < descriptor->close_fd_count; i++) {
    mark_fd(seen, descriptor->close_fds[i]);
  }
  for (size_t i = 0; i < descriptor->inherit_fd_count; i++) {
    mark_fd(seen, descriptor->inherit_fds[i]);
  }
  for (size_t i = 0; i < descriptor->reopen_file_count; i++) {
    mark_fd(seen, descriptor->reopen_files[i].fd);
  }
}

static void push_arg(char **argv, size_t *argc, const char *value) {
  argv[*argc] = (char *)value;
  *argc += 1u;
}

static int open_flags_for_access(int access) {
  if (access == 1) {
    return O_WRONLY;
  }
  if (access == 2) {
    return O_RDWR;
  }
  return O_RDONLY;
}

static void apply_fd_recipes(const struct Descriptor *descriptor) {
  for (size_t i = 0; i < descriptor->close_fd_count; i++) {
    if (close(descriptor->close_fds[i]) < 0 && errno != EBADF) {
      perror("machinen-target-guest-restore-loader: close fd");
      _exit(126);
    }
  }
  for (size_t i = 0; i < descriptor->reopen_file_count; i++) {
    const struct ReopenFileRecipe *recipe = &descriptor->reopen_files[i];
    int opened = open(recipe->path, open_flags_for_access(recipe->access));
    if (opened < 0) {
      perror("machinen-target-guest-restore-loader: open resource");
      _exit(126);
    }
    if (recipe->offset > 0 && lseek(opened, (off_t)recipe->offset, SEEK_SET) < 0) {
      perror("machinen-target-guest-restore-loader: seek resource");
      _exit(126);
    }
    if (opened != recipe->fd) {
      if (dup2(opened, recipe->fd) < 0) {
        perror("machinen-target-guest-restore-loader: dup2 resource");
        _exit(126);
      }
      close(opened);
    }
  }
}

static int run_trampoline(const struct Options *opts, const struct Descriptor *descriptor) {
  char file_offset[32];
  char code_size[32];
  char target_address[32];
  char argument0[32];
  char timeout_seconds[32];
  char stack_target_start[32];
  char stack_size[32];
  char stack_pointer[32];
  char pipe_read_fd[16];
  char pipe_write_fd[16];
  char event_fd[16];
  char timer_fd[16];
  char cloexec_fds[MAX_FD_RECIPES][16];
  snprintf(file_offset, sizeof(file_offset), "0x%" PRIx64, descriptor->file_offset);
  snprintf(code_size, sizeof(code_size), "0x%" PRIx64, descriptor->code_size);
  snprintf(target_address, sizeof(target_address), "0x%" PRIx64, descriptor->target_address);
  snprintf(argument0, sizeof(argument0), "0x%" PRIx64, descriptor->argument0);
  snprintf(timeout_seconds, sizeof(timeout_seconds), "0x%" PRIx64, descriptor->timeout_seconds);
  snprintf(stack_target_start, sizeof(stack_target_start), "0x%" PRIx64, descriptor->stack_target_start);
  snprintf(stack_size, sizeof(stack_size), "0x%" PRIx64, descriptor->stack_size);
  snprintf(stack_pointer, sizeof(stack_pointer), "0x%" PRIx64, descriptor->stack_pointer);
  snprintf(pipe_read_fd, sizeof(pipe_read_fd), "%d", descriptor->pipe_read_fd);
  snprintf(pipe_write_fd, sizeof(pipe_write_fd), "%d", descriptor->pipe_write_fd);
  snprintf(event_fd, sizeof(event_fd), "%d", descriptor->event_fd);
  snprintf(timer_fd, sizeof(timer_fd), "%d", descriptor->timer_fd);
  for (size_t i = 0; i < descriptor->cloexec_fd_count; i++) {
    snprintf(cloexec_fds[i], sizeof(cloexec_fds[i]), "%d", descriptor->cloexec_fds[i]);
  }

  char *child_argv[192];
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
  if (descriptor->has_argument0) {
    push_arg(child_argv, &child_argc, "--argument0");
    push_arg(child_argv, &child_argc, argument0);
  }
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
  if (descriptor->timer_fd >= 0) {
    push_arg(child_argv, &child_argc, "--synthetic-timerfd");
    push_arg(child_argv, &child_argc, timer_fd);
  }
  for (size_t i = 0; i < descriptor->cloexec_fd_count; i++) {
    push_arg(child_argv, &child_argc, "--set-cloexec-fd");
    push_arg(child_argv, &child_argc, cloexec_fds[i]);
  }
  for (size_t i = 0; i < descriptor->memory_spec_count; i++) {
    push_arg(child_argv, &child_argc, "--materialize-memory");
    push_arg(child_argv, &child_argc, descriptor->memory_specs[i]);
  }
  for (size_t i = 0; i < descriptor->guard_spec_count; i++) {
    push_arg(child_argv, &child_argc, "--materialize-guard");
    push_arg(child_argv, &child_argc, descriptor->guard_specs[i]);
  }
  child_argv[child_argc] = NULL;

  pid_t child = fork();
  if (child < 0) {
    refuse("target-guest-loader-descriptor-invalid", "fork failed");
  }
  if (child == 0) {
    apply_fd_recipes(descriptor);
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
