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
#include <limits.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <sched.h>
#include <string.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/ip_icmp.h>
#include <sys/auxv.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/mman.h>
#include <sys/signalfd.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <sys/timerfd.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>

extern char **environ;
#include <unistd.h>

#if defined(__linux__) && defined(__x86_64__)
#include <asm/prctl.h>
#endif

#ifndef MAP_FIXED_NOREPLACE
#define MAP_FIXED_NOREPLACE 0x100000
#endif
#ifndef AT_PAGESZ
#define AT_PAGESZ 6
#endif
#ifndef AT_CLKTCK
#define AT_CLKTCK 17
#endif
#ifndef AT_NULL
#define AT_NULL 0
#endif

#if defined(__linux__) && defined(__x86_64__)
#include <setjmp.h>
#include <signal.h>
#include <ucontext.h>
#endif

#define MAX_MATERIALIZED_MAPPINGS 32
#define MAX_NATIVE_RESTORE_STEPS 128
#define MAX_CLOEXEC_FDS 64
#define MAX_TRANSLATED_FRAME_SLOTS 8
#define MAX_CONTEXT_ARGV 16
#define MAX_CONTEXT_ENV 256
#define MAX_CONTEXT_STRING 512
#define STATE_CONSUMPTION_MARKER UINT64_C(0x5354415445434f4e)
#define STATE_CONSUMPTION_MASK UINT64_C(0x7f)
#define STATE_CHECK_MEMORY UINT64_C(0x01)
#define STATE_CHECK_STDIO UINT64_C(0x02)
#define STATE_CHECK_CLOSE_FD UINT64_C(0x04)
#define STATE_CHECK_REOPEN_FILE UINT64_C(0x08)
#define STATE_CHECK_PIPE UINT64_C(0x10)
#define STATE_CHECK_EVENTFD UINT64_C(0x20)
#define STATE_CHECK_TIMERFD UINT64_C(0x40)
#define STATE_CHECK_EPOLL UINT64_C(0x80)
#define STATE_CHECK_SIGNALFD UINT64_C(0x100)
#define STATE_CHECK_TCP_LISTENER UINT64_C(0x200)
#define STATE_CHECK_TCP_READINESS UINT64_C(0x400)
#define STATE_CHECK_TCP_ACTIVE UINT64_C(0x800)
#define STATE_CHECK_RAW_ICMP UINT64_C(0x1000)
#define STATE_CHECK_PING_SOCKET UINT64_C(0x2000)
#define TRANSLATED_RETURN_MARKER UINT64_C(0x52455455524e4a50)
#define TRANSLATED_FRAME_MARKER UINT64_C(0x4652414d45504153)
#define TRANSLATED_RESUME_MARKER UINT64_C(0x524553554d455041)
#define TRANSLATED_FRAME_REGISTER_MASK UINT64_C(0x1f)
#define TRANSLATED_FRAME_REGISTER_RBX UINT64_C(0x01)
#define TRANSLATED_FRAME_REGISTER_R12 UINT64_C(0x02)
#define TRANSLATED_FRAME_REGISTER_R13 UINT64_C(0x04)
#define TRANSLATED_FRAME_REGISTER_R14 UINT64_C(0x08)
#define TRANSLATED_FRAME_REGISTER_R15 UINT64_C(0x10)
#define RESUME_REGISTER_MARKER UINT64_C(0x52454753544f5245)
#define RESUME_RFLAGS_MARKER UINT64_C(0x52464c4147534f4b)
#define TLS_RESTORE_MARKER UINT64_C(0x544c534f4b504153)
#define TLS_TCB_MARKER UINT64_C(0x5443425041534f4b)
#define TLS_TCB_SELF_OFFSET UINT64_C(0x0)
#define TLS_TCB_MARKER_OFFSET UINT64_C(0x40)
#define SUPPORTED_RESUME_RFLAGS_MASK UINT64_C(0x8d7)
#define RESUME_RFLAGS_CONDITION_MASK UINT64_C(0x8d5)
#define REQUIRED_RESUME_RFLAGS_MASK UINT64_C(0x2)
#define RESUME_REGISTER_MASK UINT64_C(0x1ff)
#define RESUME_REGISTER_RAX UINT64_C(0x01)
#define RESUME_REGISTER_RSI UINT64_C(0x02)
#define RESUME_REGISTER_RDX UINT64_C(0x04)
#define RESUME_REGISTER_RCX UINT64_C(0x08)
#define RESUME_REGISTER_R8 UINT64_C(0x10)
#define RESUME_REGISTER_R9 UINT64_C(0x20)
#define RESUME_REGISTER_R10 UINT64_C(0x40)
#define RESUME_REGISTER_R11 UINT64_C(0x80)
#define RESUME_REGISTER_RDI UINT64_C(0x100)
#define NATIVE_INTERNAL_FD_MIN 64
#define MAX_UNWIND_ID 128

struct MemoryMaterialization {
  const char *source_file;
  uint64_t source_offset;
  uint64_t target_start;
  uint64_t size;
  int prot;
};

struct GuardMaterialization {
  uint64_t target_start;
  uint64_t size;
};

struct NativeU64Write {
  uint64_t target_address;
  uint64_t value;
  char bytes[17];
  char kind[32];
};

struct NativeStackGuard {
  uint64_t target_start;
  uint64_t size;
  char placement[16];
};

struct NativeRestoreStepSpec {
  char spec[1024];
};

struct NativeSignalRestoreState {
  bool requested;
  bool saved;
  bool applied;
  bool verify_requested;
  bool verified;
  bool restore_requested;
  bool restored;
  sigset_t saved_mask;
};

struct NativeActiveSyscallRestoreState {
  bool requested;
  size_t armed_count;
  size_t consumed_count;
  int timer_fds[MAX_NATIVE_RESTORE_STEPS];
};

struct NativeThreadRestoreState {
  bool requested;
  size_t spawned_count;
};

struct NativeProcessContextRestoreState {
  bool requested;
  bool argv_materialized;
  bool env_cleared;
  bool env_verified;
  bool env_value_verified;
  bool cwd_applied;
  bool cwd_verified;
  bool auxv_verified;
  bool auxv_policy_recorded;
  bool initial_stack_materialized;
  bool initial_stack_verified;
  uint64_t initial_stack_start;
  size_t env_set_count;
  size_t metadata_count;
  size_t consumed_count;
};

struct Options {
  const char *code_file;
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
  uint64_t resume_register_mask;
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
  bool has_translated_frame_callee_rbx;
  uint64_t translated_frame_callee_rbx;
  bool has_translated_frame_callee_r12;
  uint64_t translated_frame_callee_r12;
  bool has_translated_frame_callee_r13;
  uint64_t translated_frame_callee_r13;
  bool has_translated_frame_callee_r14;
  uint64_t translated_frame_callee_r14;
  bool has_translated_frame_callee_r15;
  uint64_t translated_frame_callee_r15;
  size_t translated_frame_slot_count;
  uint64_t translated_frame_slot_offsets[MAX_TRANSLATED_FRAME_SLOTS];
  uint64_t translated_frame_slot_values[MAX_TRANSLATED_FRAME_SLOTS];
  char translated_frame_slot_classes[MAX_TRANSLATED_FRAME_SLOTS][32];
  char translated_frame_unwind_id[MAX_UNWIND_ID];
  uint64_t stack_target_start;
  uint64_t stack_size;
  uint64_t stack_pointer;
  uint64_t timeout_seconds;
  int synthetic_empty_pipe_read_fd;
  int synthetic_empty_pipe_write_fd;
  char synthetic_pipe_initial_hex[512];
  int synthetic_empty_eventfd;
  bool has_synthetic_eventfd;
  int synthetic_eventfd;
  int synthetic_eventfd_duplicate;
  uint64_t synthetic_eventfd_initial_value;
  int synthetic_timerfd;
  char synthetic_timerfd_spec[1024];
  struct NativeRestoreStepSpec synthetic_signalfds[MAX_NATIVE_RESTORE_STEPS];
  size_t synthetic_signalfd_count;
  struct NativeRestoreStepSpec synthetic_epolls[MAX_NATIVE_RESTORE_STEPS];
  size_t synthetic_epoll_count;
  struct NativeRestoreStepSpec synthetic_tcp_listeners[MAX_NATIVE_RESTORE_STEPS];
  size_t synthetic_tcp_listener_count;
  struct NativeRestoreStepSpec synthetic_tcp_active_brokers[MAX_NATIVE_RESTORE_STEPS];
  size_t synthetic_tcp_active_broker_count;
  struct NativeRestoreStepSpec synthetic_raw_icmp[MAX_NATIVE_RESTORE_STEPS];
  size_t synthetic_raw_icmp_count;
  struct NativeRestoreStepSpec synthetic_ping_socket[MAX_NATIVE_RESTORE_STEPS];
  size_t synthetic_ping_socket_count;
  int cloexec_fds[MAX_CLOEXEC_FDS];
  size_t cloexec_fd_count;
  struct MemoryMaterialization materialized_memory[MAX_MATERIALIZED_MAPPINGS];
  size_t materialized_memory_count;
  struct GuardMaterialization materialized_guards[MAX_MATERIALIZED_MAPPINGS];
  size_t materialized_guard_count;
  struct NativeU64Write native_stack_window_writes[MAX_NATIVE_RESTORE_STEPS];
  size_t native_stack_window_write_count;
  struct NativeStackGuard native_stack_window_guards[MAX_NATIVE_RESTORE_STEPS];
  size_t native_stack_window_guard_count;
  struct NativeU64Write native_return_chain_writes[MAX_NATIVE_RESTORE_STEPS];
  size_t native_return_chain_write_count;
  struct NativeRestoreStepSpec native_private_memory_steps[MAX_NATIVE_RESTORE_STEPS];
  size_t native_private_memory_step_count;
  struct NativeRestoreStepSpec native_executable_mappings[MAX_NATIVE_RESTORE_STEPS];
  size_t native_executable_mapping_count;
  struct NativeRestoreStepSpec native_process_context_steps[MAX_NATIVE_RESTORE_STEPS];
  size_t native_process_context_step_count;
  struct NativeRestoreStepSpec native_signal_steps[MAX_NATIVE_RESTORE_STEPS];
  size_t native_signal_step_count;
  struct NativeRestoreStepSpec native_active_syscall_steps[MAX_NATIVE_RESTORE_STEPS];
  size_t native_active_syscall_step_count;
  struct NativeRestoreStepSpec native_thread_spawn_steps[MAX_NATIVE_RESTORE_STEPS];
  size_t native_thread_spawn_step_count;
};

