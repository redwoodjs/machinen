// Guest-side vmstate restore entropy reseed helper.
//
// Usage: /sbin/machinen-vmstate-reseed <hex-seed>
//
// Writes caller-provided host entropy into Linux's random pool, credits it,
// and asks the kernel to reseed the CRNG immediately. This is used by the
// runtime after whole-VM vmstate restore so two restores from the same kernel
// CSPRNG snapshot do not hand out the same post-restore random stream.

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/random.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#ifndef RNDRESEEDCRNG
#define RNDRESEEDCRNG _IO('R', 0x07)
#endif

static int hex_nibble(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static size_t decode_hex(const char *hex, uint8_t *out, size_t out_cap) {
  const size_t len = strlen(hex);
  if ((len % 2) != 0 || (len / 2) > out_cap) {
    fprintf(stderr, "machinen-vmstate-reseed: seed must be even-length hex <= %zu bytes\n", out_cap);
    exit(2);
  }
  for (size_t i = 0; i < len / 2; i++) {
    const int hi = hex_nibble(hex[i * 2]);
    const int lo = hex_nibble(hex[i * 2 + 1]);
    if (hi < 0 || lo < 0) {
      fprintf(stderr, "machinen-vmstate-reseed: seed contains non-hex characters\n");
      exit(2);
    }
    out[i] = (uint8_t)((hi << 4) | lo);
  }
  return len / 2;
}

static void write_marker(void) {
  if (mkdir("/run", 0755) != 0 && errno != EEXIST) return;
  const int fd = open("/run/machinen-vmstate-reseed", O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
  if (fd < 0) return;
  char buf[128];
  const time_t now = time(NULL);
  const int n = snprintf(buf, sizeof(buf), "vmstate reseeded %lld\n", (long long)now);
  if (n > 0) {
    (void)write(fd, buf, (size_t)n);
  }
  (void)fchmod(fd, 0600);
  close(fd);
}

int main(int argc, char **argv) {
  if (argc != 2) {
    fprintf(stderr, "usage: %s <hex-seed>\n", argv[0]);
    return 2;
  }

  uint8_t seed[64];
  const size_t seed_len = decode_hex(argv[1], seed, sizeof(seed));
  if (seed_len < 32) {
    fprintf(stderr, "machinen-vmstate-reseed: seed must be at least 32 bytes\n");
    return 2;
  }

  const int fd = open("/dev/random", O_RDWR | O_CLOEXEC);
  if (fd < 0) {
    perror("machinen-vmstate-reseed: open /dev/random");
    return 1;
  }

  const size_t info_len = sizeof(struct rand_pool_info) + seed_len;
  struct rand_pool_info *info = calloc(1, info_len);
  if (!info) {
    perror("machinen-vmstate-reseed: calloc");
    close(fd);
    return 1;
  }
  info->entropy_count = (int)(seed_len * 8);
  info->buf_size = (int)seed_len;
  memcpy(info->buf, seed, seed_len);

  if (ioctl(fd, RNDADDENTROPY, info) != 0) {
    perror("machinen-vmstate-reseed: RNDADDENTROPY");
    free(info);
    close(fd);
    return 1;
  }
  // Newer kernels support an explicit CRNG reseed request. Older kernels may
  // return EINVAL/ENOTTY after RNDADDENTROPY already mixed and credited the
  // seed; tolerate that so old guests still get the pool mix-in.
  if (ioctl(fd, RNDRESEEDCRNG, 0) != 0 && errno != EINVAL && errno != ENOTTY) {
    perror("machinen-vmstate-reseed: RNDRESEEDCRNG");
    free(info);
    close(fd);
    return 1;
  }

  free(info);
  close(fd);
  write_marker();
  puts("machinen-vmstate-reseed: ok");
  return 0;
}
