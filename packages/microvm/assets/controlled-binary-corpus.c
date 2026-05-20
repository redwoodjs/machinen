// Controlled cross-ISA fixture corpus for portable state translation research.
//
// This binary is intentionally ordinary C. It does not call the Machinen
// checkpoint ABI and it does not write a portable bundle. Future extraction
// work can launch or attach to it, stop it at an observation point, and recover
// semantic state from normal process memory, symbols, DWARF, or sidecar data.

#include <errno.h>
#include <inttypes.h>
#include <pthread.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <unistd.h>

#define CONTROLLED_MARKER "MACHINEN_CONTROLLED_BINARY "
#define CONTROLLED_SCHEMA_VERSION 1u
#define CONTROLLED_LABEL_CAPACITY 32u
#define CONTROLLED_THREAD_COUNT 2u
#define CONTROLLED_PATH_CAPACITY 512u
#define CONTROLLED_RESOURCE_PAYLOAD "machinen-controlled-resource\n"
#define CONTROLLED_RESOURCE_OFFSET 9u

#if defined(__aarch64__) || defined(_M_ARM64)
#define CONTROLLED_ARCH "arm64"
#elif defined(__x86_64__) || defined(_M_X64)
#define CONTROLLED_ARCH "amd64"
#else
#define CONTROLLED_ARCH "unknown"
#endif

#if defined(__GNUC__) || defined(__clang__)
#define CONTROLLED_EXPORT __attribute__((used, visibility("default")))
#else
#define CONTROLLED_EXPORT
#endif

struct ControlledGlobalState {
  uint64_t counter;
  uint32_t flags;
  char label[CONTROLLED_LABEL_CAPACITY];
};

struct ControlledNode {
  uint64_t value;
  struct ControlledNode *next;
};

struct ControlledHeapState {
  struct ControlledNode *head;
  uint64_t node_count;
  uint64_t checksum;
};

struct ControlledStackObservation {
  uint64_t live_local;
  uint64_t caller_counter;
  char continuation[CONTROLLED_LABEL_CAPACITY];
};

struct ControlledResourceState {
  uint32_t argc;
  uint32_t env_seen;
  uint64_t file_bytes;
  uint64_t file_offset;
  uint64_t checksum;
};

struct ControlledThreadState {
  uint32_t id;
  uint32_t at_observation;
  uint64_t local_counter;
  char continuation[CONTROLLED_LABEL_CAPACITY];
};

struct ThreadArgs {
  uint32_t id;
  uint64_t base_counter;
};

CONTROLLED_EXPORT struct ControlledGlobalState machinen_controlled_global_state;
CONTROLLED_EXPORT struct ControlledHeapState machinen_controlled_heap_state;
CONTROLLED_EXPORT struct ControlledStackObservation machinen_controlled_stack_observation;
CONTROLLED_EXPORT struct ControlledResourceState machinen_controlled_resource_state;
CONTROLLED_EXPORT struct ControlledThreadState machinen_controlled_thread_states[CONTROLLED_THREAD_COUNT];

CONTROLLED_EXPORT const char machinen_controlled_corpus_metadata[] =
    "{\"schema_version\":1,"
    "\"workload\":\"machinen-controlled-binary-corpus\","
    "\"fixtures\":[\"global\",\"heap\",\"stack\",\"resource\",\"threads\"],"
    "\"global_symbol\":\"machinen_controlled_global_state\","
    "\"heap_symbol\":\"machinen_controlled_heap_state\","
    "\"stack_symbol\":\"machinen_controlled_stack_observation\","
    "\"resource_symbol\":\"machinen_controlled_resource_state\","
    "\"threads_symbol\":\"machinen_controlled_thread_states\"}";

static bool g_pause_at_observation;
static pthread_mutex_t g_thread_mutex = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t g_thread_cond = PTHREAD_COND_INITIALIZER;
static uint32_t g_threads_arrived;
static bool g_threads_release;

static void copy_label(char destination[CONTROLLED_LABEL_CAPACITY], const char *source) {
  uint32_t i = 0;
  while (i + 1u < CONTROLLED_LABEL_CAPACITY && source[i] != '\0') {
    destination[i] = source[i];
    i++;
  }
  destination[i] = '\0';
  while (i + 1u < CONTROLLED_LABEL_CAPACITY) {
    i++;
    destination[i] = '\0';
  }
}

