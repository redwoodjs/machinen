// pdeathsig: tiny exec wrapper that arranges for the target to die
// when a watched process dies. See packages/runtime/src/pdeathsig.ts.
//
// Modes:
//   pdeathsig <cmd> [args...]                   - watch immediate parent
//   pdeathsig --watch-pid <pid> <cmd> [args]    - watch the given pid

#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/wait.h>

#if defined(__linux__)
#include <sys/prctl.h>
#include <poll.h>
#include <sys/syscall.h>
#include <sys/signalfd.h>
#elif defined(__APPLE__)
#include <sys/event.h>
#include <sys/types.h>
#endif

#if defined(__linux__) && !defined(SYS_pidfd_open)
#define SYS_pidfd_open 434
#endif

// Wait up to ~5s for the target to exit after SIGTERM, then escalate.
static int reap_then_exit(pid_t child, int code) {
    for (int i = 0; i < 50; i++) {
        int status;
        pid_t r = waitpid(child, &status, WNOHANG);
        if (r == child) return code;
        usleep(100000);
    }
    kill(child, SIGKILL);
    waitpid(child, NULL, 0);
    return code;
}

static int parse_pid(const char *s, pid_t *out) {
    char *end = NULL;
    errno = 0;
    long n = strtol(s, &end, 10);
    if (errno != 0 || end == s || end == NULL || *end != '\0' ||
        n <= 0 || n > 0x7fffffff) {
        return -1;
    }
    *out = (pid_t)n;
    return 0;
}

#if defined(__linux__)

// Default mode: prctl + execvp. Single process. Parent of pdeathsig
// becomes the watched pid by definition.
static int run_default_linux(char **target) {
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) == -1) {
        perror("pdeathsig: prctl");
        return 127;
    }
    // Race: parent may already be gone. PDEATHSIG won't fire because
    // there's nothing to fire on. Detect via reparenting to PID 1.
    if (getppid() == 1) {
        return 0;
    }
    execvp(target[0], target);
    perror("pdeathsig: execvp");
    return 127;
}

