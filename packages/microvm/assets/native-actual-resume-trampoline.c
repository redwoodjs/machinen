// Actual target-native resume probe for captured real-utility continuations.
//
// This helper is intentionally narrow. It runs only as a short-lived
// Linux/amd64 subprocess. It maps an explicit window of target-native bytes at
// the planned target address, installs a target stack, transfers control to the
// bytes, and reports whether the CPU reached that target instruction stream.
// Faults are expected while broader process state is still unmodeled; they are
// reported as proof data instead of being treated as a completed migration.

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
#include <setjmp.h>
#include <signal.h>
#include <ucontext.h>
#endif

struct Options {
  const char *code_file;
  uint64_t file_offset;
  uint64_t code_size;
  uint64_t target_address;
  uint64_t stack_target_start;
  uint64_t stack_size;
  uint64_t stack_pointer;
  uint64_t timeout_seconds;
  int synthetic_empty_pipe_read_fd;
  int synthetic_empty_pipe_write_fd;
};

static void usage(void) {
  fprintf(stderr,
      "usage: machinen-native-actual-resume-trampoline --code-file path "
      "--file-offset n --code-size n --target-address addr "
      "--timeout-seconds n [--synthetic-empty-pipe-read-fd n] "
      "[--synthetic-empty-pipe-write-fd n] "
      "--stack-target-start addr --stack-size n --stack-pointer addr\n");
  exit(2);
}

static uint64_t parse_u64(const char *value, const char *field) {
  errno = 0;
  char *end = NULL;
  uint64_t parsed = strtoull(value, &end, 0);
  if (errno != 0 || end == value || *end != '\0') {
    fprintf(stderr, "native-actual-resume-trampoline: invalid %s: %s\n", field, value);
    exit(2);
  }
  return parsed;
}

static bool streq(const char *left, const char *right) {
  return strcmp(left, right) == 0;
}

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {0};
  opts.timeout_seconds = 1;
  opts.synthetic_empty_pipe_read_fd = -1;
  opts.synthetic_empty_pipe_write_fd = -1;
  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--code-file")) {
      if (++i >= argc) {
        usage();
      }
      opts.code_file = argv[i];
    } else if (streq(argv[i], "--file-offset")) {
      if (++i >= argc) {
        usage();
      }
      opts.file_offset = parse_u64(argv[i], "file-offset");
    } else if (streq(argv[i], "--code-size")) {
      if (++i >= argc) {
        usage();
      }
      opts.code_size = parse_u64(argv[i], "code-size");
    } else if (streq(argv[i], "--target-address")) {
      if (++i >= argc) {
        usage();
      }
      opts.target_address = parse_u64(argv[i], "target-address");
    } else if (streq(argv[i], "--timeout-seconds")) {
      if (++i >= argc) {
        usage();
      }
      opts.timeout_seconds = parse_u64(argv[i], "timeout-seconds");
    } else if (streq(argv[i], "--synthetic-empty-pipe-read-fd")) {
      if (++i >= argc) {
        usage();
      }
      uint64_t fd = parse_u64(argv[i], "synthetic-empty-pipe-read-fd");
      if (fd > 1024u) {
        fprintf(stderr, "native-actual-resume-trampoline: synthetic fd is too large\n");
        exit(2);
      }
      opts.synthetic_empty_pipe_read_fd = (int)fd;
    } else if (streq(argv[i], "--synthetic-empty-pipe-write-fd")) {
      if (++i >= argc) {
        usage();
      }
      uint64_t fd = parse_u64(argv[i], "synthetic-empty-pipe-write-fd");
      if (fd > 1024u) {
        fprintf(stderr, "native-actual-resume-trampoline: synthetic fd is too large\n");
        exit(2);
      }
      opts.synthetic_empty_pipe_write_fd = (int)fd;
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
    } else if (streq(argv[i], "--stack-pointer")) {
      if (++i >= argc) {
        usage();
      }
      opts.stack_pointer = parse_u64(argv[i], "stack-pointer");
    } else {
      usage();
    }
  }
  if (!opts.code_file || opts.code_size == 0 || opts.stack_size == 0 ||
      opts.stack_pointer == 0) {
    usage();
  }
  return opts;
}

