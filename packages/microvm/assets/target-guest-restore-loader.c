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
#define MAX_NATIVE_RESTORE_STEPS 128
#define MAX_FD_RECIPES 64
#define MAX_UNWIND_ID 128
#define MAX_TRANSLATED_FRAME_SLOTS 8
#define SUPPORTED_RESUME_RFLAGS_MASK UINT64_C(0x8d7)
#define REQUIRED_RESUME_RFLAGS_MASK UINT64_C(0x2)

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

struct NativeRestoreArg {
  char flag[64];
  char spec[PATH_MAX * 2];
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
  bool has_state_report_address;
  uint64_t state_report_address;
  bool has_target_fs_base;
  uint64_t target_fs_base;
  bool has_translated_return_address;
  uint64_t translated_return_address;
  bool has_resume_mode;
  char resume_mode[32];
  bool has_resume_rflags;
  uint64_t resume_rflags;
  bool has_resume_registers;
  uint32_t resume_register_mask;
  uint64_t resume_register_rax;
  uint64_t resume_register_rdi;
  uint64_t resume_register_rsi;
  uint64_t resume_register_rdx;
  uint64_t resume_register_rcx;
  uint64_t resume_register_r8;
  uint64_t resume_register_r9;
  uint64_t resume_register_r10;
  uint64_t resume_register_r11;
  bool has_translated_frame;
  uint64_t translated_frame_pointer;
  uint64_t translated_frame_cfa;
  uint64_t translated_frame_return_address_slot;
  uint64_t translated_frame_return_address;
  uint64_t translated_frame_callee_rbx;
  uint64_t translated_frame_callee_r12;
  uint64_t translated_frame_callee_r13;
  uint64_t translated_frame_callee_r14;
  uint64_t translated_frame_callee_r15;
  size_t translated_frame_slot_count;
  uint64_t translated_frame_slot_offsets[MAX_TRANSLATED_FRAME_SLOTS];
  uint64_t translated_frame_slot_values[MAX_TRANSLATED_FRAME_SLOTS];
  char translated_frame_slot_classes[MAX_TRANSLATED_FRAME_SLOTS][32];
  char translated_frame_unwind_id[MAX_UNWIND_ID];
  uint64_t timeout_seconds;
  uint64_t stack_target_start;
  uint64_t stack_size;
  uint64_t stack_pointer;
  int pipe_read_fd;
  int pipe_write_fd;
  int event_fd;
  bool has_eventfd_spec;
  char eventfd_spec[1024];
  int timer_fd;
  char timerfd_spec[1024];
  int signalfd_fds[MAX_FD_RECIPES];
  char signalfd_specs[MAX_FD_RECIPES][1024];
  size_t signalfd_count;
  int epoll_fds[MAX_FD_RECIPES];
  char epoll_specs[MAX_FD_RECIPES][1024];
  size_t epoll_count;
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
  struct NativeRestoreArg native_restore_args[MAX_NATIVE_RESTORE_STEPS];
  size_t native_restore_arg_count;
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
  } else if (streq(key, "stateReportAddress")) {
    descriptor->state_report_address = parse_u64(value, key);
    descriptor->has_state_report_address = true;
  } else if (streq(key, "targetFsBase")) {
    descriptor->target_fs_base = parse_u64(value, key);
    descriptor->has_target_fs_base = true;
  } else if (streq(key, "translatedReturnAddress")) {
    descriptor->translated_return_address = parse_u64(value, key);
    descriptor->has_translated_return_address = true;
  } else if (streq(key, "resumeMode")) {
    if (!streq(value, "translated-frame")) {
      refuse("target-guest-loader-invalid-continuation", "resume mode is unsupported");
    }
    snprintf(descriptor->resume_mode, sizeof(descriptor->resume_mode), "%s", value);
    descriptor->has_resume_mode = true;
  } else if (streq(key, "resumeRflags")) {
    descriptor->resume_rflags = parse_u64(value, key);
    descriptor->has_resume_rflags = true;
  } else if (streq(key, "resumeRegisterRax")) {
    descriptor->resume_register_rax = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x01u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterRdi")) {
    descriptor->resume_register_rdi = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x100u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterRsi")) {
    descriptor->resume_register_rsi = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x02u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterRdx")) {
    descriptor->resume_register_rdx = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x04u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterRcx")) {
    descriptor->resume_register_rcx = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x08u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterR8")) {
    descriptor->resume_register_r8 = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x10u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterR9")) {
    descriptor->resume_register_r9 = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x20u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterR10")) {
    descriptor->resume_register_r10 = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x40u;
    descriptor->has_resume_registers = true;
  } else if (streq(key, "resumeRegisterR11")) {
    descriptor->resume_register_r11 = parse_u64(value, key);
    descriptor->resume_register_mask |= 0x80u;
    descriptor->has_resume_registers = true;
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
static void fields_to_semicolon_spec(char *dst, size_t dst_size, char *fields);

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
  if (descriptor->event_fd >= 0) {
    refuse("target-guest-loader-invalid-fd", "eventfd fd is assigned by multiple recipes");
  }
  descriptor->event_fd = parse_single_fd_resource(fields, "eventfd fd is required");
  add_cloexec_if_requested(descriptor, fields, descriptor->event_fd);
}