// Watch-pid mode on Linux: fork + exec; parent watches the explicit
// pid via pidfd_open + poll. Falls back to a kill(pid,0) polling loop
// when pidfd_open is unavailable (kernel < 5.3) or returns ENOSYS.
static int run_watch_pid_linux(pid_t watch_pid, char **target) {
    sigset_t mask;
    sigemptyset(&mask);
    sigaddset(&mask, SIGTERM);
    sigaddset(&mask, SIGINT);
    sigaddset(&mask, SIGHUP);
    sigprocmask(SIG_BLOCK, &mask, NULL);

    pid_t child = fork();
    if (child == -1) {
        perror("pdeathsig: fork");
        return 127;
    }
    if (child == 0) {
        sigprocmask(SIG_UNBLOCK, &mask, NULL);
        execvp(target[0], target);
        perror("pdeathsig: execvp");
        _exit(127);
    }

    int sigfd = signalfd(-1, &mask, SFD_CLOEXEC);
    if (sigfd == -1) {
        perror("pdeathsig: signalfd");
        kill(child, SIGTERM);
        return reap_then_exit(child, 127);
    }

    int pidfd = (int)syscall(SYS_pidfd_open, watch_pid, 0);
    int saved_errno = errno;
    if (pidfd == -1 && saved_errno == ESRCH) {
        // Watched pid died between the pre-fork ESRCH check and now.
        kill(child, SIGTERM);
        close(sigfd);
        return reap_then_exit(child, 0);
    }

    if (pidfd == -1) {
        // pidfd_open unavailable (ENOSYS) or denied. Polling fallback:
        // poll signalfd with a 250ms timeout and recheck the watched
        // pid via kill(pid, 0) on every wake.
        struct pollfd pfd = { .fd = sigfd, .events = POLLIN, .revents = 0 };
        for (;;) {
            int n = poll(&pfd, 1, 250);
            if (n == -1) {
                if (errno == EINTR) continue;
                perror("pdeathsig: poll");
                kill(child, SIGTERM);
                close(sigfd);
                return reap_then_exit(child, 127);
            }
            if (n == 1 && (pfd.revents & POLLIN)) {
                struct signalfd_siginfo si;
                if (read(sigfd, &si, sizeof si) == sizeof si) {
                    kill(child, (int)si.ssi_signo);
                    close(sigfd);
                    return reap_then_exit(child, 128 + (int)si.ssi_signo);
                }
            }
            if (kill(watch_pid, 0) == -1 && errno == ESRCH) {
                kill(child, SIGTERM);
                close(sigfd);
                return reap_then_exit(child, 0);
            }
            int status;
            pid_t r = waitpid(child, &status, WNOHANG);
            if (r == child) {
                close(sigfd);
                return WIFEXITED(status) ? WEXITSTATUS(status)
                                         : 128 + WTERMSIG(status);
            }
        }
    }

    // pidfd path: poll signalfd + pidfd; pidfd POLLIN fires on exit.
    struct pollfd pfds[2] = {
        { .fd = sigfd,  .events = POLLIN, .revents = 0 },
        { .fd = pidfd,  .events = POLLIN, .revents = 0 },
    };
    for (;;) {
        int n = poll(pfds, 2, -1);
        if (n == -1) {
            if (errno == EINTR) continue;
            perror("pdeathsig: poll");
            kill(child, SIGTERM);
            close(sigfd);
            close(pidfd);
            return reap_then_exit(child, 127);
        }
        if (pfds[1].revents & POLLIN) {
            kill(child, SIGTERM);
            close(sigfd);
            close(pidfd);
            return reap_then_exit(child, 0);
        }
        if (pfds[0].revents & POLLIN) {
            struct signalfd_siginfo si;
            if (read(sigfd, &si, sizeof si) == sizeof si) {
                kill(child, (int)si.ssi_signo);
                close(sigfd);
                close(pidfd);
                return reap_then_exit(child, 128 + (int)si.ssi_signo);
            }
        }
    }
}

#elif defined(__APPLE__)

