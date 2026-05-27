// Unmodified source/target binary for DWARF/eh-frame stack-frame discovery.
//
// The arm64 source side publishes real CFI for the active frame. The external
// capturer stops the process while PC is inside that frame; the proof reads the
// FDE, computes CFA and the saved x30 slot, reads the return address from the
// captured stack bytes, and feeds that discovered frame into stack translation.
// The amd64 target side contributes matching active/return functions from a
// real executable section so native ret can consume the translated stack slot.

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#define SOURCE_MARKER UINT64_C(0x534f555243454a50)
#define ACTIVE_MARKER UINT64_C(0x4e454e494843414d)
#define RETURN_MARKER UINT64_C(0x52455455524e4a50)
#define RETURN_VALUE UINT64_C(0x4d)

static uint64_t native_dwarf_unwind_state[512] __attribute__((aligned(4096)));

static void die(const char *message) {
  fprintf(stderr, "machinen-native-dwarf-unwind-continuation: %s: %s\n", message, strerror(errno));
  exit(1);
}

static const char *resource_file_arg(int argc, char **argv) {
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], "--resource-file") == 0) {
      if (i + 1 >= argc) {
        fprintf(stderr, "--resource-file requires a path\n");
        exit(2);
      }
      return argv[i + 1];
    }
  }
  return NULL;
}

static int open_resource_file(const char *path) {
  if (!path) {
    return -1;
  }
  int fd = open(path, O_CREAT | O_TRUNC | O_RDWR | O_CLOEXEC, 0600);
  if (fd < 0) {
    die("open resource file");
  }
  const char payload[] = "machinen-native-dwarf-unwind-continuation\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write resource file");
  }
  if (lseek(fd, 9, SEEK_SET) < 0) {
    die("seek resource file");
  }
  return fd;
}

#if defined(__aarch64__)
void machinen_native_dwarf_unwind_source_caller(uint64_t *state) __attribute__((noreturn));
__asm__(
    ".text\n"
    ".balign 16\n"
    ".global machinen_native_dwarf_unwind_active\n"
    ".type machinen_native_dwarf_unwind_active, %function\n"
    "machinen_native_dwarf_unwind_active:\n"
    "  .cfi_startproc\n"
    "  stp x29, x30, [sp, #-16]!\n"
    "  .cfi_def_cfa_offset 16\n"
    "  .cfi_offset x29, -16\n"
    "  .cfi_offset x30, -8\n"
    "  mov x29, sp\n"
    "  .cfi_def_cfa_register x29\n"
    "1:\n"
    "  ldr x1, [x0, #16]\n"
    "  add x1, x1, #1\n"
    "  str x1, [x0, #16]\n"
    "  b 1b\n"
    "  .cfi_endproc\n"
    ".size machinen_native_dwarf_unwind_active, .-machinen_native_dwarf_unwind_active\n"
    ".balign 16\n"
    ".global machinen_native_dwarf_unwind_source_caller\n"
    ".type machinen_native_dwarf_unwind_source_caller, %function\n"
    "machinen_native_dwarf_unwind_source_caller:\n"
    "  .cfi_startproc\n"
    "  stp x29, x30, [sp, #-16]!\n"
    "  .cfi_def_cfa_offset 16\n"
    "  .cfi_offset x29, -16\n"
    "  .cfi_offset x30, -8\n"
    "  mov x29, sp\n"
    "  .cfi_def_cfa_register x29\n"
    "  bl machinen_native_dwarf_unwind_active\n"
    ".global machinen_native_dwarf_unwind_return\n"
    ".type machinen_native_dwarf_unwind_return, %function\n"
    "machinen_native_dwarf_unwind_return:\n"
    "  b machinen_native_dwarf_unwind_return\n"
    "  .cfi_endproc\n"
    ".size machinen_native_dwarf_unwind_source_caller, .-machinen_native_dwarf_unwind_source_caller\n");
#elif defined(__x86_64__)
__asm__(
    ".section .machinen_resume,\"ax\",@progbits\n"
    ".balign 16\n"
    ".global machinen_native_dwarf_unwind_active\n"
    ".type machinen_native_dwarf_unwind_active,@function\n"
    "machinen_native_dwarf_unwind_active:\n"
    "  movq %rsp, (%rdi)\n"
    "  movabsq $0x4e454e494843414d, %rax\n"
    "  movq %rax, 8(%rdi)\n"
    "  ret\n"
    ".size machinen_native_dwarf_unwind_active, .-machinen_native_dwarf_unwind_active\n"
    ".balign 16\n"
    ".global machinen_native_dwarf_unwind_return\n"
    ".type machinen_native_dwarf_unwind_return,@function\n"
    "machinen_native_dwarf_unwind_return:\n"
    "  movabsq $0x52455455524e4a50, %rax\n"
    "  movq %rax, 16(%rdi)\n"
    "  movq %rsp, 24(%rdi)\n"
    "  movl $0x4d, %eax\n"
    "  ret\n"
    ".size machinen_native_dwarf_unwind_return, .-machinen_native_dwarf_unwind_return\n"
    ".previous\n");

__attribute__((noinline, noreturn)) void machinen_native_dwarf_unwind_source_caller(
    uint64_t *state) {
  for (;;) {
    state[2]++;
  }
}
#else
__attribute__((noinline, noreturn)) void machinen_native_dwarf_unwind_source_caller(
    uint64_t *state) {
  for (;;) {
    state[2]++;
  }
}
#endif

int main(int argc, char **argv) {
  int resource_fd = open_resource_file(resource_file_arg(argc, argv));
  native_dwarf_unwind_state[0] = (uint64_t)(uintptr_t)native_dwarf_unwind_state;
  native_dwarf_unwind_state[1] = SOURCE_MARKER;
  native_dwarf_unwind_state[2] = 0;
  native_dwarf_unwind_state[3] = RETURN_MARKER;
  printf("MACHINEN_NATIVE_DWARF_UNWIND_CONTINUATION pid=%ld resource_fd=%d state=0x%" PRIx64 "\n",
      (long)getpid(), resource_fd, native_dwarf_unwind_state[0]);
  fflush(stdout);
  machinen_native_dwarf_unwind_source_caller(native_dwarf_unwind_state);
}
