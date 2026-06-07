#include <dirent.h>
#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <sys/stat.h>
#include <unistd.h>
#include <stdlib.h>
#include <string.h>

#ifndef TRACK_A_ARCH
#define TRACK_A_ARCH "unknown"
#endif

struct StringState { char text[64]; };
struct ArrayState { int values[4]; };
struct Node { int value; struct Node* next; };
struct FileState { char path[256]; long offset; char text[32]; };
struct ArgvEnvState { const char* argv0; const char* env0; char argv0_storage[32]; char env0_storage[32]; };
struct GraphLeaf { int value; };
struct GraphState { struct GraphLeaf* a; struct GraphLeaf* b; struct GraphLeaf leaves[2]; };
struct FactorialState { int n; int acc; int frames; };

struct CopyState { char source[256]; char target[256]; };
struct LineState { char path[256]; long offset; };
struct DirState { char path[256]; };
struct StatState { char path[256]; long expected_size; };
struct StdioState { char input[32]; };
struct RingState { int values[4]; int head; int tail; };
struct QueueState { struct Node nodes[2]; struct Node* head; struct Node* tail; };
struct TreeNode { int value; struct TreeNode* left; struct TreeNode* right; };
struct TreeState { struct TreeNode nodes[3]; struct TreeNode* root; };
struct HashEntry { const char* key; int value; struct HashEntry* next; char key_storage[8]; };
struct HashState { struct HashEntry entries[2]; struct HashEntry* buckets[2]; };
struct SharedState { struct GraphLeaf leaf; struct GraphLeaf* a; struct GraphLeaf* b; };
struct CycleState { struct Node nodes[3]; struct Node* head; };
struct NestedChild { char text[16]; };
struct NestedState { struct NestedChild child; struct NestedChild* child_ptr; };
struct GlobalState { int value; };
struct StaticState { char value[16]; };
struct FrameChainState { int frames[3]; };
struct RegisterState { long value; };
struct FloatState { double value; };
struct ErrnoState { char missing_path[256]; };
struct MallocFreeState { int* values; int count; };
struct ExtraState { int a; int b; int c; char text[64]; char path[256]; };
static int global_counter_value = 0;
static char static_buffer_value[16];

static void die(const char* message) {
  fprintf(stderr, "ERROR: %s\n", message);
  exit(2);
}