static void parse_counter_eventfd_resource(struct Descriptor *descriptor, char *fields) {
  parse_eventfd_resource(descriptor, fields);
  fields_to_semicolon_spec(descriptor->eventfd_spec, sizeof(descriptor->eventfd_spec), fields);
  descriptor->has_eventfd_spec = true;
}

static void parse_timerfd_resource(struct Descriptor *descriptor, char *fields) {
  descriptor->timer_fd = parse_single_fd_resource(fields, "timerfd fd is required");
  fields_to_semicolon_spec(descriptor->timerfd_spec, sizeof(descriptor->timerfd_spec), fields);
  add_cloexec_if_requested(descriptor, fields, descriptor->timer_fd);
}

static void parse_signalfd_resource(struct Descriptor *descriptor, char *fields) {
  if (descriptor->signalfd_count >= MAX_FD_RECIPES) {
    refuse("target-guest-loader-resource-unsupported", "too many signalfd recipes");
  }
  int fd = parse_single_fd_resource(fields, "signalfd fd is required");
  descriptor->signalfd_fds[descriptor->signalfd_count] = fd;
  fields_to_semicolon_spec(descriptor->signalfd_specs[descriptor->signalfd_count],
      sizeof(descriptor->signalfd_specs[0]),
      fields);
  descriptor->signalfd_count++;
  add_cloexec_if_requested(descriptor, fields, fd);
}

