// Unmodified source/target binary for the captured regular-file resource proof.
//
// The arm64 process opens a normal file, seeks to a known offset, stores that fd
// in page-aligned process state, and is captured while an active function has a
// live return address. The amd64 target continuation uses the reopened fd after
// native `ret` reaches the matching return function.

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
#define RESOURCE_OFFSET 9
#define RESOURCE_CHECKSUM UINT64_C(0x4d)

static uint64_t native_file_resource_state[512] __attribute__((aligned(4096)));

static void die(const char *message) {
  fprintf(stderr, "machinen-native-file-resource-continuation: %s: %s\n", message, strerror(errno));
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
    fprintf(stderr, "machinen-native-file-resource-continuation: --resource-file is required\n");
    exit(2);
  }
  int fd = open(path, O_CREAT | O_TRUNC | O_RDWR, 0600);
  if (fd < 0) {
    die("open resource file");
  }
  const char payload[] = "machinen-M-native-file-resource-final-jump\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write resource file");
  }
  if (lseek(fd, RESOURCE_OFFSET, SEEK_SET) < 0) {
    die("seek resource file");
  }
  return fd;
}

#if defined(__aarch64__)
void machinen_native_file_resource_source_caller(uint64_t *state) __attribute__((noreturn));
__asm__(
    ".text\n"
    ".global machinen_native_file_resource_active\n"
    ".type machinen_native_file_resource_active, %function\n"
    "machinen_native_file_resource_active:\n"
    "1:\n"
    "  ldr x1, [x0, #48]\n"
    "  add x1, x1, #1\n"
    "  str x1, [x0, #64]\n"
    "  b 1b\n"
    ".size machinen_native_file_resource_active, .-machinen_native_file_resource_active\n"
    ".global machinen_native_file_resource_source_caller\n"
    ".type machinen_native_file_resource_source_caller, %function\n"
    "machinen_native_file_resource_source_caller:\n"
    "  bl machinen_native_file_resource_active\n"
    ".global machinen_native_file_resource_return\n"
    ".type machinen_native_file_resource_return, %function\n"
    "machinen_native_file_resource_return:\n"
    "  b machinen_native_file_resource_return\n"
    ".size machinen_native_file_resource_source_caller, .-machinen_native_file_resource_source_caller\n");
#elif defined(__x86_64__)
__asm__(
    ".section .machinen_resume,\"ax\",@progbits\n"
    ".balign 16\n"
    ".global machinen_native_file_resource_active\n"
    ".type machinen_native_file_resource_active,@function\n"
    "machinen_native_file_resource_active:\n"
    "  movq %rsp, (%rdi)\n"
    "  movabsq $0x4e454e494843414d, %rax\n"
    "  movq %rax, 8(%rdi)\n"
    "  ret\n"
    ".size machinen_native_file_resource_active, .-machinen_native_file_resource_active\n"
    ".balign 16\n"
    ".global machinen_native_file_resource_return\n"
    ".type machinen_native_file_resource_return,@function\n"
    "machinen_native_file_resource_return:\n"
    "  movq %rdi, %r8\n"
    "  movq 48(%r8), %rdi\n"
    "  leaq 64(%r8), %rsi\n"
    "  movl $1, %edx\n"
    "  xorl %eax, %eax\n"
    "  syscall\n"
    "  cmpq $1, %rax\n"
    "  jne 2f\n"
    "  movzbq 64(%r8), %rax\n"
    "  cmpq 56(%r8), %rax\n"
    "  jne 2f\n"
    "  movq %rax, 48(%r8)\n"
    "  movabsq $0x52455455524e4a50, %rcx\n"
    "  movq %rcx, 16(%r8)\n"
    "  movq %rsp, 24(%r8)\n"
    "  ret\n"
    "2:\n"
    "  movabsq $0xbadbadbadbadbad, %rax\n"
    "  ret\n"
    ".size machinen_native_file_resource_return, .-machinen_native_file_resource_return\n"
    ".previous\n");

__attribute__((noinline, noreturn)) void machinen_native_file_resource_source_caller(
    uint64_t *state) {
  for (;;) {
    state[8]++;
  }
}
#else
__attribute__((noinline, noreturn)) void machinen_native_file_resource_source_caller(
    uint64_t *state) {
  for (;;) {
    state[8]++;
  }
}
#endif

int main(int argc, char **argv) {
  int resource_fd = open_resource_file(resource_file_arg(argc, argv));
  native_file_resource_state[0] = (uint64_t)(uintptr_t)native_file_resource_state;
  native_file_resource_state[1] = SOURCE_MARKER;
  native_file_resource_state[6] = (uint64_t)resource_fd;
  native_file_resource_state[7] = RESOURCE_CHECKSUM;
  printf(
      "MACHINEN_NATIVE_FILE_RESOURCE_CONTINUATION pid=%ld resource_fd=%d state=0x%" PRIx64
      " offset=%d checksum=0x%" PRIx64 "\n",
      (long)getpid(),
      resource_fd,
      native_file_resource_state[0],
      RESOURCE_OFFSET,
      RESOURCE_CHECKSUM);
  fflush(stdout);
  machinen_native_file_resource_source_caller(native_file_resource_state);
}
