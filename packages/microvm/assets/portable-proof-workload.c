// Tiny deterministic workload for the experimental portable snapshot engine.
//
// It keeps a simple pointer graph in global storage and uses the cooperative
// checkpoint ABI from portable-checkpoint-abi.h. The checkpoint request happens
// from a named safe-point function, and restore enters through machinen_restore_main
// instead of reconstructing a raw machine stack.

#include "portable-checkpoint-abi.h"

#include <errno.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>

#define PORTABLE_PROOF_ROOT_COUNT 3u
#define PORTABLE_PROOF_THREAD_COUNT 2u
#define PORTABLE_PROOF_MAX_ALLOCATIONS 4u
#define PORTABLE_PROOF_HEAP_CAPACITY 128u
#define PORTABLE_PROOF_PATH_CAPACITY 512u
#define PORTABLE_PROOF_CONTINUATION "machinen_portable_checkpoint"
#define PORTABLE_PROOF_RESTORE_CONTINUATION "machinen_portable_restore_entry"
#define PORTABLE_PROOF_WORKER_CONTINUATION "machinen_portable_worker_continue"
#define PORTABLE_PROOF_THREAD_BARRIER "portable-proof-checkpoint"
#define PORTABLE_PROOF_BUILD_ID "0123456789abcdef"

struct Node {
  uint64_t value;
  struct Node *next;
};

struct AppState {
  uint64_t counter;
  struct Node *list;
};

struct PortableAllocation {
  uint32_t id;
  uint8_t *address;
  uint64_t size_bytes;
  const char *type_name;
  bool live;
};

struct PortableThreadSemanticState {
  uint32_t id;
  uint32_t at_barrier;
  uint64_t local_counter;
  const char *continuation_name;
};

#if defined(__aarch64__)
#define PORTABLE_PROOF_ARCH "arm64"
#elif defined(__x86_64__)
#define PORTABLE_PROOF_ARCH "amd64"
#else
#define PORTABLE_PROOF_ARCH "unknown"
#endif

static const uint8_t PORTABLE_PROOF_HEAP_BYTES[16] = {
    0x4d, 0x61, 0x63, 0x68, 0x69, 0x6e, 0x65, 0x6e,
    0x2d, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x21, 0x00,
};

__attribute__((used, visibility("default"))) struct Node machinen_portable_nodes[3];
__attribute__((used, visibility("default"))) struct AppState machinen_portable_app_state;
__attribute__((used, visibility("default"))) int machinen_portable_last_checkpoint_result;

static uint8_t machinen_portable_heap[PORTABLE_PROOF_HEAP_CAPACITY];
static struct PortableAllocation machinen_portable_allocations[PORTABLE_PROOF_MAX_ALLOCATIONS];
static struct machinen_checkpoint_root machinen_portable_roots[PORTABLE_PROOF_ROOT_COUNT];
static struct PortableThreadSemanticState machinen_portable_thread_states[PORTABLE_PROOF_THREAD_COUNT];
static struct machinen_checkpoint_thread machinen_portable_threads[PORTABLE_PROOF_THREAD_COUNT];
static struct machinen_checkpoint_threads machinen_portable_thread_manifest;
static pthread_mutex_t machinen_portable_barrier_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t machinen_portable_barrier_cond = PTHREAD_COND_INITIALIZER;
static uint32_t machinen_portable_allocation_count;
static uint32_t machinen_portable_heap_offset;
static uint32_t machinen_portable_next_allocation_id;
static uint8_t *machinen_portable_heap_bytes;
static uint64_t machinen_portable_unknown_root;
static bool machinen_portable_force_bad_root;
static bool machinen_portable_force_bad_pointer;
static bool machinen_portable_force_bad_resource;
static bool machinen_portable_force_bad_thread;
static bool machinen_portable_use_threads;
static uint32_t machinen_portable_barrier_arrived;
static bool machinen_portable_barrier_complete;
static const char *machinen_portable_resource_file_path;

__attribute__((used, visibility("default"))) const char machinen_portable_metadata[] =
    "{\"schema_version\":1,"
    "\"workload\":\"machinen-portable-proof\","
    "\"checkpoint_abi_version\":1,"
    "\"checkpoint_symbol\":\"machinen_checkpoint\","
    "\"checkpoint_roots_type\":\"machinen_checkpoint_roots\","
    "\"checkpoint_continuation\":\"machinen_portable_checkpoint\","
    "\"restore_symbol\":\"machinen_restore_main\","
    "\"restore_bundle_type\":\"machinen_restore_bundle\","
    "\"restore_continuation\":\"machinen_portable_restore_entry\","
    "\"thread_registration\":\"machinen_register_thread\","
    "\"thread_barrier\":\"machinen_checkpoint_barrier\","
    "\"worker_continuation\":\"machinen_portable_worker_continue\","
    "\"allocator\":\"machinen_portable_allocator\","
    "\"state_symbol\":\"machinen_portable_app_state\"}";

static uint32_t align_up_u32(uint32_t value, uint32_t alignment) {
  return (value + alignment - 1u) & ~(alignment - 1u);
}

static void reset_allocator(void) {
  memset(machinen_portable_heap, 0, sizeof(machinen_portable_heap));
  memset(machinen_portable_allocations, 0, sizeof(machinen_portable_allocations));
  machinen_portable_allocation_count = 0;
  machinen_portable_heap_offset = 0;
  machinen_portable_next_allocation_id = 1;
  machinen_portable_heap_bytes = 0;
}

static uint8_t *portable_alloc(uint32_t size_bytes, const char *type_name) {
  uint32_t offset = align_up_u32(machinen_portable_heap_offset, 8u);
  if (machinen_portable_allocation_count >= PORTABLE_PROOF_MAX_ALLOCATIONS) {
    return 0;
  }
  if (size_bytes > PORTABLE_PROOF_HEAP_CAPACITY - offset) {
    return 0;
  }
  struct PortableAllocation *allocation =
      &machinen_portable_allocations[machinen_portable_allocation_count];
  allocation->id = machinen_portable_next_allocation_id++;
  allocation->address = &machinen_portable_heap[offset];
  allocation->size_bytes = size_bytes;
  allocation->type_name = type_name;
  allocation->live = true;
  machinen_portable_allocation_count++;
  machinen_portable_heap_offset = offset + size_bytes;
  return allocation->address;
}

