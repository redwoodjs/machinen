// Target-native final-jump proof helper for native process images.
//
// The helper is intentionally narrow: on a Linux/amd64 host it maps translated
// text/data pages at their target virtual addresses, installs a fresh target
// stack, jumps into the target-native entry point, and verifies that the target
// code used both the translated argument register and the target stack. It is a
// proof boundary, not a general process zygote.

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

#if defined(__linux__) && defined(__x86_64__)
#include <ucontext.h>
#endif

struct Options {
  const char *memory;
  uint64_t text_offset;
  uint64_t text_size;
  uint64_t text_target_start;
  uint64_t entry_offset;
  const char *expect_prefix;
  uint64_t data_offset;
  uint64_t data_size;
  uint64_t data_target_start;
  uint64_t stack_target_start;
  uint64_t stack_size;
  uint64_t arg0;
  uint64_t expect_return;
  uint64_t expect_store_marker;
  bool has_expect_initial_word0;
  uint64_t expect_initial_word0;
  bool has_translated_return;
  uint64_t translated_return;
  uint64_t expect_return_marker;
};

static void usage(void) {
  fprintf(stderr,
      "usage: machinen-native-resume-trampoline --memory path "
      "--text-offset n --text-size n --text-target-start addr --entry-offset n "
      "--expect-prefix text --data-offset n --data-size n --data-target-start addr "
      "--stack-target-start addr --stack-size n --arg0 n --expect-return n "
      "--expect-store-marker n [--expect-initial-word0 n] "
      "[--translated-return addr --expect-return-marker n]\n");
  exit(2);
}

static uint64_t parse_u64(const char *value, const char *field) {
  errno = 0;
  char *end = NULL;
  uint64_t parsed = strtoull(value, &end, 0);
  if (errno != 0 || end == value || *end != '\0') {
    fprintf(stderr, "native-resume-trampoline: invalid %s: %s\n", field, value);
    exit(2);
  }
  return parsed;
}

static bool streq(const char *left, const char *right) {
  return strcmp(left, right) == 0;
}

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {0};
  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--memory")) {
      if (++i >= argc) {
        usage();
      }
      opts.memory = argv[i];
    } else if (streq(argv[i], "--text-offset")) {
      if (++i >= argc) {
        usage();
      }
      opts.text_offset = parse_u64(argv[i], "text-offset");
    } else if (streq(argv[i], "--text-size")) {
      if (++i >= argc) {
        usage();
      }
      opts.text_size = parse_u64(argv[i], "text-size");
    } else if (streq(argv[i], "--text-target-start")) {
      if (++i >= argc) {
        usage();
      }
      opts.text_target_start = parse_u64(argv[i], "text-target-start");
    } else if (streq(argv[i], "--entry-offset")) {
      if (++i >= argc) {
        usage();
      }
      opts.entry_offset = parse_u64(argv[i], "entry-offset");
    } else if (streq(argv[i], "--expect-prefix")) {
      if (++i >= argc) {
        usage();
      }
      opts.expect_prefix = argv[i];
    } else if (streq(argv[i], "--data-offset")) {
      if (++i >= argc) {
        usage();
      }
      opts.data_offset = parse_u64(argv[i], "data-offset");
    } else if (streq(argv[i], "--data-size")) {
      if (++i >= argc) {
        usage();
      }
      opts.data_size = parse_u64(argv[i], "data-size");
    } else if (streq(argv[i], "--data-target-start")) {
      if (++i >= argc) {
        usage();
      }
      opts.data_target_start = parse_u64(argv[i], "data-target-start");
    } else if (streq(argv[i], "--stack-target-start")) {
      if (++i >= argc) {
        usage();
      }
      opts.stack_target_start = parse_u64(argv[i], "stack-target-start");
    } else if (streq(argv[i], "--stack-size")) {
      if (++i >= argc) {
        usage();
      }
      opts.stack_size = parse_u64(argv[i], "stack-size");
    } else if (streq(argv[i], "--arg0")) {
      if (++i >= argc) {
        usage();
      }
      opts.arg0 = parse_u64(argv[i], "arg0");
    } else if (streq(argv[i], "--expect-return")) {
      if (++i >= argc) {
        usage();
      }
      opts.expect_return = parse_u64(argv[i], "expect-return");
    } else if (streq(argv[i], "--expect-store-marker")) {
      if (++i >= argc) {
        usage();
      }
      opts.expect_store_marker = parse_u64(argv[i], "expect-store-marker");
    } else if (streq(argv[i], "--expect-initial-word0")) {
      if (++i >= argc) {
        usage();
      }
      opts.has_expect_initial_word0 = true;
      opts.expect_initial_word0 = parse_u64(argv[i], "expect-initial-word0");
    } else if (streq(argv[i], "--translated-return")) {
      if (++i >= argc) {
        usage();
      }
      opts.has_translated_return = true;
      opts.translated_return = parse_u64(argv[i], "translated-return");
    } else if (streq(argv[i], "--expect-return-marker")) {
      if (++i >= argc) {
        usage();
      }
      opts.expect_return_marker = parse_u64(argv[i], "expect-return-marker");
    } else {
      usage();
    }
  }
  if (!opts.memory || !opts.expect_prefix || opts.text_size == 0 || opts.data_size == 0 ||
      opts.stack_size == 0) {
    usage();
  }
  if (opts.entry_offset >= opts.text_size) {
    fprintf(stderr, "native-resume-trampoline: entry offset is outside text mapping\n");
    exit(2);
  }
  if (opts.has_translated_return && opts.expect_return_marker == 0) {
    fprintf(stderr, "native-resume-trampoline: translated return requires expect-return-marker\n");
    exit(2);
  }
  if (opts.has_translated_return &&
      (opts.translated_return < opts.text_target_start ||
          opts.translated_return >= opts.text_target_start + opts.text_size)) {
    fprintf(stderr, "native-resume-trampoline: translated return is outside text mapping\n");
    exit(2);
  }
  return opts;
}

