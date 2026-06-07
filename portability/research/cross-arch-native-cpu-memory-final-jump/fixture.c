#include <errno.h>
#include <inttypes.h>
#include <stdint.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef TRACK_A_ARCH
#define TRACK_A_ARCH "unknown"
#endif

struct CapturedState {
  int counter;
  uintptr_t message_ptr;
  char message[64];
};

static void die(const char* message) {
  fprintf(stderr, "ERROR: %s\n", message);
  exit(2);
}

static void refuse(const char* reason) {
  fprintf(stderr, "REFUSED: %s\n", reason);
  exit(10);
}

int continue_from_safepoint(struct CapturedState* state) {
  state->counter += 1;
  printf("%s:%d\n", (const char*)state->message_ptr, state->counter);
  return state->counter;
}

static uintptr_t current_stack_pointer(void) {
  uintptr_t stack_pointer = 0;
#if defined(__x86_64__)
  __asm__ volatile("mov %%rsp, %0" : "=r"(stack_pointer));
#elif defined(__aarch64__)
  __asm__ volatile("mov %0, sp" : "=r"(stack_pointer));
#else
#error unsupported architecture
#endif
  return stack_pointer;
}

static uintptr_t capture_argument_register(uintptr_t value) {
#if defined(__x86_64__)
  register uintptr_t argument asm("rdi") = value;
  __asm__ volatile("" : "+D"(argument));
  return argument;
#elif defined(__aarch64__)
  register uintptr_t argument asm("x0") = value;
  __asm__ volatile("" : "+r"(argument));
  return argument;
#else
#error unsupported architecture
#endif
}

static int final_jump_to_target(void* entry, void* argument, void* stack_top) {
  int result = -1;
#if defined(__x86_64__)
  __asm__ volatile(
    "mov %%rsp, %%r12\n"
    "mov %[stack_top], %%rsp\n"
    "and $-16, %%rsp\n"
    "mov %[argument], %%rdi\n"
    "call *%[entry]\n"
    "mov %%r12, %%rsp\n"
    : "=a"(result)
    : [entry] "r"(entry), [argument] "r"(argument), [stack_top] "r"(stack_top)
    : "rdi", "r12", "memory", "cc");
#elif defined(__aarch64__)
  __asm__ volatile(
    "mov x19, sp\n"
    "mov sp, %[stack_top]\n"
    "mov x0, %[argument]\n"
    "blr %[entry]\n"
    "mov %w[result], w0\n"
    "mov sp, x19\n"
    : [result] "=r"(result)
    : [entry] "r"(entry), [argument] "r"(argument), [stack_top] "r"(stack_top)
    : "x0", "x19", "memory", "cc");
#else
#error unsupported architecture
#endif
  return result;
}

static void write_hex(FILE* file, const unsigned char* bytes, size_t size) {
  static const char digits[] = "0123456789abcdef";
  for (size_t index = 0; index < size; index += 1) {
    fputc(digits[bytes[index] >> 4], file);
    fputc(digits[bytes[index] & 0x0f], file);
  }
}