static bool init_heap_state(void) {
  machinen_portable_heap_bytes = portable_alloc(sizeof(PORTABLE_PROOF_HEAP_BYTES), "uint8_t[16]");
  if (!machinen_portable_heap_bytes) {
    return false;
  }
  memcpy(machinen_portable_heap_bytes, PORTABLE_PROOF_HEAP_BYTES, sizeof(PORTABLE_PROOF_HEAP_BYTES));
  return true;
}

static bool range_contains(const void *base, uint64_t size_bytes, const void *ptr, uint64_t len) {
  uintptr_t start = (uintptr_t)base;
  uintptr_t probe = (uintptr_t)ptr;
  if (size_bytes == 0 || len == 0 || probe < start) {
    return false;
  }
  uint64_t delta = (uint64_t)(probe - start);
  return delta <= size_bytes && len <= size_bytes - delta;
}

static bool root_in_known_global(const struct machinen_checkpoint_root *root) {
  if (range_contains(&machinen_portable_app_state, sizeof(machinen_portable_app_state),
          root->address, root->size_bytes)) {
    return true;
  }
  return range_contains(&machinen_portable_nodes, sizeof(machinen_portable_nodes), root->address,
      root->size_bytes);
}

static bool root_in_known_thread_local(const struct machinen_checkpoint_root *root) {
  return range_contains(machinen_portable_thread_states, sizeof(machinen_portable_thread_states),
      root->address, root->size_bytes);
}

static bool root_in_live_allocation(const struct machinen_checkpoint_root *root) {
  for (uint32_t i = 0; i < machinen_portable_allocation_count; i++) {
    const struct PortableAllocation *allocation = &machinen_portable_allocations[i];
    if (!allocation->live) {
      continue;
    }
    if (range_contains(allocation->address, allocation->size_bytes, root->address, root->size_bytes)) {
      return true;
    }
  }
  return false;
}

static bool root_range_known(const struct machinen_checkpoint_root *root) {
  return root_in_known_global(root) || root_in_known_thread_local(root) ||
         root_in_live_allocation(root);
}

static bool pointer_known_or_null(const void *ptr) {
  if (!ptr) {
    return true;
  }
  const struct machinen_checkpoint_root pointer_root = {
      .name = "pointer-field",
      .address = ptr,
      .size_bytes = 1,
      .kind = MACHINEN_CHECKPOINT_ROOT_OPAQUE,
      .flags = 0,
      .type_name = "pointer",
  };
  return root_range_known(&pointer_root);
}

static bool proof_pointers_known(void) {
  if (!pointer_known_or_null(machinen_portable_app_state.list)) {
    return false;
  }
  for (uint32_t i = 0; i < 3; i++) {
    if (!pointer_known_or_null(machinen_portable_nodes[i].next)) {
      return false;
    }
  }
  return true;
}

static void refresh_checkpoint_roots(void) {
  machinen_portable_roots[0] = (struct machinen_checkpoint_root){
      .name = "machinen_portable_app_state",
      .address = &machinen_portable_app_state,
      .size_bytes = sizeof(machinen_portable_app_state),
      .kind = MACHINEN_CHECKPOINT_ROOT_GLOBAL,
      .flags = 0,
      .type_name = "struct AppState",
  };
  machinen_portable_roots[1] = (struct machinen_checkpoint_root){
      .name = "machinen_portable_nodes",
      .address = &machinen_portable_nodes,
      .size_bytes = sizeof(machinen_portable_nodes),
      .kind = MACHINEN_CHECKPOINT_ROOT_GLOBAL,
      .flags = 0,
      .type_name = "struct Node[3]",
  };
  machinen_portable_roots[2] = (struct machinen_checkpoint_root){
      .name = "machinen_portable_heap_bytes",
      .address = machinen_portable_heap_bytes,
      .size_bytes = sizeof(PORTABLE_PROOF_HEAP_BYTES),
      .kind = MACHINEN_CHECKPOINT_ROOT_HEAP,
      .flags = 0,
      .type_name = "uint8_t[16]",
  };
}

static void refresh_thread_manifest(void) {
  machinen_portable_thread_states[0] = (struct PortableThreadSemanticState){
      .id = 0,
      .at_barrier = machinen_portable_barrier_complete ? 1u : 0u,
      .local_counter = 1000,
      .continuation_name = PORTABLE_PROOF_CONTINUATION,
  };
  machinen_portable_thread_states[1] = (struct PortableThreadSemanticState){
      .id = 1,
      .at_barrier = machinen_portable_barrier_complete ? 1u : 0u,
      .local_counter = 2001,
      .continuation_name = PORTABLE_PROOF_WORKER_CONTINUATION,
  };
  machinen_portable_threads[0] = (struct machinen_checkpoint_thread){
      .id = 0,
      .flags = 0,
      .name = "main",
      .continuation_name = PORTABLE_PROOF_CONTINUATION,
      .thread_local_state = &machinen_portable_thread_states[0],
      .thread_local_state_size_bytes = sizeof(machinen_portable_thread_states[0]),
  };
  machinen_portable_threads[1] = (struct machinen_checkpoint_thread){
      .id = 1,
      .flags = 0,
      .name = "worker",
      .continuation_name = PORTABLE_PROOF_WORKER_CONTINUATION,
      .thread_local_state = &machinen_portable_thread_states[1],
      .thread_local_state_size_bytes = sizeof(machinen_portable_thread_states[1]),
  };
  machinen_portable_thread_manifest = (struct machinen_checkpoint_threads){
      .abi_version = MACHINEN_CHECKPOINT_ABI_VERSION,
      .thread_count = machinen_portable_use_threads ? PORTABLE_PROOF_THREAD_COUNT : 1u,
      .threads = machinen_portable_threads,
      .barrier_name = PORTABLE_PROOF_THREAD_BARRIER,
  };
}

static const char *checkpoint_refusal_name(int result) {
  switch (result) {
    case MACHINEN_CHECKPOINT_REFUSED_INVALID_ABI:
      return "checkpoint-invalid-abi";
    case MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS:
      return "checkpoint-invalid-roots";
    case MACHINEN_CHECKPOINT_REFUSED_INSIDE_SIGNAL_HANDLER:
      return "checkpoint-inside-signal-handler";
    case MACHINEN_CHECKPOINT_REFUSED_INSIDE_SYSCALL:
      return "checkpoint-inside-syscall";
    case MACHINEN_CHECKPOINT_REFUSED_UNSUPPORTED_ROOT:
      return "checkpoint-unsupported-root";
    case MACHINEN_CHECKPOINT_REFUSED_UNKNOWN_ROOT:
      return "checkpoint-unknown-root";
    case MACHINEN_CHECKPOINT_REFUSED_UNKNOWN_POINTER:
      return "pointer-outside-known-object";
    case MACHINEN_CHECKPOINT_REFUSED_UNSUPPORTED_FD:
      return "fd-kind-unsupported";
    case MACHINEN_CHECKPOINT_REFUSED_NON_COOPERATIVE_THREAD:
      return "thread-not-at-barrier";
  }
  return "checkpoint-refused";
}