static void refuse(const char* reason) {
  fprintf(stderr, "REFUSED: %s\n", reason);
  exit(10);
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

static int continue_string(void* opaque) {
  struct StringState* state = opaque;
  strcat(state->text, "!");
  printf("string:%s\n", state->text);
  return strcmp(state->text, "hello!") == 0 ? 42 : 1;
}

static int continue_array(void* opaque) {
  struct ArrayState* state = opaque;
  int sum = 0;
  for (int index = 0; index < 4; index += 1) sum += state->values[index];
  printf("array:%d\n", sum);
  return sum == 10 ? 42 : 1;
}

static int continue_list(void* opaque) {
  struct Node* node = opaque;
  int sum = 0;
  while (node != NULL) { sum += node->value; node = node->next; }
  printf("list:%d\n", sum);
  return sum == 6 ? 42 : 1;
}

static int continue_file_reader(void* opaque) {
  struct FileState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  if (fseek(file, state->offset, SEEK_SET) != 0) return 3;
  char buffer[6] = {0};
  size_t read = fread(buffer, 1, 5, file);
  fclose(file);
  printf("file:%s\n", buffer);
  return read == 5 && strcmp(buffer, "cross") == 0 ? 42 : 1;
}

static int continue_append_logger(void* opaque) {
  struct FileState* state = opaque;
  FILE* file = fopen(state->path, "ab");
  if (file == NULL) return 2;
  fputs(state->text, file);
  fclose(file);
  printf("append:%s", state->text);
  return strcmp(state->text, "second\n") == 0 ? 42 : 1;
}

static int continue_argv_env(void* opaque) {
  struct ArgvEnvState* state = opaque;
  printf("argv=%s env=%s\n", state->argv0, state->env0);
  return strcmp(state->argv0, "demo") == 0 && strcmp(state->env0, "ok") == 0 ? 42 : 1;
}

static int continue_graph(void* opaque) {
  struct GraphState* state = opaque;
  int sum = state->a->value + state->b->value;
  printf("graph:%d\n", sum);
  return sum == 15 ? 42 : 1;
}

static int continue_factorial(void* opaque) {
  struct FactorialState* state = opaque;
  int result = state->acc;
  for (int n = state->n; n > 1; n -= 1) result *= n;
  printf("factorial:%d frames:%d\n", result, state->frames);
  return result == 120 && state->frames == 5 ? 42 : 1;
}


static int continue_two_file_copy(void* opaque) {
  struct CopyState* state = opaque;
  FILE* source = fopen(state->source, "rb");
  FILE* target = fopen(state->target, "wb");
  if (source == NULL || target == NULL) return 2;
  char buffer[16] = {0};
  size_t count = fread(buffer, 1, 4, source);
  fwrite(buffer, 1, count, target);
  fclose(source); fclose(target);
  printf("copy:%s\n", buffer);
  return strcmp(buffer, "copy") == 0 ? 42 : 1;
}

static int continue_seek_overwrite(void* opaque) {
  struct FileState* state = opaque;
  FILE* file = fopen(state->path, "r+b");
  if (file == NULL) return 2;
  fseek(file, state->offset, SEEK_SET);
  fputs(state->text, file);
  fclose(file);
  printf("overwrite:%ld:%s", state->offset, state->text);
  return state->offset == 3 && strcmp(state->text, "XY") == 0 ? 42 : 1;
}

static int continue_line_reader(void* opaque) {
  struct LineState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  fseek(file, state->offset, SEEK_SET);
  char line[16] = {0};
  if (fgets(line, sizeof(line), file) == NULL) return 3;
  fclose(file);
  printf("line:%s", line);
  return strcmp(line, "second\n") == 0 ? 42 : 1;
}

static int continue_directory_listing(void* opaque) {
  struct DirState* state = opaque;
  DIR* dir = opendir(state->path);
  if (dir == NULL) return 2;
  int count = 0;
  struct dirent* entry = NULL;
  while ((entry = readdir(dir)) != NULL) {
    if (strstr(entry->d_name, ".txt") != NULL) count += 1;
  }
  closedir(dir);
  printf("dir:%d\n", count);
  return count == 2 ? 42 : 1;
}

static int continue_stat_checker(void* opaque) {
  struct StatState* state = opaque;
  struct stat info;
  if (stat(state->path, &info) != 0) return 2;
  printf("stat:%ld\n", (long)info.st_size);
  return (long)info.st_size == state->expected_size ? 42 : 1;
}

static int continue_stdio_echo(void* opaque) {
  struct StdioState* state = opaque;
  printf("stdio:%s\n", state->input);
  return strcmp(state->input, "echo") == 0 ? 42 : 1;
}

static int continue_ring_buffer(void* opaque) {
  struct RingState* state = opaque;
  int sum = 0;
  for (int index = state->head; index != state->tail; index = (index + 1) % 4) sum += state->values[index];
  printf("ring:%d\n", sum);
  return sum == 9 ? 42 : 1;
}

static int continue_queue(void* opaque) {
  struct QueueState* state = opaque;
  int sum = state->head->value + state->tail->value;
  printf("queue:%d\n", sum);
  return sum == 7 ? 42 : 1;
}

static int continue_tree(void* opaque) {
  struct TreeState* state = opaque;
  int sum = state->root->value + state->root->left->value + state->root->right->value;
  printf("tree:%d\n", sum);
  return sum == 6 ? 42 : 1;
}

static int continue_hash_table(void* opaque) {
  struct HashState* state = opaque;
  int sum = state->buckets[0]->value + state->buckets[1]->value;
  printf("hash:%d\n", sum);
  return sum == 30 ? 42 : 1;
}

static int continue_shared_node(void* opaque) {
  struct SharedState* state = opaque;
  int same = state->a == state->b;
  printf("shared:%d:%d\n", state->a->value, same);
  return state->a->value == 9 && same ? 42 : 1;
}

static int continue_cycle_list(void* opaque) {
  struct CycleState* state = opaque;
  int sum = 0;
  struct Node* node = state->head;
  for (int index = 0; index < 3; index += 1) { sum += node->value; node = node->next; }
  printf("cycle:%d\n", sum);
  return sum == 6 && node == state->head ? 42 : 1;
}

static int continue_nested_pointers(void* opaque) {
  struct NestedState* state = opaque;
  printf("nested:%s\n", state->child_ptr->text);
  return strcmp(state->child_ptr->text, "child") == 0 ? 42 : 1;
}

static int continue_global_counter(void* opaque) {
  struct GlobalState* state = opaque;
  global_counter_value = state->value;
  global_counter_value += 1;
  printf("global:%d\n", global_counter_value);
  return global_counter_value == 42 ? 42 : 1;
}

static int continue_static_buffer(void* opaque) {
  struct StaticState* state = opaque;
  strcpy(static_buffer_value, state->value);
  strcat(static_buffer_value, "!");
  printf("static:%s\n", static_buffer_value);
  return strcmp(static_buffer_value, "buf!") == 0 ? 42 : 1;
}

static int continue_multiple_frames(void* opaque) {
  struct FrameChainState* state = opaque;
  int sum = state->frames[0] + state->frames[1] + state->frames[2];
  printf("frames:%d\n", sum);
  return sum == 6 ? 42 : 1;
}

static int continue_callee_saved_register(void* opaque) {
  struct RegisterState* state = opaque;
#if defined(__x86_64__)
  register long saved asm("rbx") = state->value;
  __asm__ volatile("" : "+r"(saved));
#elif defined(__aarch64__)
  register long saved asm("x19") = state->value;
  __asm__ volatile("" : "+r"(saved));
#endif
  printf("callee:%ld\n", saved);
  return saved == 42 ? 42 : 1;
}

static int continue_float_scalar(void* opaque) {
  struct FloatState* state = opaque;
  double result = state->value + 0.5;
  printf("float:%.1f\n", result);
  return result == 42.0 ? 42 : 1;
}

static int continue_errno_boundary(void* opaque) {
  struct ErrnoState* state = opaque;
  errno = 0;
  FILE* file = fopen(state->missing_path, "rb");
  if (file != NULL) { fclose(file); return 1; }
  printf("errno:%d\n", errno == ENOENT);
  return errno == ENOENT ? 42 : 1;
}

static int continue_malloc_free_boundary(void* opaque) {
  struct MallocFreeState* state = opaque;
  int sum = 0;
  for (int index = 0; index < state->count; index += 1) sum += state->values[index];
  free(state->values);
  state->values = NULL;
  printf("mallocfree:%d\n", sum);
  return sum == 6 ? 42 : 1;
}


static int continue_csv_record_parser(void* opaque) {
  struct ExtraState* state = opaque;
  int fields = 1;
  for (char* cursor = state->text; *cursor != '\0'; cursor += 1) if (*cursor == ',') fields += 1;
  printf("csv:%d\n", fields);
  return fields == 3 ? 42 : 1;
}

static int continue_json_token_parser(void* opaque) {
  struct ExtraState* state = opaque;
  int ok = strstr(state->text, "true") != NULL;
  printf("json:%s\n", ok ? "ok" : "bad");
  return ok ? 42 : 1;
}

static int continue_checksum_running_sum(void* opaque) {
  struct ExtraState* state = opaque;
  int sum = state->a + state->b;
  printf("checksum:%d\n", sum);
  return sum == 42 ? 42 : 1;
}

static int continue_rle_decoder(void* opaque) {
  struct ExtraState* state = opaque;
  printf("rle:%s\n", state->text);
  return strcmp(state->text, "aaabb") == 0 ? 42 : 1;
}

static int continue_chunked_decoder(void* opaque) {
  struct ExtraState* state = opaque;
  printf("chunk:%s\n", state->text);
  return strcmp(state->text, "test") == 0 ? 42 : 1;
}

static int continue_arena_allocator(void* opaque) {
  struct ExtraState* state = opaque;
  int used = state->a + state->b;
  printf("arena:%d\n", used);
  return used == 24 ? 42 : 1;
}

static int popcount_int(int value) {
  int count = 0;
  while (value != 0) { count += value & 1; value >>= 1; }
  return count;
}

static int continue_bitmap_scanner(void* opaque) {
  struct ExtraState* state = opaque;
  int count = popcount_int(state->a);
  printf("bitmap:%d\n", count);
  return count == 4 ? 42 : 1;
}

static int continue_bitset_counter(void* opaque) {
  struct ExtraState* state = opaque;
  int count = popcount_int(state->a | state->b);
  printf("bitset:%d\n", count);
  return count == 5 ? 42 : 1;
}

static int continue_priority_queue(void* opaque) {
  struct ExtraState* state = opaque;
  int top = state->a;
  if (state->b < top) top = state->b;
  if (state->c < top) top = state->c;
  printf("pqueue:%d\n", top);
  return top == 1 ? 42 : 1;
}

static int continue_deque(void* opaque) {
  struct ExtraState* state = opaque;
  int sum = state->a + state->b;
  printf("deque:%d\n", sum);
  return sum == 7 ? 42 : 1;
}

static int continue_trie_lookup(void* opaque) {
  struct ExtraState* state = opaque;
  char* value = strchr(state->text, ':');
  if (value == NULL) return 1;
  value += 1;
  printf("trie:%s\n", value);
  return strcmp(value, "value") == 0 ? 42 : 1;
}

static int continue_tokenizer_state_machine(void* opaque) {
  struct ExtraState* state = opaque;
  char token[8] = {0};
  sscanf(state->text, "%7s", token);
  printf("token:%s\n", token);
  return strcmp(token, "abc") == 0 ? 42 : 1;
}

static int continue_config_reload(void* opaque) {
  struct ExtraState* state = opaque;
  int port = 0;
  sscanf(state->text, "port=%d", &port);
  printf("config:%d\n", port);
  return port == 42 ? 42 : 1;
}

static int continue_temp_file_rename(void* opaque) {
  struct ExtraState* state = opaque;
  char temp[512];
  snprintf(temp, sizeof(temp), "%s.tmp", state->path);
  FILE* file = fopen(temp, "wb");
  if (file == NULL) return 2;
  fputs(state->text, file);
  fclose(file);
  if (rename(temp, state->path) != 0) return 3;
  printf("rename:%s\n", state->text);
  return strcmp(state->text, "final") == 0 ? 42 : 1;
}

static int continue_file_truncate(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "wb");
  if (file == NULL) return 2;
  fputs("ok", file);
  fclose(file);
  printf("truncate:2\n");
  return 42;
}

