// External Linux process capturer for the transparent native process image.
//
// The capturer can attach to an existing PID or launch an unmodified command,
// stop all of its threads with ptrace, and emit the native-process-image bundle
// documents. It does not require the target to link against Machinen or call a
// checkpoint function.

#define _GNU_SOURCE

#include <ctype.h>
#include <dirent.h>
#include <elf.h>
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <limits.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ptrace.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#if defined(__aarch64__) || defined(__x86_64__)
#include <sys/user.h>
#endif

#define NATIVE_CAPTURE_MAX_THREADS 256u
#define NATIVE_CAPTURE_MAX_MAPPINGS 1024u
#define NATIVE_CAPTURE_MAX_FDS 1024u
#define NATIVE_CAPTURE_MAX_ENV 256u
#define NATIVE_CAPTURE_MAX_MAPPING_BYTES (64ull * 1024ull * 1024ull)
#define NATIVE_CAPTURE_MAX_TOTAL_BYTES (256ull * 1024ull * 1024ull)

#if defined(__aarch64__)
#define NATIVE_CAPTURE_ARCH "arm64"
#ifndef NT_ARM_TLS
#define NT_ARM_TLS 0x401
#endif
#elif defined(__x86_64__)
#define NATIVE_CAPTURE_ARCH "amd64"
#else
#define NATIVE_CAPTURE_ARCH "unknown"
#endif

struct Options {
  const char *output_dir;
  const char *target_arch;
  pid_t pid;
  int command_index;
  uint32_t settle_ms;
  const char *trace_syscall;
  int64_t trace_syscall_fd;
};

#if defined(__aarch64__)
struct NativeArm64Regs {
  uint64_t regs[31];
  uint64_t sp;
  uint64_t pc;
  uint64_t pstate;
};
#endif

struct ThreadCapture;

struct SyscallInfo {
  char state[32];
  bool has_number;
  uint64_t number;
  char name[64];
  bool has_arguments;
  uint64_t arguments[6];
  bool has_stack_pointer;
  uint64_t stack_pointer;
  bool has_instruction_pointer;
  uint64_t instruction_pointer;
};

static const char *syscall_name(long long number);
static void read_thread_syscall(pid_t tid, struct SyscallInfo *info);
static void read_thread_simd_fpu(struct ThreadCapture *thread);

struct ThreadCapture {
  pid_t tid;
  bool attached;
  int stop_signal;
  struct SyscallInfo syscall;
  bool simd_fpu_captured;
  bool simd_fpu_zero;
  size_t simd_fpu_size;
#if defined(__x86_64__)
  struct user_regs_struct amd64_regs;
#elif defined(__aarch64__)
  struct NativeArm64Regs arm64_regs;
  uint64_t arm64_tls;
#endif
};

struct MappingCapture {
  uint32_t index;
  char id[64];
  char kind[32];
  uint64_t start;
  uint64_t end;
  uint64_t size_bytes;
  bool read;
  bool write;
  bool execute;
  bool private_mapping;
  bool shared_mapping;
  bool has_file;
  char path[PATH_MAX];
  uint64_t file_offset;
  bool has_captured;
  uint64_t captured_offset;
  uint64_t captured_size;
  char materialization[16];
  char reason[160];
  bool has_refusal;
  char refusal_code[64];
  char refusal_message[192];
};

struct ProcessInfo {
  char exe[PATH_MAX];
  char cwd[PATH_MAX];
  char **argv;
  size_t argc;
  char **env_keys;
  char **env_values;
  size_t env_count;
  char auxv_hex[8192];
};

static void die(const char *message) {
  fprintf(stderr, "machinen-native-process-capture: %s: %s\n", message, strerror(errno));
  exit(1);
}

static void fail(const char *message) {
  fprintf(stderr, "machinen-native-process-capture: %s\n", message);
  exit(1);
}

static bool streq(const char *left, const char *right) {
  return strcmp(left, right) == 0;
}

static void path_join(char out[PATH_MAX], const char *dir, const char *name) {
  int written = snprintf(out, PATH_MAX, "%s/%s", dir, name);
  if (written < 0 || written >= PATH_MAX) {
    fail("path too long");
  }
}

static void proc_path(char out[PATH_MAX], pid_t pid, const char *suffix) {
  int written = snprintf(out, PATH_MAX, "/proc/%ld/%s", (long)pid, suffix);
  if (written < 0 || written >= PATH_MAX) {
    fail("proc path too long");
  }
}

static FILE *open_output(const struct Options *opts, const char *name) {
  char path[PATH_MAX];
  path_join(path, opts->output_dir, name);
  FILE *file = fopen(path, "wb");
  if (!file) {
    die("open output");
  }
  return file;
}

static void json_string(FILE *file, const char *value) {
  fputc('"', file);
  for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
    if (*p == '"' || *p == '\\') {
      fputc('\\', file);
      fputc(*p, file);
    } else if (*p == '\n') {
      fputs("\\n", file);
    } else if (*p == '\r') {
      fputs("\\r", file);
    } else if (*p == '\t') {
      fputs("\\t", file);
    } else if (*p < 0x20u) {
      fprintf(file, "\\u%04x", *p);
    } else {
      fputc(*p, file);
    }
  }
  fputc('"', file);
}

static void json_hex_u64(FILE *file, uint64_t value) {
  fprintf(file, "\"0x%" PRIx64 "\"", value);
}

static void ensure_output_dir(const char *path) {
  if (mkdir(path, 0755) != 0 && errno != EEXIST) {
    die("create output directory");
  }
}

static uint64_t parse_u64(const char *value, const char *field) {
  errno = 0;
  char *end = NULL;
  uint64_t parsed = strtoull(value, &end, 0);
  if (errno != 0 || end == value || *end != '\0') {
    fprintf(stderr, "machinen-native-process-capture: invalid %s: %s\n", field, value);
    exit(2);
  }
  return parsed;
}

static const char *opposite_arch(void) {
  if (streq(NATIVE_CAPTURE_ARCH, "arm64")) {
    return "amd64";
  }
  if (streq(NATIVE_CAPTURE_ARCH, "amd64")) {
    return "arm64";
  }
  return "unknown";
}

static void usage(void) {
  fprintf(stderr,
      "usage: machinen-native-process-capture --output dir [--target-arch arch] "
      "[--settle-ms n] [--trace-syscall name] [--trace-syscall-fd n] (--pid pid | -- command [args...])\n");
  exit(2);
}

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {.output_dir = NULL,
      .target_arch = NULL,
      .pid = 0,
      .command_index = -1,
      .settle_ms = 200,
      .trace_syscall = NULL,
      .trace_syscall_fd = -1};
  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--output")) {
      if (++i >= argc) {
        usage();
      }
      opts.output_dir = argv[i];
    } else if (streq(argv[i], "--target-arch")) {
      if (++i >= argc) {
        usage();
      }
      opts.target_arch = argv[i];
    } else if (streq(argv[i], "--pid")) {
      if (++i >= argc) {
        usage();
      }
      opts.pid = (pid_t)parse_u64(argv[i], "pid");
    } else if (streq(argv[i], "--settle-ms")) {
      if (++i >= argc) {
        usage();
      }
      opts.settle_ms = (uint32_t)parse_u64(argv[i], "settle-ms");
    } else if (streq(argv[i], "--trace-syscall")) {
      if (++i >= argc) {
        usage();
      }
      opts.trace_syscall = argv[i];
    } else if (streq(argv[i], "--trace-syscall-fd")) {
      if (++i >= argc) {
        usage();
      }
      opts.trace_syscall_fd = (int64_t)parse_u64(argv[i], "trace-syscall-fd");
    } else if (streq(argv[i], "--")) {
      opts.command_index = i + 1;
      break;
    } else {
      usage();
    }
  }
  if (!opts.output_dir) {
    usage();
  }
  if (!opts.target_arch) {
    opts.target_arch = opposite_arch();
  }
  if ((opts.pid > 0) == (opts.command_index >= 0)) {
    usage();
  }
  if (opts.trace_syscall && opts.command_index < 0) {
    usage();
  }
  if (opts.trace_syscall_fd >= 0 && !opts.trace_syscall) {
    usage();
  }
  if (opts.command_index >= argc) {
    usage();
  }
  return opts;
}