static void usage(void) {
  fprintf(stderr,
      "usage: machinen-native-actual-resume-trampoline --code-file path "
      "--file-offset n --code-size n --target-address addr "
      "[--argument0 addr] [--state-report-address addr] [--target-fs-base addr] "
      "[--translated-return-address addr] [--translated-frame-pointer addr] "
      "[--translated-frame-cfa addr] [--translated-frame-return-address-slot addr] "
      "[--translated-frame-return-address addr] [--translated-frame-unwind-id id] "
      "[--translated-frame-callee-rbx addr] [--translated-frame-callee-r12 addr] "
      "[--translated-frame-callee-r13 addr] [--translated-frame-callee-r14 addr] "
      "[--translated-frame-callee-r15 addr] [--translated-frame-slot offset:value:class] "
      "[--resume-mode translated-frame] [--resume-rflags flags] [--resume-register-rax addr] "
      "[--resume-register-rdi addr] [--resume-register-rsi addr] [--resume-register-rdx addr] "
      "[--resume-register-rcx addr] [--resume-register-r8 addr] "
      "[--resume-register-r9 addr] [--resume-register-r10 addr] "
      "[--resume-register-r11 addr] --timeout-seconds n "
      "[--synthetic-empty-pipe-read-fd n] [--synthetic-empty-pipe-write-fd n] "
      "[--synthetic-empty-eventfd n] [--synthetic-eventfd spec] "
      "[--synthetic-timerfd n] [--synthetic-signalfd spec] [--synthetic-epoll spec] "
      "[--synthetic-tcp-listener spec] [--synthetic-tcp-active-broker spec] "
      "[--synthetic-raw-icmp spec] [--synthetic-ping-socket spec] [--set-cloexec-fd n] "
      "[--materialize-memory file:offset:target:size:perms] "
      "[--materialize-guard target:size] "
      "[--native-stack-window-write target:value:bytes:kind] "
      "[--native-stack-window-guard target:size:placement] "
      "[--native-return-chain-write target:value:bytes:kind] "
      "[--native-private-memory-step spec] [--native-executable-mapping spec] "
      "[--native-process-context-step spec] [--native-signal-restore-step spec] "
      "[--native-active-syscall-step spec] [--native-thread-spawn-step spec] "
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

static int parse_memory_prot(const char *value) {
  if (strlen(value) != 4u || value[2] == 'x') {
    fprintf(stderr, "native-actual-resume-trampoline: materialized memory must be non-executable\n");
    exit(2);
  }
  int prot = 0;
  if (value[0] == 'r') {
    prot |= PROT_READ;
  }
  if (value[1] == 'w') {
    prot |= PROT_WRITE;
  }
  return prot;
}

static char *next_spec_field(char **cursor, const char *field) {
  char *value = strsep(cursor, ":");
  if (!value || value[0] == '\0') {
    fprintf(stderr, "native-actual-resume-trampoline: materialized %s is missing\n", field);
    exit(2);
  }
  return value;
}

static void add_cloexec_fd(struct Options *opts, const char *value) {
  if (opts->cloexec_fd_count >= MAX_CLOEXEC_FDS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many cloexec fds\n");
    exit(2);
  }
  uint64_t fd = parse_u64(value, "set-cloexec-fd");
  if (fd > 1024u) {
    fprintf(stderr, "native-actual-resume-trampoline: cloexec fd is too large\n");
    exit(2);
  }
  opts->cloexec_fds[opts->cloexec_fd_count++] = (int)fd;
}

static void add_materialized_memory(struct Options *opts, const char *spec) {
  if (opts->materialized_memory_count >= MAX_MATERIALIZED_MAPPINGS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many materialized mappings\n");
    exit(2);
  }
  char *copy = strdup(spec);
  if (!copy) {
    fprintf(stderr, "native-actual-resume-trampoline: materialized memory allocation failed\n");
    exit(1);
  }
  char *cursor = copy;
  struct MemoryMaterialization *mapping =
      &opts->materialized_memory[opts->materialized_memory_count++];
  mapping->source_file = next_spec_field(&cursor, "source file");
  mapping->source_offset = parse_u64(next_spec_field(&cursor, "source offset"), "source offset");
  mapping->target_start = parse_u64(next_spec_field(&cursor, "target start"), "target start");
  mapping->size = parse_u64(next_spec_field(&cursor, "size"), "size");
  mapping->prot = parse_memory_prot(next_spec_field(&cursor, "permissions"));
}

static void copy_resume_mode(struct Options *opts, const char *value) {
  if (!streq(value, "translated-frame")) {
    fprintf(stderr, "native-actual-resume-trampoline: resume mode is unsupported\n");
    exit(2);
  }
  snprintf(opts->resume_mode, sizeof(opts->resume_mode), "%s", value);
  opts->has_resume_mode = true;
}

static void copy_unwind_id(struct Options *opts, const char *value) {
  size_t length = strlen(value);
  if (length == 0 || length >= sizeof(opts->translated_frame_unwind_id)) {
    fprintf(stderr, "native-actual-resume-trampoline: translated frame unwind id is invalid\n");
    exit(2);
  }
  memcpy(opts->translated_frame_unwind_id, value, length + 1u);
}

static void add_translated_frame_slot(struct Options *opts, const char *spec) {
  if (opts->translated_frame_slot_count >= MAX_TRANSLATED_FRAME_SLOTS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many translated frame slots\n");
    exit(2);
  }
  char *copy = strdup(spec);
  if (!copy) {
    fprintf(stderr, "native-actual-resume-trampoline: frame slot allocation failed\n");
    exit(1);
  }
  char *cursor = copy;
  size_t index = opts->translated_frame_slot_count++;
  opts->translated_frame_slot_offsets[index] = parse_u64(next_spec_field(&cursor, "frame slot offset"), "frame slot offset");
  opts->translated_frame_slot_values[index] = parse_u64(next_spec_field(&cursor, "frame slot value"), "frame slot value");
  const char *slot_class = next_spec_field(&cursor, "frame slot class");
  if (!streq(slot_class, "non-pointer-data")) {
    fprintf(stderr, "native-actual-resume-trampoline: frame slot class is unsupported\n");
    exit(2);
  }
  snprintf(opts->translated_frame_slot_classes[index], sizeof(opts->translated_frame_slot_classes[0]), "%s", slot_class);
}

static void add_materialized_guard(struct Options *opts, const char *spec) {
  if (opts->materialized_guard_count >= MAX_MATERIALIZED_MAPPINGS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many guard mappings\n");
    exit(2);
  }
  char *copy = strdup(spec);
  if (!copy) {
    fprintf(stderr, "native-actual-resume-trampoline: guard allocation failed\n");
    exit(1);
  }
  char *cursor = copy;
  struct GuardMaterialization *guard = &opts->materialized_guards[opts->materialized_guard_count++];
  guard->target_start = parse_u64(next_spec_field(&cursor, "guard target start"), "guard target start");
  guard->size = parse_u64(next_spec_field(&cursor, "guard size"), "guard size");
}

static void copy_step_spec(struct NativeRestoreStepSpec *dst, const char *spec) {
  if (strlen(spec) >= sizeof(dst->spec)) {
    fprintf(stderr, "native-actual-resume-trampoline: native restore step is too long\n");
    exit(2);
  }
  snprintf(dst->spec, sizeof(dst->spec), "%s", spec);
}

static void add_native_u64_write(
    struct NativeU64Write *writes, size_t *count, const char *spec, const char *label) {
  if (*count >= MAX_NATIVE_RESTORE_STEPS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many %s writes\n", label);
    exit(2);
  }
  char *copy = strdup(spec);
  if (!copy) {
    fprintf(stderr, "native-actual-resume-trampoline: native write allocation failed\n");
    exit(1);
  }
  char *cursor = copy;
  struct NativeU64Write *write = &writes[(*count)++];
  write->target_address = parse_u64(next_spec_field(&cursor, "native write target"), "native write target");
  write->value = parse_u64(next_spec_field(&cursor, "native write value"), "native write value");
  const char *bytes = next_spec_field(&cursor, "native write bytes");
  if (strlen(bytes) != 16u) {
    fprintf(stderr, "native-actual-resume-trampoline: native write bytes must be 8 bytes\n");
    exit(2);
  }
  snprintf(write->bytes, sizeof(write->bytes), "%s", bytes);
  const char *kind = next_spec_field(&cursor, "native write kind");
  if (strlen(kind) == 0 || strlen(kind) >= sizeof(write->kind)) {
    fprintf(stderr, "native-actual-resume-trampoline: native write kind is invalid\n");
    exit(2);
  }
  snprintf(write->kind, sizeof(write->kind), "%s", kind);
}

static void add_native_stack_window_guard(struct Options *opts, const char *spec) {
  if (opts->native_stack_window_guard_count >= MAX_NATIVE_RESTORE_STEPS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many native stack guards\n");
    exit(2);
  }
  char *copy = strdup(spec);
  if (!copy) {
    fprintf(stderr, "native-actual-resume-trampoline: native stack guard allocation failed\n");
    exit(1);
  }
  char *cursor = copy;
  struct NativeStackGuard *guard = &opts->native_stack_window_guards[opts->native_stack_window_guard_count++];
  guard->target_start = parse_u64(next_spec_field(&cursor, "native stack guard target"), "native stack guard target");
  guard->size = parse_u64(next_spec_field(&cursor, "native stack guard size"), "native stack guard size");
  const char *placement = next_spec_field(&cursor, "native stack guard placement");
  if (!streq(placement, "below") && !streq(placement, "above")) {
    fprintf(stderr, "native-actual-resume-trampoline: native stack guard placement is invalid\n");
    exit(2);
  }
  snprintf(guard->placement, sizeof(guard->placement), "%s", placement);
}

static void add_native_step(struct NativeRestoreStepSpec *steps, size_t *count, const char *spec, const char *label) {
  if (*count >= MAX_NATIVE_RESTORE_STEPS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many %s steps\n", label);
    exit(2);
  }
  copy_step_spec(&steps[(*count)++], spec);
}

static uint64_t native_step_u64(const char *spec, const char *name, const char *label);
static bool native_step_has_value(const char *spec, const char *name);
static void native_step_string(
    const char *spec, const char *name, char *out, size_t out_size, const char *label);
static void print_target_refusal(const char *code, const char *reason);
static void hex_to_bytes(const char *hex, uint8_t *out, size_t *out_len, size_t max_len);

static struct Options parse_args(int argc, char **argv) {
  struct Options opts = {0};
  opts.timeout_seconds = 1;
  opts.synthetic_empty_pipe_read_fd = -1;
  opts.synthetic_empty_pipe_write_fd = -1;
  opts.synthetic_empty_eventfd = -1;
  opts.synthetic_eventfd = -1;
  opts.synthetic_eventfd_duplicate = -1;
  opts.synthetic_timerfd = -1;
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
    } else if (streq(argv[i], "--argument0")) {
      if (++i >= argc) {
        usage();
      }
      opts.argument0 = parse_u64(argv[i], "argument0");
      opts.has_argument0 = true;
    } else if (streq(argv[i], "--state-report-address")) {
      if (++i >= argc) {
        usage();
      }
      opts.state_report_address = parse_u64(argv[i], "state-report-address");
      opts.has_state_report_address = true;
    } else if (streq(argv[i], "--target-fs-base")) {
      if (++i >= argc) {
        usage();
      }
      opts.target_fs_base = parse_u64(argv[i], "target-fs-base");
      opts.has_target_fs_base = true;
    } else if (streq(argv[i], "--translated-return-address")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_return_address = parse_u64(argv[i], "translated-return-address");
      opts.has_translated_return_address = true;
    } else if (streq(argv[i], "--translated-frame-pointer")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_pointer = parse_u64(argv[i], "translated-frame-pointer");
      opts.has_translated_frame = true;
    } else if (streq(argv[i], "--translated-frame-cfa")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_cfa = parse_u64(argv[i], "translated-frame-cfa");
    } else if (streq(argv[i], "--translated-frame-return-address-slot")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_return_address_slot = parse_u64(argv[i], "translated-frame-return-address-slot");
    } else if (streq(argv[i], "--translated-frame-return-address")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_return_address = parse_u64(argv[i], "translated-frame-return-address");
    } else if (streq(argv[i], "--translated-frame-unwind-id")) {
      if (++i >= argc) {
        usage();
      }
      copy_unwind_id(&opts, argv[i]);
    } else if (streq(argv[i], "--translated-frame-callee-rbx")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_callee_rbx = parse_u64(argv[i], "translated-frame-callee-rbx");
      opts.has_translated_frame_callee_rbx = true;
    } else if (streq(argv[i], "--translated-frame-callee-r12")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_callee_r12 = parse_u64(argv[i], "translated-frame-callee-r12");
      opts.has_translated_frame_callee_r12 = true;
    } else if (streq(argv[i], "--translated-frame-callee-r13")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_callee_r13 = parse_u64(argv[i], "translated-frame-callee-r13");
      opts.has_translated_frame_callee_r13 = true;
    } else if (streq(argv[i], "--translated-frame-callee-r14")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_callee_r14 = parse_u64(argv[i], "translated-frame-callee-r14");
      opts.has_translated_frame_callee_r14 = true;
    } else if (streq(argv[i], "--translated-frame-callee-r15")) {
      if (++i >= argc) {
        usage();
      }
      opts.translated_frame_callee_r15 = parse_u64(argv[i], "translated-frame-callee-r15");
      opts.has_translated_frame_callee_r15 = true;
    } else if (streq(argv[i], "--translated-frame-slot")) {
      if (++i >= argc) {
        usage();
      }
      add_translated_frame_slot(&opts, argv[i]);
    } else if (streq(argv[i], "--resume-mode")) {
      if (++i >= argc) {
        usage();
      }
      copy_resume_mode(&opts, argv[i]);
    } else if (streq(argv[i], "--resume-rflags")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_rflags = parse_u64(argv[i], "resume-rflags");
      opts.has_resume_rflags = true;
    } else if (streq(argv[i], "--resume-register-rax")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_rax = parse_u64(argv[i], "resume-register-rax");
      opts.resume_register_mask |= RESUME_REGISTER_RAX;
    } else if (streq(argv[i], "--resume-register-rdi")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_rdi = parse_u64(argv[i], "resume-register-rdi");
      opts.resume_register_mask |= RESUME_REGISTER_RDI;
    } else if (streq(argv[i], "--resume-register-rsi")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_rsi = parse_u64(argv[i], "resume-register-rsi");
      opts.resume_register_mask |= RESUME_REGISTER_RSI;
    } else if (streq(argv[i], "--resume-register-rdx")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_rdx = parse_u64(argv[i], "resume-register-rdx");
      opts.resume_register_mask |= RESUME_REGISTER_RDX;
    } else if (streq(argv[i], "--resume-register-rcx")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_rcx = parse_u64(argv[i], "resume-register-rcx");
      opts.resume_register_mask |= RESUME_REGISTER_RCX;
    } else if (streq(argv[i], "--resume-register-r8")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_r8 = parse_u64(argv[i], "resume-register-r8");
      opts.resume_register_mask |= RESUME_REGISTER_R8;
    } else if (streq(argv[i], "--resume-register-r9")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_r9 = parse_u64(argv[i], "resume-register-r9");
      opts.resume_register_mask |= RESUME_REGISTER_R9;
    } else if (streq(argv[i], "--resume-register-r10")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_r10 = parse_u64(argv[i], "resume-register-r10");
      opts.resume_register_mask |= RESUME_REGISTER_R10;
    } else if (streq(argv[i], "--resume-register-r11")) {
      if (++i >= argc) {
        usage();
      }
      opts.resume_register_r11 = parse_u64(argv[i], "resume-register-r11");
      opts.resume_register_mask |= RESUME_REGISTER_R11;
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
    } else if (streq(argv[i], "--synthetic-empty-eventfd")) {
      if (++i >= argc) {
        usage();
      }
      uint64_t fd = parse_u64(argv[i], "synthetic-empty-eventfd");
      if (fd > 1024u) {
        fprintf(stderr, "native-actual-resume-trampoline: synthetic fd is too large\n");
        exit(2);
      }
      opts.synthetic_empty_eventfd = (int)fd;
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
    } else if (streq(argv[i], "--synthetic-empty-pipe-initial-hex")) {
      if (++i >= argc) {
        usage();
      }
      if (strlen(argv[i]) >= sizeof(opts.synthetic_pipe_initial_hex)) {
        fprintf(stderr, "native-actual-resume-trampoline: synthetic pipe initial bytes are too large\n");
        exit(2);
      }
      snprintf(opts.synthetic_pipe_initial_hex, sizeof(opts.synthetic_pipe_initial_hex), "%s", argv[i]);
    } else if (streq(argv[i], "--synthetic-eventfd")) {
      if (++i >= argc) {
        usage();
      }
      uint64_t fd = native_step_u64(argv[i], "fd", "synthetic-eventfd");
      uint64_t initial_value = native_step_u64(argv[i], "initialValue", "synthetic-eventfd");
      uint64_t duplicate_fd = native_step_has_value(argv[i], "duplicateFd")
          ? native_step_u64(argv[i], "duplicateFd", "synthetic-eventfd")
          : UINT64_MAX;
      if (native_step_has_value(argv[i], "expectedRefusalCode")) {
        char code[128];
        char reason[128] = "eventfd-alias-target-native-refusal";
        native_step_string(argv[i], "expectedRefusalCode", code, sizeof(code), "synthetic-eventfd");
        if (native_step_has_value(argv[i], "expectedRefusalReason")) {
          native_step_string(argv[i], "expectedRefusalReason", reason, sizeof(reason), "synthetic-eventfd");
        }
        print_target_refusal(code, reason);
        exit(1);
      }
      if (fd > 1024u || initial_value == UINT64_MAX ||
          (duplicate_fd != UINT64_MAX && (duplicate_fd > 1024u || duplicate_fd == fd))) {
        fprintf(stderr, "native-actual-resume-trampoline: synthetic eventfd spec is invalid\n");
        exit(2);
      }
      opts.has_synthetic_eventfd = true;
      opts.synthetic_eventfd = (int)fd;
      opts.synthetic_eventfd_duplicate = duplicate_fd == UINT64_MAX ? -1 : (int)duplicate_fd;
      opts.synthetic_eventfd_initial_value = initial_value;
    } else if (streq(argv[i], "--synthetic-timerfd")) {
      if (++i >= argc) {
        usage();
      }
      uint64_t fd = strchr(argv[i], '=') ? native_step_u64(argv[i], "fd", "synthetic-timerfd") : parse_u64(argv[i], "synthetic-timerfd");
      if (fd > 1024u) {
        fprintf(stderr, "native-actual-resume-trampoline: synthetic fd is too large\n");
        exit(2);
      }
      opts.synthetic_timerfd = (int)fd;
      snprintf(opts.synthetic_timerfd_spec, sizeof(opts.synthetic_timerfd_spec), "%s", strchr(argv[i], '=') ? argv[i] : "");
    } else if (streq(argv[i], "--synthetic-signalfd")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.synthetic_signalfds, &opts.synthetic_signalfd_count, argv[i], "synthetic-signalfd");
    } else if (streq(argv[i], "--synthetic-epoll")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.synthetic_epolls, &opts.synthetic_epoll_count, argv[i], "synthetic-epoll");
    } else if (streq(argv[i], "--synthetic-tcp-listener")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.synthetic_tcp_listeners, &opts.synthetic_tcp_listener_count, argv[i], "synthetic-tcp-listener");
    } else if (streq(argv[i], "--synthetic-tcp-active-broker")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.synthetic_tcp_active_brokers, &opts.synthetic_tcp_active_broker_count, argv[i], "synthetic-tcp-active-broker");
    } else if (streq(argv[i], "--synthetic-raw-icmp")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.synthetic_raw_icmp, &opts.synthetic_raw_icmp_count, argv[i], "synthetic-raw-icmp");
    } else if (streq(argv[i], "--synthetic-ping-socket")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.synthetic_ping_socket, &opts.synthetic_ping_socket_count, argv[i], "synthetic-ping-socket");
    } else if (streq(argv[i], "--set-cloexec-fd")) {
      if (++i >= argc) {
        usage();
      }
      add_cloexec_fd(&opts, argv[i]);
    } else if (streq(argv[i], "--materialize-memory")) {
      if (++i >= argc) {
        usage();
      }
      add_materialized_memory(&opts, argv[i]);
    } else if (streq(argv[i], "--materialize-guard")) {
      if (++i >= argc) {
        usage();
      }
      add_materialized_guard(&opts, argv[i]);
    } else if (streq(argv[i], "--native-stack-window-write")) {
      if (++i >= argc) {
        usage();
      }
      add_native_u64_write(
          opts.native_stack_window_writes, &opts.native_stack_window_write_count, argv[i], "stack-window");
    } else if (streq(argv[i], "--native-stack-window-guard")) {
      if (++i >= argc) {
        usage();
      }
      add_native_stack_window_guard(&opts, argv[i]);
    } else if (streq(argv[i], "--native-return-chain-write")) {
      if (++i >= argc) {
        usage();
      }
      add_native_u64_write(
          opts.native_return_chain_writes, &opts.native_return_chain_write_count, argv[i], "return-chain");
    } else if (streq(argv[i], "--native-private-memory-step")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.native_private_memory_steps, &opts.native_private_memory_step_count, argv[i], "private-memory");
    } else if (streq(argv[i], "--native-executable-mapping")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.native_executable_mappings, &opts.native_executable_mapping_count, argv[i], "executable-mapping");
    } else if (streq(argv[i], "--native-process-context-step")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.native_process_context_steps, &opts.native_process_context_step_count, argv[i], "process-context");
    } else if (streq(argv[i], "--native-signal-restore-step")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.native_signal_steps, &opts.native_signal_step_count, argv[i], "signal-restore");
    } else if (streq(argv[i], "--native-active-syscall-step")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.native_active_syscall_steps, &opts.native_active_syscall_step_count, argv[i], "active-syscall");
    } else if (streq(argv[i], "--native-thread-spawn-step")) {
      if (++i >= argc) {
        usage();
      }
      add_native_step(opts.native_thread_spawn_steps, &opts.native_thread_spawn_step_count, argv[i], "thread-spawn");
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
static volatile uint64_t resume_return_value __attribute__((used)) = 0;
static uint64_t host_rsp_before_jump __attribute__((used)) = 0;
static uint64_t host_fs_before_jump __attribute__((used)) = 0;
static uint64_t jump_target_fs_base __attribute__((used)) = 0;
static uint64_t host_rbx_before_jump __attribute__((used)) = 0;
static uint64_t host_rbp_before_jump __attribute__((used)) = 0;
static uint64_t host_r12_before_jump __attribute__((used)) = 0;
static uint64_t host_r13_before_jump __attribute__((used)) = 0;
static uint64_t host_r14_before_jump __attribute__((used)) = 0;
static uint64_t host_r15_before_jump __attribute__((used)) = 0;
static uint64_t jump_entry_address __attribute__((used)) = 0;
static uint64_t jump_initial_rsp __attribute__((used)) = 0;
static uint64_t jump_argument0 __attribute__((used)) = 0;
static uint64_t jump_translated_return_address __attribute__((used)) = 0;
static uint64_t jump_translated_frame_pointer __attribute__((used)) = 0;
static uint64_t jump_translated_frame_rbx __attribute__((used)) = 0;
static uint64_t jump_translated_frame_r12 __attribute__((used)) = 0;
static uint64_t jump_translated_frame_r13 __attribute__((used)) = 0;
static uint64_t jump_translated_frame_r14 __attribute__((used)) = 0;
static uint64_t jump_translated_frame_r15 __attribute__((used)) = 0;
static uint64_t jump_resume_rflags __attribute__((used)) = 0;
static uint64_t jump_resume_register_rax __attribute__((used)) = 0;
static uint64_t jump_resume_register_rdi __attribute__((used)) = 0;
static uint64_t jump_resume_register_rsi __attribute__((used)) = 0;
static uint64_t jump_resume_register_rdx __attribute__((used)) = 0;
static uint64_t jump_resume_register_rcx __attribute__((used)) = 0;
static uint64_t jump_resume_register_r8 __attribute__((used)) = 0;
static uint64_t jump_resume_register_r9 __attribute__((used)) = 0;
static uint64_t jump_resume_register_r10 __attribute__((used)) = 0;
static uint64_t jump_resume_register_r11 __attribute__((used)) = 0;
static struct NativeSignalRestoreState native_signal_restore_state = {0};
static struct NativeProcessContextRestoreState native_process_context_restore_state = {0};
static char target_context_argv_token[256];
static char target_context_argv_storage[MAX_CONTEXT_ARGV][MAX_CONTEXT_STRING];
static const char *target_context_argv[MAX_CONTEXT_ARGV + 1];
static char target_context_env_keys[MAX_CONTEXT_ENV][MAX_CONTEXT_STRING];
static char target_context_env_values[MAX_CONTEXT_ENV][MAX_CONTEXT_STRING];
static size_t target_context_argc = 0;
static size_t target_context_env_count = 0;
static struct NativeActiveSyscallRestoreState native_active_syscall_restore_state = {0};
static struct NativeThreadRestoreState native_thread_restore_state = {0};

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

static void materialize_memory_mapping(const struct MemoryMaterialization *mapping) {
  void *mapped = map_fixed(mapping->target_start, mapping->size, PROT_READ | PROT_WRITE, "materialized-memory");
  int fd = open(mapping->source_file, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr,
        "native-actual-resume-trampoline: open materialized memory failed for %s: %s\n",
        mapping->source_file,
        strerror(errno));
    exit(1);
  }
  read_exact(fd, mapped, mapping->size, mapping->source_offset);
  close(fd);
  if (mprotect(mapped, (size_t)mapping->size, mapping->prot) != 0) {
    fprintf(stderr,
        "native-actual-resume-trampoline: materialized memory mprotect failed: %s\n",
        strerror(errno));
    exit(1);
  }
}

static void materialize_guard_mapping(const struct GuardMaterialization *guard) {
  (void)map_fixed(guard->target_start, guard->size, PROT_NONE, "materialized-guard");
}

static void materialize_descriptor_memory(const struct Options *opts) {
  for (size_t i = 0; i < opts->materialized_memory_count; i++) {
    materialize_memory_mapping(&opts->materialized_memory[i]);
  }
  for (size_t i = 0; i < opts->materialized_guard_count; i++) {
    materialize_guard_mapping(&opts->materialized_guards[i]);
  }
}