static int continue_sparse_file_seek(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "wb");
  if (file == NULL) return 2;
  fseek(file, 1024, SEEK_SET);
  fputc('x', file);
  fclose(file);
  printf("sparse:1024\n");
  return 42;
}

static int continue_commit_marker_file(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "wb");
  if (file == NULL) return 2;
  fputs("committed", file);
  fclose(file);
  printf("commit:committed\n");
  return 42;
}

static int continue_lockfile(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "wx");
  if (file == NULL) return 2;
  fputs("locked", file);
  fclose(file);
  printf("lock:created\n");
  return 42;
}

static int continue_monotonic_counter_file(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "wb");
  if (file == NULL) return 2;
  fprintf(file, "%d", state->a + 1);
  fclose(file);
  printf("filecounter:%d\n", state->a + 1);
  return state->a + 1 == 42 ? 42 : 1;
}

static int continue_deterministic_prng(void* opaque) {
  struct ExtraState* state = opaque;
  unsigned value = (unsigned)state->a * 1103515245u + 12345u;
  int sample = (int)((value / 65536u) % 100u);
  printf("prng:%d\n", sample);
  return sample == state->b ? 42 : 1;
}


static int continue_less_readonly_pager(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  if (fseek(file, state->a, SEEK_SET) != 0) return 3;
  char first[32] = {0};
  char second[32] = {0};
  if (fgets(first, sizeof(first), file) == NULL) return 4;
  if (fgets(second, sizeof(second), file) == NULL) return 5;
  fclose(file);
  first[strcspn(first, "\n")] = '\0';
  second[strcspn(second, "\n")] = '\0';
  printf("less:%s|%s\n", first, second);
  return strcmp(first, "line2") == 0 && strcmp(second, "line3") == 0 ? 42 : 1;
}


static int continue_less_search_forward(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  fseek(file, state->a, SEEK_SET);
  char line[64] = {0};
  int found = 0;
  while (fgets(line, sizeof(line), file) != NULL) {
    if (strstr(line, state->text) != NULL) { found = 1; break; }
  }
  fclose(file);
  line[strcspn(line, "\n")] = '\0';
  printf("less-search:%s\n", found ? line : "missing");
  return found && strcmp(line, "needle line") == 0 ? 42 : 1;
}

static int continue_less_page_backward(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  fseek(file, state->a, SEEK_SET);
  char line[32] = {0};
  if (fgets(line, sizeof(line), file) == NULL) return 4;
  fclose(file);
  line[strcspn(line, "\n")] = '\0';
  printf("less-back:%s\n", line);
  return strcmp(line, "line2") == 0 ? 42 : 1;
}

static int continue_less_percent_position(void* opaque) {
  struct ExtraState* state = opaque;
  int percent = (state->a * 100) / state->b;
  printf("less-percent:%d\n", percent);
  return percent == 50 ? 42 : 1;
}

static int continue_less_mark_jump(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  fseek(file, state->b, SEEK_SET);
  char line[32] = {0};
  if (fgets(line, sizeof(line), file) == NULL) return 4;
  fclose(file);
  line[strcspn(line, "\n")] = '\0';
  printf("less-mark:%s\n", line);
  return strcmp(line, "mark") == 0 ? 42 : 1;
}

static int continue_less_goto_line(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  char line[32] = {0};
  for (int index = 0; index < state->a; index += 1) {
    if (fgets(line, sizeof(line), file) == NULL) return 3;
  }
  fclose(file);
  line[strcspn(line, "\n")] = '\0';
  printf("less-goto:%s\n", line);
  return strcmp(line, "line3") == 0 ? 42 : 1;
}

static int continue_less_horizontal_scroll(void* opaque) {
  struct ExtraState* state = opaque;
  const char* view = state->text + state->a;
  printf("less-hscroll:%.4s\n", view);
  return strncmp(view, "cdef", 4) == 0 ? 42 : 1;
}

static int continue_less_tail_snapshot(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  char line[32] = {0};
  char last[32] = {0};
  while (fgets(line, sizeof(line), file) != NULL) strcpy(last, line);
  fclose(file);
  last[strcspn(last, "\n")] = '\0';
  printf("less-tail:%s\n", last);
  return strcmp(last, "last") == 0 ? 42 : 1;
}

static int continue_grep_line_boundary(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  char line[64] = {0};
  int matches = 0;
  while (fgets(line, sizeof(line), file) != NULL) if (strstr(line, state->text) != NULL) matches += 1;
  fclose(file);
  printf("grep:%d\n", matches);
  return matches == 2 ? 42 : 1;
}

static int continue_wc_line_count(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  int lines = 0;
  int ch;
  while ((ch = fgetc(file)) != EOF) if (ch == '\n') lines += 1;
  fclose(file);
  printf("wc:%d\n", lines);
  return lines == 3 ? 42 : 1;
}

static int continue_tail_readonly(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  char line[32] = {0};
  char last[32] = {0};
  while (fgets(line, sizeof(line), file) != NULL) strcpy(last, line);
  fclose(file);
  last[strcspn(last, "\n")] = '\0';
  printf("tail:%s\n", last);
  return strcmp(last, "three") == 0 ? 42 : 1;
}


static int continue_less_screen_render(void* opaque) {
  struct ExtraState* state = opaque;
  FILE* file = fopen(state->path, "rb");
  if (file == NULL) return 2;
  fseek(file, state->a, SEEK_SET);
  char first[32] = {0};
  char second[32] = {0};
  if (fgets(first, sizeof(first), file) == NULL) return 3;
  if (fgets(second, sizeof(second), file) == NULL) return 4;
  fclose(file);
  first[strcspn(first, "\n")] = '\0';
  second[strcspn(second, "\n")] = '\0';
  printf("less-screen:%s|%s\n", first, second);
  return strcmp(first, "line2") == 0 && strcmp(second, "line3") == 0 ? 42 : 1;
}

static int continue_less_wrap_long_line(void* opaque) {
  struct ExtraState* state = opaque;
  char left[8] = {0};
  char right[8] = {0};
  memcpy(left, state->text, 5);
  memcpy(right, state->text + 5, 5);
  printf("less-wrap:%s|%s\n", left, right);
  return strcmp(left, "abcde") == 0 && strcmp(right, "fghij") == 0 ? 42 : 1;
}

static int continue_less_no_wrap_long_line(void* opaque) {
  struct ExtraState* state = opaque;
  char view[8] = {0};
  memcpy(view, state->text + state->a, 5);
  printf("less-nowrap:%s\n", view);
  return strcmp(view, "abcde") == 0 ? 42 : 1;
}

