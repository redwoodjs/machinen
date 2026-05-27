// Unmodified source/target binary for the captured target-binary final-jump proof.
//
// The arm64 build is launched as a normal Linux process and captured with
// ptrace/procfs while x0 points at page-aligned process state. The amd64 build
// is never treated as a hand-written blob: the proof extracts the compiled
// machinen_native_target_binary_resume function from this binary and maps those
// bytes as the target-native continuation.

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
#define TARGET_MARKER UINT64_C(0x4e454e494843414d)
#define TARGET_RETURN UINT64_C(0x4d)

static uint64_t native_target_binary_state[512] __attribute__((aligned(4096)));

static void die(const char *message) {
  fprintf(stderr, "machinen-native-target-binary-continuation: %s: %s\n", message, strerror(errno));
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
  const char payload[] = "machinen-native-target-binary-continuation\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write resource file");
  }
  if (lseek(fd, 9, SEEK_SET) < 0) {
    die("seek resource file");
  }
  return fd;
}

#if defined(__x86_64__)
__asm__(
    ".section .machinen_resume,\"ax\",@progbits\n"
    ".balign 16\n"
    ".global machinen_native_target_binary_resume\n"
    ".type machinen_native_target_binary_resume,@function\n"
    "machinen_native_target_binary_resume:\n"
    "  movq %rsp, (%rdi)\n"
    "  movabsq $0x4e454e494843414d, %rax\n"
    "  movq %rax, 8(%rdi)\n"
    "  movl $0x4d, %eax\n"
    "  ret\n"
    ".size machinen_native_target_binary_resume, .-machinen_native_target_binary_resume\n"
    ".previous\n");
#endif

#if defined(__aarch64__)
__attribute__((noinline, noreturn)) static void native_target_binary_capture_point(
    uint64_t *state) {
  register uint64_t *x0 __asm__("x0") = state;
  __asm__ __volatile__(
      ".global machinen_native_target_binary_resume\n"
      "machinen_native_target_binary_resume:\n"
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
#else
__attribute__((noinline, noreturn)) static void native_target_binary_capture_point(
    uint64_t *state) {
  for (;;) {
    state[2]++;
  }
}
#endif

int main(int argc, char **argv) {
  int resource_fd = open_resource_file(resource_file_arg(argc, argv));
  native_target_binary_state[0] = (uint64_t)(uintptr_t)native_target_binary_state;
  native_target_binary_state[1] = SOURCE_MARKER;
  native_target_binary_state[2] = TARGET_RETURN;
  native_target_binary_state[3] = TARGET_MARKER;
  printf("MACHINEN_NATIVE_TARGET_BINARY_CONTINUATION pid=%ld resource_fd=%d state=0x%" PRIx64 "\n",
      (long)getpid(), resource_fd, native_target_binary_state[0]);
  fflush(stdout);
  native_target_binary_capture_point(native_target_binary_state);
}