static void wait_for_launch_stop(pid_t child) {
  for (;;) {
    int status = 0;
    pid_t got = waitpid(child, &status, 0);
    if (got == child && WIFSTOPPED(status)) {
      return;
    }
    if (got == child && WIFEXITED(status)) {
      fail("traced target exited before capture");
    }
    if (got < 0 && errno == EINTR) {
      continue;
    }
    fail("traced target did not stop before capture");
  }
}

struct TraceSyscallRegisters {
  long long number;
  uint64_t arg0;
};

static struct TraceSyscallRegisters current_ptrace_syscall_registers(pid_t child) {
#if defined(__x86_64__)
  struct user_regs_struct regs;
  if (ptrace(PTRACE_GETREGS, child, NULL, &regs) != 0) {
    die("ptrace getregs trace syscall");
  }
  return (struct TraceSyscallRegisters){.number = (long long)regs.orig_rax, .arg0 = regs.rdi};
#elif defined(__aarch64__)
  struct NativeArm64Regs regs;
  struct iovec regs_iov = {.iov_base = &regs, .iov_len = sizeof(regs)};
  if (ptrace(PTRACE_GETREGSET, child, (void *)NT_PRSTATUS, &regs_iov) != 0) {
    die("ptrace getregset trace syscall");
  }
  return (struct TraceSyscallRegisters){.number = (long long)regs.regs[8], .arg0 = regs.regs[0]};
#else
  (void)child;
  return (struct TraceSyscallRegisters){.number = -1, .arg0 = 0};
#endif
}

static bool trace_syscall_matches(
    const char *wanted_syscall, int64_t wanted_fd, struct TraceSyscallRegisters regs) {
  if (!streq(syscall_name(regs.number), wanted_syscall)) {
    return false;
  }
  return wanted_fd < 0 || regs.arg0 == (uint64_t)wanted_fd;
}

static void trace_target_to_syscall(pid_t child, const char *syscall, int64_t syscall_fd) {
  wait_for_launch_stop(child);
  if (ptrace(PTRACE_SETOPTIONS, child, NULL, (void *)(uintptr_t)PTRACE_O_TRACESYSGOOD) != 0) {
    die("ptrace setoptions trace syscall");
  }
  bool entering = true;
  for (;;) {
    if (ptrace(PTRACE_SYSCALL, child, NULL, NULL) != 0) {
      die("ptrace syscall trace");
    }
    int status = 0;
    pid_t got = 0;
    do {
      got = waitpid(child, &status, 0);
    } while (got < 0 && errno == EINTR);
    if (got != child) {
      fail("traced target wait failed");
    }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fail("traced target exited before requested syscall");
    }
    if (!WIFSTOPPED(status)) {
      continue;
    }
    int signal = WSTOPSIG(status);
    if ((signal & 0x80) == 0) {
      continue;
    }
    struct TraceSyscallRegisters regs = current_ptrace_syscall_registers(child);
    if (entering && trace_syscall_matches(syscall, syscall_fd, regs)) {
      return;
    }
    entering = !entering;
  }
}

static pid_t launch_target(const struct Options *opts, char **argv) {
  if (opts->command_index < 0) {
    return opts->pid;
  }

  pid_t child = fork();
  if (child < 0) {
    die("fork target");
  }
  if (child == 0) {
    char log_path[PATH_MAX];
    path_join(log_path, opts->output_dir, "target.log");
    int log_fd = open(log_path, O_CREAT | O_TRUNC | O_WRONLY, 0644);
    if (log_fd >= 0) {
      dup2(log_fd, STDOUT_FILENO);
      dup2(log_fd, STDERR_FILENO);
      close(log_fd);
    }
    if (opts->trace_syscall) {
      if (ptrace(PTRACE_TRACEME, 0, NULL, NULL) != 0) {
        fprintf(stderr, "machinen-native-process-capture: ptrace traceme failed: %s\n", strerror(errno));
        _exit(126);
      }
      raise(SIGSTOP);
    }
    execvp(argv[opts->command_index], &argv[opts->command_index]);
    fprintf(stderr, "machinen-native-process-capture: exec target failed: %s\n", strerror(errno));
    _exit(127);
  }

  if (opts->trace_syscall) {
    trace_target_to_syscall(child, opts->trace_syscall, opts->trace_syscall_fd);
    return child;
  }

  struct timespec delay = {.tv_sec = opts->settle_ms / 1000u,
      .tv_nsec = (long)(opts->settle_ms % 1000u) * 1000000L};
  nanosleep(&delay, NULL);
  return child;
}

static void cleanup_target(const struct Options *opts, pid_t pid) {
  if (opts->command_index < 0) {
    return;
  }
  kill(pid, SIGTERM);
  for (;;) {
    int status = 0;
    pid_t got = waitpid(pid, &status, 0);
    if (got == pid) {
      return;
    }
    if (got < 0 && errno == EINTR) {
      continue;
    }
    return;
  }
}

static int compare_pid(const void *left, const void *right) {
  pid_t a = *(const pid_t *)left;
  pid_t b = *(const pid_t *)right;
  return (a > b) - (a < b);
}

static uint32_t list_threads(pid_t pid, pid_t tids[NATIVE_CAPTURE_MAX_THREADS]) {
  char path[PATH_MAX];
  proc_path(path, pid, "task");
  DIR *dir = opendir(path);
  if (!dir) {
    die("open proc task");
  }

  uint32_t count = 0;
  for (;;) {
    struct dirent *entry = readdir(dir);
    if (!entry) {
      break;
    }
    if (entry->d_name[0] == '.') {
      continue;
    }
    if (count >= NATIVE_CAPTURE_MAX_THREADS) {
      fail("too many target threads");
    }
    tids[count++] = (pid_t)strtol(entry->d_name, NULL, 10);
  }
  closedir(dir);
  qsort(tids, count, sizeof(tids[0]), compare_pid);
  return count;
}

static void wait_for_ptrace_stop(pid_t tid, int *stop_signal) {
  for (;;) {
    int status = 0;
    pid_t got = waitpid(tid, &status, __WALL);
    if (got == tid && WIFSTOPPED(status)) {
      *stop_signal = WSTOPSIG(status);
      return;
    }
    if (got < 0 && errno == EINTR) {
      continue;
    }
    fail("target thread did not stop after ptrace attach");
  }
}

static void attach_thread(struct ThreadCapture *thread, pid_t already_attached_tid) {
  thread->attached = false;
  thread->stop_signal = 0;
  if (thread->tid == already_attached_tid) {
    thread->attached = true;
    thread->stop_signal = SIGTRAP;
    return;
  }
  if (ptrace(PTRACE_ATTACH, thread->tid, NULL, NULL) != 0) {
    return;
  }
  wait_for_ptrace_stop(thread->tid, &thread->stop_signal);
  thread->attached = true;
}

static void detach_thread(const struct ThreadCapture *thread) {
  if (!thread->attached) {
    return;
  }
  if (ptrace(PTRACE_DETACH, thread->tid, NULL, NULL) != 0) {
    die("ptrace detach");
  }
}

static void capture_registers(struct ThreadCapture *thread) {
  if (!thread->attached) {
    return;
  }
#if defined(__x86_64__)
  memset(&thread->amd64_regs, 0, sizeof(thread->amd64_regs));
  if (ptrace(PTRACE_GETREGS, thread->tid, NULL, &thread->amd64_regs) != 0) {
    thread->attached = false;
  }
#elif defined(__aarch64__)
  memset(&thread->arm64_regs, 0, sizeof(thread->arm64_regs));
  thread->arm64_tls = 0;
  struct iovec regs_iov = {.iov_base = &thread->arm64_regs, .iov_len = sizeof(thread->arm64_regs)};
  if (ptrace(PTRACE_GETREGSET, thread->tid, (void *)NT_PRSTATUS, &regs_iov) != 0) {
    thread->attached = false;
    return;
  }
  struct iovec tls_iov = {.iov_base = &thread->arm64_tls, .iov_len = sizeof(thread->arm64_tls)};
  (void)ptrace(PTRACE_GETREGSET, thread->tid, (void *)NT_ARM_TLS, &tls_iov);
#endif
}

static bool bytes_are_zero(const unsigned char *bytes, size_t len) {
  for (size_t i = 0; i < len; i++) {
    if (bytes[i] != 0) {
      return false;
    }
  }
  return true;
}

