// External raw process capturer for the controlled binary corpus.
//
// The target program does not link against Machinen and does not write a
// portable bundle. This helper launches it, waits for a SIGSTOP observation
// point, and captures Linux process state through ptrace and /proc.

#define _GNU_SOURCE

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
#include <sys/types.h>
#include <sys/uio.h>
#include <sys/wait.h>
#include <unistd.h>

#define RAW_CAPTURE_MAX_SYMBOLS 32u
#define RAW_CAPTURE_MAX_THREADS 64u
#define RAW_CAPTURE_MAX_ARGV 128u
#define RAW_CAPTURE_REG_BYTES 1024u
#define RAW_CAPTURE_CONTROLLED_NODE_SIZE 16u
#define RAW_CAPTURE_CONTROLLED_HEAP_STATE_SIZE 24u
#define RAW_CAPTURE_CONTROLLED_MAX_NODES 64u

#if defined(__aarch64__)
#define RAW_CAPTURE_ARCH "arm64"
#elif defined(__x86_64__)
#define RAW_CAPTURE_ARCH "amd64"
#else
#define RAW_CAPTURE_ARCH "unknown"
#endif

struct CaptureSymbol {
  char name[128];
  uint64_t address;
  uint64_t size_bytes;
};

struct Options {
  const char *output_dir;
  struct CaptureSymbol symbols[RAW_CAPTURE_MAX_SYMBOLS];
  uint32_t symbol_count;
  int command_index;
};

static void die(const char *message) {
  fprintf(stderr, "machinen-raw-capture: %s: %s\n", message, strerror(errno));
  exit(1);
}

static void fail(const char *message) {
  fprintf(stderr, "machinen-raw-capture: %s\n", message);
  exit(1);
}

static bool streq(const char *a, const char *b) {
  return strcmp(a, b) == 0;
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

static FILE *open_output(const char *dir, const char *name) {
  char path[PATH_MAX];
  path_join(path, dir, name);
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

static void hex_bytes(FILE *file, const uint8_t *bytes, uint64_t len) {
  static const char alphabet[] = "0123456789abcdef";
  fputc('"', file);
  for (uint64_t i = 0; i < len; i++) {
    fputc(alphabet[bytes[i] >> 4], file);
    fputc(alphabet[bytes[i] & 0x0fu], file);
  }
  fputc('"', file);
}

static uint64_t parse_u64(const char *value, const char *field) {
  errno = 0;
  char *end = NULL;
  uint64_t parsed = strtoull(value, &end, 0);
  if (errno != 0 || end == value || *end != '\0') {
    fprintf(stderr, "machinen-raw-capture: invalid %s: %s\n", field, value);
    exit(2);
  }
  return parsed;
}

static void parse_symbol(struct Options *opts, const char *spec) {
  if (opts->symbol_count >= RAW_CAPTURE_MAX_SYMBOLS) {
    fail("too many symbols");
  }

  char scratch[256];
  if (snprintf(scratch, sizeof(scratch), "%s", spec) >= (int)sizeof(scratch)) {
    fail("symbol spec too long");
  }

  char *first = strchr(scratch, ':');
  char *second = first ? strchr(first + 1, ':') : NULL;
  if (!first || !second) {
    fail("--symbol must be name:address:size");
  }
  *first = '\0';
  *second = '\0';

  struct CaptureSymbol *symbol = &opts->symbols[opts->symbol_count++];
  if (snprintf(symbol->name, sizeof(symbol->name), "%s", scratch) >= (int)sizeof(symbol->name)) {
    fail("symbol name too long");
  }
  symbol->address = parse_u64(first + 1, "symbol address");
  symbol->size_bytes = parse_u64(second + 1, "symbol size");
}

static void usage(const char *argv0) {
  fprintf(stderr,
      "usage: %s --output dir [--symbol name:address:size ...] -- program [args...]\n", argv0);
}

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {0};
  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--output")) {
      if (i + 1 >= argc) {
        usage(argv[0]);
        exit(2);
      }
      opts.output_dir = argv[++i];
    } else if (streq(argv[i], "--symbol")) {
      if (i + 1 >= argc) {
        usage(argv[0]);
        exit(2);
      }
      parse_symbol(&opts, argv[++i]);
    } else if (streq(argv[i], "--")) {
      opts.command_index = i + 1;
      break;
    } else if (streq(argv[i], "--help") || streq(argv[i], "-h")) {
      usage(argv[0]);
      exit(0);
    } else {
      fprintf(stderr, "machinen-raw-capture: unknown argument: %s\n", argv[i]);
      usage(argv[0]);
      exit(2);
    }
  }

  if (!opts.output_dir || opts.command_index <= 0 || opts.command_index >= argc) {
    usage(argv[0]);
    exit(2);
  }
  return opts;
}

