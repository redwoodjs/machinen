// Guest-side capture scaffold for `machinen move`.
//
// This intentionally emits a stable, line-oriented evidence stream rather than
// making product decisions itself. The host-side move command turns these rows
// into the canonical move/native resource plan and remains responsible for
// DWARF/state translation and target-native load decisions.
//
// Usage:
//   /sbin/machinen-move-capture <pid>
//
// Output rows are tab-separated:
//   AGENT\tmachinen-move-capture-v1
//   STATUS\t<uid>\t<gid>
//   PING_RANGE\t<start>\t<end>
//   FD\t<fd>\t<readlink-target>
//   FDINFO\t<fd>\t<pos|flags line>
//   MAP\t<raw /proc/<pid>/maps row>
//   TASKS\t<count>
//   WCHAN\t<kernel wait-channel>
//   SYSCALL\t<raw /proc/<pid>/syscall row>
//   SAFE_BOUNDARY\t<sleep-timer|refused>\t<detail>
//   FREEZE\t<ptrace-attached|refused>\t<detail>
//   REG_ARM64\t<pc>\t<sp>\t<pstate>\t<x0>...<x30>
//   REG_AMD64\t<rip>\t<rsp>\t<rflags>\t<rax>...<r15>\t<fs_base>\t<gs_base>
//   NET_ICMP\t<raw /proc/net/icmp row>
//   NET_RAW\t<raw /proc/net/raw row>

#define _GNU_SOURCE
#include <dirent.h>
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <fcntl.h>
#include <stdint.h>
#include <sys/ptrace.h>
#include <sys/syscall.h>
#include <sys/uio.h>
#include <sys/utsname.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __aarch64__
#include <asm/ptrace.h>
#include <elf.h>
#endif
#ifdef __x86_64__
#include <sys/user.h>
#endif

static int starts_with(const char *s, const char *prefix) {
  return strncmp(s, prefix, strlen(prefix)) == 0;
}

static int numeric_name(const char *s) {
  if (!s || !*s) return 0;
  for (const char *p = s; *p; p++) {
    if (*p < '0' || *p > '9') return 0;
  }
  return 1;
}

static void chomp(char *s) {
  size_t n = strlen(s);
  while (n > 0 && (s[n - 1] == '\n' || s[n - 1] == '\r')) {
    s[--n] = '\0';
  }
}

static void emit_uname(void) {
  struct utsname uts;
  if (uname(&uts) == 0) {
    printf("UNAME\t%s\n", uts.machine);
  }
}

static void emit_status(const char *pid) {
  char path[128];
  snprintf(path, sizeof(path), "/proc/%s/status", pid);
  FILE *f = fopen(path, "r");
  char uid[32] = "";
  char gid[32] = "";
  if (f) {
    char line[512];
    while (fgets(line, sizeof(line), f)) {
      if (starts_with(line, "Uid:")) sscanf(line, "Uid:%31s", uid);
      if (starts_with(line, "Gid:")) sscanf(line, "Gid:%31s", gid);
    }
    fclose(f);
  }
  printf("STATUS\t%s\t%s\n", uid, gid);
}

static void emit_ping_range(void) {
  FILE *f = fopen("/proc/sys/net/ipv4/ping_group_range", "r");
  if (!f) return;
  char start[32] = "";
  char end[32] = "";
  if (fscanf(f, "%31s %31s", start, end) == 2) {
    printf("PING_RANGE\t%s\t%s\n", start, end);
  }
  fclose(f);
}

static void emit_fdinfo_line(const char *fd, const char *line) {
  if (!starts_with(line, "pos:") && !starts_with(line, "flags:") &&
      !starts_with(line, "eventfd-count:") && !starts_with(line, "eventfd-semaphore:") &&
      !starts_with(line, "tfd:"))
    return;
  char copy[512];
  snprintf(copy, sizeof(copy), "%s", line);
  chomp(copy);
  printf("FDINFO\t%s\t%s\n", fd, copy);
}

static void emit_fdinfo(const char *pid, const char *fd) {
  char path[256];
  snprintf(path, sizeof(path), "/proc/%s/fdinfo/%s", pid, fd);
  FILE *f = fopen(path, "r");
  if (!f) return;
  char line[512];
  while (fgets(line, sizeof(line), f)) {
    emit_fdinfo_line(fd, line);
  }
  fclose(f);
}