static uint64_t fnv1a_bytes(const uint8_t *bytes, uint64_t len) {
  uint64_t hash = UINT64_C(1469598103934665603);
  for (uint64_t i = 0; i < len; i++) {
    hash ^= bytes[i];
    hash *= UINT64_C(1099511628211);
  }
  return hash;
}

static uint64_t checksum_string(const char *value) {
  return fnv1a_bytes((const uint8_t *)value, (uint64_t)strlen(value));
}

static uint64_t checksum_nodes(const struct ControlledNode *head) {
  uint64_t hash = UINT64_C(1469598103934665603);
  const struct ControlledNode *node = head;
  while (node) {
    hash ^= node->value;
    hash *= UINT64_C(1099511628211);
    node = node->next;
  }
  return hash;
}

static void maybe_pause_at_observation(const char *fixture) {
  if (!g_pause_at_observation) {
    return;
  }
  fprintf(stderr, "machinen-controlled-corpus: paused fixture=%s pid=%ld\n", fixture, (long)getpid());
  fflush(stderr);
  raise(SIGSTOP);
}

static void print_global_marker(void) {
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"global\",\"arch\":\"%s\","
         "\"counter\":%" PRIu64 ",\"flags\":%u,\"label\":\"%s\",\"checksum\":%" PRIu64 "}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, machinen_controlled_global_state.counter,
      machinen_controlled_global_state.flags, machinen_controlled_global_state.label,
      checksum_string(machinen_controlled_global_state.label));
  fflush(stdout);
}

static int run_global_fixture(void) {
  machinen_controlled_global_state.counter = 1000;
  machinen_controlled_global_state.flags = 0xa5a5u;
  copy_label(machinen_controlled_global_state.label, "global-scalar-v1");
  print_global_marker();
  maybe_pause_at_observation("global");
  return 0;
}

static void print_heap_marker(void) {
  const struct ControlledNode *head = machinen_controlled_heap_state.head;
  const uint64_t first = head ? head->value : 0;
  const uint64_t second = head && head->next ? head->next->value : 0;
  const uint64_t third = head && head->next && head->next->next ? head->next->next->value : 0;
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"heap\",\"arch\":\"%s\","
         "\"node_count\":%" PRIu64 ",\"values\":[%" PRIu64 ",%" PRIu64 ",%" PRIu64 "],"
         "\"checksum\":%" PRIu64 "}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, machinen_controlled_heap_state.node_count, first,
      second, third, machinen_controlled_heap_state.checksum);
  fflush(stdout);
}

static int run_heap_fixture(void) {
  struct ControlledNode *nodes = calloc(3u, sizeof(struct ControlledNode));
  if (!nodes) {
    fprintf(stderr, "machinen-controlled-corpus: heap allocation failed\n");
    return 1;
  }

  nodes[0].value = 11;
  nodes[0].next = &nodes[1];
  nodes[1].value = 22;
  nodes[1].next = &nodes[2];
  nodes[2].value = 33;
  nodes[2].next = NULL;

  machinen_controlled_heap_state.head = &nodes[0];
  machinen_controlled_heap_state.node_count = 3;
  machinen_controlled_heap_state.checksum = checksum_nodes(machinen_controlled_heap_state.head);

  print_heap_marker();
  maybe_pause_at_observation("heap");

  free(nodes);
  machinen_controlled_heap_state.head = NULL;
  machinen_controlled_heap_state.node_count = 0;
  machinen_controlled_heap_state.checksum = 0;
  return 0;
}

static void print_stack_marker(void) {
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"stack\",\"arch\":\"%s\","
         "\"continuation\":\"%s\",\"live_local\":%" PRIu64 ",\"caller_counter\":%" PRIu64 "}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, machinen_controlled_stack_observation.continuation,
      machinen_controlled_stack_observation.live_local,
      machinen_controlled_stack_observation.caller_counter);
  fflush(stdout);
}

static uint64_t controlled_nested_stack_point(uint64_t seed) {
  volatile uint64_t live_local = seed + UINT64_C(4242);
  machinen_controlled_stack_observation.live_local = live_local;
  machinen_controlled_stack_observation.caller_counter = seed;
  copy_label(machinen_controlled_stack_observation.continuation, "controlled_nested_stack_point");

  print_stack_marker();
  maybe_pause_at_observation("stack");
  return live_local + 1u;
}

static int run_stack_fixture(void) {
  uint64_t after_observation = controlled_nested_stack_point(1000);
  if (after_observation != 5243u) {
    fprintf(stderr, "machinen-controlled-corpus: stack continuation invariant failed\n");
    return 1;
  }
  return 0;
}