static void read_thread_simd_fpu(struct ThreadCapture *thread) {
  thread->simd_fpu_captured = false;
  thread->simd_fpu_zero = false;
  thread->simd_fpu_size = 0;
  if (!thread->attached) {
    return;
  }
#if defined(__aarch64__) || defined(__x86_64__)
  unsigned char fpstate[4096];
  memset(fpstate, 0, sizeof(fpstate));
  struct iovec iov = {.iov_base = fpstate, .iov_len = sizeof(fpstate)};
  if (ptrace(PTRACE_GETREGSET, thread->tid, (void *)NT_PRFPREG, &iov) == 0 &&
      iov.iov_len <= sizeof(fpstate)) {
    thread->simd_fpu_captured = true;
    thread->simd_fpu_size = iov.iov_len;
    thread->simd_fpu_zero = bytes_are_zero(fpstate, iov.iov_len);
  }
#endif
}

static uint32_t attach_threads(
    pid_t pid, struct ThreadCapture threads[NATIVE_CAPTURE_MAX_THREADS], pid_t already_attached_tid) {
  pid_t tids[NATIVE_CAPTURE_MAX_THREADS];
  uint32_t count = list_threads(pid, tids);
  if (count == 0) {
    fail("target has no threads");
  }
  for (uint32_t i = 0; i < count; i++) {
    threads[i] = (struct ThreadCapture){.tid = tids[i]};
    read_thread_syscall(threads[i].tid, &threads[i].syscall);
    attach_thread(&threads[i], already_attached_tid);
    capture_registers(&threads[i]);
    read_thread_simd_fpu(&threads[i]);
  }
  return count;
}

static void detach_threads(struct ThreadCapture threads[NATIVE_CAPTURE_MAX_THREADS], uint32_t count) {
  for (uint32_t i = 0; i < count; i++) {
    detach_thread(&threads[i]);
  }
}

static char *read_proc_bytes(pid_t pid, const char *suffix, size_t *len_out) {
  char path[PATH_MAX];
  proc_path(path, pid, suffix);
  int fd = open(path, O_RDONLY);
  if (fd < 0) {
    die("open proc bytes");
  }
  size_t cap = 4096;
  size_t len = 0;
  char *buf = malloc(cap);
  if (!buf) {
    die("malloc proc bytes");
  }
  for (;;) {
    if (len == cap) {
      cap *= 2u;
      char *grown = realloc(buf, cap);
      if (!grown) {
        die("realloc proc bytes");
      }
      buf = grown;
    }
    ssize_t got = read(fd, buf + len, cap - len);
    if (got < 0) {
      if (errno == EINTR) {
        continue;
      }
      die("read proc bytes");
    }
    if (got == 0) {
      break;
    }
    len += (size_t)got;
  }
  close(fd);
  *len_out = len;
  return buf;
}

static void read_proc_link(pid_t pid, const char *suffix, char out[PATH_MAX]) {
  char path[PATH_MAX];
  proc_path(path, pid, suffix);
  ssize_t len = readlink(path, out, PATH_MAX - 1u);
  if (len < 0) {
    die("read proc link");
  }
  out[len] = '\0';
}

static void split_nul_list(char *buf, size_t len, char ***items_out, size_t *count_out) {
  size_t count = 0;
  for (size_t i = 0; i < len; i++) {
    if (buf[i] == '\0') {
      count++;
    }
  }
  char **items = calloc(count + 1u, sizeof(char *));
  if (!items) {
    die("calloc nul list");
  }
  size_t cursor = 0;
  size_t index = 0;
  while (cursor < len) {
    char *start = buf + cursor;
    size_t remaining = len - cursor;
    size_t item_len = strnlen(start, remaining);
    if (item_len > 0) {
      items[index++] = start;
    }
    cursor += item_len + 1u;
  }
  *items_out = items;
  *count_out = index;
}

static void read_auxv_hex(pid_t pid, char out[8192]) {
  size_t len = 0;
  char *buf = read_proc_bytes(pid, "auxv", &len);
  static const char alphabet[] = "0123456789abcdef";
  size_t max_bytes = (sizeof(((struct ProcessInfo *)0)->auxv_hex) - 1u) / 2u;
  size_t clipped = len < max_bytes ? len : max_bytes;
  for (size_t i = 0; i < clipped; i++) {
    unsigned char byte = (unsigned char)buf[i];
    out[i * 2u] = alphabet[byte >> 4];
    out[i * 2u + 1u] = alphabet[byte & 0x0fu];
  }
  out[clipped * 2u] = '\0';
  free(buf);
}

static struct ProcessInfo read_process_info(pid_t pid) {
  struct ProcessInfo info;
  memset(&info, 0, sizeof(info));
  read_proc_link(pid, "exe", info.exe);
  read_proc_link(pid, "cwd", info.cwd);

  size_t cmd_len = 0;
  char *cmd = read_proc_bytes(pid, "cmdline", &cmd_len);
  split_nul_list(cmd, cmd_len, &info.argv, &info.argc);

  size_t env_len = 0;
  char *env = read_proc_bytes(pid, "environ", &env_len);
  char **env_items = NULL;
  size_t env_item_count = 0;
  split_nul_list(env, env_len, &env_items, &env_item_count);
  info.env_keys = calloc(env_item_count + 1u, sizeof(char *));
  info.env_values = calloc(env_item_count + 1u, sizeof(char *));
  if (!info.env_keys || !info.env_values) {
    die("calloc env");
  }
  for (size_t i = 0; i < env_item_count && info.env_count < NATIVE_CAPTURE_MAX_ENV; i++) {
    char *equals = strchr(env_items[i], '=');
    if (!equals) {
      continue;
    }
    *equals = '\0';
    info.env_keys[info.env_count] = env_items[i];
    info.env_values[info.env_count] = equals + 1;
    info.env_count++;
  }
  free(env_items);
  read_auxv_hex(pid, info.auxv_hex);
  return info;
}

static void write_json_string_array(FILE *file, char **items, size_t count) {
  fputc('[', file);
  for (size_t i = 0; i < count; i++) {
    if (i != 0) {
      fputc(',', file);
    }
    json_string(file, items[i]);
  }
  fputc(']', file);
}

static void write_json_env(FILE *file, const struct ProcessInfo *info) {
  fputc('{', file);
  for (size_t i = 0; i < info->env_count; i++) {
    if (i != 0) {
      fputc(',', file);
    }
    json_string(file, info->env_keys[i]);
    fputc(':', file);
    json_string(file, info->env_values[i]);
  }
  fputc('}', file);
}

static const char *trim_path(char *path) {
  while (*path && isspace((unsigned char)*path)) {
    path++;
  }
  return path;
}

static const char *mapping_kind(const char *path, bool read, bool write, bool execute) {
  if (path[0] == '[') {
    if (strncmp(path, "[heap]", 6) == 0) {
      return "heap";
    }
    if (strncmp(path, "[stack", 6) == 0) {
      return "stack";
    }
    if (strncmp(path, "[vdso]", 6) == 0) {
      return "vdso";
    }
    if (strncmp(path, "[vvar]", 6) == 0) {
      return "vvar";
    }
    return "special";
  }
  if (path[0] == '\0') {
    return "anonymous";
  }
  if (execute) {
    return "text";
  }
  if (write && read) {
    return "data";
  }
  return "file";
}

static bool kernel_mapping(const char *kind) {
  return streq(kind, "vdso") || streq(kind, "vvar") || streq(kind, "special");
}

static bool no_access_protection_mapping(const struct MappingCapture *mapping) {
  return !mapping->read && !mapping->write && !mapping->execute &&
         mapping->private_mapping && !mapping->shared_mapping &&
         (streq(mapping->kind, "anonymous") || streq(mapping->kind, "stack") ||
             streq(mapping->kind, "file"));
}

static void set_mapping_refusal(struct MappingCapture *mapping, const char *code,
    const char *message) {
  mapping->has_refusal = true;
  snprintf(mapping->refusal_code, sizeof(mapping->refusal_code), "%s", code);
  snprintf(mapping->refusal_message, sizeof(mapping->refusal_message), "%s", message);
  snprintf(mapping->materialization, sizeof(mapping->materialization), "refuse");
  snprintf(mapping->reason, sizeof(mapping->reason), "%s", message);
}