static void write_capture(const char* source_arch, const char* target_arch, const char* path) {
  struct CapturedState* state = calloc(1, sizeof(*state));
  if (state == NULL) {
    die("failed to allocate captured heap state");
  }
  state->counter = 41;
  memcpy(state->message, "hello", sizeof("hello"));
  state->message_ptr = (uintptr_t)&state->message[0];

  uintptr_t source_heap_base = (uintptr_t)state;
  uintptr_t source_message = (uintptr_t)&state->message[0];
  uintptr_t source_sp = current_stack_pointer();
  uintptr_t source_arg0 = capture_argument_register(source_heap_base);
  uintptr_t source_pc = 0;
  goto capture_safe_point;

capture_safe_point:
  source_pc = (uintptr_t)&&capture_safe_point;

  FILE* file = fopen(path, "wb");
  if (file == NULL) {
    perror("fopen");
    exit(2);
  }
  fprintf(file, "{\n");
  fprintf(file, "  \"kind\": \"machinen.research.track-a.cpu-memory-final-jump-ir\",\n");
  fprintf(file, "  \"version\": 1,\n");
  fprintf(file, "  \"sourceArch\": \"%s\",\n", source_arch);
  fprintf(file, "  \"targetArch\": \"%s\",\n", target_arch);
  fprintf(file, "  \"safePoint\": \"captured_state_ready\",\n");
  fprintf(file, "  \"entrySymbol\": \"continue_from_safepoint\",\n");
  fprintf(file, "  \"sourceCpu\": {\n");
  fprintf(file, "    \"pc\": \"0x%" PRIxPTR "\",\n", source_pc);
  fprintf(file, "    \"sp\": \"0x%" PRIxPTR "\",\n", source_sp);
  fprintf(file, "    \"arg0\": \"0x%" PRIxPTR "\"\n", source_arg0);
  fprintf(file, "  },\n");
  fprintf(file, "  \"targetCpuPlan\": {\n");
  fprintf(file, "    \"pcSymbol\": \"continue_from_safepoint\",\n");
  fprintf(file, "    \"argumentRegister\": \"%s\",\n", strcmp(target_arch, "amd64") == 0 ? "rdi" : "x0");
  fprintf(file, "    \"stackBytes\": 65536\n");
  fprintf(file, "  },\n");
  fprintf(file, "  \"memory\": {\n");
  fprintf(file, "    \"regionId\": \"heap:captured-state\",\n");
  fprintf(file, "    \"sourceBase\": \"0x%" PRIxPTR "\",\n", source_heap_base);
  fprintf(file, "    \"sizeBytes\": %zu,\n", sizeof(*state));
  fprintf(file, "    \"bytesHex\": \"");
  write_hex(file, (const unsigned char*)state, sizeof(*state));
  fprintf(file, "\",\n");
  fprintf(file, "    \"relocationOffset\": %zu,\n", offsetof(struct CapturedState, message_ptr));
  fprintf(file, "    \"sourcePointer\": \"0x%" PRIxPTR "\",\n", source_message);
  fprintf(file, "    \"targetOffset\": %zu\n", offsetof(struct CapturedState, message));
  fprintf(file, "  },\n");
  fprintf(file, "  \"claimGuard\": {\n");
  fprintf(file, "    \"arbitraryProcessRestoreClaimed\": false,\n");
  fprintf(file, "    \"rawVmReplayUsed\": false,\n");
  fprintf(file, "    \"sourceIsaEmulationUsed\": false,\n");
  fprintf(file, "    \"metadataOnlySuccess\": false\n");
  fprintf(file, "  }\n");
  fprintf(file, "}\n");
  fclose(file);
  printf(
    "CAPTURE_OK source=%s target=%s pc=0x%" PRIxPTR " sp=0x%" PRIxPTR " arg0=0x%" PRIxPTR " heap=0x%" PRIxPTR "\n",
    source_arch,
    target_arch,
    source_pc,
    source_sp,
    source_arg0,
    source_heap_base);
  free(state);
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

static int json_size(const char* json, const char* key, size_t* output) {
  const char* value = find_key_value(json, key);
  if (value == NULL) {
    return 0;
  }
  while (*value == ' ' || *value == '\n' || *value == '\t') {
    value += 1;
  }
  char* end = NULL;
  errno = 0;
  unsigned long long parsed = strtoull(value, &end, 10);
  if (errno != 0 || end == value) {
    return 0;
  }
  *output = (size_t)parsed;
  return 1;
}

static int parse_hex_u64(const char* text, uint64_t* output) {
  const char* value = text;
  if (value[0] == '0' && (value[1] == 'x' || value[1] == 'X')) {
    value += 2;
  }
  char* end = NULL;
  errno = 0;
  unsigned long long parsed = strtoull(value, &end, 16);
  if (errno != 0 || end == value || *end != '\0') {
    return 0;
  }
  *output = (uint64_t)parsed;
  return 1;
}

static int json_hex_u64(const char* json, const char* key, uint64_t* output) {
  char text[64];
  if (!json_string(json, key, text, sizeof(text))) {
    return 0;
  }
  return parse_hex_u64(text, output);
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

static int hex_nibble(char value) {
  if (value >= '0' && value <= '9') {
    return value - '0';
  }
  if (value >= 'a' && value <= 'f') {
    return value - 'a' + 10;
  }
  if (value >= 'A' && value <= 'F') {
    return value - 'A' + 10;
  }
  return -1;
}

static void decode_hex(const char* hex, unsigned char* bytes, size_t size) {
  if (strlen(hex) != size * 2) {
    refuse("memory region hex length does not match declared size");
  }
  for (size_t index = 0; index < size; index += 1) {
    int high = hex_nibble(hex[index * 2]);
    int low = hex_nibble(hex[index * 2 + 1]);
    if (high < 0 || low < 0) {
      refuse("memory region contains non-hex data");
    }
    bytes[index] = (unsigned char)((high << 4) | low);
  }
}

static void put_u64_le(unsigned char* bytes, uint64_t value) {
  for (size_t index = 0; index < sizeof(uint64_t); index += 1) {
    bytes[index] = (unsigned char)((value >> (index * 8)) & 0xffu);
  }
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
  char bytes_hex[512];
  uint64_t source_pc = 0;
  uint64_t source_sp = 0;
  uint64_t source_arg0 = 0;
  uint64_t source_base = 0;
  uint64_t source_pointer = 0;
  size_t size_bytes = 0;
  size_t relocation_offset = 0;
  size_t target_offset = 0;

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
  if (!json_string(json, "bytesHex", bytes_hex, sizeof(bytes_hex))) {
    refuse("missing memory bytes");
  }
  if (!json_hex_u64(json, "pc", &source_pc) || !json_hex_u64(json, "sp", &source_sp) || !json_hex_u64(json, "arg0", &source_arg0)) {
    refuse("missing source CPU register capture");
  }
  if (!json_hex_u64(json, "sourceBase", &source_base) || !json_hex_u64(json, "sourcePointer", &source_pointer)) {
    refuse("missing source memory addresses");
  }
  if (!json_size(json, "sizeBytes", &size_bytes) || !json_size(json, "relocationOffset", &relocation_offset) || !json_size(json, "targetOffset", &target_offset)) {
    refuse("missing memory relocation plan");
  }

  if (strcmp(target_arch, TRACK_A_ARCH) != 0) {
    refuse("IR target architecture does not match target-native binary");
  }
  if (strcmp(source_arch, target_arch) == 0) {
    refuse("source and target architectures must differ");
  }
  if (strcmp(safe_point, "captured_state_ready") != 0) {
    refuse("safe point is not declared for this fixture");
  }
  if (strcmp(entry_symbol, "continue_from_safepoint") != 0) {
    refuse("entry symbol is not supported by this target binary");
  }
  if (source_pc == 0 || source_sp == 0 || source_arg0 != source_base) {
    refuse("source CPU register capture is inconsistent");
  }
  if (size_bytes != sizeof(struct CapturedState)) {
    refuse("memory region size does not match target struct layout");
  }
  if (relocation_offset + sizeof(uint64_t) > size_bytes || target_offset >= size_bytes) {
    refuse("pointer relocation is outside declared memory");
  }
  if (source_pointer < source_base || source_pointer >= source_base + size_bytes) {
    refuse("source pointer is outside declared memory");
  }

  require_false_guard(json, "arbitraryProcessRestoreClaimed");
  require_false_guard(json, "rawVmReplayUsed");
  require_false_guard(json, "sourceIsaEmulationUsed");
  require_false_guard(json, "metadataOnlySuccess");
  if (json_has_true(json, "activeSyscall") || json_has_true(json, "hasThreads") || json_has_true(json, "hasSocket")) {
    refuse("unsupported live kernel/runtime state is present");
  }

  unsigned char* target_heap = calloc(1, size_bytes);
  if (target_heap == NULL) {
    die("failed to allocate target heap");
  }
  decode_hex(bytes_hex, target_heap, size_bytes);

  uintptr_t target_base = (uintptr_t)target_heap;
  uintptr_t target_pointer = target_base + (uintptr_t)(source_pointer - source_base);
  uintptr_t expected_pointer = target_base + target_offset;
  if (target_pointer != expected_pointer) {
    refuse("pointer relocation table does not match source pointer offset");
  }
  put_u64_le(target_heap + relocation_offset, (uint64_t)target_pointer);

  unsigned char* target_stack = calloc(1, 65536);
  if (target_stack == NULL) {
    die("failed to allocate target stack");
  }
  uintptr_t target_sp = ((uintptr_t)target_stack + 65536u) & ~(uintptr_t)0xfu;
  int result = final_jump_to_target((void*)&continue_from_safepoint, (void*)target_heap, (void*)target_sp);
  struct CapturedState* restored = (struct CapturedState*)target_heap;
  if (result != 42 || restored->counter != 42 || strcmp((const char*)restored->message_ptr, "hello") != 0) {
    refuse("target-native final jump produced the wrong reconstructed state");
  }

  printf(
    "FINAL_JUMP_OK source=%s target=%s sourcePc=0x%" PRIx64 " sourceSp=0x%" PRIx64 " targetEntry=%p targetSp=0x%" PRIxPTR " relocatedPointer=%p result=%d\n",
    source_arch,
    target_arch,
    source_pc,
    source_sp,
    (void*)&continue_from_safepoint,
    target_sp,
    (void*)target_pointer,
    result);
  free(target_stack);
  free(target_heap);
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
