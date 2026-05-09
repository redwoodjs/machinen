// Parent-death-binding shim for child processes (#115).
//
// Node's `child_process.spawn` has no way to say "die when I die." The
// gap shows up the moment the runtime is killed -9 (OOM, IDE crash,
// `kill -9`): the kernel reparents children like `gvproxy` to PID 1
// and they keep running, holding host ports. PR #169 fails fast with a
// useful error on the *next* boot, but that's diagnosis — this module
// closes the loop by making the child actually die with the runtime.
//
// Two modes:
//
//   1. Default — watch the immediate parent (the process that exec'd
//      the shim). Used by gvproxy and the VMM today.
//   2. `--watch-pid <pid>` — watch an explicit, non-parent PID. Used
//      by the detached live-mount helper (#150 phase 3): the helper
//      is spawned by the supervisor, but it should die when the *VMM*
//      dies, not when the supervisor exits.
//
// Cross-platform via a tiny C shim, ~200 lines, three branches:
//
//   - Linux + default:   `prctl(PR_SET_PDEATHSIG, SIGTERM)` then
//     `execvp` the target. The kernel sends SIGTERM to the target
//     when its parent exits. PDEATHSIG is preserved across exec as
//     long as the target doesn't change UID. One process.
//   - Linux + watch-pid: fork + exec; parent uses `pidfd_open(2)` +
//     `poll(2)` to wait for the watched pid's exit. Falls back to a
//     `kill(pid, 0)` polling loop on pre-5.3 kernels (or where
//     pidfd_open is denied). Two processes.
//   - macOS:             no PDEATHSIG, no pidfd. Fork; the child
//     execs the target; the parent (the shim, now reparented to PID
//     1) kqueue-watches the watched pid (`getppid()` in default mode,
//     argv pid in watch-pid mode) for `NOTE_EXIT` and SIGTERMs the
//     target when it fires. Two processes.
//
// We compile the shim on first use into `~/.machinen/pdeathsig/<ver>/
// pdeathsig` (mirrors `gvproxyCachePath`). If `cc` is missing we log
// a one-shot warning and fall through to spawning unwrapped — the
// machine still works, the next abnormal exit just leaks a gvproxy
// (recoverable via PR #169's BOOT_PORT_FORWARD_IN_USE message).
//
// Opt-out: `MACHINEN_PDEATHSIG=disabled` skips the shim entirely.
// Useful for debugging or environments where the C toolchain is gone.

import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir, platform as osPlatform } from "node:os";
import { dirname, join } from "node:path";
import debugLib from "debug";

const debug = debugLib("machinen:pdeathsig");

/**
 * Bumped whenever the C source below changes in a way that changes
 * behavior. Recompiles instead of silently reusing a stale binary.
 */
const PDEATHSIG_VERSION = "v3";

let warnedNoCompiler = false;
// Keyed by the resolved cache path. Two reasons it has to be a map and
// not a single global: tests rebind `process.env.HOME` per-case (so the
// cache path differs across calls in the same process), and the
// runtime now calls `ensurePdeathsig()` in two spots per `boot()`
// (gvproxy + the VMM, #200) — caching by path keeps the dedup correct
// without leaking a stale promise from one HOME into the next call.
const installInFlight = new Map<string, Promise<string | null>>();

/**
 * The shim's source. Embedded so the runtime ships exactly one file
 * and `tsup` doesn't need to copy non-TS assets into `dist/`. Reads
 * verbatim from the same string at compile time.
 */
const PDEATHSIG_C_SOURCE = `// pdeathsig: tiny exec wrapper that arranges for the target to die
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
    if (errno != 0 || end == s || end == NULL || *end != '\\0' ||
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

    struct kevent changes[5];
    EV_SET(&changes[0], watch_pid, EVFILT_PROC, EV_ADD | EV_ONESHOT,
           NOTE_EXIT, 0, NULL);
    EV_SET(&changes[1], child, EVFILT_PROC, EV_ADD | EV_ONESHOT,
           NOTE_EXIT, 0, NULL);
    EV_SET(&changes[2], SIGTERM, EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    EV_SET(&changes[3], SIGINT,  EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    EV_SET(&changes[4], SIGHUP,  EVFILT_SIGNAL, EV_ADD, 0, 0, NULL);
    if (kevent(kq, changes, 5, NULL, 0, NULL) == -1) {
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
            fprintf(stderr, "pdeathsig: invalid pid '%s'\\n", argv[2]);
            return 2;
        }
        target = argv + 3;
    } else if (argc >= 2) {
        target = argv + 1;
    } else {
        fprintf(stderr,
                "pdeathsig: usage: pdeathsig [--watch-pid <pid>] "
                "<command> [args...]\\n");
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
    fprintf(stderr, "pdeathsig: unsupported platform\\n");
    return 127;
#endif
}
`;

/**
 * Where the compiled shim lands. Versioned so a source bump
 * recompiles instead of reusing a stale binary.
 */
function pdeathsigCachePath(): string {
  return join(homedir(), ".machinen", "pdeathsig", PDEATHSIG_VERSION, "pdeathsig");
}