static uint32_t parse_maps(pid_t pid, struct MappingCapture mappings[NATIVE_CAPTURE_MAX_MAPPINGS]) {
  char path[PATH_MAX];
  proc_path(path, pid, "maps");
  FILE *file = fopen(path, "rb");
  if (!file) {
    die("open proc maps");
  }

  uint32_t count = 0;
  char line[8192];
  while (fgets(line, sizeof(line), file)) {
    if (count >= NATIVE_CAPTURE_MAX_MAPPINGS) {
      fail("too many mappings");
    }
    unsigned long long start = 0;
    unsigned long long end = 0;
    unsigned long long offset = 0;
    unsigned long long inode = 0;
    char perms[8] = {0};
    char dev[32] = {0};
    char raw_path[PATH_MAX] = {0};
    int matched = sscanf(line, "%llx-%llx %7s %llx %31s %llu %4095[^\n]", &start, &end, perms,
        &offset, dev, &inode, raw_path);
    if (matched < 6) {
      continue;
    }
    struct MappingCapture *mapping = &mappings[count];
    memset(mapping, 0, sizeof(*mapping));
    mapping->index = count;
    snprintf(mapping->id, sizeof(mapping->id), "mapping:%u", count);
    mapping->start = start;
    mapping->end = end;
    mapping->size_bytes = end - start;
    mapping->read = perms[0] == 'r';
    mapping->write = perms[1] == 'w';
    mapping->execute = perms[2] == 'x';
    mapping->private_mapping = perms[3] == 'p';
    mapping->shared_mapping = perms[3] == 's';
    mapping->file_offset = offset;
    const char *parsed_path = matched >= 7 ? trim_path(raw_path) : "";
    if (parsed_path[0] != '\0') {
      snprintf(mapping->path, sizeof(mapping->path), "%s", parsed_path);
      mapping->has_file = parsed_path[0] == '/';
    }
    snprintf(mapping->kind, sizeof(mapping->kind), "%s",
        mapping_kind(mapping->path, mapping->read, mapping->write, mapping->execute));
    if (kernel_mapping(mapping->kind)) {
      snprintf(mapping->materialization, sizeof(mapping->materialization), "recreate");
      snprintf(mapping->reason, sizeof(mapping->reason), "kernel mapping is recreated on target");
    } else if (!mapping->read) {
      if (no_access_protection_mapping(mapping)) {
        snprintf(mapping->materialization, sizeof(mapping->materialization), "recreate");
        snprintf(mapping->reason, sizeof(mapping->reason),
            "guard/protection mapping is recreated as target PROT_NONE");
      } else {
        set_mapping_refusal(mapping, "mapping-unreadable", "mapping is not readable through /proc/pid/mem");
      }
    } else {
      snprintf(mapping->materialization, sizeof(mapping->materialization), "translate");
    }
    count++;
  }
  fclose(file);
  return count;
}

static bool read_mapping_bytes(int mem_fd, const struct MappingCapture *mapping, uint8_t *buffer) {
  uint64_t remaining = mapping->size_bytes;
  uint64_t cursor = 0;
  while (remaining > 0) {
    size_t chunk = remaining > 1024u * 1024u ? 1024u * 1024u : (size_t)remaining;
    ssize_t got = pread(mem_fd, buffer + cursor, chunk, (off_t)(mapping->start + cursor));
    if (got < 0) {
      return false;
    }
    if (got == 0) {
      return false;
    }
    cursor += (uint64_t)got;
    remaining -= (uint64_t)got;
  }
  return true;
}

static void capture_mapping_memory(pid_t pid, struct MappingCapture mappings[NATIVE_CAPTURE_MAX_MAPPINGS],
    uint32_t count, const struct Options *opts) {
  char mem_path[PATH_MAX];
  proc_path(mem_path, pid, "mem");
  int mem_fd = open(mem_path, O_RDONLY);
  if (mem_fd < 0) {
    die("open proc mem");
  }
  char memory_path[PATH_MAX];
  path_join(memory_path, opts->output_dir, "native-memory.bin");
  FILE *memory = fopen(memory_path, "wb");
  if (!memory) {
    die("open native-memory.bin");
  }

  uint64_t total = 0;
  for (uint32_t i = 0; i < count; i++) {
    struct MappingCapture *mapping = &mappings[i];
    if (!mapping->read || kernel_mapping(mapping->kind) || mapping->has_refusal) {
      continue;
    }
    if (mapping->size_bytes > NATIVE_CAPTURE_MAX_MAPPING_BYTES ||
        total + mapping->size_bytes > NATIVE_CAPTURE_MAX_TOTAL_BYTES) {
      set_mapping_refusal(mapping, "mapping-ambiguous", "mapping exceeds capture size policy");
      continue;
    }
    uint8_t *buffer = malloc((size_t)mapping->size_bytes);
    if (!buffer) {
      set_mapping_refusal(mapping, "mapping-ambiguous", "mapping is too large to allocate");
      continue;
    }
    if (!read_mapping_bytes(mem_fd, mapping, buffer)) {
      free(buffer);
      set_mapping_refusal(mapping, "mapping-unreadable", "mapping read failed through /proc/pid/mem");
      continue;
    }
    mapping->captured_offset = total;
    mapping->captured_size = mapping->size_bytes;
    mapping->has_captured = true;
    if (fwrite(buffer, 1u, (size_t)mapping->size_bytes, memory) != (size_t)mapping->size_bytes) {
      die("write native-memory.bin");
    }
    total += mapping->size_bytes;
    free(buffer);
  }
  fclose(memory);
  close(mem_fd);
}

static void write_manifest(const struct Options *opts, pid_t pid, const struct ProcessInfo *info) {
  FILE *out = open_output(opts, "native-process.json");
  fputs("{\"formatVersion\":1,\"kind\":\"machinen.native-process-image\",", out);
  fputs("\"capture\":{\"method\":\"external-ptrace-procfs\",\"sourceArch\":", out);
  json_string(out, NATIVE_CAPTURE_ARCH);
  fprintf(out, ",\"pid\":%ld},", (long)pid);
  fputs("\"target\":{\"mode\":\"native-cross-isa\",\"arch\":", out);
  json_string(out, opts->target_arch);
  fputs(",\"abi\":\"linux-user\"},\"process\":{\"exe\":", out);
  json_string(out, info->exe);
  fputs(",\"argv\":", out);
  write_json_string_array(out, info->argv, info->argc);
  fputs(",\"env\":", out);
  write_json_env(out, info);
  fputs(",\"cwd\":", out);
  json_string(out, info->cwd);
  fputs("},\"refusals\":{\"vocabularyVersion\":1,\"refusals\":[]}}\n", out);
  fclose(out);
}

static void write_refusal(FILE *out, const char *code, const char *message) {
  fputs("{\"code\":", out);
  json_string(out, code);
  fputs(",\"message\":", out);
  json_string(out, message);
  fputc('}', out);
}

static void mapping_perm_string(const struct MappingCapture *mapping, char perms[5]) {
  perms[0] = mapping->read ? 'r' : '-';
  perms[1] = mapping->write ? 'w' : '-';
  perms[2] = mapping->execute ? 'x' : '-';
  perms[3] = mapping->shared_mapping ? 's' : mapping->private_mapping ? 'p' : '-';
  perms[4] = '\0';
}

static void write_mapping_refusal(FILE *out, const struct MappingCapture *mapping) {
  char perms[5];
  mapping_perm_string(mapping, perms);
  fputs("{\"code\":", out);
  json_string(out, mapping->refusal_code);
  fputs(",\"message\":", out);
  json_string(out, mapping->refusal_message);
  fputs(",\"detail\":{\"mapping\":", out);
  json_string(out, mapping->id);
  fputs(",\"kind\":", out);
  json_string(out, mapping->kind);
  fputs(",\"sourceStart\":", out);
  json_hex_u64(out, mapping->start);
  fputs(",\"sourceEnd\":", out);
  json_hex_u64(out, mapping->end);
  fprintf(out, ",\"sizeBytes\":%" PRIu64, mapping->size_bytes);
  fputs(",\"perms\":", out);
  json_string(out, perms);
  fputs(",\"path\":", out);
  json_string(out, mapping->path);
  fprintf(out,
      ",\"permissions\":{\"read\":%s,\"write\":%s,\"execute\":%s,\"private\":%s,\"shared\":%s}}}",
      mapping->read ? "true" : "false", mapping->write ? "true" : "false",
      mapping->execute ? "true" : "false", mapping->private_mapping ? "true" : "false",
      mapping->shared_mapping ? "true" : "false");
}