static void emit_fds(const char *pid) {
  char dirpath[128];
  snprintf(dirpath, sizeof(dirpath), "/proc/%s/fd", pid);
  DIR *dir = opendir(dirpath);
  if (!dir) return;
  struct dirent *ent;
  while ((ent = readdir(dir))) {
    if (!numeric_name(ent->d_name)) continue;
    char linkpath[256];
    snprintf(linkpath, sizeof(linkpath), "%s/%s", dirpath, ent->d_name);
    char target[1024];
    ssize_t n = readlink(linkpath, target, sizeof(target) - 1);
    if (n < 0) target[0] = '\0';
    else target[n] = '\0';
    printf("FD\t%s\t%s\n", ent->d_name, target);
    emit_fdinfo(pid, ent->d_name);
  }
  closedir(dir);
}

static void emit_proc_net(const char *path, const char *tag) {
  FILE *f = fopen(path, "r");
  if (!f) return;
  char line[1024];
  while (fgets(line, sizeof(line), f)) {
    chomp(line);
    printf("%s\t%s\n", tag, line);
  }
  fclose(f);
}

static void emit_proc_file(const char *pid, const char *name, const char *tag) {
  char path[256];
  snprintf(path, sizeof(path), "/proc/%s/%s", pid, name);
  FILE *f = fopen(path, "r");
  if (!f) return;
  char line[2048];
  while (fgets(line, sizeof(line), f)) {
    chomp(line);
    printf("%s\t%s\n", tag, line);
  }
  fclose(f);
}

static int count_tasks(const char *pid) {
  char path[128];
  snprintf(path, sizeof(path), "/proc/%s/task", pid);
  DIR *dir = opendir(path);
  if (!dir) return -1;
  int count = 0;
  struct dirent *ent;
  while ((ent = readdir(dir))) {
    if (numeric_name(ent->d_name)) count++;
  }
  closedir(dir);
  return count;
}

static int read_proc_first_line(const char *pid, const char *name, char *out, size_t out_size) {
  char path[256];
  snprintf(path, sizeof(path), "/proc/%s/%s", pid, name);
  FILE *f = fopen(path, "r");
  if (!f) return -1;
  if (!fgets(out, out_size, f)) {
    fclose(f);
    return -1;
  }
  fclose(f);
  chomp(out);
  return 0;
}

static long monotonic_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return ts.tv_sec * 1000L + ts.tv_nsec / 1000000L;
}

static int looks_like_sleep_timer_boundary(const char *wchan, const char *syscall) {
  if (strstr(wchan, "hrtimer") || strstr(wchan, "nanosleep") || strstr(wchan, "schedule_timeout")) return 1;
  if (strstr(wchan, "__skb_wait_for_more_packets")) return 1;
  if (starts_with(syscall, "35 ") || starts_with(syscall, "230 ") || starts_with(syscall, "271 ")) return 1;
  if (starts_with(syscall, "23 ") || starts_with(syscall, "270 ") || starts_with(syscall, "73 ")) return 1;
  return 0;
}

static int wait_safe_boundary(const char *pid, long timeout_ms) {
  long deadline = monotonic_ms() + timeout_ms;
  char wchan[256] = "";
  char syscall[512] = "";
  while (monotonic_ms() <= deadline) {
    int tasks = count_tasks(pid);
    printf("TASKS\t%d\n", tasks);
    if (tasks != 1) {
      printf("SAFE_BOUNDARY\trefused\tmultiple-tasks\n");
      return 0;
    }
    if (read_proc_first_line(pid, "wchan", wchan, sizeof(wchan)) != 0) wchan[0] = '\0';
    if (read_proc_first_line(pid, "syscall", syscall, sizeof(syscall)) != 0) syscall[0] = '\0';
    printf("WCHAN\t%s\n", wchan);
    printf("SYSCALL\t%s\n", syscall);
    if (looks_like_sleep_timer_boundary(wchan, syscall)) {
      printf("SAFE_BOUNDARY\tsleep-timer\t%s\n", wchan[0] ? wchan : syscall);
      return 1;
    }
    usleep(50000);
  }
  printf("SAFE_BOUNDARY\trefused\ttimeout\n");
  return 0;
}