#if defined(__linux__) && defined(__x86_64__)

static sigjmp_buf resume_fault_jmp;
static volatile sig_atomic_t observed_signal = 0;
static volatile uintptr_t observed_fault_address = 0;
static volatile uintptr_t observed_rip = 0;
static volatile uintptr_t observed_rsp = 0;
static uint64_t mapped_target_start = 0;
static uint64_t mapped_target_end = 0;
static uint8_t *mapped_code_bytes = NULL;
static uint64_t mapped_code_page_start = 0;
static uint64_t mapped_code_page_size = 0;
static uint64_t resume_return_value = 0;
static uint64_t host_rsp_before_jump __attribute__((used)) = 0;

struct ObservedRegisters {
  uint64_t rax;
  uint64_t rbx;
  uint64_t rcx;
  uint64_t rdx;
  uint64_t rsi;
  uint64_t rdi;
  uint64_t rbp;
  uint64_t r8;
  uint64_t r9;
  uint64_t r10;
  uint64_t r11;
  uint64_t r12;
  uint64_t r13;
  uint64_t r14;
  uint64_t r15;
};

static struct ObservedRegisters observed_registers = {0};

static long page_size(void) {
  long size = sysconf(_SC_PAGESIZE);
  if (size <= 0) {
    fprintf(stderr, "native-actual-resume-trampoline: sysconf(_SC_PAGESIZE) failed\n");
    exit(1);
  }
  return size;
}

static uint64_t align_down(uint64_t value, uint64_t alignment) {
  return value & ~(alignment - 1u);
}

static uint64_t align_up(uint64_t value, uint64_t alignment) {
  return (value + alignment - 1u) & ~(alignment - 1u);
}

static void validate_page_aligned(uint64_t value, const char *field) {
  uint64_t size = (uint64_t)page_size();
  if (value % size != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: %s must be page-aligned\n", field);
    exit(2);
  }
}

static void read_exact(int fd, void *dst, uint64_t size, uint64_t offset) {
  uint8_t *bytes = dst;
  uint64_t cursor = 0;
  while (cursor < size) {
    size_t chunk = size - cursor > 1024u * 1024u ? 1024u * 1024u : (size_t)(size - cursor);
    ssize_t got = pread(fd, bytes + cursor, chunk, (off_t)(offset + cursor));
    if (got < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: code read failed: %s\n", strerror(errno));
      exit(1);
    }
    if (got == 0) {
      fprintf(stderr,
          "native-actual-resume-trampoline: code read was short at offset 0x%" PRIx64 "\n",
          offset + cursor);
      exit(1);
    }
    cursor += (uint64_t)got;
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
        "native-actual-resume-trampoline: %s mmap at 0x%" PRIx64 " failed: %s\n",
        label,
        target_start,
        strerror(errno));
    exit(1);
  }
  if (mapped != target) {
    fprintf(stderr, "native-actual-resume-trampoline: %s mmap ignored target address\n", label);
    exit(1);
  }
  return mapped;
}

static void *map_target_code(const struct Options *opts, uint64_t *mapped_start, uint64_t *mapped_size) {
  uint64_t size = (uint64_t)page_size();
  uint64_t page_start = align_down(opts->target_address, size);
  uint64_t page_offset = opts->target_address - page_start;
  uint64_t total_size = align_up(page_offset + opts->code_size, size);
  void *mapped = map_fixed(page_start, total_size, PROT_READ | PROT_WRITE, "target-code");
  int fd = open(opts->code_file, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr,
        "native-actual-resume-trampoline: open target code failed for %s: %s\n",
        opts->code_file,
        strerror(errno));
    exit(1);
  }
  read_exact(fd, (uint8_t *)mapped + page_offset, opts->code_size, opts->file_offset);
  close(fd);
  if (mprotect(mapped, (size_t)total_size, PROT_READ | PROT_EXEC) != 0) {
    fprintf(stderr,
        "native-actual-resume-trampoline: target code mprotect failed: %s\n",
        strerror(errno));
    exit(1);
  }
  *mapped_start = page_start;
  *mapped_size = total_size;
  return mapped;
}