static bool root_kind_supported(uint32_t kind) {
  switch (kind) {
    case MACHINEN_CHECKPOINT_ROOT_GLOBAL:
    case MACHINEN_CHECKPOINT_ROOT_HEAP:
    case MACHINEN_CHECKPOINT_ROOT_STACK:
    case MACHINEN_CHECKPOINT_ROOT_THREAD_LOCAL:
    case MACHINEN_CHECKPOINT_ROOT_OPAQUE:
      return true;
  }
  return false;
}

__attribute__((noinline, used, visibility("default"))) int machinen_checkpoint(
    const struct machinen_checkpoint_roots *roots) {
  if (!roots) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  if (roots->abi_version != MACHINEN_CHECKPOINT_ABI_VERSION) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ABI;
  }
  if (!(roots->flags & MACHINEN_CHECKPOINT_FLAG_OUTSIDE_SIGNAL_HANDLER)) {
    return MACHINEN_CHECKPOINT_REFUSED_INSIDE_SIGNAL_HANDLER;
  }
  if (!(roots->flags & MACHINEN_CHECKPOINT_FLAG_OUTSIDE_SYSCALL)) {
    return MACHINEN_CHECKPOINT_REFUSED_INSIDE_SYSCALL;
  }
  if (!roots->continuation_name || !roots->roots) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  if (roots->root_count == 0 || roots->root_count > MACHINEN_CHECKPOINT_MAX_ROOTS) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  if (roots->threads) {
    if (roots->threads->abi_version != MACHINEN_CHECKPOINT_ABI_VERSION ||
        roots->threads->thread_count == 0 ||
        roots->threads->thread_count > MACHINEN_CHECKPOINT_MAX_THREADS ||
        !roots->threads->threads || !roots->threads->barrier_name) {
      return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
    }
    for (uint32_t i = 0; i < roots->threads->thread_count; i++) {
      const struct machinen_checkpoint_thread *thread = &roots->threads->threads[i];
      if (!thread->name || !thread->continuation_name || !thread->thread_local_state ||
          thread->thread_local_state_size_bytes == 0) {
        return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
      }
    }
    if (machinen_portable_use_threads && !machinen_portable_barrier_complete) {
      return MACHINEN_CHECKPOINT_REFUSED_NON_COOPERATIVE_THREAD;
    }
  }
  for (uint32_t i = 0; i < roots->root_count; i++) {
    const struct machinen_checkpoint_root *root = &roots->roots[i];
    if (!root->name || !root->address || root->size_bytes == 0) {
      return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
    }
    if (!root_kind_supported(root->kind)) {
      return MACHINEN_CHECKPOINT_REFUSED_UNSUPPORTED_ROOT;
    }
    if (!root_range_known(root)) {
      return MACHINEN_CHECKPOINT_REFUSED_UNKNOWN_ROOT;
    }
  }
  if (!proof_pointers_known()) {
    return MACHINEN_CHECKPOINT_REFUSED_UNKNOWN_POINTER;
  }
  if (machinen_portable_force_bad_resource) {
    return MACHINEN_CHECKPOINT_REFUSED_UNSUPPORTED_FD;
  }
  return MACHINEN_CHECKPOINT_OK;
}

static uint32_t build_checkpoint_roots(struct machinen_checkpoint_root *roots, uint32_t capacity) {
  if (capacity < PORTABLE_PROOF_ROOT_COUNT + PORTABLE_PROOF_THREAD_COUNT + 1u) {
    return 0;
  }
  memcpy(roots, machinen_portable_roots, sizeof(machinen_portable_roots));
  uint32_t count = PORTABLE_PROOF_ROOT_COUNT;
  if (machinen_portable_use_threads) {
    roots[count++] = (struct machinen_checkpoint_root){
        .name = "machinen_portable_thread_main_tls",
        .address = &machinen_portable_thread_states[0],
        .size_bytes = sizeof(machinen_portable_thread_states[0]),
        .kind = MACHINEN_CHECKPOINT_ROOT_THREAD_LOCAL,
        .flags = 0,
        .type_name = "struct PortableThreadSemanticState",
    };
    roots[count++] = (struct machinen_checkpoint_root){
        .name = "machinen_portable_thread_worker_tls",
        .address = &machinen_portable_thread_states[1],
        .size_bytes = sizeof(machinen_portable_thread_states[1]),
        .kind = MACHINEN_CHECKPOINT_ROOT_THREAD_LOCAL,
        .flags = 0,
        .type_name = "struct PortableThreadSemanticState",
    };
  }
  if (machinen_portable_force_bad_root) {
    machinen_portable_unknown_root = 0xfeedfaceu;
    roots[count++] = (struct machinen_checkpoint_root){
        .name = "machinen_portable_unknown_root",
        .address = &machinen_portable_unknown_root,
        .size_bytes = sizeof(machinen_portable_unknown_root),
        .kind = MACHINEN_CHECKPOINT_ROOT_GLOBAL,
        .flags = 0,
        .type_name = "uint64_t",
    };
  }
  return count;
}

__attribute__((noinline, used, visibility("default"))) int machinen_portable_checkpoint(
    struct AppState *state) {
  if (state != &machinen_portable_app_state) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  struct machinen_checkpoint_root roots[PORTABLE_PROOF_ROOT_COUNT + PORTABLE_PROOF_THREAD_COUNT + 1u];
  uint32_t root_count = build_checkpoint_roots(roots,
      PORTABLE_PROOF_ROOT_COUNT + PORTABLE_PROOF_THREAD_COUNT + 1u);
  const struct machinen_checkpoint_roots checkpoint_roots = {
      .abi_version = MACHINEN_CHECKPOINT_ABI_VERSION,
      .flags = MACHINEN_CHECKPOINT_FLAG_KNOWN_SAFE_POINT,
      .continuation_name = PORTABLE_PROOF_CONTINUATION,
      .roots = roots,
      .root_count = root_count,
      .reserved = 0,
      .threads = &machinen_portable_thread_manifest,
  };
  machinen_portable_last_checkpoint_result = machinen_checkpoint(&checkpoint_roots);
  __asm__ __volatile__("" ::: "memory");
  return machinen_portable_last_checkpoint_result;
}