static int freeze_pid(const char *pid_text) {
  pid_t pid = (pid_t)strtol(pid_text, NULL, 10);
  if (ptrace(PTRACE_ATTACH, pid, NULL, NULL) != 0) {
    printf("FREEZE\trefused\tptrace-attach:%d\n", errno);
    return 0;
  }
  int status = 0;
  if (waitpid(pid, &status, 0) < 0) {
    printf("FREEZE\trefused\twaitpid:%d\n", errno);
    return 0;
  }
  printf("FREEZE\tptrace-attached\tstatus:%d\n", status);
  return 1;
}

static void detach_pid(const char *pid_text) {
  pid_t pid = (pid_t)strtol(pid_text, NULL, 10);
  ptrace(PTRACE_DETACH, pid, NULL, NULL);
}

typedef struct PingStateLayout {
  unsigned long symbol_vaddr;
  unsigned long npackets;
  unsigned long nreceived;
  unsigned long ntransmitted;
  unsigned long nerrors;
  unsigned long interval;
  unsigned long pipesize;
  unsigned long min_size;
} PingStateLayout;

static PingStateLayout ping_layout;

static int parse_layout_value(const char *line, const char *key, unsigned long *out) {
  size_t key_len = strlen(key);
  if (strncmp(line, key, key_len) != 0 || line[key_len] != '=') return 0;
  *out = strtoul(line + key_len + 1, NULL, 0);
  return 1;
}

static int load_ping_state_layout(void) {
  FILE *f = fopen("/usr/share/machinen/move/iputils-ping.state", "r");
  if (!f) {
    printf("PATCH\trefused\tping-layout-missing\n");
    return 0;
  }
  memset(&ping_layout, 0, sizeof(ping_layout));
  char line[256];
  while (fgets(line, sizeof(line), f)) {
    chomp(line);
    parse_layout_value(line, "symbol_vaddr", &ping_layout.symbol_vaddr) ||
      parse_layout_value(line, "npackets", &ping_layout.npackets) ||
      parse_layout_value(line, "nreceived", &ping_layout.nreceived) ||
      parse_layout_value(line, "ntransmitted", &ping_layout.ntransmitted) ||
      parse_layout_value(line, "nerrors", &ping_layout.nerrors) ||
      parse_layout_value(line, "interval", &ping_layout.interval) ||
      parse_layout_value(line, "pipesize", &ping_layout.pipesize) ||
      parse_layout_value(line, "min_size", &ping_layout.min_size);
  }
  fclose(f);
  if (ping_layout.symbol_vaddr == 0 || ping_layout.min_size == 0 || ping_layout.ntransmitted == 0 || ping_layout.nreceived == 0 || ping_layout.interval == 0 || ping_layout.pipesize == 0) {
    printf("PATCH\trefused\tping-layout-incomplete\n");
    return 0;
  }
  printf("PATCH\tping-layout\tready\t0x%lx\t%lu\n", ping_layout.symbol_vaddr, ping_layout.min_size);
  return 1;
}

static int patch_long_fd(int memfd, unsigned long base, unsigned long offset, long value) {
  return pwrite(memfd, &value, sizeof(value), (off_t)(base + offset)) == (ssize_t)sizeof(value);
}

static unsigned long find_ping_rts_symbol_addr(FILE *maps) {
  char line[2048];
  rewind(maps);
  while (fgets(line, sizeof(line), maps)) {
    unsigned long start = 0, end = 0, offset = 0;
    char perms[8] = "";
    char path[1024] = "";
    if (sscanf(line, "%lx-%lx %7s %lx %*s %*s %1023[^\n]", &start, &end, perms, &offset, path) < 4) continue;
    (void)end;
    (void)perms;
    if (offset == 0 && strstr(path, "/usr/bin/ping")) return start + ping_layout.symbol_vaddr;
  }
  return 0;
}

static void patch_ping_rts_fields(int memfd, unsigned long base, long ntransmitted, long nreceived, long nerrors) {
  patch_long_fd(memfd, base, ping_layout.ntransmitted, ntransmitted);
  patch_long_fd(memfd, base, ping_layout.nreceived, nreceived);
  patch_long_fd(memfd, base, ping_layout.nerrors, nerrors);
}