static const char *signal_name(int signum) {
  switch (signum) {
  case SIGSEGV:
    return "SIGSEGV";
  case SIGILL:
    return "SIGILL";
  case SIGBUS:
    return "SIGBUS";
  case SIGFPE:
    return "SIGFPE";
  case SIGSYS:
    return "SIGSYS";
  case SIGALRM:
    return "SIGALRM";
  default:
    return "SIGNAL";
  }
}

static void signal_handler(int signum, siginfo_t *info, void *context) {
  ucontext_t *uc = (ucontext_t *)context;
  observed_signal = signum;
  observed_fault_address = (uintptr_t)info->si_addr;
  observed_rip = (uintptr_t)uc->uc_mcontext.gregs[REG_RIP];
  observed_rsp = (uintptr_t)uc->uc_mcontext.gregs[REG_RSP];
  observed_registers.rax = (uint64_t)uc->uc_mcontext.gregs[REG_RAX];
  observed_registers.rbx = (uint64_t)uc->uc_mcontext.gregs[REG_RBX];
  observed_registers.rcx = (uint64_t)uc->uc_mcontext.gregs[REG_RCX];
  observed_registers.rdx = (uint64_t)uc->uc_mcontext.gregs[REG_RDX];
  observed_registers.rsi = (uint64_t)uc->uc_mcontext.gregs[REG_RSI];
  observed_registers.rdi = (uint64_t)uc->uc_mcontext.gregs[REG_RDI];
  observed_registers.rbp = (uint64_t)uc->uc_mcontext.gregs[REG_RBP];
  observed_registers.r8 = (uint64_t)uc->uc_mcontext.gregs[REG_R8];
  observed_registers.r9 = (uint64_t)uc->uc_mcontext.gregs[REG_R9];
  observed_registers.r10 = (uint64_t)uc->uc_mcontext.gregs[REG_R10];
  observed_registers.r11 = (uint64_t)uc->uc_mcontext.gregs[REG_R11];
  observed_registers.r12 = (uint64_t)uc->uc_mcontext.gregs[REG_R12];
  observed_registers.r13 = (uint64_t)uc->uc_mcontext.gregs[REG_R13];
  observed_registers.r14 = (uint64_t)uc->uc_mcontext.gregs[REG_R14];
  observed_registers.r15 = (uint64_t)uc->uc_mcontext.gregs[REG_R15];
  siglongjmp(resume_fault_jmp, 1);
}

static void install_signal_handlers(void) {
  stack_t signal_stack = {0};
  signal_stack.ss_size = SIGSTKSZ;
  signal_stack.ss_sp = malloc(signal_stack.ss_size);
  if (!signal_stack.ss_sp) {
    fprintf(stderr, "native-actual-resume-trampoline: signal stack allocation failed\n");
    exit(1);
  }
  if (sigaltstack(&signal_stack, NULL) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: sigaltstack failed: %s\n", strerror(errno));
    exit(1);
  }

  struct sigaction action;
  memset(&action, 0, sizeof(action));
  sigemptyset(&action.sa_mask);
  action.sa_sigaction = signal_handler;
  action.sa_flags = SA_SIGINFO | SA_ONSTACK;
  int signals[] = {SIGSEGV, SIGILL, SIGBUS, SIGFPE, SIGSYS, SIGALRM};
  for (size_t i = 0; i < sizeof(signals) / sizeof(signals[0]); i++) {
    if (sigaction(signals[i], &action, NULL) != 0) {
      fprintf(stderr,
          "native-actual-resume-trampoline: sigaction failed for %s: %s\n",
          signal_name(signals[i]),
          strerror(errno));
      exit(1);
    }
  }
}

static void validate_stack_options(const struct Options *opts) {
  validate_page_aligned(opts->stack_target_start, "stack-target-start");
  validate_page_aligned(opts->stack_size, "stack-size");
  uint64_t stack_end = opts->stack_target_start + opts->stack_size;
  if (opts->stack_pointer < opts->stack_target_start + 16u || opts->stack_pointer > stack_end) {
    fprintf(stderr, "native-actual-resume-trampoline: stack pointer is outside target stack\n");
    exit(2);
  }
  if (opts->stack_pointer % 16u != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: stack pointer must be 16-byte aligned\n");
    exit(2);
  }
}