static void ensure_output_dir(const char *path) {
  if (mkdir(path, 0777) != 0 && errno != EEXIST) {
    die("mkdir output dir");
  }
}

static void redirect_child_logs(const char *output_dir) {
  char path[PATH_MAX];
  path_join(path, output_dir, "target.log");
  int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0666);
  if (fd < 0) {
    _exit(127);
  }
  if (dup2(fd, STDOUT_FILENO) < 0 || dup2(fd, STDERR_FILENO) < 0) {
    _exit(127);
  }
  if (fd > STDERR_FILENO) {
    close(fd);
  }
}

static pid_t launch_target(const struct Options *opts, char **argv) {
  pid_t child = fork();
  if (child < 0) {
    die("fork");
  }
  if (child == 0) {
    redirect_child_logs(opts->output_dir);
    execvp(argv[opts->command_index], &argv[opts->command_index]);
    _exit(127);
  }
  return child;
}

static void wait_for_observation_stop(pid_t child) {
  for (;;) {
    int status = 0;
    pid_t got = waitpid(child, &status, WUNTRACED);
    if (got < 0) {
      die("wait for child stop");
    }
    if (WIFSTOPPED(status)) {
      return;
    }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      fail("target exited before observation stop");
    }
  }
}

static void cleanup_child(pid_t child) {
  kill(child, SIGKILL);
  for (;;) {
    int status = 0;
    pid_t got = waitpid(child, &status, 0);
    if (got == child) {
      return;
    }
    if (got < 0 && errno == ECHILD) {
      return;
    }
    if (got < 0 && errno != EINTR) {
      die("wait for child cleanup");
    }
  }
}

static void write_manifest(const struct Options *opts, char **argv, pid_t child) {
  FILE *file = open_output(opts->output_dir, "manifest.json");
  fprintf(file,
      "{\"formatVersion\":1,\"capturer\":\"machinen-raw-process-capture\","
      "\"hostArch\":\"%s\",\"pid\":%ld,\"stopSignal\":\"SIGSTOP\",\"target\":{",
      RAW_CAPTURE_ARCH, (long)child);
  fputs("\"path\":", file);
  json_string(file, argv[opts->command_index]);
  fputs(",\"argv\":[", file);
  for (int i = opts->command_index; argv[i]; i++) {
    if (i != opts->command_index) {
      fputc(',', file);
    }
    json_string(file, argv[i]);
  }
  fputs("]}}\n", file);
  fclose(file);
}

static void write_symbols(const struct Options *opts) {
  FILE *file = open_output(opts->output_dir, "symbols.json");
  fputs("{\"formatVersion\":1,\"symbols\":[", file);
  for (uint32_t i = 0; i < opts->symbol_count; i++) {
    const struct CaptureSymbol *symbol = &opts->symbols[i];
    if (i != 0) {
      fputc(',', file);
    }
    fputs("{\"name\":", file);
    json_string(file, symbol->name);
    fprintf(file, ",\"address\":\"0x%" PRIx64 "\",\"sizeBytes\":%" PRIu64 "}",
        symbol->address, symbol->size_bytes);
  }
  fputs("]}\n", file);
  fclose(file);
}

static void trim_newline(char *line) {
  size_t len = strlen(line);
  while (len > 0 && (line[len - 1] == '\n' || line[len - 1] == '\r')) {
    line[--len] = '\0';
  }
}

static void write_maps(const struct Options *opts, pid_t child) {
  char path[PATH_MAX];
  proc_path(path, child, "maps");
  FILE *input = fopen(path, "rb");
  if (!input) {
    die("open proc maps");
  }

  FILE *output = open_output(opts->output_dir, "maps.json");
  fputs("{\"formatVersion\":1,\"maps\":[", output);

  char line[4096];
  bool first = true;
  while (fgets(line, sizeof(line), input)) {
    trim_newline(line);
    unsigned long start = 0;
    unsigned long end = 0;
    unsigned long offset = 0;
    unsigned long inode = 0;
    char perms[8] = {0};
    char dev[32] = {0};
    int path_offset = 0;
    int matched = sscanf(line, "%lx-%lx %7s %lx %31s %lu %n", &start, &end, perms, &offset, dev,
        &inode, &path_offset);
    if (matched < 6) {
      continue;
    }
    const char *map_path = line + path_offset;
    if (!first) {
      fputc(',', output);
    }
    first = false;
    fprintf(output,
        "{\"start\":\"0x%lx\",\"end\":\"0x%lx\",\"perms\":\"%s\","
        "\"offset\":\"0x%lx\",\"dev\":",
        start, end, perms, offset);
    json_string(output, dev);
    fprintf(output, ",\"inode\":%lu,\"path\":", inode);
    json_string(output, map_path);
    fprintf(output, ",\"readable\":%s,\"writable\":%s,\"executable\":%s}",
        perms[0] == 'r' ? "true" : "false", perms[1] == 'w' ? "true" : "false",
        perms[2] == 'x' ? "true" : "false");
  }

  fputs("]}\n", output);
  fclose(output);
  fclose(input);
}