static int plausible_ping_rts(int memfd, unsigned long base) {
  long npackets = -1;
  long ntransmitted = -1;
  int interval = -1;
  int pipesize = 0;
  if (pread(memfd, &npackets, sizeof(npackets), (off_t)(base + ping_layout.npackets)) != (ssize_t)sizeof(npackets)) return 0;
  if (pread(memfd, &ntransmitted, sizeof(ntransmitted), (off_t)(base + ping_layout.ntransmitted)) != (ssize_t)sizeof(ntransmitted)) return 0;
  if (pread(memfd, &interval, sizeof(interval), (off_t)(base + ping_layout.interval)) != (ssize_t)sizeof(interval)) return 0;
  if (pread(memfd, &pipesize, sizeof(pipesize), (off_t)(base + ping_layout.pipesize)) != (ssize_t)sizeof(pipesize)) return 0;
  return npackets == 0 && ntransmitted >= 0 && ntransmitted < 1000000 && interval > 0 && interval <= 10000 && pipesize >= -1 && pipesize < 100000;
}

static int patch_ping_state(const char *pid_text, long ntransmitted, long nreceived, long nerrors) {
  if (!load_ping_state_layout()) return 2;
  if (!freeze_pid(pid_text)) return 2;
  char maps_path[128];
  char mem_path[128];
  snprintf(maps_path, sizeof(maps_path), "/proc/%s/maps", pid_text);
  snprintf(mem_path, sizeof(mem_path), "/proc/%s/mem", pid_text);
  FILE *maps = fopen(maps_path, "r");
  int memfd = open(mem_path, O_RDWR);
  if (!maps || memfd < 0) {
    printf("PATCH\trefused\topen-proc:%d\n", errno);
    if (maps) fclose(maps);
    if (memfd >= 0) close(memfd);
    detach_pid(pid_text);
    return 2;
  }
  unsigned long symbol_addr = find_ping_rts_symbol_addr(maps);
  if (symbol_addr == 0) {
    printf("PATCH\trefused\tping-load-bias-not-found\n");
    fclose(maps);
    close(memfd);
    detach_pid(pid_text);
    return 2;
  }
  if (!plausible_ping_rts(memfd, symbol_addr)) {
    printf("PATCH\trefused\tping-rts-symbol-not-plausible\t0x%lx\n", symbol_addr);
    fclose(maps);
    close(memfd);
    detach_pid(pid_text);
    return 2;
  }
  patch_ping_rts_fields(memfd, symbol_addr, ntransmitted, nreceived, nerrors);
  printf("PATCH\tping-rts\t0x%lx\t%ld\t%ld\t%ld\n", symbol_addr, ntransmitted, nreceived, nerrors);
  fclose(maps);
  close(memfd);
  detach_pid(pid_text);
  return 0;
}

static void emit_registers(const char *pid_text) {
  pid_t pid = (pid_t)strtol(pid_text, NULL, 10);
#ifdef __aarch64__
  struct user_pt_regs regs;
  struct iovec iov;
  memset(&regs, 0, sizeof(regs));
  iov.iov_base = &regs;
  iov.iov_len = sizeof(regs);
  if (ptrace(PTRACE_GETREGSET, pid, (void *)NT_PRSTATUS, &iov) != 0) {
    printf("REG_ARM64\trefused\tgetregset:%d\n", errno);
    return;
  }
  printf("REG_ARM64\t0x%llx\t0x%llx\t0x%llx", (unsigned long long)regs.pc, (unsigned long long)regs.sp, (unsigned long long)regs.pstate);
  for (int i = 0; i < 31; i++) printf("\t0x%llx", (unsigned long long)regs.regs[i]);
  printf("\n");
#elif defined(__x86_64__)
  struct user_regs_struct regs;
  memset(&regs, 0, sizeof(regs));
  if (ptrace(PTRACE_GETREGS, pid, NULL, &regs) != 0) {
    printf("REG_AMD64\trefused\tgetregs:%d\n", errno);
    return;
  }
  printf("REG_AMD64\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\t0x%llx\n",
         (unsigned long long)regs.rip, (unsigned long long)regs.rsp, (unsigned long long)regs.eflags,
         (unsigned long long)regs.rax, (unsigned long long)regs.rbx, (unsigned long long)regs.rcx,
         (unsigned long long)regs.rdx, (unsigned long long)regs.rsi, (unsigned long long)regs.rdi,
         (unsigned long long)regs.rbp, (unsigned long long)regs.r8, (unsigned long long)regs.r9,
         (unsigned long long)regs.r10, (unsigned long long)regs.r11, (unsigned long long)regs.r12,
         (unsigned long long)regs.r13, (unsigned long long)regs.r14, (unsigned long long)regs.r15,
         (unsigned long long)regs.fs_base, (unsigned long long)regs.gs_base);
#else
  printf("REG_UNKNOWN\trefused\tunsupported-arch\n");
#endif
}