static void install_synthetic_empty_pipe(int read_fd, int write_fd) {
  if (read_fd < 0) {
    return;
  }
  if (write_fd == read_fd) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic pipe fds must differ\n");
    exit(2);
  }
  int pipe_fds[2];
  if (pipe(pipe_fds) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic pipe failed: %s\n", strerror(errno));
    exit(1);
  }
  if (pipe_fds[0] != read_fd) {
    if (dup2(pipe_fds[0], read_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic pipe read dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(pipe_fds[0]);
  }
  if (write_fd >= 0 && pipe_fds[1] != write_fd) {
    if (dup2(pipe_fds[1], write_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic pipe write dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(pipe_fds[1]);
  }
  // Keep a write end open so the read end is not EOF/readable. This makes the
  // modeled one-fd ppoll proof timeout-driven instead of readiness-driven.
}

static void jump_to_target(uint64_t entry, uint64_t initial_rsp) {
  __asm__ __volatile__(
      "movq %%rsp, host_rsp_before_jump(%%rip)\n"
      "movq %[initial_rsp], %%rsp\n"
      "leaq 1f(%%rip), %%rax\n"
      "movq %%rax, (%%rsp)\n"
      "xorl %%eax, %%eax\n"
      "xorl %%edi, %%edi\n"
      "xorl %%esi, %%esi\n"
      "xorl %%edx, %%edx\n"
      "xorl %%ecx, %%ecx\n"
      "xorl %%r8d, %%r8d\n"
      "xorl %%r9d, %%r9d\n"
      "xorl %%r10d, %%r10d\n"
      "xorl %%r11d, %%r11d\n"
      "jmp *%[entry]\n"
      "1:\n"
      "movq %%rax, resume_return_value(%%rip)\n"
      "movq host_rsp_before_jump(%%rip), %%rsp\n"
      :
      : [entry] "r"((void *)(uintptr_t)entry), [initial_rsp] "r"(initial_rsp)
      : "rax", "rcx", "rdx", "rsi", "rdi", "r8", "r9", "r10", "r11", "memory");
}

static bool rip_inside_target_bytes(uint64_t rip) {
  return rip >= mapped_target_start && rip < mapped_target_end;
}

static void print_instruction_bytes(uint64_t rip) {
  printf("\"targetInstructionBytes\":\"");
  if (mapped_code_bytes != NULL && rip_inside_target_bytes(rip) && rip >= mapped_code_page_start) {
    uint64_t offset = rip - mapped_code_page_start;
    if (offset >= mapped_code_page_size) {
      printf("\"");
      return;
    }
    uint64_t available_in_page = mapped_code_page_size - offset;
    uint64_t available_in_window = mapped_target_end - rip;
    uint64_t count =
        available_in_page < available_in_window ? available_in_page : available_in_window;
    if (count > 16u) {
      count = 16u;
    }
    for (uint64_t i = 0; i < count; i++) {
      printf("%02x", mapped_code_bytes[offset + i]);
    }
  }
  printf("\"");
}

static void print_registers(void) {
  printf(
      "\"registers\":{\"rax\":\"0x%" PRIx64 "\",\"rbx\":\"0x%" PRIx64
      "\",\"rcx\":\"0x%" PRIx64 "\",\"rdx\":\"0x%" PRIx64
      "\",\"rsi\":\"0x%" PRIx64 "\",\"rdi\":\"0x%" PRIx64
      "\",\"rbp\":\"0x%" PRIx64 "\",\"rsp\":\"0x%" PRIx64
      "\",\"r8\":\"0x%" PRIx64 "\",\"r9\":\"0x%" PRIx64
      "\",\"r10\":\"0x%" PRIx64 "\",\"r11\":\"0x%" PRIx64
      "\",\"r12\":\"0x%" PRIx64 "\",\"r13\":\"0x%" PRIx64
      "\",\"r14\":\"0x%" PRIx64 "\",\"r15\":\"0x%" PRIx64 "\"}",
      observed_registers.rax,
      observed_registers.rbx,
      observed_registers.rcx,
      observed_registers.rdx,
      observed_registers.rsi,
      observed_registers.rdi,
      observed_registers.rbp,
      (uint64_t)observed_rsp,
      observed_registers.r8,
      observed_registers.r9,
      observed_registers.r10,
      observed_registers.r11,
      observed_registers.r12,
      observed_registers.r13,
      observed_registers.r14,
      observed_registers.r15);
}

static void print_fault_event(const struct Options *opts) {
  uint64_t rip = (uint64_t)observed_rip;
  printf(
      "MACHINEN_ACTUAL_RESUME_TRAMPOLINE {\"status\":\"faulted\","
      "\"targetArch\":\"amd64\",\"entry\":\"0x%" PRIx64 "\","
      "\"signal\":\"%s\",\"signalNumber\":%d,"
      "\"faultAddress\":\"0x%" PRIx64 "\","
      "\"targetInstructionPointer\":\"0x%" PRIx64 "\",",
      opts->target_address,
      signal_name(observed_signal),
      observed_signal,
      (uint64_t)observed_fault_address,
      rip);
  print_instruction_bytes(rip);
  printf(",");
  print_registers();
  printf(
      ",\"observedRsp\":\"0x%" PRIx64 "\","
      "\"stackPointer\":\"0x%" PRIx64 "\","
      "\"targetBytesStart\":\"0x%" PRIx64 "\","
      "\"targetBytesEnd\":\"0x%" PRIx64 "\","
      "\"instructionPointerInTargetBytes\":%s,"
      "\"attemptedResume\":true,\"sourceTextReusedAsTargetCode\":false,"
      "\"sourceIsaEmulationUsed\":false,\"sidecarRuntimeUsed\":false}\n",
      (uint64_t)observed_rsp,
      opts->stack_pointer,
      mapped_target_start,
      mapped_target_end,
      rip_inside_target_bytes(rip) ? "true" : "false");
}

static void print_return_event(const struct Options *opts) {
  printf(
      "MACHINEN_ACTUAL_RESUME_TRAMPOLINE {\"status\":\"returned\"," 
      "\"targetArch\":\"amd64\",\"entry\":\"0x%" PRIx64 "\"," 
      "\"returnValue\":\"0x%" PRIx64 "\"," 
      "\"stackPointer\":\"0x%" PRIx64 "\"," 
      "\"targetBytesStart\":\"0x%" PRIx64 "\"," 
      "\"targetBytesEnd\":\"0x%" PRIx64 "\"," 
      "\"instructionPointerInTargetBytes\":true,"
      "\"attemptedResume\":true,\"sourceTextReusedAsTargetCode\":false,"
      "\"sourceIsaEmulationUsed\":false,\"sidecarRuntimeUsed\":false}\n",
      opts->target_address,
      resume_return_value,
      opts->stack_pointer,
      mapped_target_start,
      mapped_target_end);
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  validate_stack_options(&opts);
  mapped_target_start = opts.target_address;
  mapped_target_end = opts.target_address + opts.code_size;

  uint64_t mapped_code_start = 0;
  uint64_t mapped_code_size = 0;
  void *code = map_target_code(&opts, &mapped_code_start, &mapped_code_size);
  mapped_code_bytes = code;
  mapped_code_page_start = mapped_code_start;
  mapped_code_page_size = mapped_code_size;
  void *stack = map_fixed(
      opts.stack_target_start, opts.stack_size, PROT_READ | PROT_WRITE, "target-stack");

  install_signal_handlers();
  install_synthetic_empty_pipe(
      opts.synthetic_empty_pipe_read_fd, opts.synthetic_empty_pipe_write_fd);
  alarm((unsigned int)opts.timeout_seconds);
  if (sigsetjmp(resume_fault_jmp, 1) == 0) {
    jump_to_target(opts.target_address, opts.stack_pointer - 8u);
    alarm(0);
    print_return_event(&opts);
  } else {
    alarm(0);
    print_fault_event(&opts);
  }

  munmap(stack, (size_t)opts.stack_size);
  munmap(code, (size_t)mapped_code_size);
  (void)mapped_code_start;
  return 0;
}

#else

int main(int argc, char **argv) {
  (void)parse_args(argc, argv);
  fprintf(stderr, "native-actual-resume-trampoline: target-native resume requires linux/amd64\n");
  return 77;
}

#endif
