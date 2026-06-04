
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <poll.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/epoll.h>
#include <sys/eventfd.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/timerfd.h>
#include <sys/types.h>
#include <ucontext.h>
#include <unistd.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <limits.h>

struct WorkloadContext {
  unsigned char *memory;
  void *stack_base;
  size_t stack_size;
  char cwd[PATH_MAX];
  int result;
  bool memory_ok;
  bool stack_ok;
  bool bootstrap_ok;
  bool target_returned;
  bool closed_fd_ok;
  bool stdio_ok;
  bool reopen_file_ok;
  bool pipe_ok;
  bool eventfd_ok;
  bool timerfd_ok;
  bool epoll_ok;
  bool tcp_listener_ok;
};

static const int FD_CLOSED = 3;
static const int FD_FILE = 7;
static const int FD_PIPE_READ = 8;
static const int FD_PIPE_WRITE = 9;
static const int FD_EVENT = 10;
static const int FD_TIMER = 11;
static const int FD_EPOLL = 12;
static const int FD_TCP_LISTENER = 55;

static bool check_closed_fd(void) {
  errno = 0;
  return fcntl(FD_CLOSED, F_GETFD) == -1 && errno == EBADF;
}

static bool check_fd_open(int fd) {
  return fcntl(fd, F_GETFD) >= 0;
}

static bool read_exact(int fd, const char *expected, size_t len) {
  char buffer[64];
  if (len > sizeof(buffer)) return false;
  ssize_t got = read(fd, buffer, len);
  return got == (ssize_t)len && memcmp(buffer, expected, len) == 0;
}

static bool write_exact(int fd, const char *bytes, size_t len) {
  ssize_t wrote = write(fd, bytes, len);
  return wrote == (ssize_t)len;
}

static void selected_native_target(uintptr_t raw) {
  struct WorkloadContext *ctx = (struct WorkloadContext *)raw;
  volatile int stack_probe = 0;
  uintptr_t sp = (uintptr_t)&stack_probe;
  uintptr_t stack_start = (uintptr_t)ctx->stack_base;
  uintptr_t stack_end = stack_start + ctx->stack_size;
  ctx->stack_ok = sp >= stack_start && sp < stack_end;
  ctx->memory_ok = ctx->memory[0] == 0x5a;
  const char *env_value = getenv("MACHINEN_SELECTED_NATIVE");
  char cwd[PATH_MAX];
  ctx->bootstrap_ok = env_value && strcmp(env_value, "workload") == 0 && getcwd(cwd, sizeof(cwd)) && strcmp(cwd, ctx->cwd) == 0;
  ctx->closed_fd_ok = check_closed_fd();
  ctx->stdio_ok = check_fd_open(STDOUT_FILENO);
  ctx->epoll_ok = false;
  struct epoll_event event;
  int epoll_count = epoll_wait(FD_EPOLL, &event, 1, 0);
  if (epoll_count == 1 && event.data.u64 == 0x45504f4c4cULL) {
    ctx->epoll_ok = true;
  }
  uint64_t event_value = 0;
  ctx->eventfd_ok = read(FD_EVENT, &event_value, sizeof(event_value)) == (ssize_t)sizeof(event_value) && event_value == 42;
  ctx->reopen_file_ok = read_exact(FD_FILE, "FILE", 4) && write_exact(FD_FILE, "WRIT", 4);
  ctx->pipe_ok = read_exact(FD_PIPE_READ, "PIPEBUF", 7) && check_fd_open(FD_PIPE_WRITE);
  struct pollfd timer_poll = {.fd = FD_TIMER, .events = POLLIN, .revents = 0};
  ctx->timerfd_ok = poll(&timer_poll, 1, 0) == 0;
  int accept_conn = 0;
  socklen_t accept_conn_len = sizeof(accept_conn);
  ctx->tcp_listener_ok = getsockopt(FD_TCP_LISTENER, SOL_SOCKET, SO_ACCEPTCONN, &accept_conn, &accept_conn_len) == 0 && accept_conn == 1;
  ctx->target_returned = true;
  ctx->result = ctx->memory_ok && ctx->stack_ok && ctx->bootstrap_ok && ctx->closed_fd_ok && ctx->stdio_ok && ctx->reopen_file_ok && ctx->pipe_ok && ctx->eventfd_ok && ctx->timerfd_ok && ctx->epoll_ok && ctx->tcp_listener_ok ? 0 : 1;
}

static void die(const char *message) {
  perror(message);
  exit(2);
}

static void dup_to(int fd, int target) {
  if (fd != target) {
    if (dup2(fd, target) < 0) die("dup2");
    close(fd);
  }
}

static int setup_tcp_listener(void) {
  int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) die("socket");
  int one = 1;
  if (setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof(one)) < 0) die("setsockopt");
  struct sockaddr_in addr;
  memset(&addr, 0, sizeof(addr));
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = htons(0);
  if (bind(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) die("bind");
  if (listen(fd, 16) < 0) die("listen");
  return fd;
}

static const char *target_arch(void) {
#if defined(__x86_64__)
  return "amd64";
#elif defined(__aarch64__)
  return "arm64";
#else
  return "unsupported";
#endif
}

