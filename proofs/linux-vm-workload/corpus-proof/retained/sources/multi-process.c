#include <stdio.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>
int main(void) {
  int fds[2];
  if (pipe(fds) != 0) { perror("pipe"); return 1; }
  pid_t child = fork();
  if (child < 0) { perror("fork"); return 1; }
  if (child == 0) {
    close(fds[0]);
    const char *msg = "child-ready";
    ssize_t wrote = write(fds[1], msg, strlen(msg));
    _exit(wrote == (ssize_t)strlen(msg) ? 0 : 2);
  }
  close(fds[1]);
  char buf[32] = {0};
  ssize_t got = read(fds[0], buf, sizeof(buf) - 1);
  int status = 0;
  waitpid(child, &status, 0);
  printf("MULTI_PROCESS_WORKLOAD_OK message='%s' bytes=%zd childStatus=%d\n", buf, got, status);
  return got > 0 && strcmp(buf, "child-ready") == 0 && WIFEXITED(status) && WEXITSTATUS(status) == 0 ? 0 : 1;
}