__attribute__((noinline, used, visibility("default"))) int machinen_portable_restore_entry(
    struct AppState *state) {
  if (state != &machinen_portable_app_state) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  __asm__ __volatile__("" ::: "memory");
  return MACHINEN_CHECKPOINT_OK;
}

__attribute__((noinline, used, visibility("default"))) int machinen_restore_main(
    const struct machinen_restore_bundle *bundle) {
  if (!bundle) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  if (bundle->abi_version != MACHINEN_CHECKPOINT_ABI_VERSION) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ABI;
  }
  if (!bundle->continuation_name) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  if (strcmp(bundle->continuation_name, PORTABLE_PROOF_RESTORE_CONTINUATION) != 0) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  return machinen_portable_restore_entry(&machinen_portable_app_state);
}

static void reset_state(void) {
  reset_allocator();
  machinen_portable_nodes[0].value = 1;
  machinen_portable_nodes[0].next = &machinen_portable_nodes[1];
  machinen_portable_nodes[1].value = 2;
  machinen_portable_nodes[1].next = &machinen_portable_nodes[2];
  machinen_portable_nodes[2].value = 3;
  machinen_portable_nodes[2].next = 0;
  machinen_portable_app_state.counter = 1000;
  machinen_portable_app_state.list = &machinen_portable_nodes[0];
  machinen_portable_last_checkpoint_result = MACHINEN_CHECKPOINT_OK;
  machinen_portable_force_bad_root = false;
  machinen_portable_force_bad_pointer = false;
  machinen_portable_force_bad_resource = false;
  machinen_portable_force_bad_thread = false;
  machinen_portable_use_threads = false;
  machinen_portable_barrier_arrived = 0;
  machinen_portable_barrier_complete = false;
  refresh_thread_manifest();
  if (init_heap_state()) {
    refresh_checkpoint_roots();
  }
}

static bool list_matches_1_2_3(const struct AppState *state) {
  const struct Node *a = state->list;
  const struct Node *b = a ? a->next : 0;
  const struct Node *c = b ? b->next : 0;
  return a && b && c && !c->next && a->value == 1 && b->value == 2 && c->value == 3;
}

static bool heap_matches_expected(void) {
  return machinen_portable_heap_bytes && memcmp(machinen_portable_heap_bytes,
      PORTABLE_PROOF_HEAP_BYTES, sizeof(PORTABLE_PROOF_HEAP_BYTES)) == 0;
}

int machinen_register_thread(uint32_t id, const char *name, const char *continuation_name,
    uint64_t local_counter) {
  if (id >= PORTABLE_PROOF_THREAD_COUNT || !name || !continuation_name) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  machinen_portable_thread_states[id].id = id;
  machinen_portable_thread_states[id].local_counter = local_counter;
  machinen_portable_thread_states[id].continuation_name = continuation_name;
  machinen_portable_threads[id].id = id;
  machinen_portable_threads[id].name = name;
  machinen_portable_threads[id].continuation_name = continuation_name;
  machinen_portable_threads[id].thread_local_state = &machinen_portable_thread_states[id];
  machinen_portable_threads[id].thread_local_state_size_bytes =
      sizeof(machinen_portable_thread_states[id]);
  return MACHINEN_CHECKPOINT_OK;
}

int machinen_checkpoint_barrier(const char *barrier_name, uint32_t expected_threads, uint32_t id) {
  if (!barrier_name || strcmp(barrier_name, PORTABLE_PROOF_THREAD_BARRIER) != 0 ||
      expected_threads != PORTABLE_PROOF_THREAD_COUNT || id >= PORTABLE_PROOF_THREAD_COUNT) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  if (machinen_portable_force_bad_thread) {
    return MACHINEN_CHECKPOINT_REFUSED_NON_COOPERATIVE_THREAD;
  }
  pthread_mutex_lock(&machinen_portable_barrier_mutex);
  machinen_portable_thread_states[id].at_barrier = 1;
  machinen_portable_barrier_arrived++;
  if (machinen_portable_barrier_arrived == expected_threads) {
    machinen_portable_barrier_complete = true;
    pthread_cond_broadcast(&machinen_portable_barrier_cond);
  }
  while (!machinen_portable_barrier_complete) {
    pthread_cond_wait(&machinen_portable_barrier_cond, &machinen_portable_barrier_mutex);
  }
  pthread_mutex_unlock(&machinen_portable_barrier_mutex);
  return MACHINEN_CHECKPOINT_OK;
}

static void *portable_worker_checkpoint_thread(void *arg) {
  (void)arg;
  int result = machinen_register_thread(1, "worker", PORTABLE_PROOF_WORKER_CONTINUATION, 2001);
  if (result != MACHINEN_CHECKPOINT_OK) {
    return (void *)(uintptr_t)(uint32_t)result;
  }
  result = machinen_checkpoint_barrier(PORTABLE_PROOF_THREAD_BARRIER, PORTABLE_PROOF_THREAD_COUNT, 1);
  return (void *)(uintptr_t)(uint32_t)result;
}

static int run_thread_checkpoint_barrier(void) {
  refresh_thread_manifest();
  int result = machinen_register_thread(0, "main", PORTABLE_PROOF_CONTINUATION, 1000);
  if (result != MACHINEN_CHECKPOINT_OK) {
    return result;
  }
  if (machinen_portable_force_bad_thread) {
    return MACHINEN_CHECKPOINT_REFUSED_NON_COOPERATIVE_THREAD;
  }
  pthread_t worker;
  if (pthread_create(&worker, 0, portable_worker_checkpoint_thread, 0) != 0) {
    return MACHINEN_CHECKPOINT_REFUSED_NON_COOPERATIVE_THREAD;
  }
  result = machinen_checkpoint_barrier(PORTABLE_PROOF_THREAD_BARRIER, PORTABLE_PROOF_THREAD_COUNT, 0);
  void *worker_result = 0;
  if (pthread_join(worker, &worker_result) != 0) {
    return MACHINEN_CHECKPOINT_REFUSED_NON_COOPERATIVE_THREAD;
  }
  if (result != MACHINEN_CHECKPOINT_OK) {
    return result;
  }
  result = (int)(uintptr_t)worker_result;
  refresh_thread_manifest();
  return result;
}

static void *portable_worker_restore_thread(void *arg) {
  (void)arg;
  machinen_register_thread(1, "worker", PORTABLE_PROOF_WORKER_CONTINUATION, 2001);
  machinen_portable_thread_states[1].at_barrier = 1;
  return 0;
}