static void materialize_native_stack_window_guards(const struct Options *opts) {
  for (size_t i = 0; i < opts->native_stack_window_guard_count; i++) {
    const struct NativeStackGuard *guard = &opts->native_stack_window_guards[i];
    struct GuardMaterialization materialization = {
        .target_start = guard->target_start,
        .size = guard->size,
    };
    materialize_guard_mapping(&materialization);
  }
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

static bool address_inside_stack(const struct Options *opts, uint64_t address, uint64_t size) {
  return address >= opts->stack_target_start && size <= opts->stack_size &&
      address + size <= opts->stack_target_start + opts->stack_size;
}

static bool address_inside_writable_materialized_memory(
    const struct Options *opts, uint64_t address, uint64_t size) {
  for (size_t i = 0; i < opts->materialized_memory_count; i++) {
    const struct MemoryMaterialization *mapping = &opts->materialized_memory[i];
    if ((mapping->prot & PROT_WRITE) == 0) {
      continue;
    }
    if (address >= mapping->target_start && size <= mapping->size &&
        address + size <= mapping->target_start + mapping->size) {
      return true;
    }
  }
  return false;
}

static void validate_target_tls_options(const struct Options *opts) {
  if (!opts->has_target_fs_base) {
    return;
  }
  if (!opts->has_state_report_address) {
    fprintf(stderr, "native-actual-resume-trampoline: target fs base requires a state report\n");
    exit(2);
  }
  if (opts->target_fs_base == 0 || opts->target_fs_base % 16u != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: target fs base must be non-zero and 16-byte aligned\n");
    exit(2);
  }
}

static void validate_resume_rflags_options(const struct Options *opts) {
  if (!opts->has_resume_rflags) {
    return;
  }
  if ((opts->resume_rflags & REQUIRED_RESUME_RFLAGS_MASK) != REQUIRED_RESUME_RFLAGS_MASK) {
    fprintf(stderr, "native-actual-resume-trampoline: resumeRflags must include reserved bit 1\n");
    exit(2);
  }
  if ((opts->resume_rflags & ~SUPPORTED_RESUME_RFLAGS_MASK) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: resumeRflags contains unsupported non-condition bits\n");
    exit(2);
  }
  if (!opts->has_state_report_address) {
    fprintf(stderr, "native-actual-resume-trampoline: resume rflags restore requires a state report\n");
    exit(2);
  }
}

static void validate_resume_register_options(const struct Options *opts) {
  if (opts->resume_register_mask == 0) {
    return;
  }
  if (opts->resume_register_mask != RESUME_REGISTER_MASK) {
    fprintf(stderr, "native-actual-resume-trampoline: resume register bank is incomplete\n");
    exit(2);
  }
  if (!opts->has_state_report_address) {
    fprintf(stderr, "native-actual-resume-trampoline: resume register restore requires a state report\n");
    exit(2);
  }
  if (opts->has_argument0) {
    fprintf(stderr, "native-actual-resume-trampoline: argument0 cannot be combined with a resume register bank\n");
    exit(2);
  }
}

static void validate_translated_frame_options(const struct Options *opts) {
  if (!opts->has_translated_frame) {
    if (opts->has_resume_mode) {
      fprintf(stderr, "native-actual-resume-trampoline: translated resume mode requires a frame\n");
      exit(2);
    }
    return;
  }
  if (opts->has_resume_mode && !opts->has_state_report_address) {
    fprintf(stderr, "native-actual-resume-trampoline: translated resume mode requires a state report\n");
    exit(2);
  }
  if (!opts->has_translated_return_address || opts->translated_frame_return_address != opts->translated_return_address) {
    fprintf(stderr, "native-actual-resume-trampoline: translated frame return address is unresolved\n");
    exit(2);
  }
  if (!opts->has_translated_frame_callee_rbx || !opts->has_translated_frame_callee_r12 ||
      !opts->has_translated_frame_callee_r13 || !opts->has_translated_frame_callee_r14 ||
      !opts->has_translated_frame_callee_r15 || opts->translated_frame_slot_count == 0) {
    fprintf(stderr, "native-actual-resume-trampoline: translated frame is incomplete\n");
    exit(2);
  }
  if (opts->translated_frame_unwind_id[0] == '\0' ||
      strncmp(opts->translated_frame_unwind_id, "target:", strlen("target:")) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: translated frame unwind id is unsupported\n");
    exit(2);
  }
  if (!address_inside_stack(opts, opts->translated_frame_pointer, 8u) ||
      !address_inside_stack(opts, opts->translated_frame_cfa, 8u) ||
      !address_inside_stack(opts, opts->translated_frame_return_address_slot, 8u)) {
    fprintf(stderr, "native-actual-resume-trampoline: translated frame addresses are outside target stack\n");
    exit(2);
  }
  for (size_t i = 0; i < opts->translated_frame_slot_count; i++) {
    if (!address_inside_stack(opts, opts->translated_frame_pointer + opts->translated_frame_slot_offsets[i], 8u)) {
      fprintf(stderr, "native-actual-resume-trampoline: translated frame slot is outside target stack\n");
      exit(2);
    }
  }
}

static void install_synthetic_empty_pipe(int read_fd, int write_fd, const char *initial_hex) {
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
  if (initial_hex != NULL && initial_hex[0] != '\0') {
    uint8_t initial[256];
    size_t initial_len = 0;
    hex_to_bytes(initial_hex, initial, &initial_len, sizeof(initial));
    int write_target = write_fd >= 0 ? write_fd : pipe_fds[1];
    ssize_t wrote = write(write_target, initial, initial_len);
    if (wrote != (ssize_t)initial_len) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic pipe initial write failed: %s\n", strerror(errno));
      exit(1);
    }
  }
  // Keep a write end open so the read end is not EOF/readable. This makes the
  // modeled one-fd ppoll proof timeout-driven instead of readiness-driven.
}

static uint64_t native_step_u64(const char *spec, const char *name, const char *label);
static void native_step_string(
    const char *spec, const char *name, char *dst, size_t dst_size, const char *label);
static bool native_step_has_value(const char *spec, const char *name);
static bool native_step_bool(const char *spec, const char *name, const char *label);
static const char *native_step_value(const char *spec, const char *name, char *scratch, size_t scratch_size);

static void install_synthetic_timerfd_with_spec(int target_fd, const char *spec) {
  if (target_fd < 0) {
    return;
  }
  int clock_id = CLOCK_MONOTONIC;
  uint64_t settime_flags = 0;
  struct itimerspec timer = {0};
  bool has_descriptor_state = spec && spec[0] && native_step_has_value(spec, "clockId");
  if (has_descriptor_state) {
    uint64_t parsed_clock = native_step_u64(spec, "clockId", "synthetic-timerfd");
    settime_flags = native_step_u64(spec, "settimeFlags", "synthetic-timerfd");
    uint64_t value_seconds = native_step_u64(spec, "valueSeconds", "synthetic-timerfd");
    uint64_t value_nanoseconds = native_step_u64(spec, "valueNanoseconds", "synthetic-timerfd");
    uint64_t interval_seconds = native_step_u64(spec, "intervalSeconds", "synthetic-timerfd");
    uint64_t interval_nanoseconds = native_step_u64(spec, "intervalNanoseconds", "synthetic-timerfd");
    if (parsed_clock > INT_MAX || value_nanoseconds > 999999999u || interval_nanoseconds > 999999999u) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic timerfd descriptor is invalid\n");
      exit(2);
    }
    clock_id = (int)parsed_clock;
    timer.it_value.tv_sec = (time_t)value_seconds;
    timer.it_value.tv_nsec = (long)value_nanoseconds;
    timer.it_interval.tv_sec = (time_t)interval_seconds;
    timer.it_interval.tv_nsec = (long)interval_nanoseconds;
  }
  int fd = timerfd_create(clock_id, TFD_CLOEXEC);
  if (fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic timerfd failed: %s\n", strerror(errno));
    exit(1);
  }
  if (fd != target_fd) {
    if (dup2(fd, target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic timerfd dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(fd);
  }
  if (has_descriptor_state && timerfd_settime(target_fd, (int)settime_flags, &timer, NULL) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic timerfd settime failed: %s\n", strerror(errno));
    exit(1);
  }
  if (fcntl(target_fd, F_SETFD, FD_CLOEXEC) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic timerfd cloexec failed: %s\n", strerror(errno));
    exit(1);
  }
}

static void install_synthetic_timerfd(int target_fd) {
  install_synthetic_timerfd_with_spec(target_fd, NULL);
}

static void install_synthetic_eventfd_alias(int target_fd, int duplicate_fd, uint64_t initial_value) {
  if (target_fd < 0) {
    return;
  }
  if (duplicate_fd > 1024 || initial_value == UINT64_MAX) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic eventfd initial value is unsupported\n");
    exit(2);
  }
  int fd = eventfd(0, EFD_CLOEXEC);
  if (fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic eventfd failed: %s\n", strerror(errno));
    exit(1);
  }
  if (fd != target_fd) {
    if (dup2(fd, target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic eventfd dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(fd);
  }
  if (duplicate_fd >= 0 && dup2(target_fd, duplicate_fd) < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic eventfd alias dup2 failed: %s\n", strerror(errno));
    exit(1);
  }
  if (initial_value != 0) {
    ssize_t wrote = write(target_fd, &initial_value, sizeof(initial_value));
    if (wrote != (ssize_t)sizeof(initial_value)) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic eventfd write failed: %s\n", strerror(errno));
      exit(1);
    }
  }
  if (fcntl(target_fd, F_SETFD, FD_CLOEXEC) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic eventfd cloexec failed: %s\n", strerror(errno));
    exit(1);
  }
}

static void install_synthetic_eventfd(int target_fd, uint64_t initial_value) {
  install_synthetic_eventfd_alias(target_fd, -1, initial_value);
}

static void install_synthetic_empty_eventfd(int target_fd) {
  install_synthetic_eventfd(target_fd, 0);
}

static void sigset_from_mask(sigset_t *set, uint64_t mask);

static void install_synthetic_signalfd(const char *spec) {
  uint64_t target_fd = native_step_u64(spec, "fd", "synthetic-signalfd");
  uint64_t signal_mask = native_step_u64(spec, "signalMask", "synthetic-signalfd");
  uint64_t flags = native_step_u64(spec, "flags", "synthetic-signalfd");
  if (target_fd > 1024u || (flags & ~(uint64_t)SFD_NONBLOCK) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic signalfd descriptor is invalid\n");
    exit(2);
  }
  sigset_t mask;
  sigset_from_mask(&mask, signal_mask);
  int signal_fd = signalfd(-1, &mask, (int)flags);
  if (signal_fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic signalfd create failed: %s\n", strerror(errno));
    exit(2);
  }
  if (signal_fd != (int)target_fd) {
    if (dup2(signal_fd, (int)target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic signalfd dup2 failed: %s\n", strerror(errno));
      exit(2);
    }
    close(signal_fd);
  }
}

static void install_synthetic_signalfds(const struct Options *opts) {
  for (size_t i = 0; i < opts->synthetic_signalfd_count; i++) {
    install_synthetic_signalfd(opts->synthetic_signalfds[i].spec);
  }
}

static void install_synthetic_epoll(const char *spec) {
  uint64_t target_fd = native_step_u64(spec, "fd", "synthetic-epoll");
  uint64_t watch_count = native_step_u64(spec, "watchCount", "synthetic-epoll");
  if (target_fd > 1024u || watch_count == 0 || watch_count > 16u) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic epoll descriptor is invalid\n");
    exit(2);
  }
  int epoll_fd = epoll_create1(EPOLL_CLOEXEC);
  if (epoll_fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: synthetic epoll create failed: %s\n", strerror(errno));
    exit(1);
  }
  if (epoll_fd != (int)target_fd) {
    if (dup2(epoll_fd, (int)target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic epoll dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(epoll_fd);
    epoll_fd = (int)target_fd;
  }
  for (uint64_t index = 0; index < watch_count; index++) {
    char field[32];
    snprintf(field, sizeof(field), "watch%" PRIu64 "Fd", index);
    int watch_fd = (int)native_step_u64(spec, field, "synthetic-epoll");
    snprintf(field, sizeof(field), "watch%" PRIu64 "Events", index);
    uint32_t events = (uint32_t)native_step_u64(spec, field, "synthetic-epoll");
    snprintf(field, sizeof(field), "watch%" PRIu64 "Data", index);
    uint64_t data = native_step_u64(spec, field, "synthetic-epoll");
    struct epoll_event event = {0};
    event.events = events;
    event.data.u64 = data;
    if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, watch_fd, &event) != 0) {
      fprintf(stderr, "native-actual-resume-trampoline: synthetic epoll_ctl add failed: %s\n", strerror(errno));
      exit(1);
    }
  }
}

static void install_synthetic_epolls(const struct Options *opts) {
  for (size_t i = 0; i < opts->synthetic_epoll_count; i++) {
    install_synthetic_epoll(opts->synthetic_epolls[i].spec);
  }
}

static void bind_loopback_listener(int fd, uint64_t port, uint64_t backlog, bool reuse_addr) {
  if (reuse_addr) {
    int yes = 1;
    if (setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, sizeof(yes)) != 0) {
      fprintf(stderr, "native-actual-resume-trampoline: tcp listener setsockopt failed: %s\n", strerror(errno));
      exit(1);
    }
  }
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)port);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp listener bind failed: %s\n", strerror(errno));
    exit(1);
  }
  if (listen(fd, (int)backlog) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp listener listen failed: %s\n", strerror(errno));
    exit(1);
  }
}

static int create_loopback_listener_from_spec(const char *spec, const char *label) {
  uint64_t port = native_step_u64(spec, "port", label);
  uint64_t backlog = native_step_u64(spec, "backlog", label);
  uint64_t reuse_addr = native_step_has_value(spec, "reuseAddr") ? native_step_u64(spec, "reuseAddr", label) : 0;
  if (port == 0 || port > 65535u || backlog == 0 || backlog > INT_MAX) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp listener spec is invalid\n");
    exit(2);
  }
  int fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp listener socket failed: %s\n", strerror(errno));
    exit(1);
  }
  bind_loopback_listener(fd, port, backlog, reuse_addr != 0);
  return fd;
}

static void install_synthetic_tcp_listener(const char *spec) {
  uint64_t target_fd = native_step_u64(spec, "fd", "synthetic-tcp-listener");
  if (target_fd > 1024u) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp listener fd is invalid\n");
    exit(2);
  }
  int fd = create_loopback_listener_from_spec(spec, "synthetic-tcp-listener");
  if (fd != (int)target_fd) {
    if (dup2(fd, (int)target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: tcp listener dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(fd);
  }
}

static void install_synthetic_tcp_listeners(const struct Options *opts) {
  for (size_t i = 0; i < opts->synthetic_tcp_listener_count; i++) {
    install_synthetic_tcp_listener(opts->synthetic_tcp_listeners[i].spec);
  }
}

static void hex_to_bytes(const char *hex, uint8_t *out, size_t *out_len, size_t max_len) {
  size_t len = strlen(hex);
  if ((len % 2u) != 0 || (len / 2u) > max_len) {
    fprintf(stderr, "native-actual-resume-trampoline: hex byte string is invalid\n");
    exit(2);
  }
  *out_len = len / 2u;
  for (size_t i = 0; i < *out_len; i++) {
    char byte_hex[3] = {hex[i * 2u], hex[i * 2u + 1u], '\0'};
    out[i] = (uint8_t)strtoul(byte_hex, NULL, 16);
  }
}

static int connect_loopback_client(uint64_t port) {
  int fd = socket(AF_INET, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp active socket failed: %s\n", strerror(errno));
    exit(1);
  }
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_port = htons((uint16_t)port);
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp active connect failed: %s\n", strerror(errno));
    exit(1);
  }
  return fd;
}