typedef struct SyscallEntry {
  long nr;
  unsigned long args[6];
  int ok;
} SyscallEntry;

static SyscallEntry current_syscall_entry(pid_t pid) {
  SyscallEntry out;
  memset(&out, 0, sizeof(out));
  out.nr = -1;
#ifdef __x86_64__
  struct user_regs_struct regs;
  memset(&regs, 0, sizeof(regs));
  if (ptrace(PTRACE_GETREGS, pid, NULL, &regs) != 0) return out;
  out.nr = (long)regs.orig_rax;
  out.args[0] = (unsigned long)regs.rdi;
  out.args[1] = (unsigned long)regs.rsi;
  out.args[2] = (unsigned long)regs.rdx;
  out.args[3] = (unsigned long)regs.r10;
  out.args[4] = (unsigned long)regs.r8;
  out.args[5] = (unsigned long)regs.r9;
  out.ok = 1;
#elif defined(__aarch64__)
  struct user_pt_regs regs;
  struct iovec iov;
  memset(&regs, 0, sizeof(regs));
  iov.iov_base = &regs;
  iov.iov_len = sizeof(regs);
  if (ptrace(PTRACE_GETREGSET, pid, (void *)NT_PRSTATUS, &iov) != 0) return out;
  out.nr = (long)regs.regs[8];
  for (int i = 0; i < 6; i++) out.args[i] = (unsigned long)regs.regs[i];
  out.ok = 1;
#endif
  return out;
}

static int is_sendto_entry(SyscallEntry sc) {
#ifdef __NR_sendto
  return sc.ok && sc.nr == __NR_sendto && sc.args[1] != 0 && sc.args[2] >= 8 && sc.args[2] <= 65535;
#else
  (void)sc;
  return 0;
#endif
}

static uint16_t icmp_checksum(const unsigned char *buf, size_t len) {
  uint32_t sum = 0;
  size_t i = 0;
  while (i + 1 < len) {
    sum += ((uint16_t)buf[i] << 8) | buf[i + 1];
    i += 2;
  }
  if (i < len) sum += ((uint16_t)buf[i] << 8);
  while (sum >> 16) sum = (sum & 0xffffU) + (sum >> 16);
  return (uint16_t)(~sum & 0xffffU);
}

static int patch_icmp_send_buffer(int memfd, unsigned long packet_addr, unsigned long packet_len, long ntransmitted) {
  if (packet_len < 8 || packet_len > 65535) return 0;
  unsigned char *packet = (unsigned char *)malloc(packet_len);
  if (!packet) return 0;
  int ok = 0;
  if (pread(memfd, packet, packet_len, (off_t)packet_addr) == (ssize_t)packet_len) {
    if (packet[0] == 8 || packet[0] == 128) {
      unsigned long next = (unsigned long)(ntransmitted + 1);
      packet[2] = 0;
      packet[3] = 0;
      packet[6] = (unsigned char)((next >> 8) & 0xff);
      packet[7] = (unsigned char)(next & 0xff);
      uint16_t sum = icmp_checksum(packet, packet_len);
      packet[2] = (unsigned char)((sum >> 8) & 0xff);
      packet[3] = (unsigned char)(sum & 0xff);
      ok = pwrite(memfd, packet, packet_len, (off_t)packet_addr) == (ssize_t)packet_len;
    }
  }
  free(packet);
  return ok;
}

