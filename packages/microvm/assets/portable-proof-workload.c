// Tiny deterministic workload for the experimental portable snapshot engine.
//
// It keeps a simple pointer graph in global storage and uses the cooperative
// checkpoint ABI from portable-checkpoint-abi.h. The checkpoint request happens
// from a named safe-point function, and restore enters through machinen_restore_main
// instead of reconstructing a raw machine stack.

#include "portable-checkpoint-abi.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define PORTABLE_PROOF_ROOT_COUNT 2u
#define PORTABLE_PROOF_CONTINUATION "machinen_portable_checkpoint"
#define PORTABLE_PROOF_RESTORE_CONTINUATION "machinen_portable_restore_entry"

struct Node {
  uint64_t value;
  struct Node *next;
};

struct AppState {
  uint64_t counter;
  struct Node *list;
};

#if defined(__aarch64__)
#define PORTABLE_PROOF_ARCH "arm64"
#elif defined(__x86_64__)
#define PORTABLE_PROOF_ARCH "amd64"
#else
#define PORTABLE_PROOF_ARCH "unknown"
#endif

__attribute__((used, visibility("default"))) struct Node machinen_portable_nodes[3];
__attribute__((used, visibility("default"))) struct AppState machinen_portable_app_state;
__attribute__((used, visibility("default"))) int machinen_portable_last_checkpoint_result;

static const struct machinen_checkpoint_root machinen_portable_roots[PORTABLE_PROOF_ROOT_COUNT] = {
    {
        .name = "machinen_portable_app_state",
        .address = &machinen_portable_app_state,
        .size_bytes = sizeof(machinen_portable_app_state),
        .kind = MACHINEN_CHECKPOINT_ROOT_GLOBAL,
        .flags = 0,
        .type_name = "struct AppState",
    },
    {
        .name = "machinen_portable_nodes",
        .address = &machinen_portable_nodes,
        .size_bytes = sizeof(machinen_portable_nodes),
        .kind = MACHINEN_CHECKPOINT_ROOT_GLOBAL,
        .flags = 0,
        .type_name = "struct Node[3]",
    },
};

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
    "\"state_symbol\":\"machinen_portable_app_state\"}";

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
  for (uint32_t i = 0; i < roots->root_count; i++) {
    const struct machinen_checkpoint_root *root = &roots->roots[i];
    if (!root->name || !root->address || root->size_bytes == 0) {
      return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
    }
    if (!root_kind_supported(root->kind)) {
      return MACHINEN_CHECKPOINT_REFUSED_UNSUPPORTED_ROOT;
    }
  }
  return MACHINEN_CHECKPOINT_OK;
}

__attribute__((noinline, used, visibility("default"))) int machinen_portable_checkpoint(
    struct AppState *state) {
  if (state != &machinen_portable_app_state) {
    return MACHINEN_CHECKPOINT_REFUSED_INVALID_ROOTS;
  }
  const struct machinen_checkpoint_roots roots = {
      .abi_version = MACHINEN_CHECKPOINT_ABI_VERSION,
      .flags = MACHINEN_CHECKPOINT_FLAG_KNOWN_SAFE_POINT,
      .continuation_name = PORTABLE_PROOF_CONTINUATION,
      .roots = machinen_portable_roots,
      .root_count = PORTABLE_PROOF_ROOT_COUNT,
      .reserved = 0,
  };
  machinen_portable_last_checkpoint_result = machinen_checkpoint(&roots);
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
  machinen_portable_nodes[0].value = 1;
  machinen_portable_nodes[0].next = &machinen_portable_nodes[1];
  machinen_portable_nodes[1].value = 2;
  machinen_portable_nodes[1].next = &machinen_portable_nodes[2];
  machinen_portable_nodes[2].value = 3;
  machinen_portable_nodes[2].next = 0;
  machinen_portable_app_state.counter = 1000;
  machinen_portable_app_state.list = &machinen_portable_nodes[0];
  machinen_portable_last_checkpoint_result = MACHINEN_CHECKPOINT_OK;
}

static bool list_matches_1_2_3(const struct AppState *state) {
  const struct Node *a = state->list;
  const struct Node *b = a ? a->next : 0;
  const struct Node *c = b ? b->next : 0;
  return a && b && c && !c->next && a->value == 1 && b->value == 2 && c->value == 3;
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
      "\"root_names\":[\"machinen_portable_app_state\",\"machinen_portable_nodes\"],"
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

int main(int argc, char **argv) {
  reset_state();
  if (!list_matches_1_2_3(&machinen_portable_app_state)) {
    fprintf(stderr, "portable proof: initial state mismatch\n");
    return 2;
  }

  int result = machinen_portable_checkpoint(&machinen_portable_app_state);
  if (result != MACHINEN_CHECKPOINT_OK) {
    fprintf(stderr, "portable proof: checkpoint refused: %d\n", result);
    return 4;
  }
  print_marker("checkpoint");

  if (has_arg(argc, argv, "--restore-proof")) {
    const struct machinen_restore_bundle bundle = {
        .abi_version = MACHINEN_CHECKPOINT_ABI_VERSION,
        .flags = 0,
        .continuation_name = PORTABLE_PROOF_RESTORE_CONTINUATION,
        .objects = 0,
        .object_count = 0,
        .reserved = 0,
    };
    result = machinen_restore_main(&bundle);
    if (result != MACHINEN_CHECKPOINT_OK) {
      fprintf(stderr, "portable proof: restore refused: %d\n", result);
      return 5;
    }
    if (machinen_portable_app_state.counter != 1000 ||
        !list_matches_1_2_3(&machinen_portable_app_state)) {
      fprintf(stderr, "portable proof: restore state mismatch\n");
      return 3;
    }
    print_marker("restore");
  }

  for (int i = 0; i < 3; i++) {
    machinen_portable_app_state.counter++;
    print_marker("continue");
  }

  return 0;
}