#if defined(__linux__) && defined(__x86_64__)

typedef uint64_t (*TargetEntry)(uint64_t);

struct ResumeContext {
  TargetEntry entry;
  uint64_t arg0;
  uint64_t result;
  ucontext_t caller;
  ucontext_t callee;
};

static struct ResumeContext *active_context = NULL;
static uint64_t chain_original_rsp = 0;
static uint64_t chain_result = 0;

static void read_exact(int fd, void *dst, uint64_t size, uint64_t offset) {
  uint8_t *bytes = dst;
  uint64_t cursor = 0;
  while (cursor < size) {
    size_t chunk = size - cursor > 1024u * 1024u ? 1024u * 1024u : (size_t)(size - cursor);
    ssize_t got = pread(fd, bytes + cursor, chunk, (off_t)(offset + cursor));
    if (got < 0) {
      fprintf(stderr, "native-resume-trampoline: memory read failed: %s\n", strerror(errno));
      exit(1);
    }
    if (got == 0) {
      fprintf(stderr,
          "native-resume-trampoline: memory read was short at offset 0x%" PRIx64 "\n",
          offset + cursor);
      exit(1);
    }
    cursor += (uint64_t)got;
  }
}

static void validate_page_aligned(uint64_t value, const char *field) {
  long page_size = sysconf(_SC_PAGESIZE);
  if (page_size <= 0) {
    fprintf(stderr, "native-resume-trampoline: sysconf(_SC_PAGESIZE) failed\n");
    exit(1);
  }
  if (value % (uint64_t)page_size != 0) {
    fprintf(stderr, "native-resume-trampoline: %s must be page-aligned\n", field);
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
        "native-resume-trampoline: %s mmap at 0x%" PRIx64 " failed: %s\n",
        label,
        target_start,
        strerror(errno));
    exit(1);
  }
  if (mapped != target) {
    fprintf(stderr, "native-resume-trampoline: %s mmap did not honor target address\n", label);
    exit(1);
  }
  return mapped;
}

static void *map_segment(int fd, uint64_t target_start, uint64_t size, uint64_t offset, const char *label) {
  void *mapped = map_fixed(target_start, size, PROT_READ | PROT_WRITE, label);
  read_exact(fd, mapped, size, offset);
  return mapped;
}