static void install_synthetic_tcp_active_broker(const char *spec) {
  uint64_t target_fd = native_step_u64(spec, "fd", "synthetic-tcp-active-broker");
  uint64_t broker_fd = native_step_u64(spec, "brokerFd", "synthetic-tcp-active-broker");
  uint64_t port = native_step_u64(spec, "port", "synthetic-tcp-active-broker");
  if (target_fd > 1024u || broker_fd > 1024u || target_fd == broker_fd || port == 0 || port > 65535u) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp active broker spec is invalid\n");
    exit(2);
  }
  char scratch[1024];
  const char *initial_hex = native_step_value(spec, "initialPeerBytes", scratch, sizeof(scratch));
  if (!initial_hex) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp active broker initial bytes are missing\n");
    exit(2);
  }
  uint8_t initial[256];
  size_t initial_len = 0;
  hex_to_bytes(initial_hex, initial, &initial_len, sizeof(initial));
  char listener_spec[256];
  snprintf(listener_spec, sizeof(listener_spec), "fd=1023;port=%" PRIu64 ";backlog=1;reuseAddr=1", port);
  int listener_fd = create_loopback_listener_from_spec(listener_spec, "synthetic-tcp-active-broker");
  int client_fd = connect_loopback_client(port);
  int peer_fd = accept4(listener_fd, NULL, NULL, SOCK_CLOEXEC);
  if (peer_fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp active accept failed: %s\n", strerror(errno));
    exit(1);
  }
  close(listener_fd);
  if (initial_len > 0 && write(peer_fd, initial, initial_len) != (ssize_t)initial_len) {
    fprintf(stderr, "native-actual-resume-trampoline: tcp active seed write failed: %s\n", strerror(errno));
    exit(1);
  }
  if (client_fd != (int)target_fd) {
    if (dup2(client_fd, (int)target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: tcp active client dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(client_fd);
  }
  if (peer_fd != (int)broker_fd) {
    if (dup2(peer_fd, (int)broker_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: tcp active broker dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(peer_fd);
  }
}

static void install_synthetic_tcp_active_brokers(const struct Options *opts) {
  for (size_t i = 0; i < opts->synthetic_tcp_active_broker_count; i++) {
    install_synthetic_tcp_active_broker(opts->synthetic_tcp_active_brokers[i].spec);
  }
}

static uint16_t internet_checksum(const void *data, size_t len) {
  const uint8_t *bytes = (const uint8_t *)data;
  uint32_t sum = 0;
  while (len > 1) {
    sum += (uint16_t)((bytes[0] << 8) | bytes[1]);
    bytes += 2;
    len -= 2;
  }
  if (len != 0) {
    sum += (uint16_t)(bytes[0] << 8);
  }
  while ((sum >> 16) != 0) {
    sum = (sum & 0xffffu) + (sum >> 16);
  }
  return (uint16_t)(~sum & 0xffffu);
}

static void drain_raw_icmp_queue(int fd) {
  for (int attempt = 0; attempt < 8; attempt++) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int ready = poll(&pfd, 1, 0);
    if (ready < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: raw icmp drain poll failed: %s\n", strerror(errno));
      exit(1);
    }
    if (ready == 0) {
      return;
    }
    uint8_t buffer[256];
    ssize_t got = recv(fd, buffer, sizeof(buffer), MSG_DONTWAIT);
    if (got < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) {
        return;
      }
      fprintf(stderr, "native-actual-resume-trampoline: raw icmp drain recv failed: %s\n", strerror(errno));
      exit(1);
    }
  }
  fprintf(stderr, "native-actual-resume-trampoline: raw icmp receive queue did not drain\n");
  exit(1);
}

static void raw_icmp_probe(int fd, uint16_t identifier, uint16_t sequence) {
  uint8_t packet[16] = {0};
  struct icmphdr *icmp = (struct icmphdr *)packet;
  icmp->type = ICMP_ECHO;
  icmp->code = 0;
  icmp->un.echo.id = htons(identifier);
  icmp->un.echo.sequence = htons(sequence);
  memcpy(packet + sizeof(*icmp), "MACHINEN", 8);
  icmp->checksum = 0;
  icmp->checksum = htons(internet_checksum(packet, sizeof(packet)));
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (sendto(fd, packet, sizeof(packet), 0, (struct sockaddr *)&addr, sizeof(addr)) != (ssize_t)sizeof(packet)) {
    fprintf(stderr, "native-actual-resume-trampoline: raw icmp sendto failed: %s\n", strerror(errno));
    exit(1);
  }
  for (int attempt = 0; attempt < 8; attempt++) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int ready = poll(&pfd, 1, 250);
    if (ready < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: raw icmp poll failed: %s\n", strerror(errno));
      exit(1);
    }
    if (ready == 0) {
      continue;
    }
    uint8_t buffer[256];
    ssize_t got = recv(fd, buffer, sizeof(buffer), 0);
    if (got < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: raw icmp recv failed: %s\n", strerror(errno));
      exit(1);
    }
    if (got < (ssize_t)(sizeof(struct iphdr) + sizeof(struct icmphdr))) {
      continue;
    }
    struct iphdr *ip = (struct iphdr *)buffer;
    size_t ip_header_len = (size_t)ip->ihl * 4u;
    if (ip_header_len < sizeof(struct iphdr) || got < (ssize_t)(ip_header_len + sizeof(struct icmphdr))) {
      continue;
    }
    struct icmphdr *reply = (struct icmphdr *)(buffer + ip_header_len);
    if (reply->type == ICMP_ECHOREPLY && reply->code == 0 &&
        ntohs(reply->un.echo.id) == identifier && ntohs(reply->un.echo.sequence) == sequence) {
      drain_raw_icmp_queue(fd);
      return;
    }
  }
  fprintf(stderr, "native-actual-resume-trampoline: raw icmp loopback echo verifier timed out\n");
  exit(1);
}

static void install_synthetic_raw_icmp(const char *spec) {
  uint64_t target_fd = native_step_u64(spec, "fd", "synthetic-raw-icmp");
  uint64_t identifier = native_step_u64(spec, "identifier", "synthetic-raw-icmp");
  uint64_t sequence = native_step_u64(spec, "sequence", "synthetic-raw-icmp");
  if (target_fd > 1024u || identifier > 0xffffu || sequence > 0xffffu) {
    fprintf(stderr, "native-actual-resume-trampoline: raw icmp spec is invalid\n");
    exit(2);
  }
  int fd = socket(AF_INET, SOCK_RAW | SOCK_CLOEXEC, IPPROTO_ICMP);
  if (fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: raw icmp socket failed: %s\n", strerror(errno));
    exit(1);
  }
  raw_icmp_probe(fd, (uint16_t)identifier, (uint16_t)sequence);
  if (fd != (int)target_fd) {
    if (dup2(fd, (int)target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: raw icmp dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(fd);
  }
}

static void install_synthetic_raw_icmp_sockets(const struct Options *opts) {
  for (size_t i = 0; i < opts->synthetic_raw_icmp_count; i++) {
    install_synthetic_raw_icmp(opts->synthetic_raw_icmp[i].spec);
  }
}

static void print_target_refusal(const char *code, const char *reason) {
  printf("MACHINEN_TARGET_REFUSAL {\"status\":\"refused\",\"code\":\"%s\",\"reason\":\"%s\"}\n",
      code,
      reason);
  fflush(stdout);
}

static void adopt_ping_socket_credentials(uint64_t expected_uid, uint64_t expected_gid) {
  if (expected_uid > UINT32_MAX || expected_gid > UINT32_MAX) {
    fprintf(stderr, "native-actual-resume-trampoline: ping socket credential value is invalid\n");
    exit(1);
  }
  if (setgid((gid_t)expected_gid) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: setgid for ping socket failed: %s\n", strerror(errno));
    exit(1);
  }
  if (setuid((uid_t)expected_uid) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: setuid for ping socket failed: %s\n", strerror(errno));
    exit(1);
  }
}

static void verify_ping_group_range(
    uint64_t expected_uid, uint64_t expected_gid, uint64_t range_start, uint64_t range_end) {
  if ((uint64_t)getuid() != expected_uid || (uint64_t)getgid() != expected_gid) {
    fprintf(stderr,
        "native-actual-resume-trampoline: ping socket credential mismatch uid=%llu gid=%llu\n",
        (unsigned long long)getuid(),
        (unsigned long long)getgid());
    exit(1);
  }
  FILE *file = fopen("/proc/sys/net/ipv4/ping_group_range", "r");
  if (!file) {
    fprintf(stderr,
        "native-actual-resume-trampoline: open ping_group_range failed: %s\n",
        strerror(errno));
    exit(1);
  }
  unsigned long long actual_start = 0;
  unsigned long long actual_end = 0;
  if (fscanf(file, "%llu%llu", &actual_start, &actual_end) != 2) {
    fclose(file);
    fprintf(stderr, "native-actual-resume-trampoline: ping_group_range parse failed\n");
    exit(1);
  }
  fclose(file);
  if (actual_start != range_start || actual_end != range_end || expected_gid < actual_start ||
      expected_gid > actual_end) {
    fprintf(stderr,
        "native-actual-resume-trampoline: ping_group_range mismatch actual=%llu-%llu expected=%llu-%llu gid=%llu\n",
        actual_start,
        actual_end,
        (unsigned long long)range_start,
        (unsigned long long)range_end,
        (unsigned long long)expected_gid);
    exit(1);
  }
}

static void ping_socket_probe(int fd, uint16_t identifier, uint16_t sequence) {
  uint8_t packet[16] = {0};
  struct icmphdr *icmp = (struct icmphdr *)packet;
  icmp->type = ICMP_ECHO;
  icmp->code = 0;
  icmp->un.echo.id = htons(identifier);
  icmp->un.echo.sequence = htons(sequence);
  memcpy(packet + sizeof(*icmp), "PINGDGRM", 8);
  icmp->checksum = 0;
  icmp->checksum = htons(internet_checksum(packet, sizeof(packet)));
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (sendto(fd, packet, sizeof(packet), 0, (struct sockaddr *)&addr, sizeof(addr)) != (ssize_t)sizeof(packet)) {
    fprintf(stderr, "native-actual-resume-trampoline: ping socket sendto failed: %s\n", strerror(errno));
    exit(1);
  }
  for (int attempt = 0; attempt < 8; attempt++) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int ready = poll(&pfd, 1, 250);
    if (ready < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: ping socket poll failed: %s\n", strerror(errno));
      exit(1);
    }
    if (ready == 0) {
      continue;
    }
    uint8_t buffer[256];
    ssize_t got = recv(fd, buffer, sizeof(buffer), 0);
    if (got < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: ping socket recv failed: %s\n", strerror(errno));
      exit(1);
    }
    if (got < (ssize_t)sizeof(struct icmphdr)) {
      continue;
    }
    struct icmphdr *reply = (struct icmphdr *)buffer;
    if (reply->type == ICMP_ECHOREPLY && reply->code == 0 &&
        ntohs(reply->un.echo.id) == identifier && ntohs(reply->un.echo.sequence) == sequence) {
      drain_raw_icmp_queue(fd);
      return;
    }
  }
  fprintf(stderr, "native-actual-resume-trampoline: ping socket loopback echo verifier timed out\n");
  exit(1);
}

static void install_synthetic_ping_socket(const char *spec) {
  uint64_t target_fd = native_step_u64(spec, "fd", "synthetic-ping-socket");
  uint64_t identifier = native_step_u64(spec, "identifier", "synthetic-ping-socket");
  uint64_t sequence = native_step_u64(spec, "sequence", "synthetic-ping-socket");
  uint64_t uid = native_step_u64(spec, "uid", "synthetic-ping-socket");
  uint64_t gid = native_step_u64(spec, "gid", "synthetic-ping-socket");
  uint64_t range_start = native_step_u64(spec, "pingGroupRangeStart", "synthetic-ping-socket");
  uint64_t range_end = native_step_u64(spec, "pingGroupRangeEnd", "synthetic-ping-socket");
  if (native_step_has_value(spec, "expectedRefusalCode")) {
    char code[128];
    char reason[128] = "ping-socket-target-native-refusal";
    native_step_string(spec, "expectedRefusalCode", code, sizeof(code), "synthetic-ping-socket");
    if (native_step_has_value(spec, "expectedRefusalReason")) {
      native_step_string(spec, "expectedRefusalReason", reason, sizeof(reason), "synthetic-ping-socket");
    }
    print_target_refusal(code, reason);
    exit(1);
  }
  if (native_step_has_value(spec, "adoptCredentials") &&
      native_step_bool(spec, "adoptCredentials", "synthetic-ping-socket")) {
    adopt_ping_socket_credentials(uid, gid);
  }
  if (target_fd > 1024u || identifier > 0xffffu || sequence > 0xffffu || range_end < range_start ||
      gid < range_start || gid > range_end) {
    fprintf(stderr, "native-actual-resume-trampoline: ping socket spec is invalid\n");
    exit(2);
  }
  verify_ping_group_range(uid, gid, range_start, range_end);
  int fd = socket(AF_INET, SOCK_DGRAM | SOCK_CLOEXEC, IPPROTO_ICMP);
  if (fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: ping socket open failed: %s\n", strerror(errno));
    exit(1);
  }
  struct sockaddr_in local = {0};
  local.sin_family = AF_INET;
  local.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  local.sin_port = htons((uint16_t)identifier);
  if (bind(fd, (struct sockaddr *)&local, sizeof(local)) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: ping socket bind failed: %s\n", strerror(errno));
    exit(1);
  }
  ping_socket_probe(fd, (uint16_t)identifier, (uint16_t)sequence);
  if (fd != (int)target_fd) {
    if (dup2(fd, (int)target_fd) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: ping socket dup2 failed: %s\n", strerror(errno));
      exit(1);
    }
    close(fd);
  }
}

static void install_synthetic_ping_sockets(const struct Options *opts) {
  for (size_t i = 0; i < opts->synthetic_ping_socket_count; i++) {
    install_synthetic_ping_socket(opts->synthetic_ping_socket[i].spec);
  }
}

static void apply_cloexec_fds(const struct Options *opts) {
  for (size_t i = 0; i < opts->cloexec_fd_count; i++) {
    if (fcntl(opts->cloexec_fds[i], F_SETFD, FD_CLOEXEC) != 0) {
      fprintf(stderr,
          "native-actual-resume-trampoline: set cloexec failed for fd %d: %s\n",
          opts->cloexec_fds[i],
          strerror(errno));
      exit(1);
    }
  }
}

static const char *native_step_value(const char *spec, const char *name, char *scratch, size_t scratch_size) {
  snprintf(scratch, scratch_size, "%s", spec);
  size_t name_length = strlen(name);
  char *save = NULL;
  for (char *token = strtok_r(scratch, ";", &save); token; token = strtok_r(NULL, ";", &save)) {
    if (strncmp(token, name, name_length) == 0 && token[name_length] == '=') {
      return token + name_length + 1u;
    }
  }
  return NULL;
}

static const char *required_native_step_value(
    const char *spec, const char *name, char *scratch, size_t scratch_size, const char *label) {
  const char *value = native_step_value(spec, name, scratch, scratch_size);
  if (!value) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s step missing %s\n", label, name);
    exit(2);
  }
  return value;
}

static uint64_t native_step_u64(const char *spec, const char *name, const char *label) {
  char scratch[1024];
  return parse_u64(required_native_step_value(spec, name, scratch, sizeof(scratch), label), name);
}

static void native_step_string(
    const char *spec, const char *name, char *dst, size_t dst_size, const char *label) {
  char scratch[1024];
  const char *value = required_native_step_value(spec, name, scratch, sizeof(scratch), label);
  if (strlen(value) >= dst_size) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s step %s is too long\n", label, name);
    exit(2);
  }
  snprintf(dst, dst_size, "%s", value);
}

static bool native_step_has_value(const char *spec, const char *name) {
  char scratch[1024];
  return native_step_value(spec, name, scratch, sizeof(scratch)) != NULL;
}

static bool native_step_bool(const char *spec, const char *name, const char *label) {
  char value[8];
  native_step_string(spec, name, value, sizeof(value), label);
  if (streq(value, "true")) {
    return true;
  }
  if (streq(value, "false")) {
    return false;
  }
  fprintf(stderr, "native-actual-resume-trampoline: native %s step %s must be boolean\n", label, name);
  exit(2);
}

static int hex_nibble(char value) {
  if (value >= '0' && value <= '9') {
    return value - '0';
  }
  if (value >= 'a' && value <= 'f') {
    return value - 'a' + 10;
  }
  if (value >= 'A' && value <= 'F') {
    return value - 'A' + 10;
  }
  return -1;
}

static void require_sha256_hex(const char *value, const char *field, const char *label) {
  if (strlen(value) != 64u) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s %s must be sha256 hex\n", label, field);
    exit(2);
  }
  for (size_t i = 0; i < 64u; i++) {
    if (hex_nibble(value[i]) < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: native %s %s must be sha256 hex\n", label, field);
      exit(2);
    }
  }
}

static void hex_to_string(const char *hex_value, char *dst, size_t dst_size, const char *field, const char *label) {
  size_t hex_len = strlen(hex_value);
  if ((hex_len % 2u) != 0u || (hex_len / 2u) >= dst_size) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s %s hex is invalid\n", label, field);
    exit(2);
  }
  for (size_t i = 0; i < hex_len; i += 2u) {
    int high = hex_nibble(hex_value[i]);
    int low = hex_nibble(hex_value[i + 1u]);
    if (high < 0 || low < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: native %s %s hex is invalid\n", label, field);
      exit(2);
    }
    dst[i / 2u] = (char)((high << 4) | low);
  }
  dst[hex_len / 2u] = '\0';
}

static size_t target_environ_count(void) {
  size_t count = 0;
  if (!environ) {
    return 0;
  }
  for (char **entry = environ; *entry; entry++) {
    count++;
  }
  return count;
}

static void set_target_argv_entry(const char *spec) {
  uint64_t index = native_step_u64(spec, "index", "process-context");
  char value_hex[MAX_CONTEXT_STRING * 2 + 1];
  char digest[80];
  native_step_string(spec, "valueHex", value_hex, sizeof(value_hex), "process-context");
  native_step_string(spec, "valueSha256", digest, sizeof(digest), "process-context");
  require_sha256_hex(digest, "valueSha256", "process-context");
  if (index >= MAX_CONTEXT_ARGV) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context argv index is unsupported\n");
    exit(2);
  }
  hex_to_string(value_hex, target_context_argv_storage[index], sizeof(target_context_argv_storage[index]), "valueHex", "process-context");
  target_context_argv[index] = target_context_argv_storage[index];
  if (index + 1u > target_context_argc) {
    target_context_argc = (size_t)(index + 1u);
    target_context_argv[target_context_argc] = NULL;
  }
}

static void materialize_target_argv_block(const char *spec, struct NativeProcessContextRestoreState *state) {
  uint64_t argc = native_step_u64(spec, "argc", "process-context");
  uint64_t token_index = native_step_u64(spec, "tokenIndex", "process-context");
  char digest[80];
  char token_digest[80];
  char token_hex[512];
  native_step_string(spec, "argvSha256", digest, sizeof(digest), "process-context");
  native_step_string(spec, "tokenSha256", token_digest, sizeof(token_digest), "process-context");
  native_step_string(spec, "tokenHex", token_hex, sizeof(token_hex), "process-context");
  require_sha256_hex(digest, "argvSha256", "process-context");
  require_sha256_hex(token_digest, "tokenSha256", "process-context");
  if (argc == 0 || argc > MAX_CONTEXT_ARGV || token_index >= argc) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context argv shape is unsupported\n");
    exit(2);
  }
  hex_to_string(token_hex, target_context_argv_token, sizeof(target_context_argv_token), "tokenHex", "process-context");
  if (target_context_argv_token[0] == '\0') {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context argv token is empty\n");
    exit(2);
  }
  for (uint64_t i = 0; i < argc; i++) {
    target_context_argv[i] = "<machinen-argv-placeholder>";
  }
  target_context_argv[token_index] = target_context_argv_token;
  target_context_argv[argc] = NULL;
  target_context_argc = (size_t)argc;
  if (target_context_argc != argc || strcmp(target_context_argv[token_index], target_context_argv_token) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context argv verify failed\n");
    exit(1);
  }
  state->argv_materialized = true;
}

static void verify_target_env_value(const char *spec, struct NativeProcessContextRestoreState *state) {
  char key_hex[512];
  char value_hex[512];
  char key[256];
  char value[256];
  char digest[80];
  native_step_string(spec, "keyHex", key_hex, sizeof(key_hex), "process-context");
  native_step_string(spec, "valueHex", value_hex, sizeof(value_hex), "process-context");
  native_step_string(spec, "valueSha256", digest, sizeof(digest), "process-context");
  require_sha256_hex(digest, "valueSha256", "process-context");
  hex_to_string(key_hex, key, sizeof(key), "keyHex", "process-context");
  hex_to_string(value_hex, value, sizeof(value), "valueHex", "process-context");
  const char *observed = getenv(key);
  if (!observed || strcmp(observed, value) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: getenv verify failed\n");
    exit(1);
  }
  state->env_value_verified = true;
}

