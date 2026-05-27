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

struct ControlledContinuationFrame {
  uint64_t seed;
  uint64_t live_local;
  uint64_t resume_delta;
  uint64_t checksum;
  char continuation[CONTROLLED_LABEL_CAPACITY];
};

struct ControlledContinuationAnchor {
  struct ControlledContinuationFrame *frame;
  uint64_t frame_size;
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

struct ControlledDwarfGlobalState {
  char label[CONTROLLED_LABEL_CAPACITY];
  uint32_t flags;
  uint16_t generation;
  uint64_t counter;
};

struct ControlledDwarfNode {
  uint32_t tag;
  uint8_t color;
  uint64_t value;
  struct ControlledDwarfNode *next;
};

struct ControlledDwarfHeapState {
  uint16_t version;
  struct ControlledDwarfNode *head;
  uint64_t checksum;
  uint64_t node_count;
};

CONTROLLED_EXPORT struct ControlledGlobalState machinen_controlled_global_state;
CONTROLLED_EXPORT struct ControlledHeapState machinen_controlled_heap_state;
CONTROLLED_EXPORT struct ControlledStackObservation machinen_controlled_stack_observation;
CONTROLLED_EXPORT struct ControlledContinuationAnchor machinen_controlled_continuation_anchor;
CONTROLLED_EXPORT struct ControlledResourceState machinen_controlled_resource_state;
CONTROLLED_EXPORT struct ControlledThreadState machinen_controlled_thread_states[CONTROLLED_THREAD_COUNT];
CONTROLLED_EXPORT struct ControlledDwarfGlobalState machinen_controlled_dwarf_global_state;
CONTROLLED_EXPORT struct ControlledDwarfHeapState machinen_controlled_dwarf_heap_state;

CONTROLLED_EXPORT const char machinen_controlled_corpus_metadata[] =
    "{\"schema_version\":1,"
    "\"workload\":\"machinen-controlled-binary-corpus\","
    "\"fixtures\":[\"global\",\"heap\",\"stack\",\"continuation\",\"resource\",\"threads\",\"dwarf\"],"
    "\"global_symbol\":\"machinen_controlled_global_state\","
    "\"heap_symbol\":\"machinen_controlled_heap_state\","
    "\"stack_symbol\":\"machinen_controlled_stack_observation\","
    "\"continuation_symbol\":\"machinen_controlled_continuation_anchor\","
    "\"resource_symbol\":\"machinen_controlled_resource_state\","
    "\"threads_symbol\":\"machinen_controlled_thread_states\","
    "\"dwarf_global_symbol\":\"machinen_controlled_dwarf_global_state\","
    "\"dwarf_heap_symbol\":\"machinen_controlled_dwarf_heap_state\"}";

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

static uint64_t checksum_dwarf_nodes(const struct ControlledDwarfNode *head) {
  uint64_t hash = UINT64_C(1469598103934665603);
  const struct ControlledDwarfNode *node = head;
  while (node) {
    hash ^= node->tag;
    hash *= UINT64_C(1099511628211);
    hash ^= node->color;
    hash *= UINT64_C(1099511628211);
    hash ^= node->value;
    hash *= UINT64_C(1099511628211);
    node = node->next;
  }
  return hash;
}

static uint64_t checksum_continuation_values(
    uint64_t seed, uint64_t live_local, uint64_t resume_delta, const char *continuation) {
  uint64_t hash = UINT64_C(1469598103934665603);
  hash ^= seed;
  hash *= UINT64_C(1099511628211);
  hash ^= live_local;
  hash *= UINT64_C(1099511628211);
  hash ^= resume_delta;
  hash *= UINT64_C(1099511628211);
  for (const unsigned char *p = (const unsigned char *)continuation; *p; p++) {
    hash ^= *p;
    hash *= UINT64_C(1099511628211);
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

static void print_dwarf_marker(void) {
  const struct ControlledDwarfNode *head = machinen_controlled_dwarf_heap_state.head;
  const struct ControlledDwarfNode *second = head ? head->next : NULL;
  const struct ControlledDwarfNode *third = second ? second->next : NULL;
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"dwarf\",\"arch\":\"%s\","
         "\"global\":{\"counter\":%" PRIu64 ",\"flags\":%u,"
         "\"generation\":%u,\"label\":\"%s\"},"
         "\"heap\":{\"version\":%u,\"node_count\":%" PRIu64 ","
         "\"values\":[%" PRIu64 ",%" PRIu64 ",%" PRIu64 "],"
         "\"tags\":[%u,%u,%u],\"colors\":[%u,%u,%u],"
         "\"checksum\":%" PRIu64 ",\"checksum_hex\":\"0x%" PRIx64 "\"}}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, machinen_controlled_dwarf_global_state.counter,
      machinen_controlled_dwarf_global_state.flags,
      (unsigned)machinen_controlled_dwarf_global_state.generation,
      machinen_controlled_dwarf_global_state.label,
      (unsigned)machinen_controlled_dwarf_heap_state.version,
      machinen_controlled_dwarf_heap_state.node_count, head ? head->value : 0,
      second ? second->value : 0, third ? third->value : 0, head ? head->tag : 0,
      second ? second->tag : 0, third ? third->tag : 0, head ? (unsigned)head->color : 0,
      second ? (unsigned)second->color : 0, third ? (unsigned)third->color : 0,
      machinen_controlled_dwarf_heap_state.checksum,
      machinen_controlled_dwarf_heap_state.checksum);
  fflush(stdout);
}

static int run_dwarf_fixture(void) {
  struct ControlledDwarfNode *nodes = calloc(3u, sizeof(struct ControlledDwarfNode));
  if (!nodes) {
    fprintf(stderr, "machinen-controlled-corpus: dwarf heap allocation failed\n");
    return 1;
  }

  copy_label(machinen_controlled_dwarf_global_state.label, "dwarf-global-layout-v2");
  machinen_controlled_dwarf_global_state.flags = 0x5a5au;
  machinen_controlled_dwarf_global_state.generation = 7u;
  machinen_controlled_dwarf_global_state.counter = 7000u;

  nodes[0].tag = 101u;
  nodes[0].color = 3u;
  nodes[0].value = 111u;
  nodes[0].next = &nodes[1];
  nodes[1].tag = 102u;
  nodes[1].color = 5u;
  nodes[1].value = 222u;
  nodes[1].next = &nodes[2];
  nodes[2].tag = 103u;
  nodes[2].color = 7u;
  nodes[2].value = 333u;
  nodes[2].next = NULL;

  machinen_controlled_dwarf_heap_state.version = 2u;
  machinen_controlled_dwarf_heap_state.head = &nodes[0];
  machinen_controlled_dwarf_heap_state.node_count = 3u;
  machinen_controlled_dwarf_heap_state.checksum =
      checksum_dwarf_nodes(machinen_controlled_dwarf_heap_state.head);

  print_dwarf_marker();
  maybe_pause_at_observation("dwarf");

  free(nodes);
  memset(&machinen_controlled_dwarf_global_state, 0, sizeof(machinen_controlled_dwarf_global_state));
  memset(&machinen_controlled_dwarf_heap_state, 0, sizeof(machinen_controlled_dwarf_heap_state));
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

static void fill_continuation_frame(
    struct ControlledContinuationFrame *frame, uint64_t seed, uint64_t resume_delta) {
  memset(frame, 0, sizeof(*frame));
  frame->seed = seed;
  frame->live_local = seed + UINT64_C(4242);
  frame->resume_delta = resume_delta;
  copy_label(frame->continuation, "controlled_continuation_point");
  frame->checksum = checksum_continuation_values(
      frame->seed, frame->live_local, frame->resume_delta, frame->continuation);
}

static uint64_t finish_continuation_frame(const struct ControlledContinuationFrame *frame) {
  uint64_t expected = checksum_continuation_values(
      frame->seed, frame->live_local, frame->resume_delta, frame->continuation);
  if (frame->checksum != expected) {
    return UINT64_MAX;
  }
  return frame->live_local + frame->resume_delta;
}

static void print_continuation_marker(const char *fixture, uint64_t result) {
  const struct ControlledContinuationFrame *frame = machinen_controlled_continuation_anchor.frame;
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"%s\",\"arch\":\"%s\","
         "\"continuation\":\"%s\",\"frame_size\":%" PRIu64 ","
         "\"seed\":%" PRIu64 ",\"live_local\":%" PRIu64 ","
         "\"resume_delta\":%" PRIu64 ",\"checksum\":%" PRIu64 ","
         "\"checksum_hex\":\"0x%" PRIx64 "\",\"result\":%" PRIu64 "}\n",
      CONTROLLED_SCHEMA_VERSION, fixture, CONTROLLED_ARCH,
      machinen_controlled_continuation_anchor.continuation,
      machinen_controlled_continuation_anchor.frame_size, frame ? frame->seed : 0,
      frame ? frame->live_local : 0, frame ? frame->resume_delta : 0, frame ? frame->checksum : 0,
      frame ? frame->checksum : 0, result);
  fflush(stdout);
}

static uint64_t controlled_continuation_point(uint64_t seed) {
  struct ControlledContinuationFrame frame;
  fill_continuation_frame(&frame, seed, 77u);
  machinen_controlled_continuation_anchor.frame = &frame;
  machinen_controlled_continuation_anchor.frame_size = sizeof(frame);
  copy_label(machinen_controlled_continuation_anchor.continuation, frame.continuation);

  print_continuation_marker("continuation", 0);
  maybe_pause_at_observation("continuation");
  return finish_continuation_frame(&frame);
}

static uint64_t controlled_continuation_outer(uint64_t seed) {
  return controlled_continuation_point(seed);
}

static int run_continuation_fixture(void) {
  uint64_t result = controlled_continuation_outer(1000);
  if (result != 5319u) {
    fprintf(stderr, "machinen-controlled-corpus: continuation result invariant failed\n");
    return 1;
  }
  memset(&machinen_controlled_continuation_anchor, 0, sizeof(machinen_controlled_continuation_anchor));
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

struct ControlledDwarfRestoreState {
  char label[CONTROLLED_LABEL_CAPACITY];
  uint64_t counter;
  uint64_t flags;
  uint64_t generation;
  uint64_t node_count;
  uint64_t values[3];
  uint64_t tags[3];
  uint64_t colors[3];
  uint64_t checksum;
};

struct ControlledContinuationRestoreState {
  char continuation[CONTROLLED_LABEL_CAPACITY];
  uint64_t seed;
  uint64_t live_local;
  uint64_t resume_delta;
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

static bool parse_string_line(const char *line, const char *prefix, char *out, size_t capacity) {
  size_t prefix_len = strlen(prefix);
  if (strncmp(line, prefix, prefix_len) != 0) {
    return false;
  }
  size_t len = strcspn(line + prefix_len, "\r\n");
  if (len >= capacity) {
    return false;
  }
  memcpy(out, line + prefix_len, len);
  out[len] = '\0';
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

static int load_dwarf_restore_state(const char *bundle_dir, struct ControlledDwarfRestoreState *state) {
  char path[CONTROLLED_PATH_CAPACITY];
  int written = snprintf(path, sizeof(path), "%s/controlled-state.txt", bundle_dir);
  if (written < 0 || written >= (int)sizeof(path)) {
    fprintf(stderr, "machinen-controlled-corpus: dwarf restore bundle path too long\n");
    return 1;
  }

  FILE *file = fopen(path, "rb");
  if (!file) {
    fprintf(stderr, "machinen-controlled-corpus: fopen(%s) failed: %s\n", path, strerror(errno));
    return 1;
  }

  char line[128];
  while (fgets(line, sizeof(line), file)) {
    if (parse_string_line(line, "global_label=", state->label, sizeof(state->label)) ||
        parse_u64_line(line, "global_counter=", &state->counter) ||
        parse_u64_line(line, "global_flags=", &state->flags) ||
        parse_u64_line(line, "global_generation=", &state->generation) ||
        parse_u64_line(line, "node_count=", &state->node_count) ||
        parse_u64_line(line, "value0=", &state->values[0]) ||
        parse_u64_line(line, "value1=", &state->values[1]) ||
        parse_u64_line(line, "value2=", &state->values[2]) ||
        parse_u64_line(line, "tag0=", &state->tags[0]) ||
        parse_u64_line(line, "tag1=", &state->tags[1]) ||
        parse_u64_line(line, "tag2=", &state->tags[2]) ||
        parse_u64_line(line, "color0=", &state->colors[0]) ||
        parse_u64_line(line, "color1=", &state->colors[1]) ||
        parse_u64_line(line, "color2=", &state->colors[2]) ||
        parse_u64_line(line, "checksum=", &state->checksum)) {
      continue;
    }
  }

  if (fclose(file) != 0) {
    fprintf(stderr, "machinen-controlled-corpus: fclose(%s) failed\n", path);
    return 1;
  }
  if (state->node_count != 3 || state->label[0] == '\0') {
    fprintf(stderr, "machinen-controlled-corpus: invalid dwarf restore state\n");
    return 1;
  }
  return 0;
}

static void print_dwarf_restore_marker(void) {
  const struct ControlledDwarfNode *head = machinen_controlled_dwarf_heap_state.head;
  const struct ControlledDwarfNode *second = head ? head->next : NULL;
  const struct ControlledDwarfNode *third = second ? second->next : NULL;
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"dwarf-restore\",\"arch\":\"%s\","
         "\"global\":{\"counter\":%" PRIu64 ",\"flags\":%u,"
         "\"generation\":%u,\"label\":\"%s\"},"
         "\"heap\":{\"version\":%u,\"node_count\":%" PRIu64 ","
         "\"values\":[%" PRIu64 ",%" PRIu64 ",%" PRIu64 "],"
         "\"tags\":[%u,%u,%u],\"colors\":[%u,%u,%u],"
         "\"checksum\":%" PRIu64 ",\"checksum_hex\":\"0x%" PRIx64 "\"}}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, machinen_controlled_dwarf_global_state.counter,
      machinen_controlled_dwarf_global_state.flags,
      (unsigned)machinen_controlled_dwarf_global_state.generation,
      machinen_controlled_dwarf_global_state.label,
      (unsigned)machinen_controlled_dwarf_heap_state.version,
      machinen_controlled_dwarf_heap_state.node_count, head ? head->value : 0,
      second ? second->value : 0, third ? third->value : 0, head ? head->tag : 0,
      second ? second->tag : 0, third ? third->tag : 0, head ? (unsigned)head->color : 0,
      second ? (unsigned)second->color : 0, third ? (unsigned)third->color : 0,
      machinen_controlled_dwarf_heap_state.checksum,
      machinen_controlled_dwarf_heap_state.checksum);
  fflush(stdout);
}

static int run_dwarf_restore(const char *bundle_dir) {
  struct ControlledDwarfRestoreState state = {0};
  if (load_dwarf_restore_state(bundle_dir, &state) != 0) {
    return 1;
  }

  copy_label(machinen_controlled_dwarf_global_state.label, state.label);
  machinen_controlled_dwarf_global_state.counter = state.counter;
  machinen_controlled_dwarf_global_state.flags = (uint32_t)state.flags;
  machinen_controlled_dwarf_global_state.generation = (uint16_t)state.generation;

  struct ControlledDwarfNode *nodes = calloc((size_t)state.node_count, sizeof(struct ControlledDwarfNode));
  if (!nodes) {
    fprintf(stderr, "machinen-controlled-corpus: dwarf restore heap allocation failed\n");
    return 1;
  }
  for (uint64_t i = 0; i < state.node_count; i++) {
    nodes[i].tag = (uint32_t)state.tags[i];
    nodes[i].color = (uint8_t)state.colors[i];
    nodes[i].value = state.values[i];
    nodes[i].next = i + 1u < state.node_count ? &nodes[i + 1u] : NULL;
  }

  machinen_controlled_dwarf_heap_state.version = 2u;
  machinen_controlled_dwarf_heap_state.head = &nodes[0];
  machinen_controlled_dwarf_heap_state.node_count = state.node_count;
  machinen_controlled_dwarf_heap_state.checksum =
      checksum_dwarf_nodes(machinen_controlled_dwarf_heap_state.head);

  if (machinen_controlled_dwarf_heap_state.checksum != state.checksum) {
    fprintf(stderr, "machinen-controlled-corpus: dwarf restore checksum mismatch\n");
    free(nodes);
    return 1;
  }
  print_dwarf_restore_marker();
  free(nodes);
  return 0;
}

static int load_continuation_restore_state(
    const char *bundle_dir, struct ControlledContinuationRestoreState *state) {
  char path[CONTROLLED_PATH_CAPACITY];
  int written = snprintf(path, sizeof(path), "%s/controlled-state.txt", bundle_dir);
  if (written < 0 || written >= (int)sizeof(path)) {
    fprintf(stderr, "machinen-controlled-corpus: continuation restore bundle path too long\n");
    return 1;
  }

  FILE *file = fopen(path, "rb");
  if (!file) {
    fprintf(stderr, "machinen-controlled-corpus: fopen(%s) failed: %s\n", path, strerror(errno));
    return 1;
  }

  char line[128];
  while (fgets(line, sizeof(line), file)) {
    if (parse_string_line(line, "continuation=", state->continuation, sizeof(state->continuation)) ||
        parse_u64_line(line, "seed=", &state->seed) ||
        parse_u64_line(line, "live_local=", &state->live_local) ||
        parse_u64_line(line, "resume_delta=", &state->resume_delta) ||
        parse_u64_line(line, "checksum=", &state->checksum)) {
      continue;
    }
  }

  if (fclose(file) != 0) {
    fprintf(stderr, "machinen-controlled-corpus: fclose(%s) failed\n", path);
    return 1;
  }
  if (state->continuation[0] == '\0' || state->live_local == 0) {
    fprintf(stderr, "machinen-controlled-corpus: invalid continuation restore state\n");
    return 1;
  }
  return 0;
}

static uint64_t controlled_continuation_restore_trampoline(
    const struct ControlledContinuationRestoreState *state) {
  struct ControlledContinuationFrame frame;
  memset(&frame, 0, sizeof(frame));
  frame.seed = state->seed;
  frame.live_local = state->live_local;
  frame.resume_delta = state->resume_delta;
  copy_label(frame.continuation, state->continuation);
  frame.checksum = state->checksum;
  return finish_continuation_frame(&frame);
}

static void print_continuation_restore_marker(
    const struct ControlledContinuationRestoreState *state, uint64_t result) {
  printf(CONTROLLED_MARKER
         "{\"schema_version\":%u,\"fixture\":\"continuation-restore\",\"arch\":\"%s\","
         "\"continuation\":\"%s\",\"seed\":%" PRIu64 ","
         "\"live_local\":%" PRIu64 ",\"resume_delta\":%" PRIu64 ","
         "\"checksum\":%" PRIu64 ",\"checksum_hex\":\"0x%" PRIx64 "\","
         "\"result\":%" PRIu64 ",\"resumed\":true}\n",
      CONTROLLED_SCHEMA_VERSION, CONTROLLED_ARCH, state->continuation, state->seed,
      state->live_local, state->resume_delta, state->checksum, state->checksum, result);
  fflush(stdout);
}

static int run_continuation_restore(const char *bundle_dir) {
  struct ControlledContinuationRestoreState state = {0};
  if (load_continuation_restore_state(bundle_dir, &state) != 0) {
    return 1;
  }
  uint64_t result = controlled_continuation_restore_trampoline(&state);
  if (result == UINT64_MAX || result != state.live_local + state.resume_delta) {
    fprintf(stderr, "machinen-controlled-corpus: continuation restore failed\n");
    return 1;
  }
  print_continuation_restore_marker(&state, result);
  return 0;
}

static void print_usage(const char *argv0) {
  fprintf(stderr,
      "usage: %s [--fixture all|global|heap|stack|resource|threads|dwarf] "
      "[--resource-file path] [--pause-at-observation] "
      "[--restore-known-symbol-bundle path] [--restore-dwarf-bundle path] "
      "[--restore-continuation-bundle path]\n",
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
  if (streq(fixture, "dwarf")) {
    return run_dwarf_fixture();
  }
  if (streq(fixture, "continuation")) {
    return run_continuation_fixture();
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
  const char *fixtures[] = {"global", "heap", "stack", "continuation", "resource", "threads", "dwarf"};
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
  const char *dwarf_restore_bundle_dir = NULL;
  const char *continuation_restore_bundle_dir = NULL;

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
    } else if (streq(argv[i], "--restore-dwarf-bundle")) {
      if (i + 1 >= argc) {
        print_usage(argv[0]);
        return 2;
      }
      dwarf_restore_bundle_dir = argv[++i];
    } else if (streq(argv[i], "--restore-continuation-bundle")) {
      if (i + 1 >= argc) {
        print_usage(argv[0]);
        return 2;
      }
      continuation_restore_bundle_dir = argv[++i];
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
  if (dwarf_restore_bundle_dir) {
    return run_dwarf_restore(dwarf_restore_bundle_dir);
  }
  if (continuation_restore_bundle_dir) {
    return run_continuation_restore(continuation_restore_bundle_dir);
  }
  if (streq(fixture, "all")) {
    return run_all_fixtures(resource_path, argc);
  }
  return run_selected_fixture(fixture, resource_path, argc);
}
