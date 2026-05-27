// Unmodified source/target binary for the captured heap/global graph proof.
//
// The arm64 process builds a tiny pointer graph in normal process memory:
// a page-aligned global root points to two heap nodes. It is captured while an
// active function has that root in x0 and a live return address in x30. The
// amd64 target continuation walks the translated graph after native `ret` lands
// in the matching return function.

#define _GNU_SOURCE

#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <unistd.h>

#define SOURCE_MARKER UINT64_C(0x534f555243454a50)
#define ACTIVE_MARKER UINT64_C(0x4e454e494843414d)
#define RETURN_MARKER UINT64_C(0x52455455524e4a50)
#define NODE_MAGIC_A UINT64_C(0x4845415047524131)
#define NODE_MAGIC_B UINT64_C(0x4845415047524132)
#define NODE_VALUE_A UINT64_C(0x21)
#define NODE_VALUE_B UINT64_C(0x2c)
#define GRAPH_CHECKSUM (NODE_VALUE_A + NODE_VALUE_B)

struct GraphNode {
  uint64_t magic;
  uint64_t value;
  struct GraphNode *next;
  uint64_t padding[5];
};

struct GraphRoot {
  uint64_t self;
  uint64_t marker;
  struct GraphNode *head;
  uint64_t count;
  uint64_t expected_checksum;
  uint64_t observed_checksum;
  uint64_t padding[58];
};

static struct GraphRoot native_heap_graph_root __attribute__((aligned(4096)));
static void *native_heap_graph_page = NULL;

static void die(const char *message) {
  fprintf(stderr, "machinen-native-heap-graph-continuation: %s: %s\n", message, strerror(errno));
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
  const char payload[] = "machinen-native-heap-graph-continuation\n";
  if (write(fd, payload, sizeof(payload) - 1u) != (ssize_t)(sizeof(payload) - 1u)) {
    die("write resource file");
  }
  if (lseek(fd, 9, SEEK_SET) < 0) {
    die("seek resource file");
  }
  return fd;
}

static void build_graph(void) {
  native_heap_graph_page = mmap(NULL,
      4096,
      PROT_READ | PROT_WRITE,
      MAP_PRIVATE | MAP_ANONYMOUS,
      -1,
      0);
  if (native_heap_graph_page == MAP_FAILED) {
    die("mmap graph page");
  }
  struct GraphNode *first = (struct GraphNode *)native_heap_graph_page;
  struct GraphNode *second = (struct GraphNode *)((uint8_t *)native_heap_graph_page + 64u);
  first->magic = NODE_MAGIC_A;
  first->value = NODE_VALUE_A;
  first->next = second;
  second->magic = NODE_MAGIC_B;
  second->value = NODE_VALUE_B;
  second->next = NULL;
  native_heap_graph_root.self = (uint64_t)(uintptr_t)&native_heap_graph_root;
  native_heap_graph_root.marker = SOURCE_MARKER;
  native_heap_graph_root.head = first;
  native_heap_graph_root.count = 2;
  native_heap_graph_root.expected_checksum = GRAPH_CHECKSUM;
  native_heap_graph_root.observed_checksum = 0;
}

#if defined(__aarch64__)
void machinen_native_heap_graph_source_caller(struct GraphRoot *root) __attribute__((noreturn));
__asm__(
    ".text\n"
    ".global machinen_native_heap_graph_active\n"
    ".type machinen_native_heap_graph_active, %function\n"
    "machinen_native_heap_graph_active:\n"
    "1:\n"
    "  ldr x1, [x0, #16]\n"
    "  ldr x2, [x1, #8]\n"
    "  add x2, x2, #1\n"
    "  str x2, [x0, #40]\n"
    "  b 1b\n"
    ".size machinen_native_heap_graph_active, .-machinen_native_heap_graph_active\n"
    ".global machinen_native_heap_graph_source_caller\n"
    ".type machinen_native_heap_graph_source_caller, %function\n"
    "machinen_native_heap_graph_source_caller:\n"
    "  bl machinen_native_heap_graph_active\n"
    ".global machinen_native_heap_graph_return\n"
    ".type machinen_native_heap_graph_return, %function\n"
    "machinen_native_heap_graph_return:\n"
    "  b machinen_native_heap_graph_return\n"
    ".size machinen_native_heap_graph_source_caller, .-machinen_native_heap_graph_source_caller\n");
#elif defined(__x86_64__)
__asm__(
    ".section .machinen_resume,\"ax\",@progbits\n"
    ".balign 16\n"
    ".global machinen_native_heap_graph_active\n"
    ".type machinen_native_heap_graph_active,@function\n"
    "machinen_native_heap_graph_active:\n"
    "  movq %rsp, (%rdi)\n"
    "  movabsq $0x4e454e494843414d, %rax\n"
    "  movq %rax, 8(%rdi)\n"
    "  ret\n"
    ".size machinen_native_heap_graph_active, .-machinen_native_heap_graph_active\n"
    ".balign 16\n"
    ".global machinen_native_heap_graph_return\n"
    ".type machinen_native_heap_graph_return,@function\n"
    "machinen_native_heap_graph_return:\n"
    "  movq 16(%rdi), %rcx\n"
    "  testq %rcx, %rcx\n"
    "  jz 2f\n"
    "  movq 16(%rcx), %rdx\n"
    "  testq %rdx, %rdx\n"
    "  jz 2f\n"
    "  movq 8(%rcx), %rax\n"
    "  addq 8(%rdx), %rax\n"
    "  cmpq 32(%rdi), %rax\n"
    "  jne 2f\n"
    "  movabsq $0x52455455524e4a50, %r8\n"
    "  movq %r8, 16(%rdi)\n"
    "  movq %rsp, 24(%rdi)\n"
    "  movq %rax, 40(%rdi)\n"
    "  ret\n"
    "2:\n"
    "  movabsq $0xbadbadbadbadbad, %rax\n"
    "  ret\n"
    ".size machinen_native_heap_graph_return, .-machinen_native_heap_graph_return\n"
    ".previous\n");

__attribute__((noinline, noreturn)) void machinen_native_heap_graph_source_caller(
    struct GraphRoot *root) {
  for (;;) {
    root->observed_checksum++;
  }
}
#else
__attribute__((noinline, noreturn)) void machinen_native_heap_graph_source_caller(
    struct GraphRoot *root) {
  for (;;) {
    root->observed_checksum++;
  }
}
#endif

int main(int argc, char **argv) {
  int resource_fd = open_resource_file(resource_file_arg(argc, argv));
  build_graph();
  printf(
      "MACHINEN_NATIVE_HEAP_GRAPH_CONTINUATION pid=%ld resource_fd=%d root=0x%" PRIx64
      " head=0x%" PRIx64 "\n",
      (long)getpid(),
      resource_fd,
      native_heap_graph_root.self,
      (uint64_t)(uintptr_t)native_heap_graph_root.head);
  fflush(stdout);
  machinen_native_heap_graph_source_caller(&native_heap_graph_root);
}