static void verify_target_cwd(const char *spec, struct NativeProcessContextRestoreState *state) {
  char cwd_hex[1024];
  char cwd[512];
  char observed[512];
  char digest[80];
  native_step_string(spec, "cwdHex", cwd_hex, sizeof(cwd_hex), "process-context");
  native_step_string(spec, "cwdSha256", digest, sizeof(digest), "process-context");
  require_sha256_hex(digest, "cwdSha256", "process-context");
  hex_to_string(cwd_hex, cwd, sizeof(cwd), "cwdHex", "process-context");
  if (!getcwd(observed, sizeof(observed)) || strcmp(observed, cwd) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: getcwd verify failed: %s\n", strerror(errno));
    exit(1);
  }
  state->cwd_verified = true;
}

static void verify_target_auxv_selected(const char *spec, struct NativeProcessContextRestoreState *state) {
  char digest[80];
  native_step_string(spec, "auxvSha256", digest, sizeof(digest), "process-context");
  require_sha256_hex(digest, "auxvSha256", "process-context");
  uint64_t expected_page_size = native_step_u64(spec, "pageSize", "process-context");
  uint64_t expected_clock_tick = native_step_u64(spec, "clockTick", "process-context");
  unsigned long observed_page_size = getauxval(AT_PAGESZ);
  unsigned long observed_clock_tick = getauxval(AT_CLKTCK);
  if (observed_page_size != expected_page_size || observed_clock_tick != expected_clock_tick) {
    fprintf(stderr, "native-actual-resume-trampoline: selected auxv verify failed\n");
    exit(1);
  }
  state->auxv_verified = true;
}

static size_t align_size(size_t value, size_t alignment) {
  return (value + alignment - 1u) & ~(alignment - 1u);
}

static char *write_initial_stack_string(uint8_t *base, size_t size, size_t *cursor, const char *value) {
  size_t len = strlen(value) + 1u;
  if (*cursor > size || len > size - *cursor) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack strings overflow\n");
    exit(2);
  }
  char *target = (char *)(base + *cursor);
  memcpy(target, value, len);
  *cursor += len;
  return target;
}

static void materialize_target_initial_stack(const char *spec, struct NativeProcessContextRestoreState *state) {
  uint64_t target_start = native_step_u64(spec, "targetStart", "process-context");
  uint64_t size = native_step_u64(spec, "sizeBytes", "process-context");
  uint64_t argc = native_step_u64(spec, "argc", "process-context");
  uint64_t env_count = native_step_u64(spec, "envCount", "process-context");
  uint64_t page_size = native_step_u64(spec, "pageSize", "process-context");
  uint64_t clock_tick = native_step_u64(spec, "clockTick", "process-context");
  char argv_digest[80];
  char env_digest[80];
  native_step_string(spec, "argvSha256", argv_digest, sizeof(argv_digest), "process-context");
  native_step_string(spec, "envSha256", env_digest, sizeof(env_digest), "process-context");
  require_sha256_hex(argv_digest, "argvSha256", "process-context");
  require_sha256_hex(env_digest, "envSha256", "process-context");
  if (argc == 0 || argc > MAX_CONTEXT_ARGV || env_count > MAX_CONTEXT_ENV || argc != target_context_argc ||
      env_count != target_context_env_count || size < 4096u) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack shape is unsupported\n");
    exit(2);
  }
  uint8_t *base = (uint8_t *)map_fixed(target_start, size, PROT_READ | PROT_WRITE, "process-context-initial-stack");
  memset(base, 0, (size_t)size);
  uint64_t *words = (uint64_t *)base;
  size_t word_index = 0;
  words[word_index++] = argc;
  size_t argv_index = word_index;
  word_index += (size_t)argc + 1u;
  size_t env_index = word_index;
  word_index += (size_t)env_count + 1u;
  size_t auxv_index = word_index;
  word_index += 6u;
  size_t cursor = align_size(word_index * sizeof(uint64_t), 8u);
  if (cursor >= size) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack header overflow\n");
    exit(2);
  }
  for (size_t i = 0; i < (size_t)argc; i++) {
    if (!target_context_argv[i]) {
      fprintf(stderr, "native-actual-resume-trampoline: native process-context argv entry missing\n");
      exit(2);
    }
    words[argv_index + i] = (uint64_t)(uintptr_t)write_initial_stack_string(base, (size_t)size, &cursor, target_context_argv[i]);
  }
  words[argv_index + (size_t)argc] = 0;
  for (size_t i = 0; i < (size_t)env_count; i++) {
    char env_string[MAX_CONTEXT_STRING * 2];
    int written = snprintf(env_string, sizeof(env_string), "%s=%s", target_context_env_keys[i], target_context_env_values[i]);
    if (written <= 0 || (size_t)written >= sizeof(env_string)) {
      fprintf(stderr, "native-actual-resume-trampoline: native process-context env entry is unsupported\n");
      exit(2);
    }
    words[env_index + i] = (uint64_t)(uintptr_t)write_initial_stack_string(base, (size_t)size, &cursor, env_string);
  }
  words[env_index + (size_t)env_count] = 0;
  words[auxv_index + 0u] = AT_PAGESZ;
  words[auxv_index + 1u] = page_size;
  words[auxv_index + 2u] = AT_CLKTCK;
  words[auxv_index + 3u] = clock_tick;
  words[auxv_index + 4u] = AT_NULL;
  words[auxv_index + 5u] = 0;
  state->initial_stack_start = target_start;
  state->initial_stack_materialized = true;
}

static void verify_target_initial_stack(const char *spec, struct NativeProcessContextRestoreState *state) {
  uint64_t target_start = native_step_u64(spec, "targetStart", "process-context");
  uint64_t argc = native_step_u64(spec, "argc", "process-context");
  uint64_t env_count = native_step_u64(spec, "envCount", "process-context");
  if (!state->initial_stack_materialized || target_start != state->initial_stack_start || argc != target_context_argc ||
      env_count != target_context_env_count) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack state mismatch\n");
    exit(1);
  }
  uint64_t *words = (uint64_t *)(uintptr_t)target_start;
  if (words[0] != argc) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack argc mismatch\n");
    exit(1);
  }
  size_t argv_index = 1u;
  size_t env_index = argv_index + (size_t)argc + 1u;
  size_t auxv_index = env_index + (size_t)env_count + 1u;
  for (size_t i = 0; i < (size_t)argc; i++) {
    const char *value = (const char *)(uintptr_t)words[argv_index + i];
    if (!value || strcmp(value, target_context_argv[i]) != 0) {
      fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack argv verify failed\n");
      exit(1);
    }
  }
  if (words[argv_index + (size_t)argc] != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack argv terminator missing\n");
    exit(1);
  }
  for (size_t i = 0; i < (size_t)env_count; i++) {
    const char *value = (const char *)(uintptr_t)words[env_index + i];
    char env_string[MAX_CONTEXT_STRING * 2];
    int written = snprintf(env_string, sizeof(env_string), "%s=%s", target_context_env_keys[i], target_context_env_values[i]);
    if (!value || written <= 0 || (size_t)written >= sizeof(env_string) || strcmp(value, env_string) != 0) {
      fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack env verify failed\n");
      exit(1);
    }
  }
  if (words[env_index + (size_t)env_count] != 0 || words[auxv_index] != AT_PAGESZ || words[auxv_index + 2u] != AT_CLKTCK ||
      words[auxv_index + 4u] != AT_NULL) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context initial stack auxv verify failed\n");
    exit(1);
  }
  state->initial_stack_verified = true;
}

static void record_target_auxv_policy(const char *spec, struct NativeProcessContextRestoreState *state) {
  char digest[80];
  char materialized[128];
  char refused[256];
  char mode[64];
  native_step_string(spec, "auxvSha256", digest, sizeof(digest), "process-context");
  native_step_string(spec, "mode", mode, sizeof(mode), "process-context");
  native_step_string(spec, "materializedKeys", materialized, sizeof(materialized), "process-context");
  native_step_string(spec, "refusedKeys", refused, sizeof(refused), "process-context");
  require_sha256_hex(digest, "auxvSha256", "process-context");
  if (!streq(mode, "selected-safe-only") || strstr(materialized, "AT_PAGESZ") == NULL ||
      strstr(materialized, "AT_CLKTCK") == NULL) {
    fprintf(stderr, "native-actual-resume-trampoline: native process-context auxv policy verify failed\n");
    exit(2);
  }
  (void)refused;
  state->auxv_policy_recorded = true;
}

static void consume_native_process_context_steps(
    const struct Options *opts, struct NativeProcessContextRestoreState *state) {
  state->requested = opts->native_process_context_step_count > 0;
  for (size_t i = 0; i < opts->native_process_context_step_count; i++) {
    const char *spec = opts->native_process_context_steps[i].spec;
    char action[64];
    native_step_string(spec, "action", action, sizeof(action), "process-context");
    if (streq(action, "record-argv")) {
      char digest[80];
      native_step_string(spec, "argvSha256", digest, sizeof(digest), "process-context");
      require_sha256_hex(digest, "argvSha256", "process-context");
      (void)native_step_u64(spec, "argc", "process-context");
      (void)native_step_u64(spec, "argvBytes", "process-context");
      state->metadata_count++;
    } else if (streq(action, "materialize-argv")) {
      materialize_target_argv_block(spec, state);
    } else if (streq(action, "set-argv-entry")) {
      set_target_argv_entry(spec);
      state->argv_materialized = true;
    } else if (streq(action, "record-env")) {
      char digest[80];
      native_step_string(spec, "envSha256", digest, sizeof(digest), "process-context");
      require_sha256_hex(digest, "envSha256", "process-context");
      (void)native_step_u64(spec, "envCount", "process-context");
      (void)native_step_u64(spec, "envBytes", "process-context");
      state->metadata_count++;
    } else if (streq(action, "clear-env")) {
      char digest[80];
      native_step_string(spec, "envSha256", digest, sizeof(digest), "process-context");
      require_sha256_hex(digest, "envSha256", "process-context");
      (void)native_step_u64(spec, "envCount", "process-context");
      if (clearenv() != 0) {
        fprintf(stderr, "native-actual-resume-trampoline: clearenv failed: %s\n", strerror(errno));
        exit(1);
      }
      target_context_env_count = 0;
      state->env_cleared = true;
    } else if (streq(action, "set-env")) {
      char key_hex[512];
      char value_hex[512];
      char key[256];
      char value[256];
      char digest[80];
      native_step_string(spec, "keyHex", key_hex, sizeof(key_hex), "process-context");
      native_step_string(spec, "valueHex", value_hex, sizeof(value_hex), "process-context");
      native_step_string(spec, "valueSha256", digest, sizeof(digest), "process-context");
      require_sha256_hex(digest, "valueSha256", "process-context");
      hex_to_string(key_hex, key, sizeof(key), "keyHex", "process-context");
      hex_to_string(value_hex, value, sizeof(value), "valueHex", "process-context");
      if (key[0] == '\0' || strchr(key, '=') != NULL || setenv(key, value, 1) != 0) {
        fprintf(stderr, "native-actual-resume-trampoline: setenv failed: %s\n", strerror(errno));
        exit(1);
      }
      if (target_context_env_count >= MAX_CONTEXT_ENV) {
        fprintf(stderr, "native-actual-resume-trampoline: native process-context env count is unsupported\n");
        exit(2);
      }
      snprintf(
          target_context_env_keys[target_context_env_count], sizeof(target_context_env_keys[target_context_env_count]), "%s", key);
      snprintf(target_context_env_values[target_context_env_count], sizeof(target_context_env_values[target_context_env_count]), "%s", value);
      target_context_env_count++;
      const char *observed = getenv(key);
      if (!observed || strcmp(observed, value) != 0) {
        fprintf(stderr, "native-actual-resume-trampoline: setenv verify failed\n");
        exit(1);
      }
      state->env_set_count++;
    } else if (streq(action, "verify-env-value")) {
      verify_target_env_value(spec, state);
    } else if (streq(action, "verify-env")) {
      char digest[80];
      native_step_string(spec, "envSha256", digest, sizeof(digest), "process-context");
      require_sha256_hex(digest, "envSha256", "process-context");
      uint64_t expected = native_step_u64(spec, "envCount", "process-context");
      if (target_environ_count() != expected) {
        fprintf(stderr, "native-actual-resume-trampoline: env count verify failed\n");
        exit(1);
      }
      state->env_verified = true;
    } else if (streq(action, "record-cwd") || streq(action, "chdir") || streq(action, "verify-cwd")) {
      char cwd_hex[1024];
      char cwd[512];
      char digest[80];
      native_step_string(spec, "cwdHex", cwd_hex, sizeof(cwd_hex), "process-context");
      native_step_string(spec, "cwdSha256", digest, sizeof(digest), "process-context");
      require_sha256_hex(digest, "cwdSha256", "process-context");
      hex_to_string(cwd_hex, cwd, sizeof(cwd), "cwdHex", "process-context");
      if (streq(action, "chdir")) {
        char observed[512];
        if (chdir(cwd) != 0 || !getcwd(observed, sizeof(observed)) || strcmp(observed, cwd) != 0) {
          fprintf(stderr, "native-actual-resume-trampoline: chdir verify failed: %s\n", strerror(errno));
          exit(1);
        }
        state->cwd_applied = true;
      } else if (streq(action, "verify-cwd")) {
        verify_target_cwd(spec, state);
      } else {
        state->metadata_count++;
      }
    } else if (streq(action, "record-auxv")) {
      char digest[80];
      native_step_string(spec, "auxvSha256", digest, sizeof(digest), "process-context");
      require_sha256_hex(digest, "auxvSha256", "process-context");
      (void)native_step_u64(spec, "auxvBytes", "process-context");
      state->metadata_count++;
    } else if (streq(action, "verify-auxv-selected")) {
      verify_target_auxv_selected(spec, state);
    } else if (streq(action, "record-auxv-policy")) {
      record_target_auxv_policy(spec, state);
    } else if (streq(action, "materialize-initial-stack")) {
      materialize_target_initial_stack(spec, state);
    } else if (streq(action, "verify-initial-stack")) {
      verify_target_initial_stack(spec, state);
    } else {
      fprintf(stderr, "native-actual-resume-trampoline: unsupported native process-context action\n");
      exit(2);
    }
    state->consumed_count++;
  }
}

static bool native_permissions_writable(const char *permissions) {
  return strlen(permissions) >= 2u && permissions[1] == 'w';
}

static bool address_inside_writable_native_private_memory(
    const struct Options *opts, uint64_t address, uint64_t size) {
  for (size_t i = 0; i < opts->native_private_memory_step_count; i++) {
    const char *spec = opts->native_private_memory_steps[i].spec;
    char action[64];
    native_step_string(spec, "action", action, sizeof(action), "private-memory");
    if (!streq(action, "mmap-private-writable") && !streq(action, "mprotect-final")) {
      continue;
    }
    char permissions[16];
    native_step_string(spec, "permissions", permissions, sizeof(permissions), "private-memory");
    uint64_t target_start = native_step_u64(spec, "targetStart", "private-memory");
    uint64_t mapping_size = native_step_u64(spec, "sizeBytes", "private-memory");
    if (native_permissions_writable(permissions) && address >= target_start && size <= mapping_size &&
        address + size <= target_start + mapping_size) {
      return true;
    }
  }
  return false;
}

static void validate_target_tls_backing(const struct Options *opts) {
  if (!opts->has_target_fs_base) {
    return;
  }
  uint64_t address = opts->target_fs_base + TLS_TCB_SELF_OFFSET;
  uint64_t size = TLS_TCB_MARKER_OFFSET + sizeof(uint64_t);
  if (address_inside_writable_materialized_memory(opts, address, size) ||
      address_inside_writable_native_private_memory(opts, address, size)) {
    return;
  }
  fprintf(stderr, "native-actual-resume-trampoline: target fs base is outside writable materialized memory\n");
  exit(2);
}

static void apply_native_private_memory_steps(const struct Options *opts) {
  for (size_t i = 0; i < opts->native_private_memory_step_count; i++) {
    const char *spec = opts->native_private_memory_steps[i].spec;
    char action[64];
    native_step_string(spec, "action", action, sizeof(action), "private-memory");
    if (streq(action, "mmap-private-writable")) {
      char permissions[16];
      native_step_string(spec, "permissions", permissions, sizeof(permissions), "private-memory");
      if (!streq(permissions, "rw-p")) {
        fprintf(stderr, "native-actual-resume-trampoline: native private mmap permissions must be rw-p\n");
        exit(2);
      }
      (void)map_fixed(native_step_u64(spec, "targetStart", "private-memory"),
          native_step_u64(spec, "sizeBytes", "private-memory"),
          PROT_READ | PROT_WRITE,
          "native-private-memory");
    } else if (streq(action, "copy-captured-bytes")) {
      char source_file[1024];
      native_step_string(spec, "sourceFile", source_file, sizeof(source_file), "private-memory");
      int fd = open(source_file, O_RDONLY);
      if (fd < 0) {
        fprintf(stderr,
            "native-actual-resume-trampoline: open native private memory failed for %s: %s\n",
            source_file,
            strerror(errno));
        exit(1);
      }
      read_exact(fd,
          (void *)(uintptr_t)native_step_u64(spec, "targetStart", "private-memory"),
          native_step_u64(spec, "sizeBytes", "private-memory"),
          native_step_u64(spec, "sourceOffset", "private-memory"));
      close(fd);
    } else if (streq(action, "mprotect-final")) {
      char permissions[16];
      native_step_string(spec, "permissions", permissions, sizeof(permissions), "private-memory");
      void *target = (void *)(uintptr_t)native_step_u64(spec, "targetStart", "private-memory");
      uint64_t size = native_step_u64(spec, "sizeBytes", "private-memory");
      if (mprotect(target, (size_t)size, parse_memory_prot(permissions)) != 0) {
        fprintf(stderr, "native-actual-resume-trampoline: native private mprotect failed: %s\n", strerror(errno));
        exit(1);
      }
    } else if (streq(action, "mmap-guard")) {
      char permissions[16];
      native_step_string(spec, "permissions", permissions, sizeof(permissions), "private-memory");
      if (!streq(permissions, "---p")) {
        fprintf(stderr, "native-actual-resume-trampoline: native guard permissions must be ---p\n");
        exit(2);
      }
      struct GuardMaterialization guard = {
          .target_start = native_step_u64(spec, "targetStart", "private-memory"),
          .size = native_step_u64(spec, "sizeBytes", "private-memory"),
      };
      materialize_guard_mapping(&guard);
    } else {
      fprintf(stderr, "native-actual-resume-trampoline: unsupported native private-memory action\n");
      exit(2);
    }
  }
}