static void write_fds(const struct Options *opts, pid_t child) {
  char path[PATH_MAX];
  proc_path(path, child, "fd");
  DIR *dir = opendir(path);
  if (!dir) {
    die("open proc fd");
  }

  FILE *output = open_output(opts->output_dir, "fds.json");
  fputs("{\"formatVersion\":1,\"fds\":[", output);
  bool first = true;
  for (;;) {
    struct dirent *entry = readdir(dir);
    if (!entry) {
      break;
    }
    if (entry->d_name[0] == '.') {
      continue;
    }

    char link_path[PATH_MAX];
    char target[PATH_MAX];
    int written = snprintf(link_path, sizeof(link_path), "%s/%s", path, entry->d_name);
    if (written < 0 || written >= (int)sizeof(link_path)) {
      fail("fd path too long");
    }
    ssize_t len = readlink(link_path, target, sizeof(target) - 1u);
    if (len < 0) {
      continue;
    }
    target[len] = '\0';

    if (!first) {
      fputc(',', output);
    }
    first = false;
    fprintf(output, "{\"fd\":%ld,\"target\":", strtol(entry->d_name, NULL, 10));
    json_string(output, target);
    fputc('}', output);
  }
  fputs("]}\n", output);
  fclose(output);
  closedir(dir);
}

static int compare_pid(const void *left, const void *right) {
  pid_t a = *(const pid_t *)left;
  pid_t b = *(const pid_t *)right;
  return (a > b) - (a < b);
}

static uint32_t list_threads(pid_t child, pid_t tids[RAW_CAPTURE_MAX_THREADS]) {
  char path[PATH_MAX];
  proc_path(path, child, "task");
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
    if (count >= RAW_CAPTURE_MAX_THREADS) {
      fail("too many target threads");
    }
    tids[count++] = (pid_t)strtol(entry->d_name, NULL, 10);
  }
  closedir(dir);
  qsort(tids, count, sizeof(tids[0]), compare_pid);
  return count;
}

static bool attach_thread(pid_t tid) {
  if (ptrace(PTRACE_ATTACH, tid, NULL, NULL) != 0) {
    return false;
  }
  for (;;) {
    int status = 0;
    pid_t got = waitpid(tid, &status, __WALL);
    if (got == tid && WIFSTOPPED(status)) {
      return true;
    }
    if (got < 0 && errno == EINTR) {
      continue;
    }
    return false;
  }
}

static uint64_t get_register_bytes(pid_t tid, uint8_t registers[RAW_CAPTURE_REG_BYTES]) {
  struct iovec iov = {.iov_base = registers, .iov_len = RAW_CAPTURE_REG_BYTES};
  memset(registers, 0, RAW_CAPTURE_REG_BYTES);
  if (ptrace(PTRACE_GETREGSET, tid, (void *)NT_PRSTATUS, &iov) != 0) {
    return 0;
  }
  return (uint64_t)iov.iov_len;
}

static void detach_thread(pid_t tid) {
  if (ptrace(PTRACE_DETACH, tid, NULL, (void *)(uintptr_t)SIGSTOP) != 0) {
    die("ptrace detach");
  }
}

static void write_threads(const struct Options *opts, pid_t child) {
  pid_t tids[RAW_CAPTURE_MAX_THREADS];
  uint32_t count = list_threads(child, tids);
  FILE *output = open_output(opts->output_dir, "threads.json");
  fputs("{\"formatVersion\":1,\"threads\":[", output);

  for (uint32_t i = 0; i < count; i++) {
    uint8_t registers[RAW_CAPTURE_REG_BYTES];
    bool attached = attach_thread(tids[i]);
    uint64_t register_bytes = attached ? get_register_bytes(tids[i], registers) : 0;

    if (i != 0) {
      fputc(',', output);
    }
    fprintf(output, "{\"tid\":%ld,\"registers\":{\"arch\":\"%s\",", (long)tids[i],
        RAW_CAPTURE_ARCH);
    fprintf(output, "\"set\":\"NT_PRSTATUS\",\"sizeBytes\":%" PRIu64 ",\"bytes\":",
        register_bytes);
    hex_bytes(output, registers, register_bytes);
    if (!attached) {
      fputs(",\"error\":\"ptrace-attach-failed\"", output);
    } else if (register_bytes == 0) {
      fputs(",\"error\":\"ptrace-getregset-failed\"", output);
    }
    fputs("}}", output);

    if (attached) {
      detach_thread(tids[i]);
    }
  }

  fputs("]}\n", output);
  fclose(output);
}