static void write_mapping(const struct MappingCapture *mapping, FILE *out) {
  fputs("{\"id\":", out);
  json_string(out, mapping->id);
  fputs(",\"kind\":", out);
  json_string(out, mapping->kind);
  fputs(",\"sourceStart\":", out);
  json_hex_u64(out, mapping->start);
  fputs(",\"sourceEnd\":", out);
  json_hex_u64(out, mapping->end);
  fprintf(out, ",\"sizeBytes\":%" PRIu64 ",\"permissions\":{", mapping->size_bytes);
  fprintf(out, "\"read\":%s,\"write\":%s,\"execute\":%s,\"private\":%s,\"shared\":%s}",
      mapping->read ? "true" : "false", mapping->write ? "true" : "false",
      mapping->execute ? "true" : "false", mapping->private_mapping ? "true" : "false",
      mapping->shared_mapping ? "true" : "false");
  if (mapping->has_file) {
    fputs(",\"file\":{\"path\":", out);
    json_string(out, mapping->path);
    fprintf(out, ",\"offset\":%" PRIu64 "}", mapping->file_offset);
  }
  if (mapping->has_captured) {
    fprintf(out,
        ",\"captured\":{\"file\":\"native-memory.bin\",\"offset\":%" PRIu64
        ",\"sizeBytes\":%" PRIu64 "}",
        mapping->captured_offset, mapping->captured_size);
  }
  fputs(",\"target\":{\"materialization\":", out);
  json_string(out, mapping->materialization);
  if (!streq(mapping->materialization, "refuse") && !streq(mapping->materialization, "omit")) {
    fputs(",\"targetStart\":", out);
    json_hex_u64(out, mapping->start);
  }
  if (mapping->reason[0] != '\0') {
    fputs(",\"reason\":", out);
    json_string(out, mapping->reason);
  }
  fputc('}', out);
  if (mapping->has_refusal) {
    fputs(",\"refusal\":", out);
    write_mapping_refusal(out, mapping);
  }
  fputc('}', out);
}

static void write_mappings(const struct Options *opts,
    const struct MappingCapture mappings[NATIVE_CAPTURE_MAX_MAPPINGS], uint32_t count) {
  FILE *out = open_output(opts, "native-mappings.json");
  fputs("{\"formatVersion\":1,\"mappings\":[", out);
  for (uint32_t i = 0; i < count; i++) {
    if (i != 0) {
      fputc(',', out);
    }
    write_mapping(&mappings[i], out);
  }
  fputs("],\"refusals\":{\"vocabularyVersion\":1,\"refusals\":[", out);
  bool first = true;
  for (uint32_t i = 0; i < count; i++) {
    if (!mappings[i].has_refusal) {
      continue;
    }
    if (!first) {
      fputc(',', out);
    }
    first = false;
    write_mapping_refusal(out, &mappings[i]);
  }
  fputs("]}}\n", out);
  fclose(out);
}

static void write_signal_mask(FILE *out, pid_t tid, const char *field) {
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "/proc/%ld/status", (long)tid);
  FILE *status = fopen(path, "rb");
  char wanted[32];
  snprintf(wanted, sizeof(wanted), "%s:", field);
  char value[64] = "0";
  if (status) {
    char line[256];
    while (fgets(line, sizeof(line), status)) {
      if (strncmp(line, wanted, strlen(wanted)) == 0) {
        char *cursor = line + strlen(wanted);
        while (*cursor && isspace((unsigned char)*cursor)) {
          cursor++;
        }
        size_t len = strcspn(cursor, "\r\n");
        if (len >= sizeof(value)) {
          len = sizeof(value) - 1u;
        }
        memcpy(value, cursor, len);
        value[len] = '\0';
        break;
      }
    }
    fclose(status);
  }
  fputs("[", out);
  json_string(out, value);
  fputs("]", out);
}

static bool syscall_is_restart(long long number) {
#ifdef __NR_restart_syscall
  if (number == __NR_restart_syscall) {
    return true;
  }
#endif
  return false;
}

static const char *syscall_name(long long number) {
#ifdef __NR_restart_syscall
  if (number == __NR_restart_syscall) {
    return "restart_syscall";
  }
#endif
#ifdef __NR_clock_nanosleep
  if (number == __NR_clock_nanosleep) {
    return "clock_nanosleep";
  }
#endif
#ifdef __NR_nanosleep
  if (number == __NR_nanosleep) {
    return "nanosleep";
  }
#endif
#ifdef __NR_ppoll
  if (number == __NR_ppoll) {
    return "ppoll";
  }
#endif
#ifdef __NR_pselect6
  if (number == __NR_pselect6) {
    return "pselect6";
  }
#endif
#ifdef __NR_read
  if (number == __NR_read) {
    return "read";
  }
#endif
#ifdef __NR_pread64
  if (number == __NR_pread64) {
    return "pread64";
  }
#endif
#ifdef __NR_readv
  if (number == __NR_readv) {
    return "readv";
  }
#endif
#ifdef __NR_write
  if (number == __NR_write) {
    return "write";
  }
#endif
#ifdef __NR_pwrite64
  if (number == __NR_pwrite64) {
    return "pwrite64";
  }
#endif
#ifdef __NR_writev
  if (number == __NR_writev) {
    return "writev";
  }
#endif
#ifdef __NR_recvfrom
  if (number == __NR_recvfrom) {
    return "recvfrom";
  }
#endif
#ifdef __NR_recvmsg
  if (number == __NR_recvmsg) {
    return "recvmsg";
  }
#endif
#ifdef __NR_sendto
  if (number == __NR_sendto) {
    return "sendto";
  }
#endif
#ifdef __NR_sendmsg
  if (number == __NR_sendmsg) {
    return "sendmsg";
  }
#endif
  return "unknown";
}

static void syscall_info_default(struct SyscallInfo *info, const char *state) {
  memset(info, 0, sizeof(*info));
  snprintf(info->state, sizeof(info->state), "%s", state);
  snprintf(info->name, sizeof(info->name), "unknown");
}

static bool parse_syscall_word(char **cursor, uint64_t *value) {
  while (**cursor == ' ' || **cursor == '\t') {
    (*cursor)++;
  }
  if (**cursor == '\0' || **cursor == '\n') {
    return false;
  }
  errno = 0;
  char *end = NULL;
  unsigned long long parsed = strtoull(*cursor, &end, 0);
  if (errno != 0 || end == *cursor) {
    return false;
  }
  *value = (uint64_t)parsed;
  *cursor = end;
  return true;
}

static void read_thread_syscall(pid_t tid, struct SyscallInfo *info) {
  syscall_info_default(info, "outside-syscall");
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "/proc/%ld/syscall", (long)tid);
  FILE *file = fopen(path, "rb");
  if (!file) {
    syscall_info_default(info, "inside-syscall");
    return;
  }
  char line[512];
  if (!fgets(line, sizeof(line), file)) {
    fclose(file);
    syscall_info_default(info, "inside-syscall");
    return;
  }
  fclose(file);
  if (strncmp(line, "running", 7) == 0) {
    return;
  }
  errno = 0;
  char *end = NULL;
  long long number = strtoll(line, &end, 10);
  if (errno != 0 || end == line) {
    syscall_info_default(info, "inside-syscall");
    return;
  }
  if (number < 0) {
    return;
  }
  info->has_number = true;
  info->number = (uint64_t)number;
  snprintf(info->state, sizeof(info->state), "%s",
      syscall_is_restart(number) ? "restart-block" : "inside-syscall");
  snprintf(info->name, sizeof(info->name), "%s", syscall_name(number));

  char *cursor = end;
  bool has_all_arguments = true;
  for (size_t i = 0; i < 6; i++) {
    if (!parse_syscall_word(&cursor, &info->arguments[i])) {
      has_all_arguments = false;
      break;
    }
  }
  info->has_arguments = has_all_arguments;
  if (parse_syscall_word(&cursor, &info->stack_pointer)) {
    info->has_stack_pointer = true;
  }
  if (parse_syscall_word(&cursor, &info->instruction_pointer)) {
    info->has_instruction_pointer = true;
  }
}