static int patch_ping_presend(pid_t pid, unsigned long packet_addr, unsigned long packet_len, long ntransmitted, long nreceived, long nerrors) {
  char pid_text[32];
  char maps_path[128];
  char mem_path[128];
  snprintf(pid_text, sizeof(pid_text), "%ld", (long)pid);
  snprintf(maps_path, sizeof(maps_path), "/proc/%s/maps", pid_text);
  snprintf(mem_path, sizeof(mem_path), "/proc/%s/mem", pid_text);
  FILE *maps = fopen(maps_path, "r");
  int memfd = open(mem_path, O_RDWR);
  if (!maps || memfd < 0) {
    printf("PATCH\trefused\topen-proc:%d\n", errno);
    if (maps) fclose(maps);
    if (memfd >= 0) close(memfd);
    return 0;
  }
  unsigned long symbol_addr = find_ping_rts_symbol_addr(maps);
  if (symbol_addr == 0 || !plausible_ping_rts(memfd, symbol_addr)) {
    printf("PATCH\trefused\tping-rts-symbol-not-plausible\t0x%lx\n", symbol_addr);
    fclose(maps);
    close(memfd);
    return 0;
  }
  patch_ping_rts_fields(memfd, symbol_addr, ntransmitted, nreceived, nerrors);
  printf("PATCH\tping-rts\t0x%lx\t%ld\t%ld\t%ld\n", symbol_addr, ntransmitted, nreceived, nerrors);
  int packet_ok = patch_icmp_send_buffer(memfd, packet_addr, packet_len, ntransmitted);
  printf("PATCH\tping-send-buffer\t%s\t0x%lx\t%lu\t%lu\n", packet_ok ? "ready" : "refused", packet_addr, packet_len, (unsigned long)(ntransmitted + 1));
  fclose(maps);
  close(memfd);
  return packet_ok;
}

static void append_resume_marker(const char *log_path) {
  int fd = open(log_path, O_WRONLY | O_CREAT | O_APPEND, 0644);
  if (fd < 0) return;
  const char marker[] = "\nMACHINEN_MOVE_RESUME\n";
  (void)write(fd, marker, sizeof(marker) - 1);
  close(fd);
}

static int run_load_ping_state(int argc, char **argv) {
  if (!load_ping_state_layout()) return 2;
  if (argc < 9 || strcmp(argv[5], "--log") != 0 || strcmp(argv[7], "--") != 0) {
    fprintf(stderr, "usage: machinen-move-capture --load-ping-state <ntransmitted> <nreceived> <nerrors> --log <path> -- <executable> [args...]\n");
    return 64;
  }
  long ntransmitted = strtol(argv[2], NULL, 10);
  long nreceived = strtol(argv[3], NULL, 10);
  long nerrors = strtol(argv[4], NULL, 10);
  const char *log_path = argv[6];
  char **child_argv = &argv[8];
  pid_t pid = fork();
  if (pid < 0) {
    printf("RENDEZVOUS\trefused\tfork:%d\n", errno);
    return 2;
  }
  if (pid == 0) {
    int nullfd = open("/dev/null", O_RDONLY);
    if (nullfd >= 0) {
      dup2(nullfd, 0);
      if (nullfd > 2) close(nullfd);
    }
    int logfd = open(log_path, O_WRONLY | O_CREAT | O_TRUNC | O_APPEND, 0644);
    if (logfd >= 0) {
      dup2(logfd, 1);
      dup2(logfd, 2);
      if (logfd > 2) close(logfd);
    }
    ptrace(PTRACE_TRACEME, 0, NULL, NULL);
    raise(SIGSTOP);
    execvp(child_argv[0], child_argv);
    _exit(127);
  }

  printf("LOAD_PID\t%ld\n", (long)pid);
  printf("LOAD_LOG\t%s\n", log_path);
  int status = 0;
  if (waitpid(pid, &status, 0) < 0 || !WIFSTOPPED(status)) {
    printf("FREEZE\trefused\tinitial-wait:%d\n", errno);
    return 2;
  }
  if (ptrace(PTRACE_SETOPTIONS, pid, NULL, (void *)(unsigned long)PTRACE_O_TRACESYSGOOD) != 0) {
    printf("FREEZE\trefused\tsetoptions:%d\n", errno);
    kill(pid, SIGKILL);
    return 2;
  }

  int in_syscall = 0;
  long deadline = monotonic_ms() + 10000;
  while (monotonic_ms() <= deadline) {
    if (ptrace(PTRACE_SYSCALL, pid, NULL, NULL) != 0) {
      printf("FREEZE\trefused\tptrace-syscall:%d\n", errno);
      kill(pid, SIGKILL);
      return 2;
    }
    if (waitpid(pid, &status, 0) < 0) {
      printf("FREEZE\trefused\twait-syscall:%d\n", errno);
      kill(pid, SIGKILL);
      return 2;
    }
    if (WIFEXITED(status) || WIFSIGNALED(status)) {
      printf("SAFE_BOUNDARY\trefused\tprocess-exited-before-send\n");
      return 2;
    }
    if (!WIFSTOPPED(status)) continue;
    int sig = WSTOPSIG(status);
    if (sig != (SIGTRAP | 0x80)) continue;
    in_syscall = !in_syscall;
    if (!in_syscall) continue;
    SyscallEntry sc = current_syscall_entry(pid);
    if (!is_sendto_entry(sc)) continue;
    char pid_text[32];
    snprintf(pid_text, sizeof(pid_text), "%ld", (long)pid);
    printf("AGENT\tmachinen-move-capture-v3\n");
    emit_uname();
    emit_status(pid_text);
    emit_ping_range();
    emit_fds(pid_text);
    emit_proc_file(pid_text, "maps", "MAP");
    printf("TASKS\t%d\n", count_tasks(pid_text));
    printf("SAFE_BOUNDARY\tpre-send-icmp\tsendto\n");
    printf("FREEZE\tptrace-attached\tstatus:%d\n", status);
    emit_registers(pid_text);
    int ok = patch_ping_presend(pid, sc.args[1], sc.args[2], ntransmitted, nreceived, nerrors);
    emit_proc_net("/proc/net/icmp", "NET_ICMP");
    emit_proc_net("/proc/net/raw", "NET_RAW");
    if (!ok) {
      kill(pid, SIGKILL);
      return 2;
    }
    append_resume_marker(log_path);
    ptrace(PTRACE_DETACH, pid, NULL, NULL);
    return 0;
  }
  printf("SAFE_BOUNDARY\trefused\ttimeout-before-send\n");
  kill(pid, SIGKILL);
  return 2;
}