static void verify_native_executable_mappings(const struct Options *opts) {
  for (size_t i = 0; i < opts->native_executable_mapping_count; i++) {
    const char *spec = opts->native_executable_mappings[i].spec;
    char action[64];
    char path[1024];
    native_step_string(spec, "action", action, sizeof(action), "executable-mapping");
    native_step_string(spec, "path", path, sizeof(path), "executable-mapping");
    if (!streq(action, "map-target-executable") || !streq(path, opts->code_file) ||
        native_step_u64(spec, "targetStart", "executable-mapping") != opts->target_address ||
        native_step_u64(spec, "sizeBytes", "executable-mapping") != opts->code_size ||
        native_step_u64(spec, "fileOffset", "executable-mapping") != opts->file_offset) {
      fprintf(stderr, "native-actual-resume-trampoline: native executable mapping does not match target code\n");
      exit(2);
    }
    if (!native_step_bool(spec, "read", "executable-mapping") ||
        native_step_bool(spec, "write", "executable-mapping") ||
        !native_step_bool(spec, "execute", "executable-mapping") ||
        !native_step_bool(spec, "private", "executable-mapping") ||
        native_step_bool(spec, "shared", "executable-mapping")) {
      fprintf(stderr, "native-actual-resume-trampoline: native executable mapping permissions are unsafe\n");
      exit(2);
    }
    if (!native_step_has_value(spec, "buildId") && !native_step_has_value(spec, "sha256")) {
      fprintf(stderr, "native-actual-resume-trampoline: native executable mapping lacks provenance\n");
      exit(2);
    }
  }
}

static struct itimerspec native_active_timer_spec(const char *spec, const char *label) {
  uint64_t seconds = native_step_u64(spec, "seconds", label);
  uint64_t nanoseconds = native_step_u64(spec, "nanoseconds", label);
  if (nanoseconds > 999999999u) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s nanoseconds are invalid\n", label);
    exit(2);
  }
  if (seconds == 0 && nanoseconds == 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s duration must be non-zero\n", label);
    exit(2);
  }
  struct itimerspec timer = {0};
  timer.it_value.tv_sec = (time_t)seconds;
  timer.it_value.tv_nsec = (long)nanoseconds;
  return timer;
}

static void require_active_resume_mode(const char *spec, const char *label) {
  char resume_mode[64];
  native_step_string(spec, "resumeMode", resume_mode, sizeof(resume_mode), label);
  if (!streq(resume_mode, "defer-target-resume")) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s resume mode is unsupported\n", label);
    exit(2);
  }
}

static void record_active_timer_fd(struct NativeActiveSyscallRestoreState *state, int fd) {
  if (state->armed_count >= MAX_NATIVE_RESTORE_STEPS) {
    fprintf(stderr, "native-actual-resume-trampoline: too many native active-syscall timers\n");
    exit(2);
  }
  state->timer_fds[state->armed_count++] = fd;
}

static int move_to_internal_fd(int fd, const char *label) {
  int internal_fd = fcntl(fd, F_DUPFD_CLOEXEC, NATIVE_INTERNAL_FD_MIN);
  if (internal_fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s internal fd reserve failed: %s\n", label, strerror(errno));
    exit(1);
  }
  close(fd);
  return internal_fd;
}

static void arm_native_active_timer(
    const char *spec, const char *label, struct NativeActiveSyscallRestoreState *state) {
  int fd = timerfd_create(CLOCK_MONOTONIC, TFD_CLOEXEC);
  if (fd < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s timerfd failed: %s\n", label, strerror(errno));
    exit(1);
  }
  fd = move_to_internal_fd(fd, label);
  struct itimerspec timer = native_active_timer_spec(spec, label);
  if (timerfd_settime(fd, 0, &timer, NULL) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s timerfd arm failed: %s\n", label, strerror(errno));
    exit(1);
  }
  record_active_timer_fd(state, fd);
  state->consumed_count++;
}

static void verify_fd_read_would_block(int fd, const char *label) {
  struct pollfd poll_fd = {.fd = fd, .events = POLLIN, .revents = 0};
  int rc = poll(&poll_fd, 1, 0);
  if (rc < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s poll failed: %s\n", label, strerror(errno));
    exit(1);
  }
  if (rc != 0 || (poll_fd.revents & (POLLIN | POLLHUP | POLLERR | POLLNVAL)) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native %s fd read would not block\n", label);
    exit(2);
  }
}

static void complete_native_fd_read_from_file(const char *spec, struct NativeActiveSyscallRestoreState *state) {
  uint64_t fd = native_step_u64(spec, "fd", "active-syscall");
  uint64_t count_bytes = native_step_u64(spec, "countBytes", "active-syscall");
  uint64_t target_buffer = native_step_u64(spec, "targetBufferPointer", "active-syscall");
  uint64_t file_offset = native_step_u64(spec, "fileOffset", "active-syscall");
  if (fd > 1024u || count_bytes == 0 || count_bytes > (1024u * 1024u) || target_buffer == 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native file read arguments are unsupported\n");
    exit(2);
  }
  ssize_t got = pread((int)fd, (void *)(uintptr_t)target_buffer, (size_t)count_bytes, (off_t)file_offset);
  if (got < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native file read failed: %s\n", strerror(errno));
    exit(1);
  }
  if ((uint64_t)got != count_bytes) {
    fprintf(stderr, "native-actual-resume-trampoline: native file read was partial\n");
    exit(2);
  }
  state->consumed_count++;
}

static void complete_native_fd_write_to_file(const char *spec, struct NativeActiveSyscallRestoreState *state) {
  uint64_t fd = native_step_u64(spec, "fd", "active-syscall");
  uint64_t count_bytes = native_step_u64(spec, "countBytes", "active-syscall");
  uint64_t target_buffer = native_step_u64(spec, "targetBufferPointer", "active-syscall");
  uint64_t file_offset = native_step_u64(spec, "fileOffset", "active-syscall");
  if (fd > 1024u || count_bytes == 0 || count_bytes > (1024u * 1024u) || target_buffer == 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native file write arguments are unsupported\n");
    exit(2);
  }
  ssize_t wrote = pwrite((int)fd, (const void *)(uintptr_t)target_buffer, (size_t)count_bytes, (off_t)file_offset);
  if (wrote < 0) {
    fprintf(stderr, "native-actual-resume-trampoline: native file write failed: %s\n", strerror(errno));
    exit(1);
  }
  if ((uint64_t)wrote != count_bytes) {
    fprintf(stderr, "native-actual-resume-trampoline: native file write was partial\n");
    exit(2);
  }
  state->consumed_count++;
}

static void restore_native_ping_socket_recvmsg_wait(const char *spec, struct NativeActiveSyscallRestoreState *state) {
  uint64_t fd = native_step_u64(spec, "fd", "active-syscall");
  uint64_t source_fd = native_step_u64(spec, "sourceFd", "active-syscall");
  uint64_t iov_length = native_step_u64(spec, "iovLengthBytes", "active-syscall");
  uint64_t control_length = native_step_u64(spec, "controlLengthBytes", "active-syscall");
  char receive_queue[64];
  char in_flight[64];
  char signal_timer[128];
  native_step_string(spec, "receiveQueue", receive_queue, sizeof(receive_queue), "active-syscall");
  native_step_string(spec, "inFlightPackets", in_flight, sizeof(in_flight), "active-syscall");
  native_step_string(spec, "signalTimer", signal_timer, sizeof(signal_timer), "active-syscall");
  if (fd > 1024u || source_fd > 1024u || iov_length == 0 || iov_length > 4096u || control_length > 4096u ||
      !streq(receive_queue, "empty") || !streq(in_flight, "none") ||
      !streq(signal_timer, "no-pending-signal-frame-target-wait-preserved")) {
    fprintf(stderr, "native-actual-resume-trampoline: native ping recvmsg wait arguments are unsupported\n");
    exit(2);
  }
  verify_fd_read_would_block((int)fd, "active-syscall");
  state->consumed_count++;
}

static void restore_native_fd_read_block(const char *spec, struct NativeActiveSyscallRestoreState *state) {
  uint64_t fd = native_step_u64(spec, "fd", "active-syscall");
  uint64_t count_bytes = native_step_u64(spec, "countBytes", "active-syscall");
  char resource[128];
  native_step_string(spec, "resource", resource, sizeof(resource), "active-syscall");
  if (fd > 1024u || count_bytes == 0 || count_bytes > (1024u * 1024u)) {
    fprintf(stderr, "native-actual-resume-trampoline: native fd read block arguments are unsupported\n");
    exit(2);
  }
  if (streq(resource, "synthetic-empty-pipe-read-end")) {
    install_synthetic_empty_pipe((int)fd, -1, NULL);
  } else if (streq(resource, "synthetic-empty-eventfd")) {
    if (count_bytes < 8u) {
      fprintf(stderr, "native-actual-resume-trampoline: native eventfd read count is unsupported\n");
      exit(2);
    }
    install_synthetic_empty_eventfd((int)fd);
  } else if (streq(resource, "synthetic-timerfd")) {
    if (count_bytes < 8u) {
      fprintf(stderr, "native-actual-resume-trampoline: native timerfd read count is unsupported\n");
      exit(2);
    }
    install_synthetic_timerfd((int)fd);
    if (native_step_has_value(spec, "seconds")) {
      struct itimerspec timer = native_active_timer_spec(spec, "active-syscall");
      if (timerfd_settime((int)fd, 0, &timer, NULL) != 0) {
        fprintf(stderr, "native-actual-resume-trampoline: native timerfd read arm failed: %s\n", strerror(errno));
        exit(1);
      }
    }
  } else {
    fprintf(stderr, "native-actual-resume-trampoline: native fd read resource is unsupported\n");
    exit(2);
  }
  verify_fd_read_would_block((int)fd, "active-syscall");
  state->consumed_count++;
}

static void apply_native_active_syscall_restore_steps(
    const struct Options *opts, struct NativeActiveSyscallRestoreState *state) {
  state->requested = opts->native_active_syscall_step_count > 0;
  for (size_t i = 0; i < opts->native_active_syscall_step_count; i++) {
    const char *spec = opts->native_active_syscall_steps[i].spec;
    char action[64];
    native_step_string(spec, "action", action, sizeof(action), "active-syscall");
    require_active_resume_mode(spec, "active-syscall");
    if (streq(action, "rearm-sleep-timer")) {
      char syscall_name[64];
      native_step_string(spec, "syscallName", syscall_name, sizeof(syscall_name), "active-syscall");
      if (!streq(syscall_name, "clock_nanosleep") && !streq(syscall_name, "nanosleep")) {
        fprintf(stderr, "native-actual-resume-trampoline: native sleep syscall is unsupported\n");
        exit(2);
      }
      arm_native_active_timer(spec, "active-syscall", state);
    } else if (streq(action, "rearm-ppoll-timeout")) {
      uint64_t nfds = native_step_u64(spec, "nfds", "active-syscall");
      if (nfds > 1u) {
        fprintf(stderr, "native-actual-resume-trampoline: native ppoll nfds is unsupported\n");
        exit(2);
      }
      if (nfds == 1u) {
        char resources[256];
        native_step_string(spec, "resources", resources, sizeof(resources), "active-syscall");
        if (resources[0] == '\0') {
          fprintf(stderr, "native-actual-resume-trampoline: native ppoll resource is missing\n");
          exit(2);
        }
      }
      arm_native_active_timer(spec, "active-syscall", state);
    } else if (streq(action, "restore-fd-read-block")) {
      restore_native_fd_read_block(spec, state);
    } else if (streq(action, "complete-fd-read-from-file")) {
      complete_native_fd_read_from_file(spec, state);
    } else if (streq(action, "complete-fd-write-to-file")) {
      complete_native_fd_write_to_file(spec, state);
    } else if (streq(action, "restore-ping-socket-recvmsg-wait")) {
      restore_native_ping_socket_recvmsg_wait(spec, state);
    } else {
      fprintf(stderr, "native-actual-resume-trampoline: unsupported native active-syscall action\n");
      exit(2);
    }
  }
}

static void close_native_active_syscall_timers(struct NativeActiveSyscallRestoreState *state) {
  for (size_t i = 0; i < state->armed_count; i++) {
    close(state->timer_fds[i]);
    state->timer_fds[i] = -1;
  }
}

static int native_thread_spawn_child(void *arg) {
  (void)arg;
  return 0;
}

static void consume_native_thread_spawn_steps(
    const struct Options *opts, struct NativeThreadRestoreState *state) {
  state->requested = opts->native_thread_spawn_step_count > 0;
  for (size_t i = 0; i < opts->native_thread_spawn_step_count; i++) {
    const char *spec = opts->native_thread_spawn_steps[i].spec;
    char action[64];
    native_step_string(spec, "action", action, sizeof(action), "thread-spawn");
    if (!streq(action, "spawn-target-thread")) {
      fprintf(stderr, "native-actual-resume-trampoline: unsupported native thread action\n");
      exit(2);
    }
    uint64_t stack_base = native_step_u64(spec, "stackBase", "thread-spawn");
    uint64_t stack_limit = native_step_u64(spec, "stackLimit", "thread-spawn");
    uint64_t rip = native_step_u64(spec, "rip", "thread-spawn");
    uint64_t rsp = native_step_u64(spec, "rsp", "thread-spawn");
    if (stack_base >= stack_limit || rsp <= stack_base || rsp > stack_limit || rip == 0) {
      fprintf(stderr, "native-actual-resume-trampoline: native thread spawn range is invalid\n");
      exit(2);
    }
    uint64_t stack_size = stack_limit - stack_base;
    void *mapped_stack = map_fixed(stack_base, stack_size, PROT_READ | PROT_WRITE, "native-thread-stack");
    int child = clone(native_thread_spawn_child, (void *)(uintptr_t)stack_limit, SIGCHLD, NULL);
    if (child < 0) {
      fprintf(stderr, "native-actual-resume-trampoline: native thread clone failed: %s\n", strerror(errno));
      exit(1);
    }
    int status = 0;
    if (waitpid((pid_t)child, &status, 0) < 0 || !WIFEXITED(status) || WEXITSTATUS(status) != 0) {
      fprintf(stderr, "native-actual-resume-trampoline: native thread wait failed\n");
      exit(1);
    }
    munmap(mapped_stack, (size_t)stack_size);
    state->spawned_count++;
  }
}

static uint64_t parse_signal_masks(const char *value) {
  uint64_t masks = 0;
  char *copy = strdup(value);
  if (!copy) {
    fprintf(stderr, "native-actual-resume-trampoline: signal mask allocation failed\n");
    exit(1);
  }
  char *save = NULL;
  for (char *token = strtok_r(copy, ",", &save); token; token = strtok_r(NULL, ",", &save)) {
    masks |= parse_u64(token, "signal mask");
  }
  free(copy);
  return masks;
}

static void sigset_from_mask(sigset_t *set, uint64_t mask) {
  sigemptyset(set);
  for (int signum = 1; signum <= 64; signum++) {
    uint64_t bit = UINT64_C(1) << (uint64_t)(signum - 1);
    if ((mask & bit) != 0) {
      (void)sigaddset(set, signum);
    }
  }
}

static uint64_t mask_from_sigset(const sigset_t *set) {
  uint64_t mask = 0;
  for (int signum = 1; signum <= 64; signum++) {
    if (sigismember(set, signum) == 1) {
      mask |= UINT64_C(1) << (uint64_t)(signum - 1);
    }
  }
  return mask;
}

static void save_signal_mask(struct NativeSignalRestoreState *state) {
  if (state->saved) {
    return;
  }
  if (sigprocmask(SIG_SETMASK, NULL, &state->saved_mask) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: save signal mask failed: %s\n", strerror(errno));
    exit(1);
  }
  state->saved = true;
}

static void apply_native_signal_restore_steps(
    const struct Options *opts, struct NativeSignalRestoreState *state) {
  state->requested = opts->native_signal_step_count > 0;
  for (size_t i = 0; i < opts->native_signal_step_count; i++) {
    const char *spec = opts->native_signal_steps[i].spec;
    char scratch[1024];
    const char *action = native_step_value(spec, "action", scratch, sizeof(scratch));
    if (!action) {
      fprintf(stderr, "native-actual-resume-trampoline: native signal step missing action\n");
      exit(2);
    }
    if (streq(action, "save-loader-signal-mask")) {
      save_signal_mask(state);
    } else if (streq(action, "sigprocmask-set-blocked")) {
      save_signal_mask(state);
      const char *masks = native_step_value(spec, "targetBlockedMasks", scratch, sizeof(scratch));
      if (!masks) {
        fprintf(stderr, "native-actual-resume-trampoline: native signal step missing mask\n");
        exit(2);
      }
      sigset_t target;
      sigset_from_mask(&target, parse_signal_masks(masks));
      if (sigprocmask(SIG_SETMASK, &target, NULL) != 0) {
        fprintf(stderr, "native-actual-resume-trampoline: apply signal mask failed: %s\n", strerror(errno));
        exit(1);
      }
      state->applied = true;
    } else if (streq(action, "verify-blocked-signal-mask")) {
      state->verify_requested = true;
      const char *masks = native_step_value(spec, "targetBlockedMasks", scratch, sizeof(scratch));
      if (!masks) {
        fprintf(stderr, "native-actual-resume-trampoline: native signal verify missing mask\n");
        exit(2);
      }
      sigset_t current;
      if (sigprocmask(SIG_SETMASK, NULL, &current) != 0) {
        fprintf(stderr, "native-actual-resume-trampoline: verify signal mask failed: %s\n", strerror(errno));
        exit(1);
      }
      state->verified = mask_from_sigset(&current) == parse_signal_masks(masks);
    } else if (streq(action, "restore-loader-signal-mask")) {
      state->restore_requested = true;
    } else {
      fprintf(stderr, "native-actual-resume-trampoline: unsupported native signal action\n");
      exit(2);
    }
  }
}

static void restore_native_signal_mask(struct NativeSignalRestoreState *state) {
  if (!state->restore_requested || !state->saved) {
    return;
  }
  if (sigprocmask(SIG_SETMASK, &state->saved_mask, NULL) != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: restore signal mask failed: %s\n", strerror(errno));
    exit(1);
  }
  state->restored = true;
}

static void write_stack_u64(uint64_t address, uint64_t value) {
  volatile uint64_t *slot = (volatile uint64_t *)(uintptr_t)address;
  *slot = value;
}

