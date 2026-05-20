// Unmodified source/target binary for the captured call-frame return proof.
//
// The arm64 build is captured while execution is inside an active function and
// x30 holds that function's return address. The amd64 build contributes both the
// active function and the return landing function from a real executable section
// so the restore trampoline can seed a translated return address on the target
// stack and let native `ret` transfer control.

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

static uint64_t native_call_frame_state[512] __attribute__((aligned(4096)));

static void die(const char *message) {
  fprintf(stderr, "machinen-native-call-frame-continuation: %s: %s\n", message, strerror(errno));
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
  const char payload[] = "machinen-native-call-frame-continuation\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write resource file");
  }
  if (lseek(fd, 9, SEEK_SET) < 0) {
    die("seek resource file");
  }
  return fd;
}

#if defined(__aarch64__)
void machinen_native_call_frame_source_caller(uint64_t *state) __attribute__((noreturn));
__asm__(
    ".text\n"
    ".global machinen_native_call_frame_active\n"
    ".type machinen_native_call_frame_active, %function\n"
    "machinen_native_call_frame_active:\n"
    "1:\n"
    "  ldr x1, [x0, #16]\n"
    "  add x1, x1, #1\n"
    "  str x1, [x0, #16]\n"
    "  b 1b\n"
    ".size machinen_native_call_frame_active, .-machinen_native_call_frame_active\n"
    ".global machinen_native_call_frame_source_caller\n"
    ".type machinen_native_call_frame_source_caller, %function\n"
    "machinen_native_call_frame_source_caller:\n"
    "  bl machinen_native_call_frame_active\n"
    ".global machinen_native_call_frame_return\n"
    ".type machinen_native_call_frame_return, %function\n"
    "machinen_native_call_frame_return:\n"
    "  b machinen_native_call_frame_return\n"
    ".size machinen_native_call_frame_source_caller, .-machinen_native_call_frame_source_caller\n");
#elif defined(__x86_64__)
__asm__(
    ".section .machinen_resume,\"ax\",@progbits\n"
    ".balign 16\n"
    ".global machinen_native_call_frame_active\n"
    ".type machinen_native_call_frame_active,@function\n"
    "machinen_native_call_frame_active:\n"
    "  movq %rsp, (%rdi)\n"
    "  movabsq $0x4e454e494843414d, %rax\n"
    "  movq %rax, 8(%rdi)\n"
    "  ret\n"
    ".size machinen_native_call_frame_active, .-machinen_native_call_frame_active\n"
    ".balign 16\n"
    ".global machinen_native_call_frame_return\n"
    ".type machinen_native_call_frame_return,@function\n"
    "machinen_native_call_frame_return:\n"
    "  movabsq $0x52455455524e4a50, %rax\n"
    "  movq %rax, 16(%rdi)\n"
    "  movq %rsp, 24(%rdi)\n"
    "  movl $0x4d, %eax\n"
    "  ret\n"
    ".size machinen_native_call_frame_return, .-machinen_native_call_frame_return\n"
    ".previous\n");

__attribute__((noinline, noreturn)) void machinen_native_call_frame_source_caller(
    uint64_t *state) {
  for (;;) {
    state[2]++;
  }
}
#else
__attribute__((noinline, noreturn)) void machinen_native_call_frame_source_caller(
    uint64_t *state) {
  for (;;) {
    state[2]++;
  }
}
#endif

int main(int argc, char **argv) {
  int resource_fd = open_resource_file(resource_file_arg(argc, argv));
  native_call_frame_state[0] = (uint64_t)(uintptr_t)native_call_frame_state;
  native_call_frame_state[1] = SOURCE_MARKER;
  native_call_frame_state[2] = 0;
  native_call_frame_state[3] = RETURN_MARKER;
  printf("MACHINEN_NATIVE_CALL_FRAME_CONTINUATION pid=%ld resource_fd=%d state=0x%" PRIx64 "\n",
      (long)getpid(), resource_fd, native_call_frame_state[0]);
  fflush(stdout);
  machinen_native_call_frame_source_caller(native_call_frame_state);
}