/**
 * Recognize the opt-out tokens for `MACHINEN_PDEATHSIG`. Same shape
 * as `MACHINEN_GVPROXY`'s sentinels for muscle-memory consistency.
 */
function isPdeathsigDisabledSentinel(value: string): boolean {
  const v = value.toLowerCase().trim();
  return v === "disabled" || v === "off" || v === "false" || v === "0" || v === "none";
}

/**
 * Resolve and (if needed) compile the parent-death shim. Returns the
 * absolute path to a usable binary, or `null` when:
 *   - the user opted out via `MACHINEN_PDEATHSIG=disabled`
 *   - the platform is unsupported (Windows etc.)
 *   - compilation failed (e.g. no `cc` on PATH) — emits a one-shot
 *     stderr warning, then `null` so the caller can fall through.
 *
 * Compilation is sub-second and cached in `~/.machinen/pdeathsig/`.
 */
export async function ensurePdeathsig(): Promise<string | null> {
  const override = process.env.MACHINEN_PDEATHSIG;
  if (override !== undefined && isPdeathsigDisabledSentinel(override)) {
    debug("opted out via MACHINEN_PDEATHSIG=%s", override);
    return null;
  }
  if (override && override.length > 0 && existsSync(override)) {
    debug("resolved via MACHINEN_PDEATHSIG=%s", override);
    return override;
  }

  const plat = osPlatform();
  if (plat !== "linux" && plat !== "darwin") {
    debug("unsupported platform=%s", plat);
    return null;
  }

  const cached = pdeathsigCachePath();
  if (existsSync(cached)) {
    return cached;
  }
  const existing = installInFlight.get(cached);
  if (existing) {
    return existing;
  }
  const promise = (async () => {
    try {
      return compilePdeathsig(cached);
    } catch (err) {
      if (!warnedNoCompiler) {
        warnedNoCompiler = true;
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(
          `machinen: failed to compile pdeathsig shim (${msg}). ` +
            "gvproxy will not be auto-killed when the runtime exits abnormally. " +
            "Install Xcode CLI tools (macOS: `xcode-select --install`) or " +
            "build-essential (Linux). To silence this warning set " +
            "MACHINEN_PDEATHSIG=disabled.\n",
        );
      }
      debug("compile failed err=%s", err instanceof Error ? err.message : String(err));
      return null;
    }
  })();
  installInFlight.set(cached, promise);
  void promise.finally(() => {
    if (installInFlight.get(cached) === promise) {
      installInFlight.delete(cached);
    }
  });
  return promise;
}

/**
 * Compile the embedded C source to `outPath`. Atomic via tmp+rename
 * so a concurrent caller never sees a half-written binary.
 */
function compilePdeathsig(outPath: string): string {
  const dir = dirname(outPath);
  mkdirSync(dir, { recursive: true });

  const srcPath = join(dir, "pdeathsig.c");
  writeFileSync(srcPath, PDEATHSIG_C_SOURCE);

  const tmpOut = `${outPath}.${process.pid}.tmp`;
  const cc = process.env.CC ?? "cc";
  // Suppress stdout, capture stderr so we surface useful failures
  // (cc not found, syntax errors after a source bump, etc.).
  execFileSync(cc, ["-O2", "-Wall", "-Wextra", "-o", tmpOut, srcPath], {
    stdio: ["ignore", "ignore", "pipe"],
  });
  chmodSync(tmpOut, 0o755);
  try {
    renameSync(tmpOut, outPath);
  } catch (err) {
    // Lost a race with a concurrent compile. The other one's binary
    // is fine; clean up our tmp and return the cached path.
    try {
      unlinkSync(tmpOut);
    } catch {}
    if (existsSync(outPath)) {
      return outPath;
    }
    throw err;
  }
  debug("compiled %s", outPath);
  return outPath;
}

/**
 * Wrap an argv pair so the resulting spawn dies with its parent — or,
 * with `opts.watchPid`, with the given non-parent process. If
 * `pdeathsigBin` is `null` the argv is returned unchanged — caller
 * gets the unwrapped behavior (orphan-on-kill -9).
 *
 * `opts.watchPid` is for the detached live-mount helper case (#150
 * phase 3): the helper's immediate parent (the supervisor) exits on
 * purpose post-detach, but the helper must die when the *VMM* dies.
 * Pass the VMM's pid here.
 */
export function wrapWithPdeathsig(
  pdeathsigBin: string | null,
  command: string,
  args: string[],
  opts: { watchPid?: number } = {},
): { command: string; args: string[] } {
  if (!pdeathsigBin) {
    return { command, args };
  }
  if (opts.watchPid !== undefined) {
    if (!Number.isInteger(opts.watchPid) || opts.watchPid <= 0) {
      throw new Error(`wrapWithPdeathsig: invalid watchPid ${opts.watchPid}`);
    }
    return {
      command: pdeathsigBin,
      args: ["--watch-pid", String(opts.watchPid), command, ...args],
    };
  }
  return { command: pdeathsigBin, args: [command, ...args] };
}