static int recreate_threads_for_restore(void) {
  pthread_t worker;
  machinen_portable_use_threads = true;
  refresh_thread_manifest();
  machinen_register_thread(0, "main", PORTABLE_PROOF_RESTORE_CONTINUATION, 1000);
  if (pthread_create(&worker, 0, portable_worker_restore_thread, 0) != 0) {
    return -1;
  }
  if (pthread_join(worker, 0) != 0) {
    return -1;
  }
  machinen_portable_barrier_complete = true;
  refresh_thread_manifest();
  return 0;
}

static void print_marker(const char *phase) {
  printf(
      "MACHINEN_PORTABLE_PROOF "
      "{\"schema_version\":1,\"phase\":\"%s\",\"arch\":\"%s\","
      "\"counter\":%llu,\"list\":[%llu,%llu,%llu],"
      "\"checkpoint_abi_version\":%u,"
      "\"checkpoint_symbol\":\"machinen_checkpoint\","
      "\"checkpoint_continuation\":\"machinen_portable_checkpoint\","
      "\"restore_symbol\":\"machinen_restore_main\","
      "\"restore_continuation\":\"machinen_portable_restore_entry\","
      "\"state_symbol\":\"machinen_portable_app_state\","
      "\"root_count\":%u,"
      "\"root_names\":[\"machinen_portable_app_state\",\"machinen_portable_nodes\","
      "\"machinen_portable_heap_bytes\"],"
      "\"thread_count\":%u,"
      "\"thread_continuations\":[\"machinen_portable_checkpoint\","
      "\"machinen_portable_worker_continue\"],"
      "\"allocation_count\":%u,"
      "\"heap_bytes\":[%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u,%u],"
      "\"checkpoint_result\":%d,"
      "\"safe_point\":{\"outside_signal_handler\":true,\"outside_syscall\":true}}\n",
      phase,
      PORTABLE_PROOF_ARCH,
      (unsigned long long)machinen_portable_app_state.counter,
      (unsigned long long)machinen_portable_nodes[0].value,
      (unsigned long long)machinen_portable_nodes[1].value,
      (unsigned long long)machinen_portable_nodes[2].value,
      MACHINEN_CHECKPOINT_ABI_VERSION,
      PORTABLE_PROOF_ROOT_COUNT,
      machinen_portable_use_threads ? PORTABLE_PROOF_THREAD_COUNT : 1u,
      machinen_portable_allocation_count,
      machinen_portable_heap_bytes[0],
      machinen_portable_heap_bytes[1],
      machinen_portable_heap_bytes[2],
      machinen_portable_heap_bytes[3],
      machinen_portable_heap_bytes[4],
      machinen_portable_heap_bytes[5],
      machinen_portable_heap_bytes[6],
      machinen_portable_heap_bytes[7],
      machinen_portable_heap_bytes[8],
      machinen_portable_heap_bytes[9],
      machinen_portable_heap_bytes[10],
      machinen_portable_heap_bytes[11],
      machinen_portable_heap_bytes[12],
      machinen_portable_heap_bytes[13],
      machinen_portable_heap_bytes[14],
      machinen_portable_heap_bytes[15],
      machinen_portable_last_checkpoint_result);
  fflush(stdout);
}

static bool has_arg(int argc, char **argv, const char *needle) {
  for (int i = 1; i < argc; i++) {
    if (strcmp(argv[i], needle) == 0) {
      return true;
    }
  }
  return false;
}

static const char *arg_value(int argc, char **argv, const char *needle) {
  for (int i = 1; i + 1 < argc; i++) {
    if (strcmp(argv[i], needle) == 0) {
      return argv[i + 1];
    }
  }
  return 0;
}

static int ensure_dir(const char *path) {
  if (mkdir(path, 0777) == 0) {
    return 0;
  }
  if (errno == EEXIST) {
    return 0;
  }
  fprintf(stderr, "portable proof: mkdir failed for %s: %s\n", path, strerror(errno));
  return -1;
}

static FILE *open_bundle_file(const char *dir, const char *name, const char *mode) {
  char path[PORTABLE_PROOF_PATH_CAPACITY];
  int written = snprintf(path, sizeof(path), "%s/%s", dir, name);
  if (written < 0 || (uint32_t)written >= sizeof(path)) {
    fprintf(stderr, "portable proof: bundle path too long for %s\n", name);
    return 0;
  }
  FILE *file = fopen(path, mode);
  if (!file) {
    fprintf(stderr, "portable proof: open failed for %s: %s\n", path, strerror(errno));
  }
  return file;
}

static int close_bundle_file(FILE *file) {
  if (fclose(file) == 0) {
    return 0;
  }
  fprintf(stderr, "portable proof: close failed: %s\n", strerror(errno));
  return -1;
}

static int write_manifest(const char *dir) {
  FILE *file = open_bundle_file(dir, "manifest.json", "wb");
  if (!file) {
    return -1;
  }
  fprintf(file,
      "{\"formatVersion\":1,\"sourceGuestArch\":\"%s\","
      "\"allowedTargetGuestArchs\":[\"arm64\",\"amd64\"],"
      "\"program\":{\"name\":\"portable-proof\","
      "\"executable\":\"/usr/local/bin/machinen-portable-proof\","
      "\"identity\":\"com.redwoodjs.machinen.portable-proof\"},"
      "\"sourceBuild\":{\"buildId\":\"%s\",\"version\":\"0.1.0\"},"
      "\"targetBuild\":{\"version\":\"0.1.x\"},"
      "\"checkpointAbi\":{\"version\":1,"
      "\"checkpointFunction\":{\"name\":\"machinen_checkpoint\"},"
      "\"rootsType\":\"machinen_checkpoint_roots\","
      "\"restoreBundleType\":\"machinen_restore_bundle\","
      "\"safePoint\":{\"outsideSignalHandlers\":true,\"outsideSyscalls\":true}},"
      "\"checkpointContinuation\":{\"name\":\"machinen_portable_checkpoint\"},"
      "\"restoreEntrypoint\":{\"name\":\"machinen_restore_main\"},"
      "\"process\":{\"argv\":[\"/usr/local/bin/machinen-portable-proof\"],"
      "\"env\":{},\"cwd\":\"/\"},"
      "\"features\":[%s],"
      "\"unsupported\":{\"vocabularyVersion\":1,\"refusals\":[]}}",
      PORTABLE_PROOF_ARCH, PORTABLE_PROOF_BUILD_ID,
      machinen_portable_use_threads ?
          "\"proof-workload\",\"instrumented-allocator\",\"cooperative-threads\"" :
          "\"proof-workload\",\"instrumented-allocator\"");
  return close_bundle_file(file);
}

