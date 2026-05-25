#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

#define TARGET_FILE_FD 38
#define READ_OFFSET 7
#define READ_COUNT 4
#define PAGE_SIZE_BYTES 4096
#define DATA_FILE "/tmp/machinen-native-private-multi-range-file-data.txt"

static char file_read_buffer[READ_COUNT + 8] __attribute__((used));
static volatile uint8_t *range_a __attribute__((used));
static volatile uint8_t *range_b __attribute__((used));
static volatile uint64_t range_checksum __attribute__((used));

static void clear_simd_fpu_state(void) {
#if defined(__aarch64__)
  __asm__ __volatile__(
      "movi v0.16b, #0\n"
      "movi v1.16b, #0\n"
      "movi v2.16b, #0\n"
      "movi v3.16b, #0\n"
      "movi v4.16b, #0\n"
      "movi v5.16b, #0\n"
      "movi v6.16b, #0\n"
      "movi v7.16b, #0\n"
      "movi v8.16b, #0\n"
      "movi v9.16b, #0\n"
      "movi v10.16b, #0\n"
      "movi v11.16b, #0\n"
      "movi v12.16b, #0\n"
      "movi v13.16b, #0\n"
      "movi v14.16b, #0\n"
      "movi v15.16b, #0\n"
      "movi v16.16b, #0\n"
      "movi v17.16b, #0\n"
      "movi v18.16b, #0\n"
      "movi v19.16b, #0\n"
      "movi v20.16b, #0\n"
      "movi v21.16b, #0\n"
      "movi v22.16b, #0\n"
      "movi v23.16b, #0\n"
      "movi v24.16b, #0\n"
      "movi v25.16b, #0\n"
      "movi v26.16b, #0\n"
      "movi v27.16b, #0\n"
      "movi v28.16b, #0\n"
      "movi v29.16b, #0\n"
      "movi v30.16b, #0\n"
      "movi v31.16b, #0\n"
      "msr fpsr, xzr\n"
      "msr fpcr, xzr\n"
      ::: "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9", "v10",
      "v11", "v12", "v13", "v14", "v15", "v16", "v17", "v18", "v19", "v20",
      "v21", "v22", "v23", "v24", "v25", "v26", "v27", "v28", "v29", "v30",
      "v31", "memory");
#endif
}

static int move_fd(int from, int to) {
  if (from == to) {
    return 0;
  }
  if (dup2(from, to) < 0) {
    return -1;
  }
  close(from);
  return 0;
}

static int write_data_file(void) {
  int fd = open(DATA_FILE, O_CREAT | O_TRUNC | O_WRONLY, 0644);
  if (fd < 0) {
    return -1;
  }
  const char bytes[] = "HEADER-MULTI-RANGE-FILE-PROOF\n";
  ssize_t wrote = write(fd, bytes, sizeof(bytes) - 1u);
  int saved = errno;
  close(fd);
  errno = saved;
  return wrote == (ssize_t)(sizeof(bytes) - 1u) ? 0 : -1;
}

static int prepare_private_ranges(void) {
  uint8_t *guarded = mmap(
      NULL,
      PAGE_SIZE_BYTES * 3u,
      PROT_READ | PROT_WRITE,
      MAP_PRIVATE | MAP_ANONYMOUS,
      -1,
      0);
  if (guarded == MAP_FAILED) {
    return -1;
  }
  if (mprotect(guarded, PAGE_SIZE_BYTES, PROT_NONE) != 0 ||
      mprotect(guarded + PAGE_SIZE_BYTES * 2u, PAGE_SIZE_BYTES, PROT_NONE) != 0) {
    return -1;
  }
  uint8_t *plain = mmap(
      NULL,
      PAGE_SIZE_BYTES,
      PROT_READ | PROT_WRITE,
      MAP_PRIVATE | MAP_ANONYMOUS,
      -1,
      0);
  if (plain == MAP_FAILED) {
    return -1;
  }
  range_a = guarded + PAGE_SIZE_BYTES;
  range_b = plain;
  uint64_t checksum = 0;
  for (size_t index = 0; index < PAGE_SIZE_BYTES; index += 1) {
    uint8_t a = (uint8_t)(0x31u ^ (index & 0xffu));
    uint8_t b = (uint8_t)(0xa7u ^ ((index * 3u) & 0xffu));
    ((uint8_t *)range_a)[index] = a;
    ((uint8_t *)range_b)[index] = b;
    checksum += (uint64_t)a + (uint64_t)b;
  }
  range_checksum = checksum;
  return 0;
}

int main(void) {
  if (prepare_private_ranges() != 0) {
    fprintf(stderr, "machinen-private-multi-range-file-target: mmap: %s\n", strerror(errno));
    return 1;
  }
  if (write_data_file() != 0) {
    fprintf(stderr, "machinen-private-multi-range-file-target: write data: %s\n", strerror(errno));
    return 1;
  }
  int fd = open(DATA_FILE, O_RDONLY);
  if (fd < 0) {
    fprintf(stderr, "machinen-private-multi-range-file-target: open: %s\n", strerror(errno));
    return 1;
  }
  if (move_fd(fd, TARGET_FILE_FD) != 0) {
    fprintf(stderr, "machinen-private-multi-range-file-target: dup2: %s\n", strerror(errno));
    return 1;
  }
  if (lseek(TARGET_FILE_FD, READ_OFFSET, SEEK_SET) < 0) {
    fprintf(stderr, "machinen-private-multi-range-file-target: lseek: %s\n", strerror(errno));
    return 1;
  }

  clear_simd_fpu_state();
  long rc = syscall(SYS_read, TARGET_FILE_FD, file_read_buffer, READ_COUNT);
  if (rc < 0) {
    fprintf(stderr, "machinen-private-multi-range-file-target: read: %s\n", strerror(errno));
    return 1;
  }
  for (;;) {
    pause();
  }
}