static uint64_t read_u64_native(const uint8_t *bytes) {
  uint64_t value = 0;
  memcpy(&value, bytes, sizeof(value));
  return value;
}

static void read_process_memory(int mem_fd, uint64_t address, uint8_t *buffer, uint64_t size_bytes) {
  ssize_t got = pread(mem_fd, buffer, (size_t)size_bytes, (off_t)address);
  if (got < 0 || (uint64_t)got != size_bytes) {
    fail("failed to read process memory");
  }
}

static void append_memory_chunk(FILE *json, FILE *bin, bool *first, uint64_t *file_offset,
    const char *name, uint64_t source_address, const uint8_t *buffer, uint64_t size_bytes) {
  if (fwrite(buffer, 1u, (size_t)size_bytes, bin) != size_bytes) {
    die("write memory.bin");
  }
  if (!*first) {
    fputc(',', json);
  }
  *first = false;
  fputs("{\"name\":", json);
  json_string(json, name);
  fprintf(json,
      ",\"sourceAddress\":\"0x%" PRIx64 "\",\"sizeBytes\":%" PRIu64
      ",\"fileOffset\":%" PRIu64 "}",
      source_address, size_bytes, *file_offset);
  *file_offset += size_bytes;
}

static void append_controlled_heap_nodes(FILE *json, FILE *bin, bool *first, uint64_t *file_offset,
    int mem_fd, const uint8_t *heap_state, uint64_t heap_state_size) {
  if (heap_state_size < RAW_CAPTURE_CONTROLLED_HEAP_STATE_SIZE) {
    fail("controlled heap state chunk is too small");
  }

  uint64_t node_address = read_u64_native(heap_state);
  uint64_t node_count = read_u64_native(heap_state + 8u);
  if (node_count > RAW_CAPTURE_CONTROLLED_MAX_NODES) {
    fail("controlled heap node count too large");
  }

  for (uint64_t i = 0; i < node_count && node_address != 0; i++) {
    uint8_t node[RAW_CAPTURE_CONTROLLED_NODE_SIZE];
    char name[64];
    read_process_memory(mem_fd, node_address, node, sizeof(node));
    int written = snprintf(name, sizeof(name), "machinen_controlled_node_%" PRIu64, i);
    if (written < 0 || written >= (int)sizeof(name)) {
      fail("controlled node name too long");
    }
    append_memory_chunk(json, bin, first, file_offset, name, node_address, node, sizeof(node));
    node_address = read_u64_native(node + 8u);
  }
}

static void append_symbol_memory(FILE *json, FILE *bin, bool *first, uint64_t *file_offset,
    int mem_fd, const struct CaptureSymbol *symbol) {
  if (symbol->size_bytes > 1024u * 1024u) {
    fail("symbol capture too large");
  }
  uint8_t *buffer = malloc((size_t)symbol->size_bytes);
  if (!buffer) {
    die("malloc memory chunk");
  }
  read_process_memory(mem_fd, symbol->address, buffer, symbol->size_bytes);
  append_memory_chunk(json, bin, first, file_offset, symbol->name, symbol->address, buffer,
      symbol->size_bytes);
  if (streq(symbol->name, "machinen_controlled_heap_state")) {
    append_controlled_heap_nodes(json, bin, first, file_offset, mem_fd, buffer, symbol->size_bytes);
  }
  free(buffer);
}

static void write_memory(const struct Options *opts, pid_t child) {
  char mem_path[PATH_MAX];
  proc_path(mem_path, child, "mem");
  int mem_fd = open(mem_path, O_RDONLY);
  if (mem_fd < 0) {
    die("open proc mem");
  }

  char bin_path[PATH_MAX];
  path_join(bin_path, opts->output_dir, "memory.bin");
  FILE *bin = fopen(bin_path, "wb");
  if (!bin) {
    die("open memory.bin");
  }
  FILE *json = open_output(opts->output_dir, "memory.json");
  fputs("{\"formatVersion\":1,\"chunks\":[", json);

  bool first = true;
  uint64_t file_offset = 0;
  for (uint32_t i = 0; i < opts->symbol_count; i++) {
    append_symbol_memory(json, bin, &first, &file_offset, mem_fd, &opts->symbols[i]);
  }

  fputs("]}\n", json);
  fclose(json);
  fclose(bin);
  close(mem_fd);
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  ensure_output_dir(opts.output_dir);

  pid_t child = launch_target(&opts, argv);
  wait_for_observation_stop(child);

  write_manifest(&opts, argv, child);
  write_symbols(&opts);
  write_maps(&opts, child);
  write_fds(&opts, child);
  write_threads(&opts, child);
  write_memory(&opts, child);

  cleanup_child(child);
  return 0;
}