static void write_syscall_state(FILE *out, const struct SyscallInfo *syscall) {
  fputs("{\"state\":", out);
  json_string(out, syscall->state);
  if (syscall->has_number) {
    fprintf(out, ",\"number\":%" PRIu64 ",\"name\":", syscall->number);
    json_string(out, syscall->name);
  }
  if (syscall->has_arguments) {
    fputs(",\"arguments\":[", out);
    for (size_t i = 0; i < 6; i++) {
      if (i > 0) {
        fputc(',', out);
      }
      fprintf(out, "\"0x%llx\"", (unsigned long long)syscall->arguments[i]);
    }
    fputc(']', out);
  }
  if (syscall->has_stack_pointer) {
    fprintf(out, ",\"stackPointer\":\"0x%llx\"", (unsigned long long)syscall->stack_pointer);
  }
  if (syscall->has_instruction_pointer) {
    fprintf(out, ",\"instructionPointer\":\"0x%llx\"",
        (unsigned long long)syscall->instruction_pointer);
  }
  fputc('}', out);
}

static void write_source_registers(FILE *out, const struct ThreadCapture *thread) {
#if defined(__x86_64__)
  fputs("{\"arch\":\"amd64\",", out);
  fprintf(out,
      "\"rip\":\"0x%llx\",\"rsp\":\"0x%llx\",\"rflags\":\"0x%llx\","
      "\"rax\":\"0x%llx\",\"rbx\":\"0x%llx\",\"rcx\":\"0x%llx\",\"rdx\":\"0x%llx\","
      "\"rsi\":\"0x%llx\",\"rdi\":\"0x%llx\",\"rbp\":\"0x%llx\","
      "\"r8\":\"0x%llx\",\"r9\":\"0x%llx\",\"r10\":\"0x%llx\",\"r11\":\"0x%llx\","
      "\"r12\":\"0x%llx\",\"r13\":\"0x%llx\",\"r14\":\"0x%llx\",\"r15\":\"0x%llx\","
      "\"fsBase\":\"0x%llx\",\"gsBase\":\"0x%llx\"}",
      (unsigned long long)thread->amd64_regs.rip, (unsigned long long)thread->amd64_regs.rsp,
      (unsigned long long)thread->amd64_regs.eflags, (unsigned long long)thread->amd64_regs.rax,
      (unsigned long long)thread->amd64_regs.rbx, (unsigned long long)thread->amd64_regs.rcx,
      (unsigned long long)thread->amd64_regs.rdx, (unsigned long long)thread->amd64_regs.rsi,
      (unsigned long long)thread->amd64_regs.rdi, (unsigned long long)thread->amd64_regs.rbp,
      (unsigned long long)thread->amd64_regs.r8, (unsigned long long)thread->amd64_regs.r9,
      (unsigned long long)thread->amd64_regs.r10, (unsigned long long)thread->amd64_regs.r11,
      (unsigned long long)thread->amd64_regs.r12, (unsigned long long)thread->amd64_regs.r13,
      (unsigned long long)thread->amd64_regs.r14, (unsigned long long)thread->amd64_regs.r15,
      (unsigned long long)thread->amd64_regs.fs_base,
      (unsigned long long)thread->amd64_regs.gs_base);
#elif defined(__aarch64__)
  fputs("{\"arch\":\"arm64\",", out);
  fprintf(out, "\"pc\":\"0x%llx\",\"sp\":\"0x%llx\",\"pstate\":\"0x%llx\",\"x\":[",
      (unsigned long long)thread->arm64_regs.pc, (unsigned long long)thread->arm64_regs.sp,
      (unsigned long long)thread->arm64_regs.pstate);
  for (uint32_t i = 0; i < 31u; i++) {
    if (i != 0) {
      fputc(',', out);
    }
    fprintf(out, "\"0x%llx\"", (unsigned long long)thread->arm64_regs.regs[i]);
  }
  fputs("]}", out);
#else
  fputs("{\"arch\":\"arm64\",\"pc\":\"0x0\",\"sp\":\"0x0\",\"pstate\":\"0x0\",\"x\":[", out);
  for (uint32_t i = 0; i < 31u; i++) {
    if (i != 0) {
      fputc(',', out);
    }
    fputs("\"0x0\"", out);
  }
  fputs("]}", out);
#endif
}

static const char *thread_stack_mapping(
    const struct ThreadCapture *thread, const struct MappingCapture mappings[NATIVE_CAPTURE_MAX_MAPPINGS],
    uint32_t mapping_count) {
  uint64_t sp = 0;
#if defined(__x86_64__)
  sp = thread->amd64_regs.rsp;
#elif defined(__aarch64__)
  sp = thread->arm64_regs.sp;
#endif
  for (uint32_t i = 0; i < mapping_count; i++) {
    if (sp >= mappings[i].start && sp < mappings[i].end) {
      return mappings[i].id;
    }
  }
  return mapping_count > 0 ? mappings[0].id : "mapping:0";
}

static void write_simd_fpu_state(FILE *out, const struct ThreadCapture *thread) {
  fputs(",\"simdFpu\":", out);
  if (!thread->simd_fpu_captured) {
    fputs("{\"state\":\"not-captured\",\"reason\":\"ptrace fpstate unavailable\"}", out);
    return;
  }
  if (thread->simd_fpu_zero) {
    fputs("{\"state\":\"not-live\",\"provenance\":\"ptrace-zero-fpstate\"}", out);
    return;
  }
  fprintf(out,
      "{\"state\":\"requires-restore\",\"arch\":\"%s\",\"byteLength\":%zu,\"reason\":\"captured fpstate is non-zero\"}",
      NATIVE_CAPTURE_ARCH,
      thread->simd_fpu_size);
}

static void write_thread(const struct ThreadCapture *thread, FILE *out,
    const struct MappingCapture mappings[NATIVE_CAPTURE_MAX_MAPPINGS], uint32_t mapping_count) {
  fputs("{\"id\":", out);
  char id[64];
  snprintf(id, sizeof(id), "thread:%ld", (long)thread->tid);
  json_string(out, id);
  fprintf(out, ",\"lwpid\":%ld,\"state\":\"stopped\",\"stopReason\":\"ptrace-stop\",", (long)thread->tid);
  fputs("\"stackMapping\":", out);
  json_string(out, thread_stack_mapping(thread, mappings, mapping_count));
  fputs(",\"sourceRegisters\":", out);
  write_source_registers(out, thread);
  fputs(",\"syscall\":", out);
  write_syscall_state(out, &thread->syscall);
  fputs(",\"signal\":{\"blocked\":", out);
  write_signal_mask(out, thread->tid, "SigBlk");
  fputs(",\"pending\":", out);
  write_signal_mask(out, thread->tid, "SigPnd");
  fputs(",\"activeFrame\":false,\"altStack\":{\"state\":\"disabled\"}},\"tls\":{\"threadPointer\":", out);
#if defined(__x86_64__)
  json_hex_u64(out, thread->amd64_regs.fs_base);
  fputs(",\"sourceRegister\":\"amd64-fs-base\"", out);
#elif defined(__aarch64__)
  json_hex_u64(out, thread->arm64_tls);
  fputs(",\"sourceRegister\":\"arm64-tpidr-el0\"", out);
#else
  json_hex_u64(out, 0);
#endif
  fputs(",\"rseq\":{\"state\":\"absent\"}}", out);
  write_simd_fpu_state(out, thread);
  if (!thread->attached) {
    fputs(",\"refusal\":", out);
    write_refusal(out, "thread-state-unsupported", "ptrace register capture failed for thread");
  }
  fputc('}', out);
}

static void write_threads(const struct Options *opts,
    const struct ThreadCapture threads[NATIVE_CAPTURE_MAX_THREADS], uint32_t thread_count,
    const struct MappingCapture mappings[NATIVE_CAPTURE_MAX_MAPPINGS], uint32_t mapping_count) {
  FILE *out = open_output(opts, "native-threads.json");
  fputs("{\"formatVersion\":1,\"threads\":[", out);
  for (uint32_t i = 0; i < thread_count; i++) {
    if (i != 0) {
      fputc(',', out);
    }
    write_thread(&threads[i], out, mappings, mapping_count);
  }
  fputs("],\"refusals\":{\"vocabularyVersion\":1,\"refusals\":[", out);
  bool first = true;
  for (uint32_t i = 0; i < thread_count; i++) {
    if (threads[i].attached) {
      continue;
    }
    if (!first) {
      fputc(',', out);
    }
    first = false;
    write_refusal(out, "thread-state-unsupported", "ptrace register capture failed for thread");
  }
  fputs("]}}\n", out);
  fclose(out);
}