static void materialize_native_u64_writes(
    const struct Options *opts, const struct NativeU64Write *writes, size_t count, const char *label) {
  for (size_t i = 0; i < count; i++) {
    const struct NativeU64Write *write = &writes[i];
    if (!address_inside_stack(opts, write->target_address, sizeof(uint64_t))) {
      fprintf(stderr, "native-actual-resume-trampoline: %s write is outside target stack\n", label);
      exit(2);
    }
    write_stack_u64(write->target_address, write->value);
  }
}

static void materialize_native_stack_and_return_writes(const struct Options *opts) {
  materialize_native_u64_writes(
      opts, opts->native_stack_window_writes, opts->native_stack_window_write_count, "native stack-window");
  materialize_native_u64_writes(
      opts, opts->native_return_chain_writes, opts->native_return_chain_write_count, "native return-chain");
}

static void materialize_target_tcb(const struct Options *opts) {
  if (!opts->has_target_fs_base) {
    return;
  }
  write_stack_u64(opts->target_fs_base + TLS_TCB_SELF_OFFSET, opts->target_fs_base);
  write_stack_u64(opts->target_fs_base + TLS_TCB_MARKER_OFFSET, TLS_TCB_MARKER);
}

static void materialize_translated_frame(const struct Options *opts) {
  if (!opts->has_translated_frame) {
    return;
  }
  for (size_t i = 0; i < opts->translated_frame_slot_count; i++) {
    write_stack_u64(opts->translated_frame_pointer + opts->translated_frame_slot_offsets[i],
        opts->translated_frame_slot_values[i]);
  }
}

static void capture_host_fs_base(void) {
  unsigned long fs_base = 0;
  long rc = syscall(SYS_arch_prctl, ARCH_GET_FS, &fs_base);
  if (rc != 0) {
    fprintf(stderr, "native-actual-resume-trampoline: ARCH_GET_FS failed: %s\n", strerror(errno));
    exit(1);
  }
  host_fs_before_jump = (uint64_t)fs_base;
}