static void verify_prefix(const struct Options *opts, const void *mapping) {
  size_t prefix_len = strlen(opts->expect_prefix);
  if (prefix_len > opts->text_size) {
    fprintf(stderr, "native-resume-trampoline: expected prefix is larger than text mapping\n");
    exit(1);
  }
  if (memcmp(mapping, opts->expect_prefix, prefix_len) != 0) {
    fprintf(stderr, "native-resume-trampoline: text bytes did not match expected prefix\n");
    exit(1);
  }
}

static void resume_entry(void) {
  struct ResumeContext *ctx = active_context;
  ctx->result = ctx->entry(ctx->arg0);
}

static uint64_t run_on_target_stack(
    TargetEntry entry, uint64_t arg0, void *stack, uint64_t stack_size) {
  struct ResumeContext ctx = {.entry = entry, .arg0 = arg0, .result = 0};
  if (getcontext(&ctx.callee) != 0) {
    fprintf(stderr, "native-resume-trampoline: getcontext failed: %s\n", strerror(errno));
    exit(1);
  }
  ctx.callee.uc_stack.ss_sp = stack;
  ctx.callee.uc_stack.ss_size = (size_t)stack_size;
  ctx.callee.uc_link = &ctx.caller;
  active_context = &ctx;
  makecontext(&ctx.callee, resume_entry, 0);
  if (swapcontext(&ctx.caller, &ctx.callee) != 0) {
    fprintf(stderr, "native-resume-trampoline: swapcontext failed: %s\n", strerror(errno));
    exit(1);
  }
  active_context = NULL;
  return ctx.result;
}

static uint64_t run_with_translated_return(
    TargetEntry entry, uint64_t arg0, void *stack, uint64_t stack_size, uint64_t translated_return) {
  uint64_t initial_rsp = (uint64_t)(uintptr_t)stack + stack_size - 16u;
  chain_original_rsp = 0;
  chain_result = 0;
  __asm__ __volatile__(
      "movq %%rsp, chain_original_rsp(%%rip)\n"
      "movq %[initial_rsp], %%rsp\n"
      "movq %[translated_return], (%%rsp)\n"
      "leaq 1f(%%rip), %%rax\n"
      "movq %%rax, 8(%%rsp)\n"
      "movq %[arg0], %%rdi\n"
      "jmp *%[entry]\n"
      "1:\n"
      "movq %%rax, chain_result(%%rip)\n"
      "movq chain_original_rsp(%%rip), %%rsp\n"
      :
      : [entry] "r"(entry),
        [arg0] "r"(arg0),
        [initial_rsp] "r"(initial_rsp),
        [translated_return] "r"(translated_return)
      : "rax", "rdi", "memory");
  return chain_result;
}

static void validate_initial_data(const struct Options *opts, const void *data) {
  if (!opts->has_expect_initial_word0) {
    return;
  }
  uint64_t initial_word0 = ((const uint64_t *)data)[0];
  if (initial_word0 != opts->expect_initial_word0) {
    fprintf(stderr,
        "native-resume-trampoline: initial data word0 was 0x%" PRIx64 ", expected 0x%" PRIx64
        "\n",
        initial_word0,
        opts->expect_initial_word0);
    exit(1);
  }
}