static void print_resource_marker(void) {
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"resource\",\"arch\":\"%s\","
         "\"argc\":%u,\"env_seen\":%s,\"file_bytes\":%" PRIu64 ","
         "\"file_offset\":%" PRIu64 ",\"checksum\":%" PRIu64 "}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, machinen_controlled_resource_state.argc,
      machinen_controlled_resource_state.env_seen ? "true" : "false",
      machinen_controlled_resource_state.file_bytes, machinen_controlled_resource_state.file_offset,
      machinen_controlled_resource_state.checksum);
  fflush(stdout);
}

static FILE *open_resource_file_at_observation(const char *path) {
  FILE *file = fopen(path, "wb+");
  if (!file) {
    fprintf(stderr, "machinen-controlled-corpus: fopen(%s) failed: %s\n", path, strerror(errno));
    return NULL;
  }

  const char payload[] = CONTROLLED_RESOURCE_PAYLOAD;
  const size_t payload_len = sizeof(payload) - 1u;
  if (fwrite(payload, 1u, payload_len, file) != payload_len) {
    fprintf(stderr, "machinen-controlled-corpus: fwrite(%s) failed\n", path);
    fclose(file);
    return NULL;
  }
  if (fflush(file) != 0) {
    fprintf(stderr, "machinen-controlled-corpus: fflush(%s) failed\n", path);
    fclose(file);
    return NULL;
  }
  if (fseek(file, (long)CONTROLLED_RESOURCE_OFFSET, SEEK_SET) != 0) {
    fprintf(stderr, "machinen-controlled-corpus: fseek(%s) failed\n", path);
    fclose(file);
    return NULL;
  }

  machinen_controlled_resource_state.file_bytes = (uint64_t)payload_len;
  machinen_controlled_resource_state.file_offset = CONTROLLED_RESOURCE_OFFSET;
  machinen_controlled_resource_state.checksum = checksum_string(payload);
  return file;
}

static int run_resource_fixture(const char *resource_path, int argc) {
  machinen_controlled_resource_state.argc = (uint32_t)argc;
  machinen_controlled_resource_state.env_seen = getenv("MACHINEN_CONTROLLED_ENV") ? 1u : 0u;
  machinen_controlled_resource_state.file_bytes = 0;
  machinen_controlled_resource_state.file_offset = 0;
  machinen_controlled_resource_state.checksum = 0;

  FILE *resource_file = open_resource_file_at_observation(resource_path);
  if (!resource_file) {
    return 1;
  }

  print_resource_marker();
  maybe_pause_at_observation("resource");

  if (fclose(resource_file) != 0) {
    fprintf(stderr, "machinen-controlled-corpus: fclose(%s) failed\n", resource_path);
    return 1;
  }
  return 0;
}

static void print_threads_marker(void) {
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"threads\",\"arch\":\"%s\","
         "\"thread_count\":%u,\"threads\":["
         "{\"id\":%u,\"at_observation\":%s,\"local_counter\":%" PRIu64 ",\"continuation\":\"%s\"},"
         "{\"id\":%u,\"at_observation\":%s,\"local_counter\":%" PRIu64 ",\"continuation\":\"%s\"}]}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, CONTROLLED_THREAD_COUNT,
      machinen_controlled_thread_states[0].id,
      machinen_controlled_thread_states[0].at_observation ? "true" : "false",
      machinen_controlled_thread_states[0].local_counter,
      machinen_controlled_thread_states[0].continuation, machinen_controlled_thread_states[1].id,
      machinen_controlled_thread_states[1].at_observation ? "true" : "false",
      machinen_controlled_thread_states[1].local_counter,
      machinen_controlled_thread_states[1].continuation);
  fflush(stdout);
}

static void *controlled_thread_main(void *opaque) {
  const struct ThreadArgs *args = (const struct ThreadArgs *)opaque;
  const uint32_t id = args->id;
  struct ControlledThreadState *state = &machinen_controlled_thread_states[id];

  pthread_mutex_lock(&g_thread_mutex);
  state->id = id;
  state->at_observation = 1;
  state->local_counter = args->base_counter + (uint64_t)id + 1u;
  copy_label(state->continuation, id == 0 ? "controlled_thread_main_0" : "controlled_thread_main_1");
  g_threads_arrived++;
  pthread_cond_broadcast(&g_thread_cond);
  while (!g_threads_release) {
    pthread_cond_wait(&g_thread_cond, &g_thread_mutex);
  }
  pthread_mutex_unlock(&g_thread_mutex);
  return NULL;
}

