#define _GNU_SOURCE

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <netinet/ip.h>
#include <netinet/ip_icmp.h>
#include <poll.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <unistd.h>

#define TARGET_FILE_FD 38
#define TARGET_RAW_ICMP_FD 58
#define DATA_FILE "/tmp/machinen-native-raw-icmp-target-data.txt"
#define ICMP_IDENTIFIER 0x4d49u
#define ICMP_SEQUENCE 1u

static char file_read_buffer[4] __attribute__((used));

static void die(const char *what) {
  fprintf(stderr, "machinen-native-raw-icmp-target: %s: %s\n", what, strerror(errno));
  _exit(1);
}

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

static void setup_file_fd(void) {
  int fd = open(DATA_FILE, O_CREAT | O_TRUNC | O_WRONLY, 0644);
  if (fd < 0) die("open write file");
  const char bytes[] = "HEADER-FILE-READ-PROOF\n";
  if (write(fd, bytes, sizeof(bytes) - 1u) != (ssize_t)(sizeof(bytes) - 1u)) die("write file");
  close(fd);
  fd = open(DATA_FILE, O_RDONLY);
  if (fd < 0) die("open read file");
  if (dup2(fd, TARGET_FILE_FD) < 0) die("dup2 file");
  if (fd != TARGET_FILE_FD) close(fd);
  if (lseek(TARGET_FILE_FD, 7, SEEK_SET) < 0) die("lseek file");
}

static uint16_t internet_checksum(const void *data, size_t len) {
  const uint8_t *bytes = (const uint8_t *)data;
  uint32_t sum = 0;
  while (len > 1) {
    sum += (uint16_t)((bytes[0] << 8) | bytes[1]);
    bytes += 2;
    len -= 2;
  }
  if (len != 0) sum += (uint16_t)(bytes[0] << 8);
  while ((sum >> 16) != 0) sum = (sum & 0xffffu) + (sum >> 16);
  return (uint16_t)(~sum & 0xffffu);
}

static void drain_raw_icmp_queue(int fd) {
  for (int attempt = 0; attempt < 8; attempt++) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int ready = poll(&pfd, 1, 0);
    if (ready < 0) die("raw icmp drain poll");
    if (ready == 0) return;
    uint8_t buffer[256];
    ssize_t got = recv(fd, buffer, sizeof(buffer), MSG_DONTWAIT);
    if (got < 0) {
      if (errno == EAGAIN || errno == EWOULDBLOCK) return;
      die("raw icmp drain recv");
    }
  }
  fprintf(stderr, "machinen-native-raw-icmp-target: receive queue did not drain\n");
  _exit(1);
}

static void verify_loopback_echo(int fd) {
  uint8_t packet[16] = {0};
  struct icmphdr *icmp = (struct icmphdr *)packet;
  icmp->type = ICMP_ECHO;
  icmp->code = 0;
  icmp->un.echo.id = htons(ICMP_IDENTIFIER);
  icmp->un.echo.sequence = htons(ICMP_SEQUENCE);
  memcpy(packet + sizeof(*icmp), "MACHINEN", 8);
  icmp->checksum = htons(internet_checksum(packet, sizeof(packet)));
  struct sockaddr_in addr = {0};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  if (sendto(fd, packet, sizeof(packet), 0, (struct sockaddr *)&addr, sizeof(addr)) != (ssize_t)sizeof(packet)) {
    die("raw icmp sendto");
  }
  for (int attempt = 0; attempt < 8; attempt++) {
    struct pollfd pfd = {.fd = fd, .events = POLLIN};
    int ready = poll(&pfd, 1, 250);
    if (ready < 0) die("raw icmp poll");
    if (ready == 0) continue;
    uint8_t buffer[256];
    ssize_t got = recv(fd, buffer, sizeof(buffer), 0);
    if (got < 0) die("raw icmp recv");
    if (got < (ssize_t)(sizeof(struct iphdr) + sizeof(struct icmphdr))) continue;
    struct iphdr *ip = (struct iphdr *)buffer;
    size_t ip_header_len = (size_t)ip->ihl * 4u;
    if (ip_header_len < sizeof(struct iphdr) || got < (ssize_t)(ip_header_len + sizeof(struct icmphdr))) continue;
    struct icmphdr *reply = (struct icmphdr *)(buffer + ip_header_len);
    if (reply->type == ICMP_ECHOREPLY && reply->code == 0 &&
        ntohs(reply->un.echo.id) == ICMP_IDENTIFIER && ntohs(reply->un.echo.sequence) == ICMP_SEQUENCE) {
      drain_raw_icmp_queue(fd);
      return;
    }
  }
  fprintf(stderr, "machinen-native-raw-icmp-target: loopback echo timed out\n");
  _exit(1);
}

int main(void) {
  setup_file_fd();
  int fd = socket(AF_INET, SOCK_RAW | SOCK_CLOEXEC, IPPROTO_ICMP);
  if (fd < 0) die("raw icmp socket");
  verify_loopback_echo(fd);
  if (dup2(fd, TARGET_RAW_ICMP_FD) < 0) die("dup2 raw icmp");
  if (fd != TARGET_RAW_ICMP_FD) close(fd);
  fprintf(stderr, "MACHINEN_NATIVE_RAW_ICMP_READY fd=%d id=%u seq=%u\n", TARGET_RAW_ICMP_FD, ICMP_IDENTIFIER, ICMP_SEQUENCE);
  fflush(stderr);
  clear_simd_fpu_state();
  long rc = syscall(SYS_read, TARGET_FILE_FD, file_read_buffer, 4);
  if (rc < 0) die("read");
  for (;;) pause();
}