// Shared by default mode (watch_pid = getppid()) and --watch-pid mode
// (watch_pid from argv). kqueue NOTE_EXIT on the watched pid.
static int run_watch_pid_macos(pid_t watch_pid, char **target) {
    // Block the signals we'll consume via EVFILT_SIGNAL. Without this
    // the default disposition would kill the guard before kqueue
    // delivers the event, leaving the target alive and orphaned to
    // PID 1 — defeating the whole point of the shim.
    //
    // SIGUSR1/SIGUSR2 are included for the vmstate snapshot protocol:
    // the runtime signals the wrapped VMM's pid, which on macOS is
    // *this* shim (the watch loop forks). Blocking + kqueue-ing them
    // lets us forward them to the VMM instead of dying by the default
    // disposition. The child unblocks the whole mask before execvp,
    // so the VMM's own handlers still fire.
    sigset_t mask;
    sigemptyset(&mask);
    sigaddset(&mask, SIGTERM);
    sigaddset(&mask, SIGINT);
    sigaddset(&mask, SIGHUP);
    sigaddset(&mask, SIGUSR1);
    sigaddset(&mask, SIGUSR2);
    sigprocmask(SIG_BLOCK, &mask, NULL);

    pid_t child = fork();
    if (child == -1) {
        perror("pdeathsig: fork");
        return 127;
    }
    if (child == 0) {
        // Restore default signal disposition so the target inherits a
        // clean mask — gvproxy and friends expect to receive SIGTERM
        // normally.
        sigprocmask(SIG_UNBLOCK, &mask, NULL);
        execvp(target[0], target);
        perror("pdeathsig: execvp");
        _exit(127);
    }

    int kq = kqueue();
    if (kq == -1) {
        perror("pdeathsig: kqueue");
        kill(child, SIGTERM);
        return reap_then_exit(child, 127);
    }

    struct kevent changes[7];
    EV_SET(&changes[0], watch_pid, EVFILT_PROC, EV_ADD | EV_ONESHOT,
           NOTE_EXIT, 0, NULL);
    EV_SET(&changes[1], child, EVFILT_PROC, EV_ADD | EV_ONESHOT,
           NOTE_EXIT, 0, NULL);
    EV_SET(&changes[2], SIGTERM, EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    EV_SET(&changes[3], SIGINT,  EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    EV_SET(&changes[4], SIGHUP,  EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    EV_SET(&changes[5], SIGUSR1, EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    EV_SET(&changes[6], SIGUSR2, EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    if (kevent(kq, changes, 7, NULL, 0, NULL) == -1) {
        perror("pdeathsig: kevent register");
        kill(child, SIGTERM);
        return reap_then_exit(child, 127);
    }

    // Race: watched pid may have died between the pre-fork check and
    // EV_SET. EVFILT_PROC on a dead pid silently never fires, so
    // recheck explicitly.
    if (kill(watch_pid, 0) == -1 && errno == ESRCH) {
        kill(child, SIGTERM);
        return reap_then_exit(child, 0);
    }

    for (;;) {
        struct kevent ev;
        int n = kevent(kq, NULL, 0, &ev, 1, NULL);
        if (n == -1) {
            if (errno == EINTR) continue;
            perror("pdeathsig: kevent wait");
            kill(child, SIGTERM);
            return reap_then_exit(child, 127);
        }
        if (n == 0) continue;
        if (ev.filter == EVFILT_SIGNAL) {
            if ((int)ev.ident == SIGUSR1 || (int)ev.ident == SIGUSR2) {
                // Vmstate snapshot trigger / resume ack. Forward to
                // the VMM and keep watching — neither is a shutdown
                // signal for the pdeathsig guard.
                kill(child, (int)ev.ident);
                continue;
            }
            // Runtime is signaling us (typical: child.kill('SIGTERM')
            // from the Node side, or Ctrl-C). Forward to the target
            // and reap. Keep the original signal so callers that look
            // at WTERMSIG see what they sent.
            kill(child, (int)ev.ident);
            return reap_then_exit(child, 128 + (int)ev.ident);
        }
        pid_t fired = (pid_t)ev.ident;
        if (fired == watch_pid) {
            kill(child, SIGTERM);
            return reap_then_exit(child, 0);
        }
        if (fired == child) {
            int status;
            waitpid(child, &status, 0);
            return WIFEXITED(status) ? WEXITSTATUS(status)
                                     : 128 + WTERMSIG(status);
        }
    }
}

#endif

int main(int argc, char **argv) {
    pid_t watch_pid = -1;
    char **target = NULL;

    if (argc >= 4 && strcmp(argv[1], "--watch-pid") == 0) {
        if (parse_pid(argv[2], &watch_pid) != 0) {
            fprintf(stderr, "pdeathsig: invalid pid '%s'\n", argv[2]);
            return 2;
        }
        target = argv + 3;
    } else if (argc >= 2) {
        target = argv + 1;
    } else {
        fprintf(stderr,
                "pdeathsig: usage: pdeathsig [--watch-pid <pid>] "
                "<command> [args...]\n");
        return 2;
    }

#if defined(__linux__)
    if (watch_pid > 0) {
        if (kill(watch_pid, 0) == -1 && errno == ESRCH) {
            return 0;  // already dead; nothing to do
        }
        return run_watch_pid_linux(watch_pid, target);
    }
    return run_default_linux(target);
#elif defined(__APPLE__)
    if (watch_pid <= 0) {
        watch_pid = getppid();
        if (watch_pid == 1) {
            return 0;  // parent already gone; don't run target
        }
    } else if (kill(watch_pid, 0) == -1 && errno == ESRCH) {
        return 0;  // watched pid already gone
    }
    return run_watch_pid_macos(watch_pid, target);
#else
    (void)target;
    fprintf(stderr, "pdeathsig: unsupported platform\n");
    return 127;
#endif
}