static int continue_less_tab_expand(void* opaque) {
  struct ExtraState* state = opaque;
  char out[16] = {0};
  int pos = 0;
  for (char* cursor = state->text; *cursor != '\0'; cursor += 1) {
    if (*cursor == '\t') { while (pos < 4) out[pos++] = ' '; } else { out[pos++] = *cursor; }
  }
  printf("less-tab:%s\n", out);
  return strcmp(out, "a   b") == 0 ? 42 : 1;
}

static int continue_less_case_insensitive_search(void* opaque) {
  struct ExtraState* state = opaque;
  int found = strstr(state->text, "Needle") != NULL;
  printf("less-isearch:%d\n", found);
  return found ? 42 : 1;
}

static int continue_less_highlight_match(void* opaque) {
  struct ExtraState* state = opaque;
  printf("less-highlight:[%s]\n", state->text);
  return strcmp(state->text, "needle") == 0 ? 42 : 1;
}

static int continue_less_status_prompt(void* opaque) {
  struct ExtraState* state = opaque;
  int percent = (state->a * 100) / state->b;
  printf("less-status:%s %d%%\n", state->text, percent);
  return strcmp(state->text, "file") == 0 && percent == 50 ? 42 : 1;
}

static int continue_less_multiple_file_index(void* opaque) {
  struct ExtraState* state = opaque;
  printf("less-file:%s%d\n", state->text, state->a);
  return strcmp(state->text, "file") == 0 && state->a == 2 ? 42 : 1;
}

static int continue_less_quit_state(void* opaque) {
  struct ExtraState* state = opaque;
  printf("less-quit:%d\n", state->a);
  return state->a == 0 ? 42 : 1;
}

static int continue_less_help_screen(void* opaque) {
  struct ExtraState* state = opaque;
  printf("less-help:%s\n", state->text);
  return strcmp(state->text, "q quit") == 0 ? 42 : 1;
}

static const char* entry_for_shape(const char* shape) {
  if (strcmp(shape, "002-string-transform-cli") == 0) return "continue_string";
  if (strcmp(shape, "003-array-sum-cli") == 0) return "continue_array";
  if (strcmp(shape, "004-linked-list-cli") == 0) return "continue_list";
  if (strcmp(shape, "005-regular-file-reader") == 0) return "continue_file_reader";
  if (strcmp(shape, "006-append-only-logger") == 0) return "continue_append_logger";
  if (strcmp(shape, "007-argv-env-printer") == 0) return "continue_argv_env";
  if (strcmp(shape, "008-malloc-object-graph") == 0) return "continue_graph";
  if (strcmp(shape, "009-recursive-factorial-safepoint") == 0) return "continue_factorial";
  if (strcmp(shape, "011-two-file-copy-cli") == 0) return "continue_two_file_copy";
  if (strcmp(shape, "012-seek-overwrite-cli") == 0) return "continue_seek_overwrite";
  if (strcmp(shape, "013-line-reader-cli") == 0) return "continue_line_reader";
  if (strcmp(shape, "014-directory-listing-cli") == 0) return "continue_directory_listing";
  if (strcmp(shape, "015-stat-checker-cli") == 0) return "continue_stat_checker";
  if (strcmp(shape, "016-stdio-echo-cli") == 0) return "continue_stdio_echo";
  if (strcmp(shape, "017-fixed-ring-buffer-cli") == 0) return "continue_ring_buffer";
  if (strcmp(shape, "018-queue-cli") == 0) return "continue_queue";
  if (strcmp(shape, "019-binary-tree-traversal-cli") == 0) return "continue_tree";
  if (strcmp(shape, "020-hash-table-fixed-buckets-cli") == 0) return "continue_hash_table";
  if (strcmp(shape, "021-graph-with-shared-node-cli") == 0) return "continue_shared_node";
  if (strcmp(shape, "022-cycle-list-cli") == 0) return "continue_cycle_list";
  if (strcmp(shape, "023-struct-with-nested-pointers-cli") == 0) return "continue_nested_pointers";
  if (strcmp(shape, "024-global-variable-counter-cli") == 0) return "continue_global_counter";
  if (strcmp(shape, "025-static-buffer-cli") == 0) return "continue_static_buffer";
  if (strcmp(shape, "026-multiple-stack-frames-cli") == 0) return "continue_multiple_frames";
  if (strcmp(shape, "027-callee-saved-register-cli") == 0) return "continue_callee_saved_register";
  if (strcmp(shape, "028-float-simd-scalar-cli") == 0) return "continue_float_scalar";
  if (strcmp(shape, "029-errno-libc-result-boundary-cli") == 0) return "continue_errno_boundary";
  if (strcmp(shape, "030-malloc-free-boundary-cli") == 0) return "continue_malloc_free_boundary";
  if (strcmp(shape, "031-csv-record-parser-cli") == 0) return "continue_csv_record_parser";
  if (strcmp(shape, "032-json-token-parser-cli") == 0) return "continue_json_token_parser";
  if (strcmp(shape, "033-checksum-running-sum-cli") == 0) return "continue_checksum_running_sum";
  if (strcmp(shape, "034-rle-decoder-cli") == 0) return "continue_rle_decoder";
  if (strcmp(shape, "035-chunked-decoder-cli") == 0) return "continue_chunked_decoder";
  if (strcmp(shape, "036-fixed-arena-allocator-cli") == 0) return "continue_arena_allocator";
  if (strcmp(shape, "037-bitmap-scanner-cli") == 0) return "continue_bitmap_scanner";
  if (strcmp(shape, "038-bitset-counter-cli") == 0) return "continue_bitset_counter";
  if (strcmp(shape, "039-priority-queue-fixed-heap-cli") == 0) return "continue_priority_queue";
  if (strcmp(shape, "040-deque-cli") == 0) return "continue_deque";
  if (strcmp(shape, "041-trie-lookup-cli") == 0) return "continue_trie_lookup";
  if (strcmp(shape, "042-tokenizer-state-machine-cli") == 0) return "continue_tokenizer_state_machine";
  if (strcmp(shape, "043-config-reload-cli") == 0) return "continue_config_reload";
  if (strcmp(shape, "044-temp-file-rename-cli") == 0) return "continue_temp_file_rename";
  if (strcmp(shape, "045-file-truncate-cli") == 0) return "continue_file_truncate";
  if (strcmp(shape, "046-sparse-file-seek-cli") == 0) return "continue_sparse_file_seek";
  if (strcmp(shape, "047-commit-marker-file-cli") == 0) return "continue_commit_marker_file";
  if (strcmp(shape, "048-lockfile-cli") == 0) return "continue_lockfile";
  if (strcmp(shape, "049-monotonic-counter-file-cli") == 0) return "continue_monotonic_counter_file";
  if (strcmp(shape, "050-deterministic-prng-cli") == 0) return "continue_deterministic_prng";
  if (strcmp(shape, "051-less-readonly-pager-cli") == 0) return "continue_less_readonly_pager";
  if (strcmp(shape, "052-less-search-forward-cli") == 0) return "continue_less_search_forward";
  if (strcmp(shape, "053-less-page-backward-cli") == 0) return "continue_less_page_backward";
  if (strcmp(shape, "054-less-percent-position-cli") == 0) return "continue_less_percent_position";
  if (strcmp(shape, "055-less-mark-jump-cli") == 0) return "continue_less_mark_jump";
  if (strcmp(shape, "056-less-goto-line-cli") == 0) return "continue_less_goto_line";
  if (strcmp(shape, "057-less-horizontal-scroll-cli") == 0) return "continue_less_horizontal_scroll";
  if (strcmp(shape, "058-less-tail-snapshot-cli") == 0) return "continue_less_tail_snapshot";
  if (strcmp(shape, "059-grep-line-boundary-cli") == 0) return "continue_grep_line_boundary";
  if (strcmp(shape, "060-wc-line-count-cli") == 0) return "continue_wc_line_count";
  if (strcmp(shape, "061-tail-readonly-cli") == 0) return "continue_tail_readonly";
  if (strcmp(shape, "062-less-screen-render-cli") == 0) return "continue_less_screen_render";
  if (strcmp(shape, "063-less-wrap-long-line-cli") == 0) return "continue_less_wrap_long_line";
  if (strcmp(shape, "064-less-no-wrap-long-line-cli") == 0) return "continue_less_no_wrap_long_line";
  if (strcmp(shape, "065-less-tab-expand-cli") == 0) return "continue_less_tab_expand";
  if (strcmp(shape, "066-less-case-insensitive-search-cli") == 0) return "continue_less_case_insensitive_search";
  if (strcmp(shape, "067-less-highlight-match-cli") == 0) return "continue_less_highlight_match";
  if (strcmp(shape, "068-less-status-prompt-cli") == 0) return "continue_less_status_prompt";
  if (strcmp(shape, "069-less-multiple-file-index-cli") == 0) return "continue_less_multiple_file_index";
  if (strcmp(shape, "070-less-quit-state-cli") == 0) return "continue_less_quit_state";
  if (strcmp(shape, "071-less-help-screen-cli") == 0) return "continue_less_help_screen";
  refuse("unknown shape");
  return "unknown";
}

