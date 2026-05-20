// Tiny deterministic workload for the experimental portable snapshot engine.
//
// It keeps a simple pointer graph in global storage and exposes stable
// checkpoint/restore symbols that future portable-checkpoint tooling can
// locate by name in both arm64 and amd64 guest binaries.

#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

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

__attribute__((used, visibility("default"))) const char machinen_portable_metadata[] =
    "{\"schema_version\":1,"
    "\"workload\":\"machinen-portable-proof\","
    "\"checkpoint_symbol\":\"machinen_portable_checkpoint\","
    "\"restore_symbol\":\"machinen_portable_restore_entry\","
    "\"state_symbol\":\"machinen_portable_app_state\"}";

__attribute__((noinline, used, visibility("default"))) void machinen_portable_checkpoint(
    struct AppState *state) {
  (void)state;
  __asm__ __volatile__("" ::: "memory");
}

__attribute__((noinline, used, visibility("default"))) void machinen_portable_restore_entry(
    struct AppState *state) {
  (void)state;
  __asm__ __volatile__("" ::: "memory");
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
      "\"checkpoint_symbol\":\"machinen_portable_checkpoint\","
      "\"restore_symbol\":\"machinen_portable_restore_entry\","
      "\"state_symbol\":\"machinen_portable_app_state\"}\n",
      phase,
      PORTABLE_PROOF_ARCH,
      (unsigned long long)machinen_portable_app_state.counter,
      (unsigned long long)machinen_portable_nodes[0].value,
      (unsigned long long)machinen_portable_nodes[1].value,
      (unsigned long long)machinen_portable_nodes[2].value);
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

  print_marker("checkpoint");
  machinen_portable_checkpoint(&machinen_portable_app_state);

  if (has_arg(argc, argv, "--restore-proof")) {
    machinen_portable_restore_entry(&machinen_portable_app_state);
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