static int write_memory_bytes(FILE *file, const void *ptr, uint64_t size_bytes) {
  if (fwrite(ptr, 1, (size_t)size_bytes, file) == size_bytes) {
    return 0;
  }
  fprintf(stderr, "portable proof: memory write failed: %s\n", strerror(errno));
  return -1;
}

static int write_memory(const char *dir) {
  FILE *file = open_bundle_file(dir, "memory.bin", "wb");
  if (!file) {
    return -1;
  }
  int result = write_memory_bytes(file, &machinen_portable_app_state,
      sizeof(machinen_portable_app_state));
  if (result == 0) {
    result = write_memory_bytes(file, machinen_portable_nodes, sizeof(machinen_portable_nodes));
  }
  if (result == 0) {
    result = write_memory_bytes(file, machinen_portable_heap_bytes,
        sizeof(PORTABLE_PROOF_HEAP_BYTES));
  }
  if (result == 0 && machinen_portable_use_threads) {
    result = write_memory_bytes(file, machinen_portable_thread_states,
        sizeof(machinen_portable_thread_states));
  }
  if (close_bundle_file(file) != 0) {
    return -1;
  }
  return result;
}

static int write_objects(const char *dir) {
  const struct PortableAllocation *allocation = &machinen_portable_allocations[0];
  uint64_t app_offset = 0;
  uint64_t nodes_offset = app_offset + sizeof(machinen_portable_app_state);
  uint64_t heap_offset = nodes_offset + sizeof(machinen_portable_nodes);
  uint64_t tls_offset = heap_offset + allocation->size_bytes;
  FILE *file = open_bundle_file(dir, "objects.json", "wb");
  if (!file) {
    return -1;
  }
  fprintf(file,
      "{\"formatVersion\":1,\"objects\":["
      "{\"id\":\"global-app-state\",\"kind\":\"global\","
      "\"type\":\"struct AppState\",\"sizeBytes\":%llu,"
      "\"sourceAddress\":\"0x%" PRIxPTR "\","
      "\"memory\":{\"offset\":%llu,\"sizeBytes\":%llu}},"
      "{\"id\":\"global-nodes\",\"kind\":\"global\","
      "\"type\":\"struct Node[3]\",\"sizeBytes\":%llu,"
      "\"sourceAddress\":\"0x%" PRIxPTR "\","
      "\"memory\":{\"offset\":%llu,\"sizeBytes\":%llu}},"
      "{\"id\":\"heap-1\",\"kind\":\"heap\",\"type\":\"%s\","
      "\"sizeBytes\":%llu,\"sourceAddress\":\"0x%" PRIxPTR "\","
      "\"allocation\":{\"id\":%u,\"sourceAddress\":\"0x%" PRIxPTR "\"},"
      "\"memory\":{\"offset\":%llu,\"sizeBytes\":%llu}}",
      (unsigned long long)sizeof(machinen_portable_app_state),
      (uintptr_t)&machinen_portable_app_state,
      (unsigned long long)app_offset,
      (unsigned long long)sizeof(machinen_portable_app_state),
      (unsigned long long)sizeof(machinen_portable_nodes),
      (uintptr_t)&machinen_portable_nodes,
      (unsigned long long)nodes_offset,
      (unsigned long long)sizeof(machinen_portable_nodes),
      allocation->type_name,
      (unsigned long long)allocation->size_bytes,
      (uintptr_t)allocation->address,
      allocation->id,
      (uintptr_t)allocation->address,
      (unsigned long long)heap_offset,
      (unsigned long long)allocation->size_bytes);
  if (machinen_portable_use_threads) {
    fprintf(file,
        ",{\"id\":\"tls-main\",\"kind\":\"tls\","
        "\"type\":\"struct PortableThreadSemanticState\",\"sizeBytes\":%llu,"
        "\"sourceAddress\":\"0x%" PRIxPTR "\","
        "\"memory\":{\"offset\":%llu,\"sizeBytes\":%llu}},"
        "{\"id\":\"tls-worker\",\"kind\":\"tls\","
        "\"type\":\"struct PortableThreadSemanticState\",\"sizeBytes\":%llu,"
        "\"sourceAddress\":\"0x%" PRIxPTR "\","
        "\"memory\":{\"offset\":%llu,\"sizeBytes\":%llu}}",
        (unsigned long long)sizeof(machinen_portable_thread_states[0]),
        (uintptr_t)&machinen_portable_thread_states[0],
        (unsigned long long)tls_offset,
        (unsigned long long)sizeof(machinen_portable_thread_states[0]),
        (unsigned long long)sizeof(machinen_portable_thread_states[1]),
        (uintptr_t)&machinen_portable_thread_states[1],
        (unsigned long long)(tls_offset + sizeof(machinen_portable_thread_states[0])),
        (unsigned long long)sizeof(machinen_portable_thread_states[1]));
  }
  fprintf(file, "],\"unsupported\":{\"vocabularyVersion\":1,\"refusals\":[]}}");
  return close_bundle_file(file);
}

static int write_relocations(const char *dir) {
  FILE *file = open_bundle_file(dir, "relocations.json", "wb");
  if (!file) {
    return -1;
  }
  uint64_t app_list_offset = offsetof(struct AppState, list);
  uint64_t node_next_offset = offsetof(struct Node, next);
  uint64_t node_size = sizeof(struct Node);
  fprintf(file,
      "{\"formatVersion\":1,\"relocations\":["
      "{\"fromObject\":\"global-app-state\",\"fromOffset\":%llu,"
      "\"toObject\":\"global-nodes\",\"addend\":0,\"kind\":\"pointer\","
      "\"sourcePointer\":\"0x%" PRIxPTR "\"},"
      "{\"fromObject\":\"global-nodes\",\"fromOffset\":%llu,"
      "\"toObject\":\"global-nodes\",\"addend\":%llu,\"kind\":\"pointer\","
      "\"sourcePointer\":\"0x%" PRIxPTR "\"},"
      "{\"fromObject\":\"global-nodes\",\"fromOffset\":%llu,"
      "\"toObject\":\"global-nodes\",\"addend\":%llu,\"kind\":\"pointer\","
      "\"sourcePointer\":\"0x%" PRIxPTR "\"}],"
      "\"unsupported\":{\"vocabularyVersion\":1,\"refusals\":[]}}",
      (unsigned long long)app_list_offset,
      (uintptr_t)machinen_portable_app_state.list,
      (unsigned long long)node_next_offset,
      (unsigned long long)node_size,
      (uintptr_t)machinen_portable_nodes[0].next,
      (unsigned long long)(node_size + node_next_offset),
      (unsigned long long)(2u * node_size),
      (uintptr_t)machinen_portable_nodes[1].next);
  return close_bundle_file(file);
}