static void parse_epoll_resource(struct Descriptor *descriptor, char *fields) {
  if (descriptor->epoll_count >= MAX_FD_RECIPES) {
    refuse("target-guest-loader-resource-unsupported", "too many epoll recipes");
  }
  int fd = parse_single_fd_resource(fields, "epoll fd is required");
  descriptor->epoll_fds[descriptor->epoll_count] = fd;
  fields_to_semicolon_spec(descriptor->epoll_specs[descriptor->epoll_count],
      sizeof(descriptor->epoll_specs[0]),
      fields);
  descriptor->epoll_count++;
  add_cloexec_if_requested(descriptor, fields, fd);
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

static void append_native_arg(struct Descriptor *descriptor, const char *flag, const char *spec) {
  if (descriptor->native_restore_arg_count >= MAX_NATIVE_RESTORE_STEPS) {
    refuse("target-guest-loader-descriptor-invalid", "too many native restore sections");
  }
  struct NativeRestoreArg *arg = &descriptor->native_restore_args[descriptor->native_restore_arg_count++];
  snprintf(arg->flag, sizeof(arg->flag), "%s", flag);
  snprintf(arg->spec, sizeof(arg->spec), "%s", spec);
}

static void fields_to_semicolon_spec(char *dst, size_t dst_size, char *fields) {
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  trim_line(scratch);
  size_t out = 0;
  char *save = NULL;
  for (char *token = strtok_r(scratch, " ", &save); token; token = strtok_r(NULL, " ", &save)) {
    int written = snprintf(dst + out, out < dst_size ? dst_size - out : 0, "%s%s", out == 0 ? "" : ";", token);
    if (written < 0 || out + (size_t)written >= dst_size) {
      refuse("target-guest-loader-descriptor-invalid", "native restore section is too long");
    }
    out += (size_t)written;
  }
  if (out == 0) {
    refuse("target-guest-loader-descriptor-invalid", "native restore section is missing fields");
  }
}

static void parse_native_stack_window_write(struct Descriptor *descriptor, char *fields) {
  char scratch[4096];
  const char *target_address = required_token(scratch, sizeof(scratch), fields, "targetAddress");
  char target_address_copy[32];
  snprintf(target_address_copy, sizeof(target_address_copy), "%s", target_address);
  const char *value = required_token(scratch, sizeof(scratch), fields, "value");
  char value_copy[32];
  snprintf(value_copy, sizeof(value_copy), "%s", value);
  const char *bytes = required_token(scratch, sizeof(scratch), fields, "bytes");
  char bytes_copy[32];
  snprintf(bytes_copy, sizeof(bytes_copy), "%s", bytes);
  const char *kind = required_token(scratch, sizeof(scratch), fields, "kind");
  char spec[256];
  snprintf(spec, sizeof(spec), "%s:%s:%s:%s", target_address_copy, value_copy, bytes_copy, kind);
  append_native_arg(descriptor, "--native-stack-window-write", spec);
}

static void parse_native_stack_window_guard(struct Descriptor *descriptor, char *fields) {
  char scratch[4096];
  const char *target_start = required_token(scratch, sizeof(scratch), fields, "targetStart");
  char target_start_copy[32];
  snprintf(target_start_copy, sizeof(target_start_copy), "%s", target_start);
  const char *size = required_token(scratch, sizeof(scratch), fields, "sizeBytes");
  char size_copy[32];
  snprintf(size_copy, sizeof(size_copy), "%s", size);
  const char *placement = required_token(scratch, sizeof(scratch), fields, "placement");
  char spec[128];
  snprintf(spec, sizeof(spec), "%s:%s:%s", target_start_copy, size_copy, placement);
  append_native_arg(descriptor, "--native-stack-window-guard", spec);
}

static void parse_native_return_chain_write(struct Descriptor *descriptor, char *fields) {
  char scratch[4096];
  const char *target_address = required_token(scratch, sizeof(scratch), fields, "targetAddress");
  char target_address_copy[32];
  snprintf(target_address_copy, sizeof(target_address_copy), "%s", target_address);
  const char *value = required_token(scratch, sizeof(scratch), fields, "value");
  char value_copy[32];
  snprintf(value_copy, sizeof(value_copy), "%s", value);
  const char *bytes = required_token(scratch, sizeof(scratch), fields, "bytes");
  char bytes_copy[32];
  snprintf(bytes_copy, sizeof(bytes_copy), "%s", bytes);
  const char *kind = required_token(scratch, sizeof(scratch), fields, "kind");
  char spec[256];
  snprintf(spec, sizeof(spec), "%s:%s:%s:%s", target_address_copy, value_copy, bytes_copy, kind);
  append_native_arg(descriptor, "--native-return-chain-write", spec);
}

static void parse_native_semicolon_step(
    struct Descriptor *descriptor, char *fields, const char *required_action, const char *flag) {
  char scratch[4096];
  (void)required_token(scratch, sizeof(scratch), fields, "action");
  (void)required_action;
  char spec[PATH_MAX * 2];
  fields_to_semicolon_spec(spec, sizeof(spec), fields);
  append_native_arg(descriptor, flag, spec);
}

static void parse_native_restore(struct Descriptor *descriptor, char *line) {
  if (starts_with(line, "native=stack-window-write")) {
    parse_native_stack_window_write(descriptor, line + strlen("native=stack-window-write"));
  } else if (starts_with(line, "native=stack-window-guard")) {
    parse_native_stack_window_guard(descriptor, line + strlen("native=stack-window-guard"));
  } else if (starts_with(line, "native=return-chain-write")) {
    parse_native_return_chain_write(descriptor, line + strlen("native=return-chain-write"));
  } else if (starts_with(line, "native=private-memory")) {
    parse_native_semicolon_step(descriptor, line + strlen("native=private-memory"), "", "--native-private-memory-step");
  } else if (starts_with(line, "native=executable-mapping")) {
    parse_native_semicolon_step(descriptor, line + strlen("native=executable-mapping"), "", "--native-executable-mapping");
  } else if (starts_with(line, "native=process-context")) {
    parse_native_semicolon_step(descriptor, line + strlen("native=process-context"), "", "--native-process-context-step");
  } else if (starts_with(line, "native=signal-restore")) {
    parse_native_semicolon_step(descriptor, line + strlen("native=signal-restore"), "", "--native-signal-restore-step");
  } else if (starts_with(line, "native=active-syscall")) {
    parse_native_semicolon_step(descriptor, line + strlen("native=active-syscall"), "", "--native-active-syscall-step");
  } else if (starts_with(line, "native=thread-spawn")) {
    parse_native_semicolon_step(descriptor, line + strlen("native=thread-spawn"), "", "--native-thread-spawn-step");
  } else {
    refuse("target-guest-loader-descriptor-invalid", "native restore section is unsupported");
  }
}

static const char *optional_frame_token(char *scratch, size_t scratch_size, char *fields, const char *name) {
  snprintf(scratch, scratch_size, "%s", fields);
  size_t name_length = strlen(name);
  const char *value = NULL;
  char *save = NULL;
  for (char *token = strtok_r(scratch, " ", &save); token; token = strtok_r(NULL, " ", &save)) {
    if (starts_with(token, name) && token[name_length] == '=') {
      if (value != NULL) {
        refuse("target-guest-loader-frame-unsupported", "duplicate translated frame field");
      }
      value = token + name_length + 1u;
    }
  }
  return value;
}

static const char *required_frame_token(char *scratch, size_t scratch_size, char *fields, const char *name) {
  const char *value = optional_frame_token(scratch, scratch_size, fields, name);
  if (!value) {
    refuse("target-guest-loader-descriptor-invalid", "translated frame field is required");
  }
  return value;
}

static void reject_unsupported_frame_slot_indexes(char *fields) {
  char scratch[4096];
  snprintf(scratch, sizeof(scratch), "%s", fields);
  char *save = NULL;
  for (char *token = strtok_r(scratch, " ", &save); token; token = strtok_r(NULL, " ", &save)) {
    if (!starts_with(token, "slot")) {
      continue;
    }
    char *end = NULL;
    uint64_t index = strtoull(token + strlen("slot"), &end, 10);
    if (end == token + strlen("slot")) {
      continue;
    }
    if (!(starts_with(end, "Offset=") || starts_with(end, "Value=") || starts_with(end, "Class="))) {
      refuse("target-guest-loader-frame-unsupported", "translated frame slot field is unsupported");
    }
    if (index >= MAX_TRANSLATED_FRAME_SLOTS) {
      refuse("target-guest-loader-frame-unsupported", "too many translated frame slots");
    }
  }
}

static void parse_frame_slots(struct Descriptor *descriptor, char *fields) {
  reject_unsupported_frame_slot_indexes(fields);
  bool saw_gap = false;
  for (size_t index = 0; index < MAX_TRANSLATED_FRAME_SLOTS; index++) {
    char offset_name[32];
    char value_name[32];
    char class_name[32];
    snprintf(offset_name, sizeof(offset_name), "slot%zuOffset", index);
    snprintf(value_name, sizeof(value_name), "slot%zuValue", index);
    snprintf(class_name, sizeof(class_name), "slot%zuClass", index);
    char scratch[4096];
    const char *offset = optional_frame_token(scratch, sizeof(scratch), fields, offset_name);
    const char *value = optional_frame_token(scratch, sizeof(scratch), fields, value_name);
    const char *slot_class = optional_frame_token(scratch, sizeof(scratch), fields, class_name);
    if (!offset && !value && !slot_class) {
      saw_gap = true;
      continue;
    }
    if (saw_gap) {
      refuse("target-guest-loader-frame-unsupported", "translated frame slots must be dense");
    }
    if (!offset || !value || !slot_class) {
      refuse("target-guest-loader-descriptor-invalid", "translated frame slot field is required");
    }
    if (!streq(slot_class, "non-pointer-data")) {
      refuse("target-guest-loader-frame-unsupported", "pointer-bearing frame slots are unsupported");
    }
    descriptor->translated_frame_slot_offsets[descriptor->translated_frame_slot_count] = parse_u64(offset, offset_name);
    descriptor->translated_frame_slot_values[descriptor->translated_frame_slot_count] = parse_u64(value, value_name);
    snprintf(descriptor->translated_frame_slot_classes[descriptor->translated_frame_slot_count],
        sizeof(descriptor->translated_frame_slot_classes[0]),
        "%s",
        slot_class);
    descriptor->translated_frame_slot_count++;
  }
  if (descriptor->translated_frame_slot_count == 0) {
    refuse("target-guest-loader-frame-unsupported", "translated frame slots are incomplete");
  }
}

static void parse_translated_frame(struct Descriptor *descriptor, char *line) {
  if (!starts_with(line, "frame=single-target-caller-frame")) {
    refuse("target-guest-loader-frame-unsupported", "translated frame is unsupported");
  }
  char *fields = line + strlen("frame=single-target-caller-frame");
  char scratch[4096];
  descriptor->has_translated_frame = true;
  descriptor->translated_frame_pointer = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "framePointer"), "framePointer");
  descriptor->translated_frame_cfa = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "canonicalFrameAddress"), "canonicalFrameAddress");
  descriptor->translated_frame_return_address_slot = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "returnAddressSlot"), "returnAddressSlot");
  descriptor->translated_frame_return_address = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "returnAddress"), "returnAddress");
  const char *unwind_id = required_frame_token(scratch, sizeof(scratch), fields, "unwindId");
  if (strlen(unwind_id) == 0 || strlen(unwind_id) >= sizeof(descriptor->translated_frame_unwind_id) ||
      strncmp(unwind_id, "target:", strlen("target:")) != 0) {
    refuse("target-guest-loader-frame-unsupported", "translated frame unwind identity is unsupported");
  }
  snprintf(descriptor->translated_frame_unwind_id, sizeof(descriptor->translated_frame_unwind_id), "%s", unwind_id);
  descriptor->translated_frame_callee_rbx = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "calleeSavedRbx"), "calleeSavedRbx");
  descriptor->translated_frame_callee_r12 = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "calleeSavedR12"), "calleeSavedR12");
  descriptor->translated_frame_callee_r13 = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "calleeSavedR13"), "calleeSavedR13");
  descriptor->translated_frame_callee_r14 = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "calleeSavedR14"), "calleeSavedR14");
  descriptor->translated_frame_callee_r15 = parse_u64(
      required_frame_token(scratch, sizeof(scratch), fields, "calleeSavedR15"), "calleeSavedR15");
  parse_frame_slots(descriptor, fields);
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
  } else if (starts_with(line, "resource=synthetic-eventfd")) {
    parse_counter_eventfd_resource(descriptor, line + strlen("resource=synthetic-eventfd"));
  } else if (starts_with(line, "resource=synthetic-timerfd")) {
    parse_timerfd_resource(descriptor, line + strlen("resource=synthetic-timerfd"));
  } else if (starts_with(line, "resource=synthetic-signalfd")) {
    parse_signalfd_resource(descriptor, line + strlen("resource=synthetic-signalfd"));
  } else if (starts_with(line, "resource=synthetic-epoll")) {
    parse_epoll_resource(descriptor, line + strlen("resource=synthetic-epoll"));
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
    } else if (starts_with(line, "native=")) {
      parse_native_restore(&descriptor, line);
    } else if (starts_with(line, "frame=")) {
      parse_translated_frame(&descriptor, line);
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
  if (descriptor->has_resume_mode && !descriptor->has_translated_frame) {
    refuse("target-guest-loader-frame-unsupported", "translated resume mode requires a frame");
  }
  if (descriptor->has_target_fs_base && !descriptor->has_state_report_address) {
    refuse("target-guest-loader-invalid-continuation", "targetFsBase requires a state report");
  }
  if (descriptor->has_argument0 && descriptor->has_resume_registers) {
    refuse("target-guest-loader-invalid-continuation", "argument0 cannot be combined with a resume register bank");
  }
  if (descriptor->has_resume_rflags &&
      (descriptor->resume_rflags & REQUIRED_RESUME_RFLAGS_MASK) != REQUIRED_RESUME_RFLAGS_MASK) {
    refuse("target-guest-loader-invalid-continuation", "resumeRflags must include reserved bit 1");
  }
  if (descriptor->has_resume_rflags &&
      (descriptor->resume_rflags & ~SUPPORTED_RESUME_RFLAGS_MASK) != 0) {
    refuse("target-guest-loader-invalid-continuation", "resumeRflags contains unsupported non-condition bits");
  }
  if (descriptor->has_resume_registers && descriptor->resume_register_mask != 0x1ffu) {
    refuse("target-guest-loader-invalid-continuation", "resume register bank is incomplete");
  }
  if (descriptor->has_translated_frame &&
      (!descriptor->has_translated_return_address || descriptor->translated_frame_slot_count == 0 ||
          descriptor->translated_frame_return_address != descriptor->translated_return_address)) {
    refuse("target-guest-loader-frame-unsupported", "translated frame return address is unresolved");
  }
  bool seen[1025] = {0};
  mark_fd(seen, descriptor->pipe_read_fd);
  mark_fd(seen, descriptor->pipe_write_fd);
  mark_fd(seen, descriptor->event_fd);
  mark_fd(seen, descriptor->timer_fd);
  for (size_t i = 0; i < descriptor->signalfd_count; i++) {
    mark_fd(seen, descriptor->signalfd_fds[i]);
  }
  for (size_t i = 0; i < descriptor->epoll_count; i++) {
    mark_fd(seen, descriptor->epoll_fds[i]);
  }
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
  char state_report_address[32];
  char target_fs_base[32];
  char translated_return_address[32];
  char resume_rflags[32];
  char resume_register_rax[32];
  char resume_register_rdi[32];
  char resume_register_rsi[32];
  char resume_register_rdx[32];
  char resume_register_rcx[32];
  char resume_register_r8[32];
  char resume_register_r9[32];
  char resume_register_r10[32];
  char resume_register_r11[32];
  char translated_frame_pointer[32];
  char translated_frame_cfa[32];
  char translated_frame_return_address_slot[32];
  char translated_frame_return_address[32];
  char translated_frame_callee_rbx[32];
  char translated_frame_callee_r12[32];
  char translated_frame_callee_r13[32];
  char translated_frame_callee_r14[32];
  char translated_frame_callee_r15[32];
  char translated_frame_slots[MAX_TRANSLATED_FRAME_SLOTS][128];
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
  snprintf(state_report_address, sizeof(state_report_address), "0x%" PRIx64, descriptor->state_report_address);
  snprintf(target_fs_base, sizeof(target_fs_base), "0x%" PRIx64, descriptor->target_fs_base);
  snprintf(translated_return_address, sizeof(translated_return_address), "0x%" PRIx64, descriptor->translated_return_address);
  snprintf(resume_rflags, sizeof(resume_rflags), "0x%" PRIx64, descriptor->resume_rflags);
  snprintf(resume_register_rax, sizeof(resume_register_rax), "0x%" PRIx64, descriptor->resume_register_rax);
  snprintf(resume_register_rdi, sizeof(resume_register_rdi), "0x%" PRIx64, descriptor->resume_register_rdi);
  snprintf(resume_register_rsi, sizeof(resume_register_rsi), "0x%" PRIx64, descriptor->resume_register_rsi);
  snprintf(resume_register_rdx, sizeof(resume_register_rdx), "0x%" PRIx64, descriptor->resume_register_rdx);
  snprintf(resume_register_rcx, sizeof(resume_register_rcx), "0x%" PRIx64, descriptor->resume_register_rcx);
  snprintf(resume_register_r8, sizeof(resume_register_r8), "0x%" PRIx64, descriptor->resume_register_r8);
  snprintf(resume_register_r9, sizeof(resume_register_r9), "0x%" PRIx64, descriptor->resume_register_r9);
  snprintf(resume_register_r10, sizeof(resume_register_r10), "0x%" PRIx64, descriptor->resume_register_r10);
  snprintf(resume_register_r11, sizeof(resume_register_r11), "0x%" PRIx64, descriptor->resume_register_r11);
  snprintf(translated_frame_pointer, sizeof(translated_frame_pointer), "0x%" PRIx64, descriptor->translated_frame_pointer);
  snprintf(translated_frame_cfa, sizeof(translated_frame_cfa), "0x%" PRIx64, descriptor->translated_frame_cfa);
  snprintf(translated_frame_return_address_slot, sizeof(translated_frame_return_address_slot), "0x%" PRIx64, descriptor->translated_frame_return_address_slot);
  snprintf(translated_frame_return_address, sizeof(translated_frame_return_address), "0x%" PRIx64, descriptor->translated_frame_return_address);
  snprintf(translated_frame_callee_rbx, sizeof(translated_frame_callee_rbx), "0x%" PRIx64, descriptor->translated_frame_callee_rbx);
  snprintf(translated_frame_callee_r12, sizeof(translated_frame_callee_r12), "0x%" PRIx64, descriptor->translated_frame_callee_r12);
  snprintf(translated_frame_callee_r13, sizeof(translated_frame_callee_r13), "0x%" PRIx64, descriptor->translated_frame_callee_r13);
  snprintf(translated_frame_callee_r14, sizeof(translated_frame_callee_r14), "0x%" PRIx64, descriptor->translated_frame_callee_r14);
  snprintf(translated_frame_callee_r15, sizeof(translated_frame_callee_r15), "0x%" PRIx64, descriptor->translated_frame_callee_r15);
  for (size_t i = 0; i < descriptor->translated_frame_slot_count; i++) {
    snprintf(translated_frame_slots[i],
        sizeof(translated_frame_slots[i]),
        "0x%" PRIx64 ":0x%" PRIx64 ":%s",
        descriptor->translated_frame_slot_offsets[i],
        descriptor->translated_frame_slot_values[i],
        descriptor->translated_frame_slot_classes[i]);
  }
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

  char *child_argv[384];
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
  if (descriptor->has_state_report_address) {
    push_arg(child_argv, &child_argc, "--state-report-address");
    push_arg(child_argv, &child_argc, state_report_address);
  }
  if (descriptor->has_target_fs_base) {
    push_arg(child_argv, &child_argc, "--target-fs-base");
    push_arg(child_argv, &child_argc, target_fs_base);
  }
  if (descriptor->has_translated_return_address) {
    push_arg(child_argv, &child_argc, "--translated-return-address");
    push_arg(child_argv, &child_argc, translated_return_address);
  }
  if (descriptor->has_resume_mode) {
    push_arg(child_argv, &child_argc, "--resume-mode");
    push_arg(child_argv, &child_argc, descriptor->resume_mode);
  }
  if (descriptor->has_resume_rflags) {
    push_arg(child_argv, &child_argc, "--resume-rflags");
    push_arg(child_argv, &child_argc, resume_rflags);
  }
  if (descriptor->has_resume_registers) {
    push_arg(child_argv, &child_argc, "--resume-register-rax");
    push_arg(child_argv, &child_argc, resume_register_rax);
    push_arg(child_argv, &child_argc, "--resume-register-rdi");
    push_arg(child_argv, &child_argc, resume_register_rdi);
    push_arg(child_argv, &child_argc, "--resume-register-rsi");
    push_arg(child_argv, &child_argc, resume_register_rsi);
    push_arg(child_argv, &child_argc, "--resume-register-rdx");
    push_arg(child_argv, &child_argc, resume_register_rdx);
    push_arg(child_argv, &child_argc, "--resume-register-rcx");
    push_arg(child_argv, &child_argc, resume_register_rcx);
    push_arg(child_argv, &child_argc, "--resume-register-r8");
    push_arg(child_argv, &child_argc, resume_register_r8);
    push_arg(child_argv, &child_argc, "--resume-register-r9");
    push_arg(child_argv, &child_argc, resume_register_r9);
    push_arg(child_argv, &child_argc, "--resume-register-r10");
    push_arg(child_argv, &child_argc, resume_register_r10);
    push_arg(child_argv, &child_argc, "--resume-register-r11");
    push_arg(child_argv, &child_argc, resume_register_r11);
  }
  if (descriptor->has_translated_frame) {
    push_arg(child_argv, &child_argc, "--translated-frame-pointer");
    push_arg(child_argv, &child_argc, translated_frame_pointer);
    push_arg(child_argv, &child_argc, "--translated-frame-cfa");
    push_arg(child_argv, &child_argc, translated_frame_cfa);
    push_arg(child_argv, &child_argc, "--translated-frame-return-address-slot");
    push_arg(child_argv, &child_argc, translated_frame_return_address_slot);
    push_arg(child_argv, &child_argc, "--translated-frame-return-address");
    push_arg(child_argv, &child_argc, translated_frame_return_address);
    push_arg(child_argv, &child_argc, "--translated-frame-unwind-id");
    push_arg(child_argv, &child_argc, descriptor->translated_frame_unwind_id);
    push_arg(child_argv, &child_argc, "--translated-frame-callee-rbx");
    push_arg(child_argv, &child_argc, translated_frame_callee_rbx);
    push_arg(child_argv, &child_argc, "--translated-frame-callee-r12");
    push_arg(child_argv, &child_argc, translated_frame_callee_r12);
    push_arg(child_argv, &child_argc, "--translated-frame-callee-r13");
    push_arg(child_argv, &child_argc, translated_frame_callee_r13);
    push_arg(child_argv, &child_argc, "--translated-frame-callee-r14");
    push_arg(child_argv, &child_argc, translated_frame_callee_r14);
    push_arg(child_argv, &child_argc, "--translated-frame-callee-r15");
    push_arg(child_argv, &child_argc, translated_frame_callee_r15);
    for (size_t i = 0; i < descriptor->translated_frame_slot_count; i++) {
      push_arg(child_argv, &child_argc, "--translated-frame-slot");
      push_arg(child_argv, &child_argc, translated_frame_slots[i]);
    }
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
    if (descriptor->has_eventfd_spec) {
      push_arg(child_argv, &child_argc, "--synthetic-eventfd");
      push_arg(child_argv, &child_argc, descriptor->eventfd_spec);
    } else {
      push_arg(child_argv, &child_argc, "--synthetic-empty-eventfd");
      push_arg(child_argv, &child_argc, event_fd);
    }
  }
  if (descriptor->timer_fd >= 0) {
    push_arg(child_argv, &child_argc, "--synthetic-timerfd");
    push_arg(child_argv, &child_argc, descriptor->timerfd_spec[0] ? descriptor->timerfd_spec : timer_fd);
  }
  for (size_t i = 0; i < descriptor->signalfd_count; i++) {
    push_arg(child_argv, &child_argc, "--synthetic-signalfd");
    push_arg(child_argv, &child_argc, descriptor->signalfd_specs[i]);
  }
  for (size_t i = 0; i < descriptor->epoll_count; i++) {
    push_arg(child_argv, &child_argc, "--synthetic-epoll");
    push_arg(child_argv, &child_argc, descriptor->epoll_specs[i]);
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
  for (size_t i = 0; i < descriptor->native_restore_arg_count; i++) {
    push_arg(child_argv, &child_argc, descriptor->native_restore_args[i].flag);
    push_arg(child_argv, &child_argc, descriptor->native_restore_args[i].spec);
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