static const char *fd_kind(const char *target) {
  if (strncmp(target, "socket:[", 8) == 0) {
    return "socket";
  }
  if (strncmp(target, "pipe:[", 6) == 0) {
    return "pipe";
  }
  if (strncmp(target, "/dev/pts/", 9) == 0) {
    return "pty";
  }
  if (strncmp(target, "anon_inode:[eventpoll]", 22) == 0) {
    return "epoll";
  }
  if (strncmp(target, "anon_inode:[eventfd]", 20) == 0) {
    return "eventfd";
  }
  if (strncmp(target, "anon_inode:[timerfd]", 20) == 0) {
    return "timer";
  }
  if (strncmp(target, "anon_inode:[signalfd]", 21) == 0) {
    return "signalfd";
  }
  if (target[0] == '/') {
    return "file";
  }
  return "unknown";
}

static const char *fd_refusal_code(const char *kind) {
  if (streq(kind, "fd") || streq(kind, "unknown")) {
    return "fd-kind-unsupported";
  }
  if (streq(kind, "pipe") || streq(kind, "socket") || streq(kind, "epoll") ||
      streq(kind, "eventfd") || streq(kind, "timer") || streq(kind, "signal") ||
      streq(kind, "signalfd")) {
    return "kernel-state-unsupported";
  }
  return "resource-kind-unsupported";
}

static uint64_t fdinfo_value(pid_t pid, const char *fd_name, const char *field) {
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "/proc/%ld/fdinfo/%s", (long)pid, fd_name);
  FILE *file = fopen(path, "rb");
  if (!file) {
    return 0;
  }
  char wanted[32];
  snprintf(wanted, sizeof(wanted), "%s:", field);
  uint64_t value = 0;
  char line[256];
  while (fgets(line, sizeof(line), file)) {
    if (strncmp(line, wanted, strlen(wanted)) == 0) {
      char *cursor = line + strlen(wanted);
      while (*cursor && isspace((unsigned char)*cursor)) {
        cursor++;
      }
      value = strtoull(cursor, NULL, 0);
      break;
    }
  }
  fclose(file);
  return value;
}

static uint64_t fdinfo_hex_value(pid_t pid, const char *fd_name, const char *field) {
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "/proc/%ld/fdinfo/%s", (long)pid, fd_name);
  FILE *file = fopen(path, "rb");
  if (!file) {
    return 0;
  }
  char wanted[32];
  snprintf(wanted, sizeof(wanted), "%s:", field);
  uint64_t value = 0;
  char line[256];
  while (fgets(line, sizeof(line), file)) {
    if (strncmp(line, wanted, strlen(wanted)) == 0) {
      char *cursor = line + strlen(wanted);
      while (*cursor && isspace((unsigned char)*cursor)) {
        cursor++;
      }
      value = strtoull(cursor, NULL, 16);
      break;
    }
  }
  fclose(file);
  return value;
}

static uint64_t status_hex_mask_path(const char *path, const char *field) {
  FILE *file = fopen(path, "rb");
  if (!file) {
    return UINT64_MAX;
  }
  char wanted[32];
  snprintf(wanted, sizeof(wanted), "%s:", field);
  uint64_t value = UINT64_MAX;
  char line[256];
  while (fgets(line, sizeof(line), file)) {
    if (strncmp(line, wanted, strlen(wanted)) == 0) {
      char *cursor = line + strlen(wanted);
      while (*cursor && isspace((unsigned char)*cursor)) {
        cursor++;
      }
      value = strtoull(cursor, NULL, 16);
      break;
    }
  }
  fclose(file);
  return value;
}

static bool pending_signals_empty(pid_t pid) {
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "/proc/%ld/status", (long)pid);
  if (status_hex_mask_path(path, "SigPnd") != 0 || status_hex_mask_path(path, "ShdPnd") != 0) {
    return false;
  }
  snprintf(path, sizeof(path), "/proc/%ld/task", (long)pid);
  DIR *dir = opendir(path);
  if (!dir) {
    return false;
  }
  struct dirent *entry = NULL;
  while ((entry = readdir(dir)) != NULL) {
    if (!isdigit((unsigned char)entry->d_name[0])) {
      continue;
    }
    char task_status[PATH_MAX];
    snprintf(task_status, sizeof(task_status), "/proc/%ld/task/%s/status", (long)pid, entry->d_name);
    if (status_hex_mask_path(task_status, "SigPnd") != 0) {
      closedir(dir);
      return false;
    }
  }
  closedir(dir);
  return true;
}

static void fdinfo_pair_value(pid_t pid, const char *fd_name, const char *field,
    uint64_t *first, uint64_t *second) {
  *first = 0;
  *second = 0;
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "/proc/%ld/fdinfo/%s", (long)pid, fd_name);
  FILE *file = fopen(path, "rb");
  if (!file) {
    return;
  }
  char wanted[32];
  snprintf(wanted, sizeof(wanted), "%s:", field);
  char line[256];
  while (fgets(line, sizeof(line), file)) {
    if (strncmp(line, wanted, strlen(wanted)) == 0) {
      char *cursor = line + strlen(wanted);
      while (*cursor && !isdigit((unsigned char)*cursor)) {
        cursor++;
      }
      *first = strtoull(cursor, &cursor, 0);
      while (*cursor && !isdigit((unsigned char)*cursor)) {
        cursor++;
      }
      *second = strtoull(cursor, NULL, 0);
      break;
    }
  }
  fclose(file);
}

static void write_epoll_recipe(FILE *out, pid_t pid, const char *fd_name) {
  char path[PATH_MAX];
  snprintf(path, sizeof(path), "/proc/%ld/fdinfo/%s", (long)pid, fd_name);
  FILE *file = fopen(path, "rb");
  fputs(",\"recipe\":{\"epollModel\":\"interest-list-v1\",\"watches\":[", out);
  bool first = true;
  if (file) {
    char line[512];
    while (fgets(line, sizeof(line), file)) {
      char *tfd_field = strstr(line, "tfd:");
      char *events_field = strstr(line, "events:");
      char *data_field = strstr(line, "data:");
      if (!tfd_field || !events_field || !data_field) {
        continue;
      }
      uint64_t tfd = strtoull(tfd_field + strlen("tfd:"), NULL, 10);
      uint64_t events = strtoull(events_field + strlen("events:"), NULL, 16);
      uint64_t data = strtoull(data_field + strlen("data:"), NULL, 16);
      if (!first) {
        fputc(',', out);
      }
      first = false;
      fprintf(out, "{\"fd\":%" PRIu64 ",\"events\":%" PRIu64 ",\"data\":", tfd, events);
      json_hex_u64(out, data);
      fputc('}', out);
    }
    fclose(file);
  }
  fputs("]}", out);
}

static void write_signalfd_recipe(FILE *out, pid_t pid, const char *fd_name) {
  uint64_t fd_flags = fdinfo_value(pid, fd_name, "flags");
  fputs(",\"recipe\":{\"signalfdModel\":\"empty-queue-v1\",\"signalMask\":", out);
  json_hex_u64(out, fdinfo_hex_value(pid, fd_name, "sigmask"));
  fprintf(out,
      ",\"flags\":%" PRIu64
      ",\"pendingSignals\":\"%s\""
      ",\"queuedSiginfo\":\"%s\""
      ",\"activeSignalFrame\":false"
      ",\"altStackState\":\"disabled\"}",
      fd_flags & 04000u,
      pending_signals_empty(pid) ? "none" : "unknown",
      pending_signals_empty(pid) ? "empty" : "unknown");
}

