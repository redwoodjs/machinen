#ifndef MACHINEN_PORTABLE_CHECKPOINT_ABI_H
#define MACHINEN_PORTABLE_CHECKPOINT_ABI_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define MACHINEN_CHECKPOINT_ABI_VERSION 1u
#define MACHINEN_CHECKPOINT_MAX_ROOTS 64u

#define MACHINEN_CHECKPOINT_FLAG_OUTSIDE_SIGNAL_HANDLER (1u << 0)
#define MACHINEN_CHECKPOINT_FLAG_OUTSIDE_SYSCALL (1u << 1)
#define MACHINEN_CHECKPOINT_FLAG_KNOWN_SAFE_POINT \
  (MACHINEN_CHECKPOINT_FLAG_OUTSIDE_SIGNAL_HANDLER | MACHINEN_CHECKPOINT_FLAG_OUTSIDE_SYSCALL)

enum machinen_checkpoint_root_kind {
  MACHINEN_CHECKPOINT_ROOT_GLOBAL = 1,
  MACHINEN_CHECKPOINT_ROOT_HEAP = 2,
  MACHINEN_CHECKPOINT_ROOT_STACK = 3,
  MACHINEN_CHECKPOINT_ROOT_THREAD_LOCAL = 4,
  MACHINEN_CHECKPOINT_ROOT_OPAQUE = 5,
};

enum machinen_checkpoint_result {
  MACHINEN_CHECKPOINT_OK = 0,
  MACHINEN_CHECKPOINT_REFUSED_INVALID_ABI = 1,
  MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS = 2,
  MACHINEN_CHECKPOINT_REFUSED_INSIDE_SIGNAL_HANDLER = 3,
  MACHINEN_CHECKPOINT_REFUSED_INSIDE_SYSCALL = 4,
  MACHINEN_CHECKPOINT_REFUSED_UNSUPPORTED_ROOT = 5,
  MACHINEN_CHECKPOINT_REFUSED_UNKNOWN_ROOT = 6,
  MACHINEN_CHECKPOINT_REFUSED_UNKNOWN_POINTER = 7,
  MACHINEN_CHECKPOINT_REFUSED_UNSUPPORTED_FD = 8,
};

struct machinen_checkpoint_root {
  const char *name;
  const void *address;
  uint64_t size_bytes;
  uint32_t kind;
  uint32_t flags;
  const char *type_name;
};

struct machinen_checkpoint_roots {
  uint32_t abi_version;
  uint32_t flags;
  const char *continuation_name;
  const struct machinen_checkpoint_root *roots;
  uint32_t root_count;
  uint32_t reserved;
};

struct machinen_restore_object {
  const char *name;
  void *target_address;
  uint64_t size_bytes;
  uint32_t kind;
  uint32_t flags;
};

struct machinen_restore_bundle {
  uint32_t abi_version;
  uint32_t flags;
  const char *continuation_name;
  const struct machinen_restore_object *objects;
  uint32_t object_count;
  uint32_t reserved;
};

int machinen_checkpoint(const struct machinen_checkpoint_roots *roots);
int machinen_restore_main(const struct machinen_restore_bundle *bundle);

#ifdef __cplusplus
}
#endif

#endif