int main(int argc, char **argv) {
  if (argc >= 2 && (strcmp(argv[1], "--load-ping-state") == 0 || strcmp(argv[1], "--rendezvous-ping-state") == 0)) {
    return run_load_ping_state(argc, argv);
  }
  if (argc == 6 && strcmp(argv[1], "--patch-ping-state") == 0 && numeric_name(argv[2])) {
    return patch_ping_state(argv[2], strtol(argv[3], NULL, 10), strtol(argv[4], NULL, 10), strtol(argv[5], NULL, 10));
  }
  if ((argc != 2 && argc != 4) || !numeric_name(argv[1])) {
    fprintf(stderr, "usage: machinen-move-capture <pid> [--timeout-ms <ms>]\n       machinen-move-capture --patch-ping-state <pid> <ntransmitted> <nreceived> <nerrors>\n       machinen-move-capture --load-ping-state <ntransmitted> <nreceived> <nerrors> --log <path> -- <executable> [args...]\n");
    return 64;
  }
  long timeout_ms = 10000;
  if (argc == 4) {
    if (strcmp(argv[2], "--timeout-ms") != 0 || !numeric_name(argv[3])) {
      fprintf(stderr, "usage: machinen-move-capture <pid> [--timeout-ms <ms>]\n");
      return 64;
    }
    timeout_ms = strtol(argv[3], NULL, 10);
  }
  char procpath[128];
  snprintf(procpath, sizeof(procpath), "/proc/%s", argv[1]);
  if (access(procpath, F_OK) != 0) {
    fprintf(stderr, "machinen-move-capture: pid %s not found\n", argv[1]);
    return 1;
  }

  printf("AGENT\tmachinen-move-capture-v2\n");
  emit_uname();
  emit_status(argv[1]);
  emit_ping_range();
  emit_fds(argv[1]);
  emit_proc_file(argv[1], "maps", "MAP");
  int safe = wait_safe_boundary(argv[1], timeout_ms);
  int frozen = safe ? freeze_pid(argv[1]) : 0;
  if (frozen) {
    emit_registers(argv[1]);
    detach_pid(argv[1]);
  }
  emit_proc_net("/proc/net/icmp", "NET_ICMP");
  emit_proc_net("/proc/net/raw", "NET_RAW");
  return 0;
}
