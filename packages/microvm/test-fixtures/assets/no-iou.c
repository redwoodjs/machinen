// Runs a child with io_uring_setup blocked via seccomp.
//
// Why: Node.js's libuv opens io_uring rings even when UV_USE_IO_URING=0
// (env var has no effect with this build). CRIU can't dump a process
// with an io_uring fd, so we stop the ring from being created in the
// first place. libuv falls back to epoll and the process looks normal
// to CRIU.
//
// Build: zig cc -target aarch64-linux-musl -static -Os -o no-iou no-iou.c
// Use:   /bin/no-iou /usr/local/bin/node /counter.js
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/prctl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <sys/syscall.h>

#ifndef __NR_io_uring_setup
#define __NR_io_uring_setup 425
#endif
#ifndef __NR_io_uring_enter
#define __NR_io_uring_enter 426
#endif
#ifndef __NR_io_uring_register
#define __NR_io_uring_register 427
#endif

#define ALLOW   BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW)
#define ENOSYS_ BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | (ENOSYS & SECCOMP_RET_DATA))
#define LD_NR   BPF_STMT(BPF_LD  | BPF_W | BPF_ABS, \
                         (unsigned)offsetof(struct seccomp_data, nr))
#define JEQ(x, t, f) BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, (x), (t), (f))

int main(int argc, char *argv[]) {
    if (argc < 2) {
        fprintf(stderr, "usage: %s CMD [ARGS...]\n", argv[0]);
        return 2;
    }

    struct sock_filter filter[] = {
        LD_NR,
        JEQ(__NR_io_uring_setup,    3, 0),
        JEQ(__NR_io_uring_enter,    2, 0),
        JEQ(__NR_io_uring_register, 1, 0),
        ALLOW,
        ENOSYS_,
    };
    struct sock_fprog prog = {
        .len    = sizeof(filter) / sizeof(filter[0]),
        .filter = filter,
    };

    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
        perror("PR_SET_NO_NEW_PRIVS");
        return 3;
    }
    if (prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &prog) < 0) {
        perror("PR_SET_SECCOMP");
        return 4;
    }
    execvp(argv[1], argv + 1);
    perror("execvp");
    return 5;
}