static int run_threads_fixture(void) {
  pthread_t threads[CONTROLLED_THREAD_COUNT];
  struct ThreadArgs args[CONTROLLED_THREAD_COUNT];

  memset(machinen_controlled_thread_states, 0, sizeof(machinen_controlled_thread_states));
  g_threads_arrived = 0;
  g_threads_release = false;

  for (uint32_t i = 0; i < CONTROLLED_THREAD_COUNT; i++) {
    args[i].id = i;
    args[i].base_counter = 2000;
    const int err = pthread_create(&threads[i], NULL, controlled_thread_main, &args[i]);
    if (err != 0) {
      fprintf(stderr, "machinen-controlled-corpus: pthread_create failed: %s\n", strerror(err));
      return 1;
    }
  }

  pthread_mutex_lock(&g_thread_mutex);
  while (g_threads_arrived != CONTROLLED_THREAD_COUNT) {
    pthread_cond_wait(&g_thread_cond, &g_thread_mutex);
  }
  pthread_mutex_unlock(&g_thread_mutex);

  print_threads_marker();
  maybe_pause_at_observation("threads");

  pthread_mutex_lock(&g_thread_mutex);
  g_threads_release = true;
  pthread_cond_broadcast(&g_thread_cond);
  pthread_mutex_unlock(&g_thread_mutex);

  for (uint32_t i = 0; i < CONTROLLED_THREAD_COUNT; i++) {
    const int err = pthread_join(threads[i], NULL);
    if (err != 0) {
      fprintf(stderr, "machinen-controlled-corpus: pthread_join failed: %s\n", strerror(err));
      return 1;
    }
  }
  return 0;
}

struct ControlledKnownSymbolRestoreState {
  uint64_t node_count;
  uint64_t values[3];
  uint64_t checksum;
};

static bool parse_u64_line(const char *line, const char *prefix, uint64_t *out) {
  size_t prefix_len = strlen(prefix);
  if (strncmp(line, prefix, prefix_len) != 0) {
    return false;
  }
  errno = 0;
  char *end = NULL;
  unsigned long long parsed = strtoull(line + prefix_len, &end, 0);
  if (errno != 0 || end == line + prefix_len || (*end != '\0' && *end != '\n' && *end != '\r')) {
    return false;
  }
  *out = (uint64_t)parsed;
  return true;
}

static int load_known_symbol_restore_state(
    const char *bundle_dir, struct ControlledKnownSymbolRestoreState *state) {
  char path[CONTROLLED_PATH_CAPACITY];
  int written = snprintf(path, sizeof(path), "%s/controlled-state.txt", bundle_dir);
  if (written < 0 || written >= (int)sizeof(path)) {
    fprintf(stderr, "machinen-controlled-corpus: restore bundle path too long\n");
    return 1;
  }

  FILE *file = fopen(path, "rb");
  if (!file) {
    fprintf(stderr, "machinen-controlled-corpus: fopen(%s) failed: %s\n", path, strerror(errno));
    return 1;
  }

  char line[128];
  while (fgets(line, sizeof(line), file)) {
    if (parse_u64_line(line, "node_count=", &state->node_count) ||
        parse_u64_line(line, "value0=", &state->values[0]) ||
        parse_u64_line(line, "value1=", &state->values[1]) ||
        parse_u64_line(line, "value2=", &state->values[2]) ||
        parse_u64_line(line, "checksum=", &state->checksum)) {
      continue;
    }
  }

  if (fclose(file) != 0) {
    fprintf(stderr, "machinen-controlled-corpus: fclose(%s) failed\n", path);
    return 1;
  }
  if (state->node_count != 3) {
    fprintf(stderr, "machinen-controlled-corpus: expected three restore nodes\n");
    return 1;
  }
  return 0;
}

static void print_known_symbol_restore_marker(void) {
  const struct ControlledNode *head = machinen_controlled_heap_state.head;
  const uint64_t first = head ? head->value : 0;
  const uint64_t second = head && head->next ? head->next->value : 0;
  const uint64_t third = head && head->next && head->next->next ? head->next->next->value : 0;
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"known-symbol-restore\",\"arch\":\"%s\","
         "\"node_count\":%" PRIu64 ",\"values\":[%" PRIu64 ",%" PRIu64 ",%" PRIu64 "],"
         "\"checksum\":%" PRIu64 ",\"checksum_hex\":\"0x%" PRIx64 "\"}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, machinen_controlled_heap_state.node_count, first,
      second, third, machinen_controlled_heap_state.checksum,
      machinen_controlled_heap_state.checksum);
  fflush(stdout);
}

