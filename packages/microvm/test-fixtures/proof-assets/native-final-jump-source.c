// Unmodified source-side process for the captured native final-jump proof.
//
// The program has no Machinen checkpoint ABI. It exposes a stable user-space
// capture point only by normal native code shape: x0 points at page-aligned
// process data, and the PC spins in a named function until an external ptrace
// capturer stops it.

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

static uint64_t native_final_jump_state[512] __attribute__((aligned(4096)));

static void die(const char *message) {
  fprintf(stderr, "machinen-native-final-jump-source: %s: %s\n", message, strerror(errno));
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
  const char payload[] = "machinen-native-captured-final-jump\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write resource file");
  }
  if (lseek(fd, 9, SEEK_SET) < 0) {
    die("seek resource file");
  }
  return fd;
}

#if defined(__aarch64__)
__attribute__((noinline, noreturn)) static void native_final_jump_capture_point(
    uint64_t *state) {
  register uint64_t *x0 __asm__("x0") = state;
  __asm__ __volatile__(
      ".global machinen_native_final_jump_capture_spin\n"
      "machinen_native_final_jump_capture_spin:\n"
      "1:\n"
      "ldr x1, [x0, #16]\n"
      "add x1, x1, #1\n"
      "str x1, [x0, #16]\n"
      "b 1b\n"
      : "+r"(x0)
      :
      : "x1", "memory");
  __builtin_unreachable();
}
#elif defined(__x86_64__)
__attribute__((noinline, noreturn)) static void native_final_jump_capture_point(
    uint64_t *state) {
  register uint64_t *rdi __asm__("rdi") = state;
  __asm__ __volatile__(
      ".global machinen_native_final_jump_capture_spin\n"
      "machinen_native_final_jump_capture_spin:\n"
      "1:\n"
      "movq 16(%0), %%rax\n"
      "addq $1, %%rax\n"
      "movq %%rax, 16(%0)\n"
      "jmp 1b\n"
      : "+D"(rdi)
      :
      : "rax", "memory");
  __builtin_unreachable();
}
#else
__attribute__((noinline, noreturn)) static void native_final_jump_capture_point(
    uint64_t *state) {
  for (;;) {
    state[2]++;
  }
}
#endif

int main(int argc, char **argv) {
  int resource_fd = open_resource_file(resource_file_arg(argc, argv));
  native_final_jump_state[0] = (uint64_t)(uintptr_t)native_final_jump_state;
  native_final_jump_state[1] = SOURCE_MARKER;
  native_final_jump_state[2] = 0;
  printf("MACHINEN_NATIVE_FINAL_JUMP_SOURCE pid=%ld resource_fd=%d state=0x%" PRIx64 "\n",
      (long)getpid(), resource_fd, native_final_jump_state[0]);
  fflush(stdout);
  native_final_jump_capture_point(native_final_jump_state);
}
