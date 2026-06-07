#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef TRACK_A_ARCH
#define TRACK_A_ARCH "unknown"
#endif

struct State {
  int counter;
  char message[64];
};

int continue_from_safepoint(struct State* state) {
  state->counter += 1;
  printf("%s:%d\n", state->message, state->counter);
  return state->counter;
}

static void die(const char* message) {
  fprintf(stderr, "ERROR: %s\n", message);
  exit(2);
}

static void refuse(const char* reason) {
  fprintf(stderr, "REFUSED: %s\n", reason);
  exit(10);
}

static char* read_file(const char* path) {
  FILE* file = fopen(path, "rb");
  if (file == NULL) {
    perror("fopen");
    exit(2);
  }
  if (fseek(file, 0, SEEK_END) != 0) {
    die("failed to seek input");
  }
  long size = ftell(file);
  if (size < 0 || size > 65536) {
    die("input size is invalid");
  }
  rewind(file);
  char* buffer = calloc((size_t)size + 1, 1);
  if (buffer == NULL) {
    die("failed to allocate input buffer");
  }
  if (fread(buffer, 1, (size_t)size, file) != (size_t)size) {
    die("failed to read input");
  }
  fclose(file);
  return buffer;
}

static void write_capture(const char* source_arch, const char* target_arch, const char* path) {
  FILE* file = fopen(path, "wb");
  if (file == NULL) {
    perror("fopen");
    exit(2);
  }
  fprintf(
    file,
    "{\n"
    "  \"kind\": \"machinen.research.continuation-ir\",\n"
    "  \"version\": 1,\n"
    "  \"sourceArch\": \"%s\",\n"
    "  \"targetArch\": \"%s\",\n"
    "  \"safePoint\": \"after_increment\",\n"
    "  \"entrySymbol\": \"continue_from_safepoint\",\n"
    "  \"capture\": {\n"
    "    \"binaryArch\": \"%s\",\n"
    "    \"declaredSafePoint\": true,\n"
    "    \"activeSyscall\": false,\n"
    "    \"threads\": 0,\n"
    "    \"sockets\": 0\n"
    "  },\n"
    "  \"state\": {\n"
    "    \"counter\": 41,\n"
    "    \"message\": \"hello\"\n"
    "  },\n"
    "  \"claimGuard\": {\n"
    "    \"arbitraryProcessRestoreClaimed\": false,\n"
    "    \"rawVmReplayUsed\": false,\n"
    "    \"sourceIsaEmulationUsed\": false,\n"
    "    \"metadataOnlySuccess\": false\n"
    "  }\n"
    "}\n",
    source_arch,
    target_arch,
    TRACK_A_ARCH
  );
  fclose(file);
}

static const char* find_key_value(const char* json, const char* key) {
  char needle[128];
  snprintf(needle, sizeof(needle), "\"%s\"", key);
  const char* found = strstr(json, needle);
  if (found == NULL) {
    return NULL;
  }
  const char* colon = strchr(found + strlen(needle), ':');
  if (colon == NULL) {
    return NULL;
  }
  return colon + 1;
}

static int json_string(const char* json, const char* key, char* output, size_t output_size) {
  const char* value = find_key_value(json, key);
  if (value == NULL) {
    return 0;
  }
  const char* start = strchr(value, '"');
  if (start == NULL) {
    return 0;
  }
  start += 1;
  const char* end = strchr(start, '"');
  if (end == NULL) {
    return 0;
  }
  size_t length = (size_t)(end - start);
  if (length >= output_size) {
    return 0;
  }
  memcpy(output, start, length);
  output[length] = '\0';
  return 1;
}

static int json_int(const char* json, const char* key, int* output) {
  const char* value = find_key_value(json, key);
  if (value == NULL) {
    return 0;
  }
  while (*value == ' ' || *value == '\n' || *value == '\t') {
    value += 1;
  }
  char* end = NULL;
  long parsed = strtol(value, &end, 10);
  if (end == value || parsed < -2147483647L || parsed > 2147483647L) {
    return 0;
  }
  *output = (int)parsed;
  return 1;
}

static int json_has_false(const char* json, const char* key) {
  const char* value = find_key_value(json, key);
  if (value == NULL) {
    return 0;
  }
  while (*value == ' ' || *value == '\n' || *value == '\t') {
    value += 1;
  }
  return strncmp(value, "false", 5) == 0;
}

