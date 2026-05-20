// Target mapping materializer proof helper.
//
// The helper does not jump into translated code. It only applies a small native
// process-image mapping plan: file-backed text from a target artifact, copied
// anonymous data/heap bytes from native-memory.bin, recreated stack/kernel-style
// mappings, and final permission checks through /proc/self/maps.

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#ifndef MAP_FIXED_NOREPLACE
#define MAP_FIXED_NOREPLACE 0x100000
#endif

struct Options {
  const char *memory;
  const char *text_file;
  const char *expect_text_prefix;
  uint64_t text_target_start;
  uint64_t text_size;
  uint64_t data_offset;
  uint64_t data_target_start;
  uint64_t data_size;
  uint64_t expect_data_word0;
  uint64_t heap_offset;
  uint64_t heap_target_start;
  uint64_t heap_size;
  uint64_t expect_heap_word0;
  uint64_t stack_target_start;
  uint64_t stack_size;
  uint64_t recreate_target_start;
  uint64_t recreate_size;
};

static void usage(void) {
  fprintf(stderr,
      "usage: native-mapping-materializer --memory path --text-file path "
      "--text-target-start addr --text-size n --expect-text-prefix text "
      "--data-offset n --data-target-start addr --data-size n --expect-data-word0 n "
      "--heap-offset n --heap-target-start addr --heap-size n --expect-heap-word0 n "
      "--stack-target-start addr --stack-size n --recreate-target-start addr "
      "--recreate-size n\n");
  exit(2);
}

static bool streq(const char *left, const char *right) {
  return strcmp(left, right) == 0;
}

static uint64_t parse_u64(const char *value, const char *field) {
  errno = 0;
  char *end = NULL;
  uint64_t parsed = strtoull(value, &end, 0);
  if (errno != 0 || end == value || *end != '\0') {
    fprintf(stderr, "native-mapping-materializer: invalid %s: %s\n", field, value);
    exit(2);
  }
  return parsed;
}

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {0};
  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--memory")) {
      if (++i >= argc) usage();
      opts.memory = argv[i];
    } else if (streq(argv[i], "--text-file")) {
      if (++i >= argc) usage();
      opts.text_file = argv[i];
    } else if (streq(argv[i], "--text-target-start")) {
      if (++i >= argc) usage();
      opts.text_target_start = parse_u64(argv[i], "text-target-start");
    } else if (streq(argv[i], "--text-size")) {
      if (++i >= argc) usage();
      opts.text_size = parse_u64(argv[i], "text-size");
    } else if (streq(argv[i], "--expect-text-prefix")) {
      if (++i >= argc) usage();
      opts.expect_text_prefix = argv[i];
    } else if (streq(argv[i], "--data-offset")) {
      if (++i >= argc) usage();
      opts.data_offset = parse_u64(argv[i], "data-offset");
    } else if (streq(argv[i], "--data-target-start")) {
      if (++i >= argc) usage();
      opts.data_target_start = parse_u64(argv[i], "data-target-start");
    } else if (streq(argv[i], "--data-size")) {
      if (++i >= argc) usage();
      opts.data_size = parse_u64(argv[i], "data-size");
    } else if (streq(argv[i], "--expect-data-word0")) {
      if (++i >= argc) usage();
      opts.expect_data_word0 = parse_u64(argv[i], "expect-data-word0");
    } else if (streq(argv[i], "--heap-offset")) {
      if (++i >= argc) usage();
      opts.heap_offset = parse_u64(argv[i], "heap-offset");
    } else if (streq(argv[i], "--heap-target-start")) {
      if (++i >= argc) usage();
      opts.heap_target_start = parse_u64(argv[i], "heap-target-start");
    } else if (streq(argv[i], "--heap-size")) {
      if (++i >= argc) usage();
      opts.heap_size = parse_u64(argv[i], "heap-size");
    } else if (streq(argv[i], "--expect-heap-word0")) {
      if (++i >= argc) usage();
      opts.expect_heap_word0 = parse_u64(argv[i], "expect-heap-word0");
    } else if (streq(argv[i], "--stack-target-start")) {
      if (++i >= argc) usage();
      opts.stack_target_start = parse_u64(argv[i], "stack-target-start");
    } else if (streq(argv[i], "--stack-size")) {
      if (++i >= argc) usage();
      opts.stack_size = parse_u64(argv[i], "stack-size");
    } else if (streq(argv[i], "--recreate-target-start")) {
      if (++i >= argc) usage();
      opts.recreate_target_start = parse_u64(argv[i], "recreate-target-start");
    } else if (streq(argv[i], "--recreate-size")) {
      if (++i >= argc) usage();
      opts.recreate_size = parse_u64(argv[i], "recreate-size");
    } else {
      usage();
    }
  }
  if (!opts.memory || !opts.text_file || !opts.expect_text_prefix || opts.text_size == 0 ||
      opts.data_size == 0 || opts.heap_size == 0 || opts.stack_size == 0 ||
      opts.recreate_size == 0) {
    usage();
  }
  return opts;
}