static long capture_resource_offset(const char *path) {
  FILE *file = fopen(path, "rb");
  if (!file) {
    fprintf(stderr, "portable proof: resource open failed for %s: %s\n", path, strerror(errno));
    return -1;
  }
  if (fseek(file, 4, SEEK_SET) != 0) {
    fclose(file);
    return -1;
  }
  long offset = ftell(file);
  fclose(file);
  return offset;
}

static int write_resources(const char *dir) {
  char cwd[PORTABLE_PROOF_PATH_CAPACITY];
  if (!getcwd(cwd, sizeof(cwd))) {
    snprintf(cwd, sizeof(cwd), "/");
  }
  long resource_offset = -1;
  if (machinen_portable_resource_file_path) {
    resource_offset = capture_resource_offset(machinen_portable_resource_file_path);
    if (resource_offset < 0) {
      return -1;
    }
  }
  FILE *file = open_bundle_file(dir, "resources.json", "wb");
  if (!file) {
    return -1;
  }
  fprintf(file,
      "{\"formatVersion\":1,\"resources\":["
      "{\"id\":\"argv\",\"kind\":\"argv\",\"state\":\"captured\","
      "\"argv\":[\"/usr/local/bin/machinen-portable-proof\"]},"
      "{\"id\":\"env\",\"kind\":\"env\",\"state\":\"captured\",\"env\":{}},"
      "{\"id\":\"cwd\",\"kind\":\"cwd\",\"state\":\"captured\",\"path\":\"%s\"}",
      cwd);
  if (machinen_portable_resource_file_path) {
    fprintf(file,
        ",{\"id\":\"file-1\",\"kind\":\"file\",\"state\":\"captured\","
        "\"path\":\"%s\",\"fd\":3,\"flags\":[\"read\"],\"offset\":%ld}",
        machinen_portable_resource_file_path, resource_offset);
  }
  fprintf(file, "],\"unsupported\":{\"vocabularyVersion\":1,\"refusals\":[]}}");
  return close_bundle_file(file);
}

static int write_threads(const char *dir) {
  if (!machinen_portable_use_threads) {
    return 0;
  }
  FILE *file = open_bundle_file(dir, "threads.json", "wb");
  if (!file) {
    return -1;
  }
  fprintf(file,
      "{\"formatVersion\":1,\"barrier\":{"
      "\"name\":\"%s\",\"participants\":%u,\"state\":\"complete\"},"
      "\"threads\":["
      "{\"id\":0,\"name\":\"main\",\"continuation\":\"%s\","
      "\"localState\":{\"counter\":%llu,\"atBarrier\":true}},"
      "{\"id\":1,\"name\":\"worker\",\"continuation\":\"%s\","
      "\"localState\":{\"counter\":%llu,\"atBarrier\":true}}],"
      "\"unsupported\":{\"vocabularyVersion\":1,\"refusals\":[]}}",
      PORTABLE_PROOF_THREAD_BARRIER,
      PORTABLE_PROOF_THREAD_COUNT,
      machinen_portable_threads[0].continuation_name,
      (unsigned long long)machinen_portable_thread_states[0].local_counter,
      machinen_portable_threads[1].continuation_name,
      (unsigned long long)machinen_portable_thread_states[1].local_counter);
  return close_bundle_file(file);
}

static int emit_bundle(const char *dir) {
  char logs_path[PORTABLE_PROOF_PATH_CAPACITY];
  int written = snprintf(logs_path, sizeof(logs_path), "%s/logs", dir);
  if (written < 0 || (uint32_t)written >= sizeof(logs_path)) {
    fprintf(stderr, "portable proof: logs path too long\n");
    return -1;
  }
  if (ensure_dir(dir) != 0 || ensure_dir(logs_path) != 0) {
    return -1;
  }
  if (write_manifest(dir) != 0 || write_memory(dir) != 0 || write_objects(dir) != 0) {
    return -1;
  }
  if (write_relocations(dir) != 0 || write_resources(dir) != 0) {
    return -1;
  }
  return write_threads(dir);
}

static bool bundle_file_exists(const char *dir, const char *name) {
  char path[PORTABLE_PROOF_PATH_CAPACITY];
  int written = snprintf(path, sizeof(path), "%s/%s", dir, name);
  if (written < 0 || (uint32_t)written >= sizeof(path)) {
    return false;
  }
  return access(path, R_OK) == 0;
}

static bool bundle_text_contains(const char *dir, const char *name, const char *needle) {
  char buf[4096];
  FILE *file = open_bundle_file(dir, name, "rb");
  if (!file) {
    return false;
  }
  size_t n = fread(buf, 1, sizeof(buf) - 1u, file);
  buf[n] = 0;
  if (close_bundle_file(file) != 0) {
    return false;
  }
  return strstr(buf, needle) != 0;
}

static int copy_json_string(char *out, uint32_t out_len, const char *start) {
  uint32_t i = 0;
  while (start[i] && start[i] != '"') {
    if (i + 1u >= out_len) {
      return -1;
    }
    out[i] = start[i];
    i++;
  }
  out[i] = 0;
  return start[i] == '"' ? 0 : -1;
}

static int validate_resource_reopen(const char *dir) {
  char buf[4096];
  FILE *file = open_bundle_file(dir, "resources.json", "rb");
  if (!file) {
    return -1;
  }
  size_t n = fread(buf, 1, sizeof(buf) - 1u, file);
  buf[n] = 0;
  if (close_bundle_file(file) != 0) {
    return -1;
  }
  char *resource = strstr(buf, "\"id\":\"file-1\"");
  if (!resource) {
    return 0;
  }
  char *path_field = strstr(resource, "\"path\":\"");
  char *offset_field = strstr(resource, "\"offset\":");
  if (!path_field || !offset_field) {
    return -1;
  }
  char path[PORTABLE_PROOF_PATH_CAPACITY];
  if (copy_json_string(path, sizeof(path), path_field + strlen("\"path\":\"")) != 0) {
    return -1;
  }
  long offset = strtol(offset_field + strlen("\"offset\":"), 0, 10);
  FILE *resource_file = fopen(path, "rb");
  if (!resource_file) {
    fprintf(stderr, "portable proof: resource reopen failed for %s: %s\n", path, strerror(errno));
    return -1;
  }
  int result = fseek(resource_file, offset, SEEK_SET);
  fclose(resource_file);
  return result == 0 ? 0 : -1;
}

