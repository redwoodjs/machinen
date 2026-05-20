// Minimal target-side materialization helper for native process images.
//
// This is not the final process zygote. It proves the loader boundary for #444:
// given a target-native materialization plan chosen by the JavaScript driver, the
// helper maps memory, copies bytes from native-memory.bin, applies final page
// permissions, and reports precise failures.

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

struct Options {
  const char *memory;
  uint64_t offset;
  uint64_t size;
  const char *expect_prefix;
  const char *final_prot;
};

static void usage(void) {
  fprintf(stderr,
      "usage: machinen-native-restore-loader --memory path --offset n --size n "
      "--expect-prefix text --final-prot rw|r|rx\n");
  exit(2);
}

static uint64_t parse_u64(const char *value, const char *field) {
  errno = 0;
  char *end = NULL;
  uint64_t parsed = strtoull(value, &end, 0);
  if (errno != 0 || end == value || *end != '\0') {
    fprintf(stderr, "native-restore-loader: invalid %s: %s\n", field, value);
    exit(2);
  }
  return parsed;
}

static bool streq(const char *left, const char *right) {
  return strcmp(left, right) == 0;
}

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {
      .memory = NULL, .offset = 0, .size = 0, .expect_prefix = NULL, .final_prot = "rw"};
  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--memory")) {
      if (++i >= argc) {
        usage();
      }
      opts.memory = argv[i];
    } else if (streq(argv[i], "--offset")) {
      if (++i >= argc) {
        usage();
      }
      opts.offset = parse_u64(argv[i], "offset");
    } else if (streq(argv[i], "--size")) {
      if (++i >= argc) {
        usage();
      }
      opts.size = parse_u64(argv[i], "size");
    } else if (streq(argv[i], "--expect-prefix")) {
      if (++i >= argc) {
        usage();
      }
      opts.expect_prefix = argv[i];
    } else if (streq(argv[i], "--final-prot")) {
      if (++i >= argc) {
        usage();
      }
      opts.final_prot = argv[i];
    } else {
      usage();
    }
  }
  if (!opts.memory || !opts.expect_prefix || opts.size == 0) {
    usage();
  }
  return opts;
}

static int prot_flags(const char *spec) {
  if (streq(spec, "rw")) {
    return PROT_READ | PROT_WRITE;
  }
  if (streq(spec, "r")) {
    return PROT_READ;
  }
  if (streq(spec, "rx")) {
    return PROT_READ | PROT_EXEC;
  }
  fprintf(stderr, "native-restore-loader: unsupported final protection: %s\n", spec);
  exit(2);
}

static void read_exact(int fd, void *dst, uint64_t size, uint64_t offset) {
  uint8_t *bytes = dst;
  uint64_t cursor = 0;
  while (cursor < size) {
    size_t chunk = size - cursor > 1024u * 1024u ? 1024u * 1024u : (size_t)(size - cursor);
    ssize_t got = pread(fd, bytes + cursor, chunk, (off_t)(offset + cursor));
    if (got < 0) {
      fprintf(stderr, "native-restore-loader: memory read failed: %s\n", strerror(errno));
      exit(1);
    }
    if (got == 0) {
      fprintf(stderr,
          "native-restore-loader: memory read was short at offset 0x%" PRIx64 "\n",
          offset + cursor);
      exit(1);
    }
    cursor += (uint64_t)got;
  }
}

static void verify_prefix(const struct Options *opts, const void *mapping) {
  size_t prefix_len = strlen(opts->expect_prefix);
  if (prefix_len > opts->size) {
    fprintf(stderr, "native-restore-loader: expected prefix is larger than mapping\n");
    exit(1);
  }
  if (memcmp(mapping, opts->expect_prefix, prefix_len) != 0) {
    fprintf(stderr, "native-restore-loader: materialized bytes did not match expected prefix\n");
    exit(1);
  }
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  int fd = open(opts.memory, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr, "native-restore-loader: open memory failed: %s\n", strerror(errno));
    return 1;
  }

  void *mapping = mmap(NULL, (size_t)opts.size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANON, -1, 0);
  if (mapping == MAP_FAILED) {
    fprintf(stderr, "native-restore-loader: mmap failed: %s\n", strerror(errno));
    close(fd);
    return 1;
  }

  read_exact(fd, mapping, opts.size, opts.offset);
  close(fd);
  verify_prefix(&opts, mapping);

  int final_prot = prot_flags(opts.final_prot);
  if (mprotect(mapping, (size_t)opts.size, final_prot) != 0) {
    fprintf(stderr, "native-restore-loader: mprotect failed: %s\n", strerror(errno));
    munmap(mapping, (size_t)opts.size);
    return 1;
  }

  printf(
      "MACHINEN_NATIVE_RESTORE_LOADER {\"status\":\"materialized\",\"sizeBytes\":%" PRIu64
      ",\"finalProt\":\"%s\"}\n",
      opts.size, opts.final_prot);
  munmap(mapping, (size_t)opts.size);
  return 0;
}
