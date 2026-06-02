#include <errno.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
int main(void) {
  struct sock_filter filter[] = {
    BPF_STMT(BPF_LD | BPF_W | BPF_ABS, (unsigned int)offsetof(struct seccomp_data, nr)),
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, SYS_getpid, 0, 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | 1),
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
  };
  struct sock_fprog prog = { .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter };
  int nnp = prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
  int install = prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog);
  errno = 0;
  long blocked = syscall(SYS_getpid);
  printf("SECCOMP_SMOKE nnp=%d install=%d getpid=%ld errno=%d\n", nnp, install, blocked, errno);
  return (nnp == 0 && install == 0 && blocked == -1 && errno == 1) ? 0 : 1;
}