static int json_has_true(const char* json, const char* key) {
  const char* value = find_key_value(json, key);
  if (value == NULL) {
    return 0;
  }
  while (*value == ' ' || *value == '\n' || *value == '\t') {
    value += 1;
  }
  return strncmp(value, "true", 4) == 0;
}

static void require_false_guard(const char* json, const char* key) {
  if (!json_has_false(json, key)) {
    char reason[160];
    snprintf(reason, sizeof(reason), "claim guard %s is missing or not false", key);
    refuse(reason);
  }
}

static void restore_capture(const char* path) {
  char* json = read_file(path);
  char source_arch[32];
  char target_arch[32];
  char safe_point[64];
  char entry_symbol[96];
  char message[64];
  int counter = 0;

  if (!json_string(json, "sourceArch", source_arch, sizeof(source_arch))) {
    refuse("missing source architecture");
  }
  if (!json_string(json, "targetArch", target_arch, sizeof(target_arch))) {
    refuse("missing target architecture");
  }
  if (!json_string(json, "safePoint", safe_point, sizeof(safe_point))) {
    refuse("missing safe point");
  }
  if (!json_string(json, "entrySymbol", entry_symbol, sizeof(entry_symbol))) {
    refuse("missing entry symbol");
  }
  if (!json_int(json, "counter", &counter)) {
    refuse("missing scalar counter");
  }
  if (!json_string(json, "message", message, sizeof(message))) {
    refuse("missing scalar message");
  }

  if (strcmp(target_arch, TRACK_A_ARCH) != 0) {
    refuse("IR target architecture does not match target-native binary");
  }
  if (strcmp(source_arch, target_arch) == 0) {
    refuse("source and target architectures must differ for the cross-architecture proof");
  }
  if (strcmp(safe_point, "after_increment") != 0) {
    refuse("safe point is not declared for this fixture");
  }
  if (strcmp(entry_symbol, "continue_from_safepoint") != 0) {
    refuse("entry symbol is not supported by this target binary");
  }

  require_false_guard(json, "arbitraryProcessRestoreClaimed");
  require_false_guard(json, "rawVmReplayUsed");
  require_false_guard(json, "sourceIsaEmulationUsed");
  require_false_guard(json, "metadataOnlySuccess");

  if (json_has_true(json, "activeSyscall")) {
    refuse("active syscall state is outside Track A scalar constraints");
  }
  if (json_has_true(json, "hasThreads") || json_has_true(json, "threads")) {
    refuse("thread state is outside Track A scalar constraints");
  }
  if (json_has_true(json, "hasSocket") || json_has_true(json, "sockets")) {
    refuse("socket state is outside Track A scalar constraints");
  }
  if (json_has_true(json, "unsupportedStackFrame")) {
    refuse("stack-frame translation is not supported by the scalar rung");
  }
  if (json_has_true(json, "nativeRuntimeOpaque")) {
    refuse("opaque native runtime state is outside Track A scalar constraints");
  }

  struct State state;
  state.counter = counter;
  memset(state.message, 0, sizeof(state.message));
  size_t message_length = strlen(message);
  if (message_length >= sizeof(state.message)) {
    refuse("scalar message is too long for the target state layout");
  }
  memcpy(state.message, message, message_length);

  int result = continue_from_safepoint(&state);
  if (result != 42 || state.counter != 42) {
    refuse("target-native re-entry produced the wrong scalar result");
  }
  printf("RESTORE_OK source=%s target=%s entry=%s result=%d\n", source_arch, target_arch, entry_symbol, result);
  free(json);
}

static void usage(const char* program) {
  fprintf(stderr, "usage: %s capture <source-arch> <target-arch> <out-ir> | restore <ir>\n", program);
  exit(2);
}

int main(int argc, char** argv) {
  if (argc < 2) {
    usage(argv[0]);
  }
  if (strcmp(argv[1], "capture") == 0) {
    if (argc != 5) {
      usage(argv[0]);
    }
    if (strcmp(argv[2], TRACK_A_ARCH) != 0) {
      refuse("capture source architecture does not match native binary");
    }
    if (strcmp(argv[2], argv[3]) == 0) {
      refuse("capture target must differ from source architecture");
    }
    write_capture(argv[2], argv[3], argv[4]);
    printf("CAPTURE_OK source=%s target=%s arch=%s\n", argv[2], argv[3], TRACK_A_ARCH);
    return 0;
  }
  if (strcmp(argv[1], "restore") == 0) {
    if (argc != 3) {
      usage(argv[0]);
    }
    restore_capture(argv[2]);
    return 0;
  }
  usage(argv[0]);
}