#if defined(__linux__)

static void validate_page_aligned(uint64_t value, const char *field) {
  long page_size = sysconf(_SC_PAGESIZE);
  if (page_size <= 0 || value % (uint64_t)page_size != 0) {
    fprintf(stderr, "native-mapping-materializer: %s must be page-aligned\n", field);
    exit(2);
  }
}

static void *map_fixed(uint64_t target_start, uint64_t size, int prot, const char *label) {
  validate_page_aligned(target_start, label);
  validate_page_aligned(size, label);
  void *target = (void *)(uintptr_t)target_start;
  void *mapped = mmap(
      target, (size_t)size, prot, MAP_PRIVATE | MAP_ANONYMOUS | MAP_FIXED_NOREPLACE, -1, 0);
  if (mapped == MAP_FAILED) {
    fprintf(stderr,
        "native-mapping-materializer: %s mmap at 0x%" PRIx64 " failed: %s\n",
        label,
        target_start,
        strerror(errno));
    exit(1);
  }
  if (mapped != target) {
    fprintf(stderr, "native-mapping-materializer: %s mmap returned wrong address\n", label);
    exit(1);
  }
  return mapped;
}

static void read_exact(int fd, void *dst, uint64_t size, uint64_t offset) {
  uint8_t *bytes = dst;
  uint64_t cursor = 0;
  while (cursor < size) {
    ssize_t got = pread(fd, bytes + cursor, (size_t)(size - cursor), (off_t)(offset + cursor));
    if (got < 0) {
      fprintf(stderr, "native-mapping-materializer: read failed: %s\n", strerror(errno));
      exit(1);
    }
    if (got == 0) {
      fprintf(stderr, "native-mapping-materializer: short read\n");
      exit(1);
    }
    cursor += (uint64_t)got;
  }
}

static void *map_file_text(const struct Options *opts) {
  int fd = open(opts->text_file, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr, "native-mapping-materializer: open text file failed: %s\n", strerror(errno));
    exit(1);
  }
  validate_page_aligned(opts->text_target_start, "text");
  validate_page_aligned(opts->text_size, "text");
  void *target = (void *)(uintptr_t)opts->text_target_start;
  void *mapped = mmap(target,
      (size_t)opts->text_size,
      PROT_READ,
      MAP_PRIVATE | MAP_FIXED_NOREPLACE,
      fd,
      0);
  close(fd);
  if (mapped == MAP_FAILED) {
    fprintf(stderr, "native-mapping-materializer: text mmap failed: %s\n", strerror(errno));
    exit(1);
  }
  if (mapped != target) {
    fprintf(stderr, "native-mapping-materializer: text mmap returned wrong address\n");
    exit(1);
  }
  if (memcmp(mapped, opts->expect_text_prefix, strlen(opts->expect_text_prefix)) != 0) {
    fprintf(stderr, "native-mapping-materializer: text prefix mismatch\n");
    exit(1);
  }
  if (mprotect(mapped, (size_t)opts->text_size, PROT_READ | PROT_EXEC) != 0) {
    fprintf(stderr, "native-mapping-materializer: text mprotect failed: %s\n", strerror(errno));
    exit(1);
  }
  return mapped;
}