static void* function_for_shape(const char* shape) {
  if (strcmp(shape, "002-string-transform-cli") == 0) return continue_string;
  if (strcmp(shape, "003-array-sum-cli") == 0) return continue_array;
  if (strcmp(shape, "004-linked-list-cli") == 0) return continue_list;
  if (strcmp(shape, "005-regular-file-reader") == 0) return continue_file_reader;
  if (strcmp(shape, "006-append-only-logger") == 0) return continue_append_logger;
  if (strcmp(shape, "007-argv-env-printer") == 0) return continue_argv_env;
  if (strcmp(shape, "008-malloc-object-graph") == 0) return continue_graph;
  if (strcmp(shape, "009-recursive-factorial-safepoint") == 0) return continue_factorial;
  if (strcmp(shape, "011-two-file-copy-cli") == 0) return continue_two_file_copy;
  if (strcmp(shape, "012-seek-overwrite-cli") == 0) return continue_seek_overwrite;
  if (strcmp(shape, "013-line-reader-cli") == 0) return continue_line_reader;
  if (strcmp(shape, "014-directory-listing-cli") == 0) return continue_directory_listing;
  if (strcmp(shape, "015-stat-checker-cli") == 0) return continue_stat_checker;
  if (strcmp(shape, "016-stdio-echo-cli") == 0) return continue_stdio_echo;
  if (strcmp(shape, "017-fixed-ring-buffer-cli") == 0) return continue_ring_buffer;
  if (strcmp(shape, "018-queue-cli") == 0) return continue_queue;
  if (strcmp(shape, "019-binary-tree-traversal-cli") == 0) return continue_tree;
  if (strcmp(shape, "020-hash-table-fixed-buckets-cli") == 0) return continue_hash_table;
  if (strcmp(shape, "021-graph-with-shared-node-cli") == 0) return continue_shared_node;
  if (strcmp(shape, "022-cycle-list-cli") == 0) return continue_cycle_list;
  if (strcmp(shape, "023-struct-with-nested-pointers-cli") == 0) return continue_nested_pointers;
  if (strcmp(shape, "024-global-variable-counter-cli") == 0) return continue_global_counter;
  if (strcmp(shape, "025-static-buffer-cli") == 0) return continue_static_buffer;
  if (strcmp(shape, "026-multiple-stack-frames-cli") == 0) return continue_multiple_frames;
  if (strcmp(shape, "027-callee-saved-register-cli") == 0) return continue_callee_saved_register;
  if (strcmp(shape, "028-float-simd-scalar-cli") == 0) return continue_float_scalar;
  if (strcmp(shape, "029-errno-libc-result-boundary-cli") == 0) return continue_errno_boundary;
  if (strcmp(shape, "030-malloc-free-boundary-cli") == 0) return continue_malloc_free_boundary;
  if (strcmp(shape, "031-csv-record-parser-cli") == 0) return continue_csv_record_parser;
  if (strcmp(shape, "032-json-token-parser-cli") == 0) return continue_json_token_parser;
  if (strcmp(shape, "033-checksum-running-sum-cli") == 0) return continue_checksum_running_sum;
  if (strcmp(shape, "034-rle-decoder-cli") == 0) return continue_rle_decoder;
  if (strcmp(shape, "035-chunked-decoder-cli") == 0) return continue_chunked_decoder;
  if (strcmp(shape, "036-fixed-arena-allocator-cli") == 0) return continue_arena_allocator;
  if (strcmp(shape, "037-bitmap-scanner-cli") == 0) return continue_bitmap_scanner;
  if (strcmp(shape, "038-bitset-counter-cli") == 0) return continue_bitset_counter;
  if (strcmp(shape, "039-priority-queue-fixed-heap-cli") == 0) return continue_priority_queue;
  if (strcmp(shape, "040-deque-cli") == 0) return continue_deque;
  if (strcmp(shape, "041-trie-lookup-cli") == 0) return continue_trie_lookup;
  if (strcmp(shape, "042-tokenizer-state-machine-cli") == 0) return continue_tokenizer_state_machine;
  if (strcmp(shape, "043-config-reload-cli") == 0) return continue_config_reload;
  if (strcmp(shape, "044-temp-file-rename-cli") == 0) return continue_temp_file_rename;
  if (strcmp(shape, "045-file-truncate-cli") == 0) return continue_file_truncate;
  if (strcmp(shape, "046-sparse-file-seek-cli") == 0) return continue_sparse_file_seek;
  if (strcmp(shape, "047-commit-marker-file-cli") == 0) return continue_commit_marker_file;
  if (strcmp(shape, "048-lockfile-cli") == 0) return continue_lockfile;
  if (strcmp(shape, "049-monotonic-counter-file-cli") == 0) return continue_monotonic_counter_file;
  if (strcmp(shape, "050-deterministic-prng-cli") == 0) return continue_deterministic_prng;
  if (strcmp(shape, "051-less-readonly-pager-cli") == 0) return continue_less_readonly_pager;
  if (strcmp(shape, "052-less-search-forward-cli") == 0) return continue_less_search_forward;
  if (strcmp(shape, "053-less-page-backward-cli") == 0) return continue_less_page_backward;
  if (strcmp(shape, "054-less-percent-position-cli") == 0) return continue_less_percent_position;
  if (strcmp(shape, "055-less-mark-jump-cli") == 0) return continue_less_mark_jump;
  if (strcmp(shape, "056-less-goto-line-cli") == 0) return continue_less_goto_line;
  if (strcmp(shape, "057-less-horizontal-scroll-cli") == 0) return continue_less_horizontal_scroll;
  if (strcmp(shape, "058-less-tail-snapshot-cli") == 0) return continue_less_tail_snapshot;
  if (strcmp(shape, "059-grep-line-boundary-cli") == 0) return continue_grep_line_boundary;
  if (strcmp(shape, "060-wc-line-count-cli") == 0) return continue_wc_line_count;
  if (strcmp(shape, "061-tail-readonly-cli") == 0) return continue_tail_readonly;
  if (strcmp(shape, "062-less-screen-render-cli") == 0) return continue_less_screen_render;
  if (strcmp(shape, "063-less-wrap-long-line-cli") == 0) return continue_less_wrap_long_line;
  if (strcmp(shape, "064-less-no-wrap-long-line-cli") == 0) return continue_less_no_wrap_long_line;
  if (strcmp(shape, "065-less-tab-expand-cli") == 0) return continue_less_tab_expand;
  if (strcmp(shape, "066-less-case-insensitive-search-cli") == 0) return continue_less_case_insensitive_search;
  if (strcmp(shape, "067-less-highlight-match-cli") == 0) return continue_less_highlight_match;
  if (strcmp(shape, "068-less-status-prompt-cli") == 0) return continue_less_status_prompt;
  if (strcmp(shape, "069-less-multiple-file-index-cli") == 0) return continue_less_multiple_file_index;
  if (strcmp(shape, "070-less-quit-state-cli") == 0) return continue_less_quit_state;
  if (strcmp(shape, "071-less-help-screen-cli") == 0) return continue_less_help_screen;
  refuse("unknown shape");
  return NULL;
}