static void validate_resume_result(const struct Options *opts,
    uint64_t result,
    uint64_t stored_rsp,
    uint64_t stored_marker,
    uint64_t return_marker,
    uint64_t observed_return_rsp) {
  if (result != opts->expect_return) {
    fprintf(stderr,
        "native-resume-trampoline: target code returned 0x%" PRIx64 ", expected 0x%" PRIx64
        "\n",
        result,
        opts->expect_return);
    exit(1);
  }
  if (stored_marker != opts->expect_store_marker) {
    fprintf(stderr,
        "native-resume-trampoline: target code stored marker 0x%" PRIx64 ", expected 0x%" PRIx64
        "\n",
        stored_marker,
        opts->expect_store_marker);
    exit(1);
  }
  uint64_t stack_end = opts->stack_target_start + opts->stack_size;
  if (stored_rsp < opts->stack_target_start || stored_rsp >= stack_end) {
    fprintf(stderr,
        "native-resume-trampoline: target code observed rsp 0x%" PRIx64
        " outside target stack [0x%" PRIx64 ", 0x%" PRIx64 ")\n",
        stored_rsp,
        opts->stack_target_start,
        stack_end);
    exit(1);
  }
  if (!opts->has_translated_return) {
    return;
  }
  if (return_marker != opts->expect_return_marker) {
    fprintf(stderr,
        "native-resume-trampoline: target return code stored marker 0x%" PRIx64
        ", expected 0x%" PRIx64 "\n",
        return_marker,
        opts->expect_return_marker);
    exit(1);
  }
  if (observed_return_rsp < opts->stack_target_start || observed_return_rsp >= stack_end) {
    fprintf(stderr,
        "native-resume-trampoline: target return code observed rsp 0x%" PRIx64
        " outside target stack [0x%" PRIx64 ", 0x%" PRIx64 ")\n",
        observed_return_rsp,
        opts->stack_target_start,
        stack_end);
    exit(1);
  }
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  validate_page_aligned(opts.text_size, "text-size");
  validate_page_aligned(opts.data_size, "data-size");
  validate_page_aligned(opts.stack_size, "stack-size");

  int fd = open(opts.memory, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr, "native-resume-trampoline: open memory failed: %s\n", strerror(errno));
    return 1;
  }

  void *text = map_segment(fd, opts.text_target_start, opts.text_size, opts.text_offset, "text");
  verify_prefix(&opts, text);
  if (mprotect(text, (size_t)opts.text_size, PROT_READ | PROT_EXEC) != 0) {
    fprintf(stderr, "native-resume-trampoline: text mprotect failed: %s\n", strerror(errno));
    close(fd);
    return 1;
  }

  void *data = map_segment(fd, opts.data_target_start, opts.data_size, opts.data_offset, "data");
  close(fd);
  validate_initial_data(&opts, data);
  void *stack = map_fixed(opts.stack_target_start, opts.stack_size, PROT_READ | PROT_WRITE, "stack");

  TargetEntry entry = (TargetEntry)(uintptr_t)(opts.text_target_start + opts.entry_offset);
  uint64_t result = opts.has_translated_return
      ? run_with_translated_return(entry, opts.arg0, stack, opts.stack_size, opts.translated_return)
      : run_on_target_stack(entry, opts.arg0, stack, opts.stack_size);
  uint64_t stored_rsp = ((uint64_t *)data)[0];
  uint64_t stored_marker = ((uint64_t *)data)[1];
  uint64_t return_marker = ((uint64_t *)data)[2];
  uint64_t observed_return_rsp = ((uint64_t *)data)[3];
  validate_resume_result(&opts, result, stored_rsp, stored_marker, return_marker, observed_return_rsp);

  printf(
      "MACHINEN_NATIVE_RESUME_TRAMPOLINE {\"status\":\"jumped\","
      "\"targetArch\":\"amd64\",\"entry\":\"0x%" PRIx64 "\","
      "\"argument\":\"0x%" PRIx64 "\",\"returnValue\":\"0x%" PRIx64 "\","
      "\"storedMarker\":\"0x%" PRIx64 "\",\"observedRsp\":\"0x%" PRIx64 "\","
      "\"returnAddress\":\"0x%" PRIx64 "\",\"returnMarker\":\"0x%" PRIx64 "\","
      "\"observedReturnRsp\":\"0x%" PRIx64 "\",\"returnedToTranslatedAddress\":%s,"
      "\"stackStart\":\"0x%" PRIx64 "\",\"stackEnd\":\"0x%" PRIx64 "\","
      "\"usedTargetStack\":true}\n",
      opts.text_target_start + opts.entry_offset,
      opts.arg0,
      result,
      stored_marker,
      stored_rsp,
      opts.translated_return,
      return_marker,
      observed_return_rsp,
      opts.has_translated_return ? "true" : "false",
      opts.stack_target_start,
      opts.stack_target_start + opts.stack_size);

  munmap(stack, (size_t)opts.stack_size);
  munmap(data, (size_t)opts.data_size);
  munmap(text, (size_t)opts.text_size);
  return 0;
}

#else

int main(int argc, char **argv) {
  (void)argc;
  (void)argv;
  fprintf(stderr, "native-resume-trampoline: target-native final jump requires linux/amd64\n");
  return 77;
}

#endif