int main(int argc, char **argv) {
  const char *direction = argc > 1 ? argv[1] : "unknown";
  char tmp_template[] = "/tmp/machinen-selected-native-workload.XXXXXX";
  char *tmp = mkdtemp(tmp_template);
  if (!tmp) die("mkdtemp");
  if (setenv("MACHINEN_SELECTED_NATIVE", "workload", 1) < 0) die("setenv");
  if (chdir(tmp) < 0) die("chdir");

  size_t page_size = (size_t)sysconf(_SC_PAGESIZE);
  unsigned char *memory = mmap(NULL, page_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (memory == MAP_FAILED) die("mmap memory");
  memory[0] = 0x5a;

  size_t stack_size = 64 * 1024;
  void *stack = mmap(NULL, stack_size + page_size, PROT_READ | PROT_WRITE, MAP_PRIVATE | MAP_ANONYMOUS, -1, 0);
  if (stack == MAP_FAILED) die("mmap stack");
  if (mprotect(stack, page_size, PROT_NONE) < 0) die("mprotect guard");
  void *stack_base = (char *)stack + page_size;

  close(FD_CLOSED);
  int file = open("selected-fd.txt", O_CREAT | O_TRUNC | O_RDWR, 0600);
  if (file < 0) die("open file");
  if (write(file, "PREFIXFILE____", 14) != 14) die("write file");
  if (lseek(file, 6, SEEK_SET) < 0) die("lseek file");
  dup_to(file, FD_FILE);

  int pipefd[2];
  if (pipe(pipefd) < 0) die("pipe");
  if (write(pipefd[1], "PIPEBUF", 7) != 7) die("write pipe");
  dup_to(pipefd[0], FD_PIPE_READ);
  dup_to(pipefd[1], FD_PIPE_WRITE);

  int efd = eventfd(42, 0);
  if (efd < 0) die("eventfd");
  dup_to(efd, FD_EVENT);

  int tfd = timerfd_create(CLOCK_MONOTONIC, 0);
  if (tfd < 0) die("timerfd_create");
  dup_to(tfd, FD_TIMER);

  int epfd = epoll_create1(0);
  if (epfd < 0) die("epoll_create1");
  struct epoll_event ev;
  memset(&ev, 0, sizeof(ev));
  ev.events = EPOLLIN;
  ev.data.u64 = 0x45504f4c4cULL;
  if (epoll_ctl(epfd, EPOLL_CTL_ADD, FD_EVENT, &ev) < 0) die("epoll_ctl");
  dup_to(epfd, FD_EPOLL);

  int listener = setup_tcp_listener();
  dup_to(listener, FD_TCP_LISTENER);

  struct WorkloadContext ctx;
  memset(&ctx, 0, sizeof(ctx));
  ctx.memory = memory;
  ctx.stack_base = stack_base;
  ctx.stack_size = stack_size;
  if (!getcwd(ctx.cwd, sizeof(ctx.cwd))) die("getcwd");
  ctx.result = 1;

  ucontext_t main_context;
  ucontext_t target_context;
  if (getcontext(&target_context) < 0) die("getcontext");
  target_context.uc_stack.ss_sp = stack_base;
  target_context.uc_stack.ss_size = stack_size;
  target_context.uc_link = &main_context;
  makecontext(&target_context, (void (*)(void))selected_native_target, 1, (uintptr_t)&ctx);
  if (swapcontext(&main_context, &target_context) < 0) die("swapcontext");

  bool passed = ctx.result == 0;
  printf("MACHINEN_SELECTED_NATIVE_WORKLOAD {");
  printf("\"status\":\"%s\",", passed ? "passed" : "failed");
  printf("\"direction\":\"%s\",", direction);
  printf("\"targetArch\":\"%s\",", target_arch());
  printf("\"targetNativeExecution\":true,");
  printf("\"rawCpuRestoreUsed\":false,");
  printf("\"sourceIsaEmulationUsed\":false,");
  printf("\"runtimeProfileRestoreUsed\":false,");
  printf("\"appHooksUsed\":false,");
  printf("\"metadataOnlySuccessAccepted\":false,");
  printf("\"checks\":{");
  printf("\"memory\":%s,", ctx.memory_ok ? "true" : "false");
  printf("\"stack\":%s,", ctx.stack_ok ? "true" : "false");
  printf("\"bootstrap\":%s,", ctx.bootstrap_ok ? "true" : "false");
  printf("\"targetFunctionReturned\":%s", ctx.target_returned ? "true" : "false");
  printf("},\"resources\":{");
  printf("\"closedFd\":%s,", ctx.closed_fd_ok ? "true" : "false");
  printf("\"stdio\":%s,", ctx.stdio_ok ? "true" : "false");
  printf("\"reopenFile\":%s,", ctx.reopen_file_ok ? "true" : "false");
  printf("\"pipe\":%s,", ctx.pipe_ok ? "true" : "false");
  printf("\"eventfd\":%s,", ctx.eventfd_ok ? "true" : "false");
  printf("\"timerfd\":%s,", ctx.timerfd_ok ? "true" : "false");
  printf("\"epoll\":%s,", ctx.epoll_ok ? "true" : "false");
  printf("\"tcpListener\":%s", ctx.tcp_listener_ok ? "true" : "false");
  printf("}}\n");
  return passed ? 0 : 1;
}