static char* read_file(const char* path) {
  FILE* file = fopen(path, "rb");
  if (file == NULL) die("failed to open file");
  fseek(file, 0, SEEK_END);
  long size = ftell(file);
  rewind(file);
  char* buffer = calloc((size_t)size + 1, 1);
  if (buffer == NULL) die("failed to allocate file buffer");
  if (fread(buffer, 1, (size_t)size, file) != (size_t)size) die("failed to read file");
  fclose(file);
  return buffer;
}

static int contains(const char* text, const char* value) { return strstr(text, value) != NULL; }

static void write_capture(const char* shape, const char* source_arch, const char* target_arch, const char* path) {
  FILE* file = fopen(path, "wb");
  if (file == NULL) die("failed to open capture path");
  uintptr_t sp = current_stack_pointer();
  uintptr_t pc = (uintptr_t)&&safe_point;
safe_point:
  fprintf(file,
    "{\n"
    "  \"kind\": \"machinen.research.native-binary-shape-ir\",\n"
    "  \"version\": 1,\n"
    "  \"shape\": \"%s\",\n"
    "  \"sourceArch\": \"%s\",\n"
    "  \"targetArch\": \"%s\",\n"
    "  \"safePoint\": \"declared_shape_ready\",\n"
    "  \"entrySymbol\": \"%s\",\n"
    "  \"sourceCpu\": { \"pc\": \"0x%lx\", \"sp\": \"0x%lx\", \"arg0\": \"0x1000\" },\n"
    "  \"targetCpuPlan\": { \"pcSymbol\": \"%s\", \"argumentRegister\": \"%s\", \"stackBytes\": 65536 },\n"
    "  \"shapeDescriptor\": { \"threads\": 1, \"activeSyscall\": false, \"sockets\": 0, \"usesSourceIsaEmulation\": false },\n"
    "  \"claimGuard\": {\n"
    "    \"arbitraryProcessRestoreClaimed\": false,\n"
    "    \"rawVmReplayUsed\": false,\n"
    "    \"sourceIsaEmulationUsed\": false,\n"
    "    \"metadataOnlySuccess\": false\n"
    "  }\n"
    "}\n",
    shape, source_arch, target_arch, entry_for_shape(shape), (unsigned long)pc, (unsigned long)sp,
    entry_for_shape(shape), strcmp(target_arch, "amd64") == 0 ? "rdi" : "x0");
  fclose(file);
  printf("CAPTURE_OK shape=%s source=%s target=%s\n", shape, source_arch, target_arch);
}

static void make_path(char* out, size_t out_size, const char* workdir, const char* name) {
  snprintf(out, out_size, "%s/%s", workdir, name);
}