static void write_fd_resource(FILE *out, pid_t pid, const char *fd_name, const char *target,
    bool *first) {
  if (!*first) {
    fputc(',', out);
  }
  *first = false;
  const char *kind = fd_kind(target);
  fputs("{\"id\":", out);
  char id[64];
  snprintf(id, sizeof(id), "fd:%s", fd_name);
  json_string(out, id);
  fputs(",\"kind\":", out);
  json_string(out, kind);
  const char *state = streq(kind, "file") ? "recipe" : ((streq(kind, "epoll") || streq(kind, "signalfd") || streq(kind, "timer")) ? "captured" : "refused");
  fprintf(out, ",\"state\":");
  json_string(out, state);
  fprintf(out, ",\"fd\":%s", fd_name);
  fputs(",\"path\":", out);
  json_string(out, target);
  fprintf(out, ",\"offset\":%" PRIu64 ",\"flags\":[", fdinfo_value(pid, fd_name, "pos"));
  char flags[64];
  snprintf(flags, sizeof(flags), "octal:%llo", (unsigned long long)fdinfo_value(pid, fd_name, "flags"));
  json_string(out, flags);
  fputc(']', out);
  if (streq(kind, "eventfd")) {
    fputs(",\"recipe\":{\"eventfdCount\":", out);
    json_hex_u64(out, fdinfo_value(pid, fd_name, "eventfd-count"));
    fprintf(out,
        ",\"eventfdSemaphore\":%" PRIu64,
        fdinfo_value(pid, fd_name, "eventfd-semaphore"));
    fputs("}", out);
  }
  if (streq(kind, "timer")) {
    uint64_t value_sec = 0;
    uint64_t value_nsec = 0;
    uint64_t interval_sec = 0;
    uint64_t interval_nsec = 0;
    fdinfo_pair_value(pid, fd_name, "it_value", &value_sec, &value_nsec);
    fdinfo_pair_value(pid, fd_name, "it_interval", &interval_sec, &interval_nsec);
    fputs(",\"recipe\":{\"timerfdModel\":\"descriptor-v1\",\"timerfdClockId\":", out);
    json_hex_u64(out, fdinfo_value(pid, fd_name, "clockid"));
    fputs(",\"timerfdTicks\":", out);
    json_hex_u64(out, fdinfo_value(pid, fd_name, "ticks"));
    fprintf(out,
        ",\"timerfdSettimeFlags\":%" PRIu64
        ",\"timerfdValueSeconds\":%" PRIu64
        ",\"timerfdValueNanoseconds\":%" PRIu64
        ",\"timerfdIntervalSeconds\":%" PRIu64
        ",\"timerfdIntervalNanoseconds\":%" PRIu64,
        fdinfo_value(pid, fd_name, "settime flags"),
        value_sec,
        value_nsec,
        interval_sec,
        interval_nsec);
    fputs("}", out);
  }
  if (streq(kind, "epoll")) {
    write_epoll_recipe(out, pid, fd_name);
  }
  if (streq(kind, "signalfd")) {
    write_signalfd_recipe(out, pid, fd_name);
  }
  if (streq(kind, "file")) {
    fputs(",\"recipe\":{\"reopen\":", out);
    json_string(out, target);
    fputs("}", out);
  } else if (!streq(kind, "epoll") && !streq(kind, "signalfd") && !streq(kind, "timer")) {
    fputs(",\"refusal\":", out);
    write_refusal(out, fd_refusal_code(kind), "fd kind needs a resource broker recipe");
  }
  fputc('}', out);
}

static void write_resources(const struct Options *opts, pid_t pid, const struct ProcessInfo *info) {
  FILE *out = open_output(opts, "native-resources.json");
  fputs("{\"formatVersion\":1,\"resources\":[", out);
  bool first = true;
#define RESOURCE_PREFIX()                                                                            \
  do {                                                                                                \
    if (!first) {                                                                                     \
      fputc(',', out);                                                                                \
    }                                                                                                 \
    first = false;                                                                                    \
  } while (0)

  RESOURCE_PREFIX();
  fputs("{\"id\":\"argv\",\"kind\":\"argv\",\"state\":\"captured\",\"recipe\":{\"argv\":", out);
  write_json_string_array(out, info->argv, info->argc);
  fputs("}}", out);
  RESOURCE_PREFIX();
  fputs("{\"id\":\"env\",\"kind\":\"env\",\"state\":\"captured\",\"recipe\":{\"env\":", out);
  write_json_env(out, info);
  fputs("}}", out);
  RESOURCE_PREFIX();
  fputs("{\"id\":\"cwd\",\"kind\":\"cwd\",\"state\":\"recipe\",\"path\":", out);
  json_string(out, info->cwd);
  fputs(",\"recipe\":{\"cwd\":", out);
  json_string(out, info->cwd);
  fputs("}}", out);
  RESOURCE_PREFIX();
  fputs("{\"id\":\"exe\",\"kind\":\"exe\",\"state\":\"captured\",\"path\":", out);
  json_string(out, info->exe);
  fputs("}", out);
  RESOURCE_PREFIX();
  fputs("{\"id\":\"auxv\",\"kind\":\"auxv\",\"state\":\"captured\",\"recipe\":{\"bytesHex\":", out);
  json_string(out, info->auxv_hex);
  fputs("}}", out);

  char fd_dir_path[PATH_MAX];
  proc_path(fd_dir_path, pid, "fd");
  DIR *dir = opendir(fd_dir_path);
  if (!dir) {
    die("open proc fd");
  }
  uint32_t fd_count = 0;
  for (;;) {
    struct dirent *entry = readdir(dir);
    if (!entry) {
      break;
    }
    if (entry->d_name[0] == '.') {
      continue;
    }
    if (++fd_count > NATIVE_CAPTURE_MAX_FDS) {
      fail("too many fds");
    }
    char link_path[PATH_MAX];
    int link_written = snprintf(link_path, sizeof(link_path), "%s/%s", fd_dir_path, entry->d_name);
    if (link_written < 0 || link_written >= (int)sizeof(link_path)) {
      fail("fd link path too long");
    }
    char target[PATH_MAX];
    ssize_t len = readlink(link_path, target, sizeof(target) - 1u);
    if (len < 0) {
      continue;
    }
    target[len] = '\0';
    write_fd_resource(out, pid, entry->d_name, target, &first);
  }
  closedir(dir);
#undef RESOURCE_PREFIX
  fputs("],\"refusals\":{\"vocabularyVersion\":1,\"refusals\":[]}}\n", out);
  fclose(out);
}

static void write_translation(const struct Options *opts,
    const struct ThreadCapture threads[NATIVE_CAPTURE_MAX_THREADS], uint32_t thread_count) {
  FILE *out = open_output(opts, "native-translation.json");
  fputs("{\"formatVersion\":1,\"mode\":\"native-cross-isa\",\"sourceArch\":", out);
  json_string(out, NATIVE_CAPTURE_ARCH);
  fputs(",\"targetArch\":", out);
  json_string(out, opts->target_arch);
  fputs(",\"codeLocations\":[],\"threads\":[", out);
  for (uint32_t i = 0; i < thread_count; i++) {
    if (i != 0) {
      fputc(',', out);
    }
    char id[64];
    snprintf(id, sizeof(id), "thread:%ld", (long)threads[i].tid);
    fputs("{\"sourceThreadId\":", out);
    json_string(out, id);
    fputs(",\"state\":\"pending\"}", out);
  }
  fputs("],\"memoryRelocations\":[],\"refusals\":{\"vocabularyVersion\":1,\"refusals\":[]}}\n", out);
  fclose(out);
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  ensure_output_dir(opts.output_dir);
  pid_t pid = launch_target(&opts, argv);

  struct ThreadCapture threads[NATIVE_CAPTURE_MAX_THREADS];
  uint32_t thread_count = attach_threads(pid, threads, opts.trace_syscall ? pid : -1);
  struct ProcessInfo info = read_process_info(pid);
  struct MappingCapture mappings[NATIVE_CAPTURE_MAX_MAPPINGS];
  uint32_t mapping_count = parse_maps(pid, mappings);
  capture_mapping_memory(pid, mappings, mapping_count, &opts);

  write_manifest(&opts, pid, &info);
  write_mappings(&opts, mappings, mapping_count);
  write_threads(&opts, threads, thread_count, mappings, mapping_count);
  write_resources(&opts, pid, &info);
  write_translation(&opts, threads, thread_count);

  detach_threads(threads, thread_count);
  cleanup_target(&opts, pid);
  return 0;
}