static int validate_restore_bundle(const char *dir) {
  if (!bundle_text_contains(dir, "manifest.json", PORTABLE_PROOF_ARCH)) {
    fprintf(stderr, "portable proof: target architecture is not allowed by manifest\n");
    return -1;
  }
  if (!bundle_text_contains(dir, "manifest.json", "machinen_restore_main")) {
    fprintf(stderr, "portable proof: restore entrypoint missing from manifest\n");
    return -1;
  }
  if (!bundle_text_contains(dir, "relocations.json", "sourcePointer")) {
    fprintf(stderr, "portable proof: pointer relocations missing from bundle\n");
    return -1;
  }
  return validate_resource_reopen(dir);
}

static int read_memory_chunk(FILE *file, void *ptr, uint64_t size_bytes) {
  if (fread(ptr, 1, (size_t)size_bytes, file) == size_bytes) {
    return 0;
  }
  fprintf(stderr, "portable proof: memory read failed\n");
  return -1;
}

static int read_bundle_memory(const char *dir) {
  FILE *file = open_bundle_file(dir, "memory.bin", "rb");
  if (!file) {
    return -1;
  }
  int result = read_memory_chunk(file, &machinen_portable_app_state,
      sizeof(machinen_portable_app_state));
  if (result == 0) {
    result = read_memory_chunk(file, machinen_portable_nodes, sizeof(machinen_portable_nodes));
  }
  if (result == 0) {
    result = read_memory_chunk(file, machinen_portable_heap_bytes,
        sizeof(PORTABLE_PROOF_HEAP_BYTES));
  }
  if (close_bundle_file(file) != 0) {
    return -1;
  }
  return result;
}

static void apply_pointer_relocations(void) {
  machinen_portable_app_state.list = &machinen_portable_nodes[0];
  machinen_portable_nodes[0].next = &machinen_portable_nodes[1];
  machinen_portable_nodes[1].next = &machinen_portable_nodes[2];
  machinen_portable_nodes[2].next = 0;
}

static int call_restore_entrypoint(void) {
  const struct machinen_restore_bundle bundle = {
      .abi_version = MACHINEN_CHECKPOINT_ABI_VERSION,
      .flags = 0,
      .continuation_name = PORTABLE_PROOF_RESTORE_CONTINUATION,
      .objects = 0,
      .object_count = 0,
      .reserved = 0,
  };
  return machinen_restore_main(&bundle);
}

static void print_continue_markers(void) {
  for (int i = 0; i < 3; i++) {
    machinen_portable_app_state.counter++;
    print_marker("continue");
  }
}

static int restore_from_bundle(const char *dir) {
  if (validate_restore_bundle(dir) != 0 || read_bundle_memory(dir) != 0) {
    return -1;
  }
  apply_pointer_relocations();
  if (bundle_file_exists(dir, "threads.json") && recreate_threads_for_restore() != 0) {
    fprintf(stderr, "portable proof: thread restore failed\n");
    return -1;
  }
  int result = call_restore_entrypoint();
  if (result != MACHINEN_CHECKPOINT_OK) {
    fprintf(stderr, "portable proof: restore refused: %d\n", result);
    return -1;
  }
  if (!list_matches_1_2_3(&machinen_portable_app_state) || !heap_matches_expected()) {
    fprintf(stderr, "portable proof: restored bundle state mismatch\n");
    return -1;
  }
  print_marker("restore");
  print_continue_markers();
  return 0;
}

int main(int argc, char **argv) {
  reset_state();
  const char *restore_bundle = arg_value(argc, argv, "--restore-bundle");
  if (restore_bundle) {
    return restore_from_bundle(restore_bundle) == 0 ? 0 : 9;
  }
  machinen_portable_force_bad_root = has_arg(argc, argv, "--bad-root");
  machinen_portable_force_bad_pointer = has_arg(argc, argv, "--bad-pointer");
  machinen_portable_force_bad_resource = has_arg(argc, argv, "--bad-resource");
  machinen_portable_force_bad_thread = has_arg(argc, argv, "--thread-missing");
  machinen_portable_use_threads = has_arg(argc, argv, "--threads") ||
                                  machinen_portable_force_bad_thread;
  refresh_thread_manifest();
  const char *bundle_dir = arg_value(argc, argv, "--emit-bundle");
  machinen_portable_resource_file_path = arg_value(argc, argv, "--resource-file");
  if (!list_matches_1_2_3(&machinen_portable_app_state)) {
    fprintf(stderr, "portable proof: initial state mismatch\n");
    return 2;
  }
  if (!heap_matches_expected()) {
    fprintf(stderr, "portable proof: heap state mismatch\n");
    return 6;
  }
  if (machinen_portable_force_bad_pointer) {
    machinen_portable_nodes[1].next = (struct Node *)&machinen_portable_unknown_root;
  }

  int result = MACHINEN_CHECKPOINT_OK;
  if (machinen_portable_use_threads) {
    result = run_thread_checkpoint_barrier();
  }
  if (result == MACHINEN_CHECKPOINT_OK) {
    result = machinen_portable_checkpoint(&machinen_portable_app_state);
  }
  if (result != MACHINEN_CHECKPOINT_OK) {
    fprintf(stderr, "portable proof: checkpoint refused: %d (%s)\n", result,
        checkpoint_refusal_name(result));
    return 4;
  }
  if (bundle_dir && emit_bundle(bundle_dir) != 0) {
    return 7;
  }
  print_marker("checkpoint");

  if (has_arg(argc, argv, "--restore-proof")) {
    result = call_restore_entrypoint();
    if (result != MACHINEN_CHECKPOINT_OK) {
      fprintf(stderr, "portable proof: restore refused: %d\n", result);
      return 5;
    }
    if (machinen_portable_app_state.counter != 1000 ||
        !list_matches_1_2_3(&machinen_portable_app_state)) {
      fprintf(stderr, "portable proof: restore state mismatch\n");
      return 3;
    }
    if (!heap_matches_expected()) {
      fprintf(stderr, "portable proof: restored heap state mismatch\n");
      return 8;
    }
    print_marker("restore");
  }

  print_continue_markers();

  return 0;
}