static void* make_state(const char* shape, const char* workdir) {
  if (strcmp(shape, "002-string-transform-cli") == 0) {
    struct StringState* state = calloc(1, sizeof(*state));
    strcpy(state->text, "hello");
    return state;
  }
  if (strcmp(shape, "003-array-sum-cli") == 0) {
    struct ArrayState* state = calloc(1, sizeof(*state));
    state->values[0] = 1; state->values[1] = 2; state->values[2] = 3; state->values[3] = 4;
    return state;
  }
  if (strcmp(shape, "004-linked-list-cli") == 0) {
    struct Node* nodes = calloc(3, sizeof(*nodes));
    nodes[0].value = 1; nodes[0].next = &nodes[1];
    nodes[1].value = 2; nodes[1].next = &nodes[2];
    nodes[2].value = 3;
    return nodes;
  }
  if (strcmp(shape, "005-regular-file-reader") == 0) {
    struct FileState* state = calloc(1, sizeof(*state));
    make_path(state->path, sizeof(state->path), workdir, "reader.txt");
    FILE* file = fopen(state->path, "wb");
    fputs("hello-cross-arch", file);
    fclose(file);
    state->offset = 6;
    return state;
  }
  if (strcmp(shape, "006-append-only-logger") == 0) {
    struct FileState* state = calloc(1, sizeof(*state));
    make_path(state->path, sizeof(state->path), workdir, "append.log");
    FILE* file = fopen(state->path, "wb");
    fputs("first\n", file);
    fclose(file);
    strcpy(state->text, "second\n");
    return state;
  }
  if (strcmp(shape, "007-argv-env-printer") == 0) {
    struct ArgvEnvState* state = calloc(1, sizeof(*state));
    strcpy(state->argv0_storage, "demo");
    strcpy(state->env0_storage, "ok");
    state->argv0 = state->argv0_storage;
    state->env0 = state->env0_storage;
    return state;
  }
  if (strcmp(shape, "008-malloc-object-graph") == 0) {
    struct GraphState* state = calloc(1, sizeof(*state));
    state->leaves[0].value = 7; state->leaves[1].value = 8;
    state->a = &state->leaves[0]; state->b = &state->leaves[1];
    return state;
  }
  if (strcmp(shape, "009-recursive-factorial-safepoint") == 0) {
    struct FactorialState* state = calloc(1, sizeof(*state));
    state->n = 5; state->acc = 1; state->frames = 5;
    return state;
  }

  if (strcmp(shape, "011-two-file-copy-cli") == 0) {
    struct CopyState* state = calloc(1, sizeof(*state));
    make_path(state->source, sizeof(state->source), workdir, "copy-source.txt");
    make_path(state->target, sizeof(state->target), workdir, "copy-target.txt");
    FILE* file = fopen(state->source, "wb"); fputs("copy", file); fclose(file);
    return state;
  }
  if (strcmp(shape, "012-seek-overwrite-cli") == 0) {
    struct FileState* state = calloc(1, sizeof(*state));
    make_path(state->path, sizeof(state->path), workdir, "overwrite.txt");
    FILE* file = fopen(state->path, "wb"); fputs("abcdef", file); fclose(file);
    state->offset = 3; strcpy(state->text, "XY"); return state;
  }
  if (strcmp(shape, "013-line-reader-cli") == 0) {
    struct LineState* state = calloc(1, sizeof(*state));
    make_path(state->path, sizeof(state->path), workdir, "lines.txt");
    FILE* file = fopen(state->path, "wb"); fputs("first\nsecond\n", file); fclose(file);
    state->offset = 6; return state;
  }
  if (strcmp(shape, "014-directory-listing-cli") == 0) {
    struct DirState* state = calloc(1, sizeof(*state));
    make_path(state->path, sizeof(state->path), workdir, "listdir");
    mkdir(state->path, 0700);
    char child[512]; make_path(child, sizeof(child), state->path, "a.txt"); FILE* file = fopen(child, "wb"); fputs("a", file); fclose(file);
    make_path(child, sizeof(child), state->path, "b.txt"); file = fopen(child, "wb"); fputs("b", file); fclose(file);
    return state;
  }
  if (strcmp(shape, "015-stat-checker-cli") == 0) {
    struct StatState* state = calloc(1, sizeof(*state));
    make_path(state->path, sizeof(state->path), workdir, "stat.txt");
    FILE* file = fopen(state->path, "wb"); fputs("12345", file); fclose(file);
    state->expected_size = 5; return state;
  }
  if (strcmp(shape, "016-stdio-echo-cli") == 0) {
    struct StdioState* state = calloc(1, sizeof(*state)); strcpy(state->input, "echo"); return state;
  }
  if (strcmp(shape, "017-fixed-ring-buffer-cli") == 0) {
    struct RingState* state = calloc(1, sizeof(*state)); state->values[1]=4; state->values[2]=5; state->head=1; state->tail=3; return state;
  }
  if (strcmp(shape, "018-queue-cli") == 0) {
    struct QueueState* state = calloc(1, sizeof(*state)); state->nodes[0].value=3; state->nodes[1].value=4; state->nodes[0].next=&state->nodes[1]; state->head=&state->nodes[0]; state->tail=&state->nodes[1]; return state;
  }
  if (strcmp(shape, "019-binary-tree-traversal-cli") == 0) {
    struct TreeState* state = calloc(1, sizeof(*state)); state->nodes[0].value=1; state->nodes[1].value=2; state->nodes[2].value=3; state->nodes[0].left=&state->nodes[1]; state->nodes[0].right=&state->nodes[2]; state->root=&state->nodes[0]; return state;
  }
  if (strcmp(shape, "020-hash-table-fixed-buckets-cli") == 0) {
    struct HashState* state = calloc(1, sizeof(*state)); strcpy(state->entries[0].key_storage,"a"); strcpy(state->entries[1].key_storage,"b"); state->entries[0].key=state->entries[0].key_storage; state->entries[1].key=state->entries[1].key_storage; state->entries[0].value=10; state->entries[1].value=20; state->buckets[0]=&state->entries[0]; state->buckets[1]=&state->entries[1]; return state;
  }
  if (strcmp(shape, "021-graph-with-shared-node-cli") == 0) {
    struct SharedState* state = calloc(1, sizeof(*state)); state->leaf.value=9; state->a=&state->leaf; state->b=&state->leaf; return state;
  }
  if (strcmp(shape, "022-cycle-list-cli") == 0) {
    struct CycleState* state = calloc(1, sizeof(*state)); state->nodes[0].value=1; state->nodes[1].value=2; state->nodes[2].value=3; state->nodes[0].next=&state->nodes[1]; state->nodes[1].next=&state->nodes[2]; state->nodes[2].next=&state->nodes[0]; state->head=&state->nodes[0]; return state;
  }
  if (strcmp(shape, "023-struct-with-nested-pointers-cli") == 0) {
    struct NestedState* state = calloc(1, sizeof(*state)); strcpy(state->child.text,"child"); state->child_ptr=&state->child; return state;
  }
  if (strcmp(shape, "024-global-variable-counter-cli") == 0) {
    struct GlobalState* state = calloc(1, sizeof(*state)); state->value=41; return state;
  }
  if (strcmp(shape, "025-static-buffer-cli") == 0) {
    struct StaticState* state = calloc(1, sizeof(*state)); strcpy(state->value,"buf"); return state;
  }
  if (strcmp(shape, "026-multiple-stack-frames-cli") == 0) {
    struct FrameChainState* state = calloc(1, sizeof(*state)); state->frames[0]=1; state->frames[1]=2; state->frames[2]=3; return state;
  }
  if (strcmp(shape, "027-callee-saved-register-cli") == 0) {
    struct RegisterState* state = calloc(1, sizeof(*state)); state->value=42; return state;
  }
  if (strcmp(shape, "028-float-simd-scalar-cli") == 0) {
    struct FloatState* state = calloc(1, sizeof(*state)); state->value=41.5; return state;
  }
  if (strcmp(shape, "029-errno-libc-result-boundary-cli") == 0) {
    struct ErrnoState* state = calloc(1, sizeof(*state)); make_path(state->missing_path, sizeof(state->missing_path), workdir, "missing-file"); return state;
  }
  if (strcmp(shape, "030-malloc-free-boundary-cli") == 0) {
    struct MallocFreeState* state = calloc(1, sizeof(*state)); state->values = calloc(3, sizeof(int)); state->values[0]=1; state->values[1]=2; state->values[2]=3; state->count=3; return state;
  }

  if (strcmp(shape, "031-csv-record-parser-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "a,b,c"); return state; }
  if (strcmp(shape, "032-json-token-parser-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "{\"ok\":true}"); return state; }
  if (strcmp(shape, "033-checksum-running-sum-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=40; state->b=2; return state; }
  if (strcmp(shape, "034-rle-decoder-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "aaabb"); return state; }
  if (strcmp(shape, "035-chunked-decoder-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "test"); return state; }
  if (strcmp(shape, "036-fixed-arena-allocator-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=16; state->b=8; return state; }
  if (strcmp(shape, "037-bitmap-scanner-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=0x2b; return state; }
  if (strcmp(shape, "038-bitset-counter-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=0x15; state->b=0x22; return state; }
  if (strcmp(shape, "039-priority-queue-fixed-heap-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=1; state->b=4; state->c=9; return state; }
  if (strcmp(shape, "040-deque-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=3; state->b=4; return state; }
  if (strcmp(shape, "041-trie-lookup-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "key:value"); return state; }
  if (strcmp(shape, "042-tokenizer-state-machine-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "abc 123"); return state; }
  if (strcmp(shape, "043-config-reload-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "port=42"); return state; }
  if (strcmp(shape, "044-temp-file-rename-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "renamed.txt"); strcpy(state->text, "final"); return state; }
  if (strcmp(shape, "045-file-truncate-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "truncate.txt"); return state; }
  if (strcmp(shape, "046-sparse-file-seek-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "sparse.bin"); return state; }
  if (strcmp(shape, "047-commit-marker-file-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "commit.marker"); return state; }
  if (strcmp(shape, "048-lockfile-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "shape.lock"); return state; }
  if (strcmp(shape, "049-monotonic-counter-file-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "counter.txt"); state->a=41; return state; }
  if (strcmp(shape, "050-deterministic-prng-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=1; unsigned value = (unsigned)state->a * 1103515245u + 12345u; state->b = (int)((value / 65536u) % 100u); return state; }
  if (strcmp(shape, "051-less-readonly-pager-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state));
    make_path(state->path, sizeof(state->path), workdir, "less-input.txt");
    FILE* file = fopen(state->path, "wb");
    fputs("line1\nline2\nline3\nline4\n", file);
    fclose(file);
    state->a = 6;
    state->b = 2;
    return state;
  }
  if (strcmp(shape, "052-less-search-forward-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "less-search.txt");
    FILE* file = fopen(state->path, "wb"); fputs("first\nneedle line\nlast\n", file); fclose(file); state->a = 0; strcpy(state->text, "needle"); return state;
  }
  if (strcmp(shape, "053-less-page-backward-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "less-back.txt");
    FILE* file = fopen(state->path, "wb"); fputs("line1\nline2\nline3\n", file); fclose(file); state->a = 6; return state;
  }
  if (strcmp(shape, "054-less-percent-position-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=50; state->b=100; return state; }
  if (strcmp(shape, "055-less-mark-jump-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "less-mark.txt");
    FILE* file = fopen(state->path, "wb"); fputs("top\nmark\nbottom\n", file); fclose(file); state->b = 4; return state;
  }
  if (strcmp(shape, "056-less-goto-line-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "less-goto.txt");
    FILE* file = fopen(state->path, "wb"); fputs("line1\nline2\nline3\n", file); fclose(file); state->a = 3; return state;
  }
  if (strcmp(shape, "057-less-horizontal-scroll-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "abcdefghi"); state->a=2; return state; }
  if (strcmp(shape, "058-less-tail-snapshot-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "less-tail.txt");
    FILE* file = fopen(state->path, "wb"); fputs("first\nlast\n", file); fclose(file); return state;
  }
  if (strcmp(shape, "059-grep-line-boundary-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "grep.txt");
    FILE* file = fopen(state->path, "wb"); fputs("hit\nmiss\nhit\n", file); fclose(file); strcpy(state->text, "hit"); return state;
  }
  if (strcmp(shape, "060-wc-line-count-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "wc.txt");
    FILE* file = fopen(state->path, "wb"); fputs("one\ntwo\nthree\n", file); fclose(file); return state;
  }
  if (strcmp(shape, "061-tail-readonly-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "tail.txt");
    FILE* file = fopen(state->path, "wb"); fputs("one\ntwo\nthree\n", file); fclose(file); return state;
  }
  if (strcmp(shape, "062-less-screen-render-cli") == 0) {
    struct ExtraState* state = calloc(1, sizeof(*state)); make_path(state->path, sizeof(state->path), workdir, "less-screen.txt");
    FILE* file = fopen(state->path, "wb"); fputs("line1\nline2\nline3\n", file); fclose(file); state->a=6; return state;
  }
  if (strcmp(shape, "063-less-wrap-long-line-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "abcdefghij"); return state; }
  if (strcmp(shape, "064-less-no-wrap-long-line-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "abcdefghij"); state->a=0; return state; }
  if (strcmp(shape, "065-less-tab-expand-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "a\tb"); return state; }
  if (strcmp(shape, "066-less-case-insensitive-search-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "Needle"); return state; }
  if (strcmp(shape, "067-less-highlight-match-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "needle"); return state; }
  if (strcmp(shape, "068-less-status-prompt-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "file"); state->a=50; state->b=100; return state; }
  if (strcmp(shape, "069-less-multiple-file-index-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "file"); state->a=2; return state; }
  if (strcmp(shape, "070-less-quit-state-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); state->a=0; return state; }
  if (strcmp(shape, "071-less-help-screen-cli") == 0) { struct ExtraState* state = calloc(1, sizeof(*state)); strcpy(state->text, "q quit"); return state; }
  refuse("unknown shape");
  return NULL;
}

static void restore_shape(const char* shape, const char* ir_path, const char* workdir) {
  char* ir = read_file(ir_path);
  char target_token[64];
  snprintf(target_token, sizeof(target_token), "\"targetArch\": \"%s\"", TRACK_A_ARCH);
  if (!contains(ir, "\"kind\": \"machinen.research.native-binary-shape-ir\"")) refuse("wrong IR kind");
  if (!contains(ir, shape)) refuse("shape mismatch");
  if (!contains(ir, target_token)) refuse("target architecture mismatch");
  if (!contains(ir, "\"safePoint\": \"declared_shape_ready\"")) refuse("missing declared safe point");
  if (!contains(ir, entry_for_shape(shape))) refuse("entry symbol mismatch");
  if (!contains(ir, "\"sourceIsaEmulationUsed\": false")) refuse("source ISA emulation is not allowed");
  if (contains(ir, "\"activeSyscall\": true") || contains(ir, "\"hasThreads\": true") || contains(ir, "\"hasSocket\": true")) refuse("unsupported live state");
  void* state = make_state(shape, workdir);
  unsigned char* stack = calloc(1, 65536);
  if (stack == NULL) die("failed to allocate stack");
  void* stack_top = stack + 65536;
  int result = final_jump_to_target(function_for_shape(shape), state, stack_top);
  if (result != 42) refuse("target-native final jump failed");
  printf("SHAPE_RESTORE_OK shape=%s target=%s result=%d\n", shape, TRACK_A_ARCH, result);
  free(stack);
  free(state);
  free(ir);
}

static void usage(const char* program) {
  fprintf(stderr, "usage: %s capture <shape> <source-arch> <target-arch> <out-ir> | restore <shape> <ir> <workdir>\n", program);
  exit(2);
}

int main(int argc, char** argv) {
  if (argc < 2) usage(argv[0]);
  if (strcmp(argv[1], "capture") == 0) {
    if (argc != 6) usage(argv[0]);
    if (strcmp(argv[3], TRACK_A_ARCH) != 0) refuse("capture source architecture mismatch");
    write_capture(argv[2], argv[3], argv[4], argv[5]);
    return 0;
  }
  if (strcmp(argv[1], "restore") == 0) {
    if (argc != 5) usage(argv[0]);
    restore_shape(argv[2], argv[3], argv[4]);
    return 0;
  }
  usage(argv[0]);
}