static void jump_to_target(uint64_t entry,
    uint64_t initial_rsp,
    uint64_t target_fs_base,
    uint64_t argument0,
    uint64_t translated_return_address,
    uint64_t translated_frame_pointer,
    uint64_t translated_frame_rbx,
    uint64_t translated_frame_r12,
    uint64_t translated_frame_r13,
    uint64_t translated_frame_r14,
    uint64_t translated_frame_r15,
    uint64_t resume_rflags,
    uint64_t resume_register_rax,
    uint64_t resume_register_rdi,
    uint64_t resume_register_rsi,
    uint64_t resume_register_rdx,
    uint64_t resume_register_rcx,
    uint64_t resume_register_r8,
    uint64_t resume_register_r9,
    uint64_t resume_register_r10,
    uint64_t resume_register_r11) {
  jump_entry_address = entry;
  jump_initial_rsp = initial_rsp;
  jump_target_fs_base = target_fs_base;
  jump_argument0 = argument0;
  jump_translated_return_address = translated_return_address;
  jump_translated_frame_pointer = translated_frame_pointer;
  jump_translated_frame_rbx = translated_frame_rbx;
  jump_translated_frame_r12 = translated_frame_r12;
  jump_translated_frame_r13 = translated_frame_r13;
  jump_translated_frame_r14 = translated_frame_r14;
  jump_translated_frame_r15 = translated_frame_r15;
  jump_resume_rflags = resume_rflags;
  jump_resume_register_rax = resume_register_rax;
  jump_resume_register_rdi = resume_register_rdi;
  jump_resume_register_rsi = resume_register_rsi;
  jump_resume_register_rdx = resume_register_rdx;
  jump_resume_register_rcx = resume_register_rcx;
  jump_resume_register_r8 = resume_register_r8;
  jump_resume_register_r9 = resume_register_r9;
  jump_resume_register_r10 = resume_register_r10;
  jump_resume_register_r11 = resume_register_r11;
  __asm__ __volatile__(
      "movq %%rsp, host_rsp_before_jump(%%rip)\n"
      "movq %%rbx, host_rbx_before_jump(%%rip)\n"
      "movq %%rbp, host_rbp_before_jump(%%rip)\n"
      "movq %%r12, host_r12_before_jump(%%rip)\n"
      "movq %%r13, host_r13_before_jump(%%rip)\n"
      "movq %%r14, host_r14_before_jump(%%rip)\n"
      "movq %%r15, host_r15_before_jump(%%rip)\n"
      "movq jump_initial_rsp(%%rip), %%rsp\n"
      "leaq 1f(%%rip), %%rax\n"
      "movq jump_translated_return_address(%%rip), %%rdx\n"
      "testq %%rdx, %%rdx\n"
      "jz 2f\n"
      "movq %%rdx, (%%rsp)\n"
      "movq %%rax, 8(%%rsp)\n"
      "jmp 3f\n"
      "2:\n"
      "movq %%rax, (%%rsp)\n"
      "3:\n"
      "movq jump_translated_frame_pointer(%%rip), %%rbp\n"
      "movq jump_translated_frame_rbx(%%rip), %%rbx\n"
      "movq jump_translated_frame_r12(%%rip), %%r12\n"
      "movq jump_translated_frame_r13(%%rip), %%r13\n"
      "movq jump_translated_frame_r14(%%rip), %%r14\n"
      "movq jump_translated_frame_r15(%%rip), %%r15\n"
      "movq jump_resume_rflags(%%rip), %%r11\n"
      "testq %%r11, %%r11\n"
      "jz 4f\n"
      "pushq %%r11\n"
      "popfq\n"
      "4:\n"
      "movq jump_resume_register_rdi(%%rip), %%rdi\n"
      "movq jump_resume_register_rax(%%rip), %%rax\n"
      "movq jump_resume_register_rsi(%%rip), %%rsi\n"
      "movq jump_resume_register_rdx(%%rip), %%rdx\n"
      "movq jump_resume_register_rcx(%%rip), %%rcx\n"
      "movq jump_resume_register_r8(%%rip), %%r8\n"
      "movq jump_resume_register_r9(%%rip), %%r9\n"
      "movq jump_resume_register_r10(%%rip), %%r10\n"
      "movq jump_resume_register_r11(%%rip), %%r11\n"
      "cmpq $0, jump_target_fs_base(%%rip)\n"
      "jz 5f\n"
      "movq $158, %%rax\n"
      "movq $0x1002, %%rdi\n"
      "movq jump_target_fs_base(%%rip), %%rsi\n"
      "syscall\n"
      "5:\n"
      "movq jump_resume_rflags(%%rip), %%r11\n"
      "testq %%r11, %%r11\n"
      "jz 7f\n"
      "pushq %%r11\n"
      "popfq\n"
      "7:\n"
      "movq jump_resume_register_rdi(%%rip), %%rdi\n"
      "movq jump_resume_register_rax(%%rip), %%rax\n"
      "movq jump_resume_register_rsi(%%rip), %%rsi\n"
      "movq jump_resume_register_rdx(%%rip), %%rdx\n"
      "movq jump_resume_register_rcx(%%rip), %%rcx\n"
      "movq jump_resume_register_r8(%%rip), %%r8\n"
      "movq jump_resume_register_r9(%%rip), %%r9\n"
      "movq jump_resume_register_r10(%%rip), %%r10\n"
      "movq jump_resume_register_r11(%%rip), %%r11\n"
      "jmp *jump_entry_address(%%rip)\n"
      "1:\n"
      "movq %%rax, resume_return_value(%%rip)\n"
      "movq jump_target_fs_base(%%rip), %%rsi\n"
      "testq %%rsi, %%rsi\n"
      "jz 6f\n"
      "movq $158, %%rax\n"
      "movq $0x1002, %%rdi\n"
      "movq host_fs_before_jump(%%rip), %%rsi\n"
      "syscall\n"
      "6:\n"
      "movq host_rsp_before_jump(%%rip), %%rsp\n"
      "movq host_rbx_before_jump(%%rip), %%rbx\n"
      "movq host_rbp_before_jump(%%rip), %%rbp\n"
      "movq host_r12_before_jump(%%rip), %%r12\n"
      "movq host_r13_before_jump(%%rip), %%r13\n"
      "movq host_r14_before_jump(%%rip), %%r14\n"
      "movq host_r15_before_jump(%%rip), %%r15\n"
      :
      :
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

static uint64_t read_state_report_u64(uint64_t base, uint64_t offset) {
  volatile uint64_t *slot = (volatile uint64_t *)(uintptr_t)(base + offset);
  return *slot;
}

static uint8_t read_state_report_u8(uint64_t base, uint64_t offset) {
  volatile uint8_t *slot = (volatile uint8_t *)(uintptr_t)(base + offset);
  return *slot;
}

static void print_check_status(const char *kind, uint64_t mask, uint64_t bit) {
  printf("{\"kind\":\"%s\",\"status\":\"%s\"}",
      kind,
      (mask & bit) == bit ? "passed" : "failed");
}

static uint64_t expected_state_consumption_mask(const struct Options *opts) {
  uint64_t mask = STATE_CONSUMPTION_MASK;
  if (opts->synthetic_epoll_count > 0) {
    mask |= STATE_CHECK_EPOLL;
  }
  if (opts->synthetic_signalfd_count > 0) {
    mask |= STATE_CHECK_SIGNALFD;
  }
  if (opts->synthetic_tcp_listener_count > 0) {
    mask |= STATE_CHECK_TCP_LISTENER;
  }
  for (size_t i = 0; i < opts->synthetic_tcp_listener_count; i++) {
    if (strstr(opts->synthetic_tcp_listeners[i].spec, "port=45322") != NULL) {
      mask |= STATE_CHECK_TCP_READINESS;
    }
  }
  if (opts->synthetic_tcp_active_broker_count > 0) {
    mask |= STATE_CHECK_TCP_ACTIVE;
  }
  if (opts->synthetic_raw_icmp_count > 0) {
    mask |= STATE_CHECK_RAW_ICMP;
  }
  if (opts->synthetic_ping_socket_count > 0) {
    mask |= STATE_CHECK_PING_SOCKET;
  }
  return mask;
}

static void print_state_consumption(const struct Options *opts) {
  if (!opts->has_state_report_address) {
    return;
  }
  uint64_t base = opts->state_report_address;
  uint8_t memory_byte = read_state_report_u8(base, 0);
  uint64_t marker = read_state_report_u64(base, 8);
  uint64_t mask = read_state_report_u64(base, 16);
  uint64_t expected_mask = expected_state_consumption_mask(opts);
  bool passed = marker == STATE_CONSUMPTION_MARKER && mask == expected_mask;
  printf(
      ",\"stateConsumption\":{\"status\":\"%s\","
      "\"reportAddress\":\"0x%" PRIx64 "\","
      "\"memoryByte\":\"0x%02x\","
      "\"reportMarker\":\"0x%" PRIx64 "\","
      "\"resourceMask\":\"0x%" PRIx64 "\","
      "\"expectedResourceMask\":\"0x%" PRIx64 "\","
      "\"checks\":[",
      passed ? "passed" : "failed",
      base,
      memory_byte,
      marker,
      mask,
      expected_mask);
  print_check_status("captured-memory", mask, STATE_CHECK_MEMORY);
  printf(",");
  print_check_status("inherit-stdio", mask, STATE_CHECK_STDIO);
  printf(",");
  print_check_status("close-fd", mask, STATE_CHECK_CLOSE_FD);
  printf(",");
  print_check_status("reopen-file", mask, STATE_CHECK_REOPEN_FILE);
  printf(",");
  print_check_status("synthetic-empty-pipe", mask, STATE_CHECK_PIPE);
  printf(",");
  print_check_status("synthetic-empty-eventfd", mask, STATE_CHECK_EVENTFD);
  printf(",");
  print_check_status("synthetic-timerfd", mask, STATE_CHECK_TIMERFD);
  if (opts->synthetic_epoll_count > 0) {
    printf(",");
    print_check_status("synthetic-epoll", mask, STATE_CHECK_EPOLL);
  }
  if (opts->synthetic_signalfd_count > 0) {
    printf(",");
    print_check_status("synthetic-signalfd", mask, STATE_CHECK_SIGNALFD);
  }
  if (opts->synthetic_tcp_listener_count > 0) {
    printf(",");
    print_check_status("synthetic-tcp-listener", mask, STATE_CHECK_TCP_LISTENER);
  }
  for (size_t i = 0; i < opts->synthetic_tcp_listener_count; i++) {
    if (strstr(opts->synthetic_tcp_listeners[i].spec, "port=45322") != NULL) {
      printf(",");
      print_check_status("synthetic-tcp-listener-readiness", mask, STATE_CHECK_TCP_READINESS);
    }
  }
  if (opts->synthetic_tcp_active_broker_count > 0) {
    printf(",");
    print_check_status("synthetic-tcp-active-broker", mask, STATE_CHECK_TCP_ACTIVE);
  }
  if (opts->synthetic_raw_icmp_count > 0) {
    printf(",");
    print_check_status("synthetic-raw-icmp", mask, STATE_CHECK_RAW_ICMP);
  }
  if (opts->synthetic_ping_socket_count > 0) {
    printf(",");
    print_check_status("synthetic-ping-socket", mask, STATE_CHECK_PING_SOCKET);
  }
  printf("],\"resourceStatuses\":[");
  print_check_status("inherit-stdio", mask, STATE_CHECK_STDIO);
  printf(",");
  print_check_status("close-fd", mask, STATE_CHECK_CLOSE_FD);
  printf(",");
  print_check_status("reopen-file", mask, STATE_CHECK_REOPEN_FILE);
  printf(",");
  print_check_status("synthetic-empty-pipe", mask, STATE_CHECK_PIPE);
  printf(",");
  print_check_status("synthetic-empty-eventfd", mask, STATE_CHECK_EVENTFD);
  printf(",");
  print_check_status("synthetic-timerfd", mask, STATE_CHECK_TIMERFD);
  if (opts->synthetic_epoll_count > 0) {
    printf(",");
    print_check_status("synthetic-epoll", mask, STATE_CHECK_EPOLL);
  }
  if (opts->synthetic_signalfd_count > 0) {
    printf(",");
    print_check_status("synthetic-signalfd", mask, STATE_CHECK_SIGNALFD);
  }
  if (opts->synthetic_tcp_listener_count > 0) {
    printf(",");
    print_check_status("synthetic-tcp-listener", mask, STATE_CHECK_TCP_LISTENER);
  }
  for (size_t i = 0; i < opts->synthetic_tcp_listener_count; i++) {
    if (strstr(opts->synthetic_tcp_listeners[i].spec, "port=45322") != NULL) {
      printf(",");
      print_check_status("synthetic-tcp-listener-readiness", mask, STATE_CHECK_TCP_READINESS);
    }
  }
  if (opts->synthetic_tcp_active_broker_count > 0) {
    printf(",");
    print_check_status("synthetic-tcp-active-broker", mask, STATE_CHECK_TCP_ACTIVE);
  }
  if (opts->synthetic_raw_icmp_count > 0) {
    printf(",");
    print_check_status("synthetic-raw-icmp", mask, STATE_CHECK_RAW_ICMP);
  }
  if (opts->synthetic_ping_socket_count > 0) {
    printf(",");
    print_check_status("synthetic-ping-socket", mask, STATE_CHECK_PING_SOCKET);
  }
  printf("]}");
}

static void print_return_chain(const struct Options *opts) {
  if (!opts->has_translated_return_address || !opts->has_state_report_address) {
    return;
  }
  uint64_t marker = read_state_report_u64(opts->state_report_address, 24);
  bool passed = marker == TRANSLATED_RETURN_MARKER;
  printf(
      ",\"returnChain\":{\"status\":\"%s\","
      "\"translatedReturnAddress\":\"0x%" PRIx64 "\","
      "\"returnMarker\":\"0x%" PRIx64 "\","
      "\"expectedReturnMarker\":\"0x%" PRIx64 "\"}",
      passed ? "passed" : "failed",
      opts->translated_return_address,
      marker,
      TRANSLATED_RETURN_MARKER);
}

static void print_resume_register_status(
    const char *name, uint64_t observed, uint64_t expected, uint64_t mask, uint64_t bit) {
  bool passed = (mask & bit) == bit && observed == expected;
  printf("{\"register\":\"%s\",\"status\":\"%s\",\"value\":\"0x%" PRIx64 "\",\"expected\":\"0x%" PRIx64 "\"}",
      name,
      passed ? "passed" : "failed",
      observed,
      expected);
}

static void print_register_restore(const struct Options *opts) {
  if (opts->resume_register_mask == 0 || !opts->has_state_report_address) {
    return;
  }
  uint64_t base = opts->state_report_address;
  uint64_t marker = read_state_report_u64(base, 128);
  uint64_t observed_rax = read_state_report_u64(base, 136);
  uint64_t observed_rdi = read_state_report_u64(base, 200);
  uint64_t observed_rsi = read_state_report_u64(base, 144);
  uint64_t observed_rdx = read_state_report_u64(base, 152);
  uint64_t observed_rcx = read_state_report_u64(base, 160);
  uint64_t observed_r8 = read_state_report_u64(base, 168);
  uint64_t observed_r9 = read_state_report_u64(base, 176);
  uint64_t observed_r10 = read_state_report_u64(base, 184);
  uint64_t observed_r11 = read_state_report_u64(base, 192);
  bool passed = marker == RESUME_REGISTER_MARKER &&
      observed_rax == opts->resume_register_rax && observed_rdi == opts->resume_register_rdi &&
      observed_rsi == opts->resume_register_rsi &&
      observed_rdx == opts->resume_register_rdx && observed_rcx == opts->resume_register_rcx &&
      observed_r8 == opts->resume_register_r8 && observed_r9 == opts->resume_register_r9 &&
      observed_r10 == opts->resume_register_r10 && observed_r11 == opts->resume_register_r11;
  printf(
      ",\"registerRestore\":{\"status\":\"%s\","
      "\"reportMarker\":\"0x%" PRIx64 "\","
      "\"expectedMarker\":\"0x%" PRIx64 "\","
      "\"registers\":[",
      passed ? "passed" : "failed",
      marker,
      RESUME_REGISTER_MARKER);
  print_resume_register_status("rax", observed_rax, opts->resume_register_rax, RESUME_REGISTER_MASK, RESUME_REGISTER_RAX);
  printf(",");
  print_resume_register_status("rdi", observed_rdi, opts->resume_register_rdi, RESUME_REGISTER_MASK, RESUME_REGISTER_RDI);
  printf(",");
  print_resume_register_status("rsi", observed_rsi, opts->resume_register_rsi, RESUME_REGISTER_MASK, RESUME_REGISTER_RSI);
  printf(",");
  print_resume_register_status("rdx", observed_rdx, opts->resume_register_rdx, RESUME_REGISTER_MASK, RESUME_REGISTER_RDX);
  printf(",");
  print_resume_register_status("rcx", observed_rcx, opts->resume_register_rcx, RESUME_REGISTER_MASK, RESUME_REGISTER_RCX);
  printf(",");
  print_resume_register_status("r8", observed_r8, opts->resume_register_r8, RESUME_REGISTER_MASK, RESUME_REGISTER_R8);
  printf(",");
  print_resume_register_status("r9", observed_r9, opts->resume_register_r9, RESUME_REGISTER_MASK, RESUME_REGISTER_R9);
  printf(",");
  print_resume_register_status("r10", observed_r10, opts->resume_register_r10, RESUME_REGISTER_MASK, RESUME_REGISTER_R10);
  printf(",");
  print_resume_register_status("r11", observed_r11, opts->resume_register_r11, RESUME_REGISTER_MASK, RESUME_REGISTER_R11);
  printf("]}");
}

static void print_rflags_restore(const struct Options *opts) {
  if (!opts->has_resume_rflags || !opts->has_state_report_address) {
    return;
  }
  uint64_t base = opts->state_report_address;
  uint64_t marker = read_state_report_u64(base, 208);
  uint64_t observed_rflags = read_state_report_u64(base, 216);
  uint64_t observed_conditions = observed_rflags & RESUME_RFLAGS_CONDITION_MASK;
  uint64_t expected_conditions = opts->resume_rflags & RESUME_RFLAGS_CONDITION_MASK;
  bool passed = marker == RESUME_RFLAGS_MARKER && observed_conditions == expected_conditions;
  printf(
      ",\"rflagsRestore\":{\"status\":\"%s\","
      "\"reportMarker\":\"0x%" PRIx64 "\","
      "\"expectedMarker\":\"0x%" PRIx64 "\","
      "\"rflags\":\"0x%" PRIx64 "\","
      "\"expectedRflags\":\"0x%" PRIx64 "\","
      "\"conditionMask\":\"0x%" PRIx64 "\"}",
      passed ? "passed" : "failed",
      marker,
      RESUME_RFLAGS_MARKER,
      observed_rflags,
      opts->resume_rflags,
      RESUME_RFLAGS_CONDITION_MASK);
}

static void print_resume_path(const struct Options *opts) {
  if (!opts->has_resume_mode || !opts->has_state_report_address) {
    return;
  }
  uint64_t marker = read_state_report_u64(opts->state_report_address, 40);
  bool passed = marker == TRANSLATED_RESUME_MARKER;
  printf(
      ",\"resumePath\":{\"status\":\"%s\","
      "\"mode\":\"%s\","
      "\"reportMarker\":\"0x%" PRIx64 "\","
      "\"expectedResumeMarker\":\"0x%" PRIx64 "\"}",
      passed ? "passed" : "failed",
      opts->resume_mode,
      marker,
      TRANSLATED_RESUME_MARKER);
}

static void print_callee_saved_status(const char *name, uint64_t value, uint64_t mask, uint64_t bit) {
  printf("{\"register\":\"%s\",\"status\":\"%s\",\"value\":\"0x%" PRIx64 "\"}",
      name,
      (mask & bit) == bit ? "passed" : "failed",
      value);
}

static bool translated_frame_slots_passed(const struct Options *opts) {
  for (size_t i = 0; i < opts->translated_frame_slot_count; i++) {
    uint64_t slot_value = read_state_report_u64(
        opts->translated_frame_pointer, opts->translated_frame_slot_offsets[i]);
    if (slot_value != opts->translated_frame_slot_values[i]) {
      return false;
    }
  }
  return true;
}

static void print_frame_slots(const struct Options *opts) {
  for (size_t i = 0; i < opts->translated_frame_slot_count; i++) {
    uint64_t slot_value = read_state_report_u64(
        opts->translated_frame_pointer, opts->translated_frame_slot_offsets[i]);
    if (i > 0) {
      printf(",");
    }
    printf("{\"offset\":%" PRIu64 ",\"classification\":\"%s\",\"status\":\"%s\",\"value\":\"0x%" PRIx64 "\"}",
        opts->translated_frame_slot_offsets[i],
        opts->translated_frame_slot_classes[i],
        slot_value == opts->translated_frame_slot_values[i] ? "passed" : "failed",
        slot_value);
  }
}

static void print_frame_restoration(const struct Options *opts) {
  if (!opts->has_translated_frame || !opts->has_state_report_address) {
    return;
  }
  uint64_t report_marker = read_state_report_u64(opts->state_report_address, 32);
  uint64_t register_mask = read_state_report_u64(opts->state_report_address, 48);
  bool passed = report_marker == TRANSLATED_FRAME_MARKER &&
      register_mask == TRANSLATED_FRAME_REGISTER_MASK && translated_frame_slots_passed(opts);
  printf(
      ",\"frameRestoration\":{\"status\":\"%s\","
      "\"framePointer\":\"0x%" PRIx64 "\","
      "\"canonicalFrameAddress\":\"0x%" PRIx64 "\","
      "\"returnAddressSlot\":\"0x%" PRIx64 "\","
      "\"returnAddress\":\"0x%" PRIx64 "\","
      "\"unwindId\":\"%s\","
      "\"reportMarker\":\"0x%" PRIx64 "\","
      "\"expectedFrameMarker\":\"0x%" PRIx64 "\","
      "\"calleeSavedMask\":\"0x%" PRIx64 "\","
      "\"expectedCalleeSavedMask\":\"0x%" PRIx64 "\","
      "\"calleeSaved\":[",
      passed ? "passed" : "failed",
      opts->translated_frame_pointer,
      opts->translated_frame_cfa,
      opts->translated_frame_return_address_slot,
      opts->translated_frame_return_address,
      opts->translated_frame_unwind_id,
      report_marker,
      TRANSLATED_FRAME_MARKER,
      register_mask,
      TRANSLATED_FRAME_REGISTER_MASK);
  print_callee_saved_status("rbx", opts->translated_frame_callee_rbx, register_mask, TRANSLATED_FRAME_REGISTER_RBX);
  printf(",");
  print_callee_saved_status("r12", opts->translated_frame_callee_r12, register_mask, TRANSLATED_FRAME_REGISTER_R12);
  printf(",");
  print_callee_saved_status("r13", opts->translated_frame_callee_r13, register_mask, TRANSLATED_FRAME_REGISTER_R13);
  printf(",");
  print_callee_saved_status("r14", opts->translated_frame_callee_r14, register_mask, TRANSLATED_FRAME_REGISTER_R14);
  printf(",");
  print_callee_saved_status("r15", opts->translated_frame_callee_r15, register_mask, TRANSLATED_FRAME_REGISTER_R15);
  printf("],\"slots\":[");
  print_frame_slots(opts);
  printf("]}");
}

static void print_tls_restore(const struct Options *opts) {
  if (!opts->has_target_fs_base || !opts->has_state_report_address) {
    return;
  }
  uint64_t marker = read_state_report_u64(opts->state_report_address, 224);
  uint64_t observed_marker = read_state_report_u64(opts->state_report_address, 232);
  uint64_t observed_self = read_state_report_u64(opts->state_report_address, 240);
  bool passed = marker == TLS_RESTORE_MARKER && observed_marker == TLS_TCB_MARKER &&
      observed_self == opts->target_fs_base;
  printf(
      ",\"tlsRestore\":{\"status\":\"%s\","
      "\"targetFsBase\":\"0x%" PRIx64 "\","
      "\"reportMarker\":\"0x%" PRIx64 "\","
      "\"expectedMarker\":\"0x%" PRIx64 "\","
      "\"observedTcbMarker\":\"0x%" PRIx64 "\","
      "\"expectedTcbMarker\":\"0x%" PRIx64 "\","
      "\"observedSelfPointer\":\"0x%" PRIx64 "\"}",
      passed ? "passed" : "failed",
      opts->target_fs_base,
      marker,
      TLS_RESTORE_MARKER,
      observed_marker,
      TLS_TCB_MARKER,
      observed_self);
}

static void print_native_restore_consumption(const struct Options *opts) {
  if (opts->native_stack_window_write_count > 0 || opts->native_stack_window_guard_count > 0) {
    printf(",\"nativeStackWindowMaterialization\":{\"status\":\"passed\",\"writeCount\":%zu,\"guardCount\":%zu}",
        opts->native_stack_window_write_count,
        opts->native_stack_window_guard_count);
  }
  if (opts->native_return_chain_write_count > 0) {
    printf(",\"nativeReturnChainMaterialization\":{\"status\":\"passed\",\"writeCount\":%zu}",
        opts->native_return_chain_write_count);
  }
  if (opts->native_private_memory_step_count > 0) {
    printf(",\"nativePrivateMemoryRestore\":{\"status\":\"passed\",\"stepCount\":%zu}",
        opts->native_private_memory_step_count);
  }
  if (opts->native_executable_mapping_count > 0) {
    printf(",\"nativeExecutableMapping\":{\"status\":\"passed\",\"mappingCount\":%zu}",
        opts->native_executable_mapping_count);
  }
  if (native_process_context_restore_state.requested) {
    bool process_context_passed =
        native_process_context_restore_state.consumed_count == opts->native_process_context_step_count;
    printf(",\"nativeProcessContextRestore\":{\"status\":\"%s\",\"stepCount\":%zu,\"metadataCount\":%zu,\"envSetCount\":%zu,\"argvMaterialized\":%s,\"envCleared\":%s,\"envVerified\":%s,\"envValueVerified\":%s,\"cwdApplied\":%s,\"cwdVerified\":%s,\"auxvVerified\":%s,\"auxvPolicyRecorded\":%s,\"initialStackMaterialized\":%s,\"initialStackVerified\":%s,\"initialStackStart\":\"0x%llx\"}",
        process_context_passed ? "passed" : "failed",
        opts->native_process_context_step_count,
        native_process_context_restore_state.metadata_count,
        native_process_context_restore_state.env_set_count,
        native_process_context_restore_state.argv_materialized ? "true" : "false",
        native_process_context_restore_state.env_cleared ? "true" : "false",
        native_process_context_restore_state.env_verified ? "true" : "false",
        native_process_context_restore_state.env_value_verified ? "true" : "false",
        native_process_context_restore_state.cwd_applied ? "true" : "false",
        native_process_context_restore_state.cwd_verified ? "true" : "false",
        native_process_context_restore_state.auxv_verified ? "true" : "false",
        native_process_context_restore_state.auxv_policy_recorded ? "true" : "false",
        native_process_context_restore_state.initial_stack_materialized ? "true" : "false",
        native_process_context_restore_state.initial_stack_verified ? "true" : "false",
        (unsigned long long)native_process_context_restore_state.initial_stack_start);
  }
  if (native_signal_restore_state.requested) {
    bool signal_passed = native_signal_restore_state.saved &&
        (!native_signal_restore_state.verify_requested || native_signal_restore_state.verified) &&
        (!native_signal_restore_state.restore_requested || native_signal_restore_state.restored);
    printf(",\"nativeSignalRestore\":{\"status\":\"%s\",\"stepCount\":%zu,\"saved\":%s,\"applied\":%s,\"verified\":%s,\"restored\":%s}",
        signal_passed ? "passed" : "failed",
        opts->native_signal_step_count,
        native_signal_restore_state.saved ? "true" : "false",
        native_signal_restore_state.applied ? "true" : "false",
        native_signal_restore_state.verified ? "true" : "false",
        native_signal_restore_state.restored ? "true" : "false");
  }
  if (native_active_syscall_restore_state.requested) {
    bool active_passed = native_active_syscall_restore_state.consumed_count == opts->native_active_syscall_step_count;
    printf(",\"nativeActiveSyscallRestore\":{\"status\":\"%s\",\"stepCount\":%zu,\"armedCount\":%zu,\"consumedCount\":%zu}",
        active_passed ? "passed" : "failed",
        opts->native_active_syscall_step_count,
        native_active_syscall_restore_state.armed_count,
        native_active_syscall_restore_state.consumed_count);
  }
  if (native_thread_restore_state.requested) {
    bool thread_passed = native_thread_restore_state.spawned_count == opts->native_thread_spawn_step_count;
    printf(",\"nativeThreadRestore\":{\"status\":\"%s\",\"stepCount\":%zu,\"spawnedCount\":%zu}",
        thread_passed ? "passed" : "failed",
        opts->native_thread_spawn_step_count,
        native_thread_restore_state.spawned_count);
  }
}

static void print_return_event(const struct Options *opts) {
  printf(
      "MACHINEN_ACTUAL_RESUME_TRAMPOLINE {\"status\":\"returned\"," 
      "\"targetArch\":\"amd64\",\"entry\":\"0x%" PRIx64 "\"," 
      "\"returnValue\":\"0x%" PRIx64 "\"," 
      "\"argument0\":\"0x%" PRIx64 "\","
      "\"stackPointer\":\"0x%" PRIx64 "\"," 
      "\"targetBytesStart\":\"0x%" PRIx64 "\"," 
      "\"targetBytesEnd\":\"0x%" PRIx64 "\"," 
      "\"instructionPointerInTargetBytes\":true,"
      "\"attemptedResume\":true,\"sourceTextReusedAsTargetCode\":false,"
      "\"sourceIsaEmulationUsed\":false,\"sidecarRuntimeUsed\":false",
      opts->target_address,
      resume_return_value,
      opts->argument0,
      opts->stack_pointer,
      mapped_target_start,
      mapped_target_end);
  print_state_consumption(opts);
  print_return_chain(opts);
  print_frame_restoration(opts);
  print_resume_path(opts);
  print_register_restore(opts);
  print_rflags_restore(opts);
  print_tls_restore(opts);
  print_native_restore_consumption(opts);
  printf("}\n");
}

int main(int argc, char **argv) {
  struct Options opts = parse_args(argc, argv);
  validate_stack_options(&opts);
  validate_resume_rflags_options(&opts);
  validate_resume_register_options(&opts);
  validate_translated_frame_options(&opts);
  validate_target_tls_options(&opts);
  mapped_target_start = opts.target_address;
  mapped_target_end = opts.target_address + opts.code_size;

  if (opts.native_private_memory_step_count > 0) {
    apply_native_private_memory_steps(&opts);
  } else {
    materialize_descriptor_memory(&opts);
  }
  materialize_native_stack_window_guards(&opts);
  validate_target_tls_backing(&opts);
  materialize_target_tcb(&opts);

  verify_native_executable_mappings(&opts);
  uint64_t mapped_code_start = 0;
  uint64_t mapped_code_size = 0;
  void *code = map_target_code(&opts, &mapped_code_start, &mapped_code_size);
  mapped_code_bytes = code;
  mapped_code_page_start = mapped_code_start;
  mapped_code_page_size = mapped_code_size;
  void *stack = map_fixed(
      opts.stack_target_start, opts.stack_size, PROT_READ | PROT_WRITE, "target-stack");
  materialize_translated_frame(&opts);
  materialize_native_stack_and_return_writes(&opts);

  install_signal_handlers();
  install_synthetic_empty_pipe(
      opts.synthetic_empty_pipe_read_fd, opts.synthetic_empty_pipe_write_fd, opts.synthetic_pipe_initial_hex);
  install_synthetic_empty_eventfd(opts.synthetic_empty_eventfd);
  if (opts.has_synthetic_eventfd) {
    install_synthetic_eventfd_alias(
        opts.synthetic_eventfd, opts.synthetic_eventfd_duplicate, opts.synthetic_eventfd_initial_value);
  }
  install_synthetic_timerfd_with_spec(opts.synthetic_timerfd, opts.synthetic_timerfd_spec);
  install_synthetic_signalfds(&opts);
  install_synthetic_epolls(&opts);
  install_synthetic_tcp_listeners(&opts);
  install_synthetic_tcp_active_brokers(&opts);
  install_synthetic_raw_icmp_sockets(&opts);
  install_synthetic_ping_sockets(&opts);
  apply_cloexec_fds(&opts);
  consume_native_process_context_steps(&opts, &native_process_context_restore_state);
  apply_native_signal_restore_steps(&opts, &native_signal_restore_state);
  apply_native_active_syscall_restore_steps(&opts, &native_active_syscall_restore_state);
  consume_native_thread_spawn_steps(&opts, &native_thread_restore_state);
  capture_host_fs_base();
  alarm((unsigned int)opts.timeout_seconds);
  if (sigsetjmp(resume_fault_jmp, 1) == 0) {
    uint64_t initial_rsp = opts.has_translated_return_address ? opts.stack_pointer - 16u : opts.stack_pointer - 8u;
    uint64_t entry_rdi = opts.resume_register_mask == 0
        ? (opts.has_argument0 ? opts.argument0 : 0u)
        : opts.resume_register_rdi;
    jump_to_target(
        opts.target_address,
        initial_rsp,
        opts.has_target_fs_base ? opts.target_fs_base : 0u,
        opts.has_argument0 ? opts.argument0 : 0u,
        opts.has_translated_return_address ? opts.translated_return_address : 0u,
        opts.has_translated_frame ? opts.translated_frame_pointer : 0u,
        opts.has_translated_frame_callee_rbx ? opts.translated_frame_callee_rbx : 0u,
        opts.has_translated_frame_callee_r12 ? opts.translated_frame_callee_r12 : 0u,
        opts.has_translated_frame_callee_r13 ? opts.translated_frame_callee_r13 : 0u,
        opts.has_translated_frame_callee_r14 ? opts.translated_frame_callee_r14 : 0u,
        opts.has_translated_frame_callee_r15 ? opts.translated_frame_callee_r15 : 0u,
        opts.has_resume_rflags ? opts.resume_rflags : 0u,
        opts.resume_register_rax,
        entry_rdi,
        opts.resume_register_rsi,
        opts.resume_register_rdx,
        opts.resume_register_rcx,
        opts.resume_register_r8,
        opts.resume_register_r9,
        opts.resume_register_r10,
        opts.resume_register_r11);
    alarm(0);
    restore_native_signal_mask(&native_signal_restore_state);
    print_return_event(&opts);
  } else {
    alarm(0);
    restore_native_signal_mask(&native_signal_restore_state);
    print_fault_event(&opts);
  }

  close_native_active_syscall_timers(&native_active_syscall_restore_state);
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