static int run_known_symbol_restore(const char *bundle_dir) {
  struct ControlledKnownSymbolRestoreState state = {0};
  if (load_known_symbol_restore_state(bundle_dir, &state) != 0) {
    return 1;
  }

  struct ControlledNode *nodes = calloc((size_t)state.node_count, sizeof(struct ControlledNode));
  if (!nodes) {
    fprintf(stderr, "machinen-controlled-corpus: restore heap allocation failed\n");
    return 1;
  }
  for (uint64_t i = 0; i < state.node_count; i++) {
    nodes[i].value = state.values[i];
    nodes[i].next = i + 1u < state.node_count ? &nodes[i + 1u] : NULL;
  }
  machinen_controlled_heap_state.head = &nodes[0];
  machinen_controlled_heap_state.node_count = state.node_count;
  machinen_controlled_heap_state.checksum = checksum_nodes(machinen_controlled_heap_state.head);

  if (machinen_controlled_heap_state.checksum != state.checksum) {
    fprintf(stderr, "machinen-controlled-corpus: restore checksum mismatch\n");
    free(nodes);
    return 1;
  }
  print_known_symbol_restore_marker();
  free(nodes);
  return 0;
}

static void print_usage(const char *argv0) {
  fprintf(stderr,
      "usage: %s [--fixture all|global|heap|stack|resource|threads] "
      "[--resource-file path] [--pause-at-observation] "
      "[--restore-known-symbol-bundle path]\n",
      argv0);
}

static bool streq(const char *a, const char *b) {
  return strcmp(a, b) == 0;
}

static int run_selected_fixture(const char *fixture, const char *resource_path, int argc) {
  if (streq(fixture, "global")) {
    return run_global_fixture();
  }
  if (streq(fixture, "heap")) {
    return run_heap_fixture();
  }
  if (streq(fixture, "stack")) {
    return run_stack_fixture();
  }
  if (streq(fixture, "resource")) {
    return run_resource_fixture(resource_path, argc);
  }
  if (streq(fixture, "threads")) {
    return run_threads_fixture();
  }
  fprintf(stderr, "machinen-controlled-corpus: unknown fixture: %s\n", fixture);
  return 1;
}

static int run_all_fixtures(const char *resource_path, int argc) {
  const char *fixtures[] = {"global", "heap", "stack", "resource", "threads"};
  for (uint32_t i = 0; i < sizeof(fixtures) / sizeof(fixtures[0]); i++) {
    if (run_selected_fixture(fixtures[i], resource_path, argc) != 0) {
      return 1;
    }
  }
  return 0;
}

int main(int argc, char **argv) {
  const char *fixture = "all";
  const char *resource_path = "machinen-controlled-resource.txt";
  const char *restore_bundle_dir = NULL;

  for (int i = 1; i < argc; i++) {
    if (streq(argv[i], "--fixture")) {
      if (i + 1 >= argc) {
        print_usage(argv[0]);
        return 2;
      }
      fixture = argv[++i];
    } else if (streq(argv[i], "--resource-file")) {
      if (i + 1 >= argc) {
        print_usage(argv[0]);
        return 2;
      }
      resource_path = argv[++i];
    } else if (streq(argv[i], "--pause-at-observation")) {
      g_pause_at_observation = true;
    } else if (streq(argv[i], "--restore-known-symbol-bundle")) {
      if (i + 1 >= argc) {
        print_usage(argv[0]);
        return 2;
      }
      restore_bundle_dir = argv[++i];
    } else if (streq(argv[i], "--help") || streq(argv[i], "-h")) {
      print_usage(argv[0]);
      return 0;
    } else {
      fprintf(stderr, "machinen-controlled-corpus: unknown argument: %s\n", argv[i]);
      print_usage(argv[0]);
      return 2;
    }
  }

  if (restore_bundle_dir) {
    return run_known_symbol_restore(restore_bundle_dir);
  }
  if (streq(fixture, "all")) {
    return run_all_fixtures(resource_path, argc);
  }
  return run_selected_fixture(fixture, resource_path, argc);
}