static void *map_copied_segment(
    int memory_fd, uint64_t target_start, uint64_t size, uint64_t offset, const char *label) {
  void *mapped = map_fixed(target_start, size, PROT_READ | PROT_WRITE, label);
  read_exact(memory_fd, mapped, size, offset);
  return mapped;
}

static void perms_for(uint64_t address, char out[5]) {
  FILE *maps = fopen("/proc/self/maps", "rb");
  if (!maps) {
    fprintf(stderr, "native-mapping-materializer: open /proc/self/maps failed\n");
    exit(1);
  }
  char line[4096];
  while (fgets(line, sizeof(line), maps)) {
    unsigned long long start = 0;
    unsigned long long end = 0;
    char perms[5] = {0};
    if (sscanf(line, "%llx-%llx %4s", &start, &end, perms) == 3 &&
        address >= (uint64_t)start && address < (uint64_t)end) {
      fclose(maps);
      memcpy(out, perms, 4);
      out[4] = '\0';
      return;
    }
  }
  fclose(maps);
  fprintf(stderr, "native-mapping-materializer: no maps entry for 0x%" PRIx64 "\n", address);
  exit(1);
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  int memory_fd = open(opts.memory, O_RDONLY);
  if (memory_fd < 0) {
    fprintf(stderr, "native-mapping-materializer: open memory failed: %s\n", strerror(errno));
    return 1;
  }

  void *text = map_file_text(&opts);
  uint64_t *data = map_copied_segment(
      memory_fd, opts.data_target_start, opts.data_size, opts.data_offset, "data");
  uint64_t *heap = map_copied_segment(
      memory_fd, opts.heap_target_start, opts.heap_size, opts.heap_offset, "heap");
  close(memory_fd);
  if (data[0] != opts.expect_data_word0 || heap[0] != opts.expect_heap_word0) {
    fprintf(stderr, "native-mapping-materializer: copied words did not match expectations\n");
    return 1;
  }
  void *stack = map_fixed(opts.stack_target_start, opts.stack_size, PROT_READ | PROT_WRITE, "stack");
  void *recreated = map_fixed(opts.recreate_target_start, opts.recreate_size, PROT_NONE, "recreate");

  char text_perms[5];
  char data_perms[5];
  char heap_perms[5];
  char stack_perms[5];
  char recreated_perms[5];
  perms_for(opts.text_target_start, text_perms);
  perms_for(opts.data_target_start, data_perms);
  perms_for(opts.heap_target_start, heap_perms);
  perms_for(opts.stack_target_start, stack_perms);
  perms_for(opts.recreate_target_start, recreated_perms);

  printf(
      "MACHINEN_NATIVE_MAPPING_MATERIALIZER {\"status\":\"materialized\"," 
      "\"textPerms\":\"%s\",\"dataPerms\":\"%s\",\"heapPerms\":\"%s\"," 
      "\"stackPerms\":\"%s\",\"recreatePerms\":\"%s\"," 
      "\"dataWord0\":\"0x%" PRIx64 "\",\"heapWord0\":\"0x%" PRIx64 "\"}\n",
      text_perms,
      data_perms,
      heap_perms,
      stack_perms,
      recreated_perms,
      data[0],
      heap[0]);

  munmap(recreated, (size_t)opts.recreate_size);
  munmap(stack, (size_t)opts.stack_size);
  munmap(heap, (size_t)opts.heap_size);
  munmap(data, (size_t)opts.data_size);
  munmap(text, (size_t)opts.text_size);
  return 0;
}

#else

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  fprintf(stderr, "native-mapping-materializer: requires Linux mmap/procfs\n");
  return 77;
}

#endif
