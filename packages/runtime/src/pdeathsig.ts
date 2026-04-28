// Parent-death-binding shim for child processes (#115).
//
// Node's `child_process.spawn` has no way to say "die when I die." The
// gap shows up the moment the runtime is killed -9 (OOM, IDE crash,
// `kill -9`): the kernel reparents children like `gvproxy` to PID 1
// and they keep running, holding host ports. PR #169 fails fast with a
// useful error on the *next* boot, but that's diagnosis — this module
// closes the loop by making the child actually die with the runtime.
//
// Cross-platform via a tiny C shim, ~100 lines, two #ifdef branches:
//
//   - Linux: `prctl(PR_SET_PDEATHSIG, SIGTERM)` then `execvp` the
//     target. The kernel sends SIGTERM to the target when its parent
//     exits. PDEATHSIG is preserved across exec as long as the target
//     doesn't change UID, which gvproxy doesn't. One process.
//
//   - macOS: no PDEATHSIG. Fork; the child execs the target; the
//     parent (the shim, now reparented to PID 1) kqueue-watches the
//     original parent's PID for NOTE_EXIT and SIGTERMs the target when
//     it fires. Two processes — the extra ~10 KiB watcher per VM is
//     a fair price for not orphaning gvproxy.
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
export const PDEATHSIG_VERSION = "v2";

let warnedNoCompiler = false;
let installInFlight: Promise<string | null> | null = null;

/**
 * The shim's source. Embedded so the runtime ships exactly one file
 * and `tsup` doesn't need to copy non-TS assets into `dist/`. Reads
 * verbatim from the same string at compile time.
 */
const PDEATHSIG_C_SOURCE = `// pdeathsig: tiny exec wrapper that arranges for the target to die
// when its parent dies. Linux uses PR_SET_PDEATHSIG; macOS uses a
// kqueue NOTE_EXIT watcher. See packages/runtime/src/pdeathsig.ts.

#define _GNU_SOURCE
#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

#if defined(__linux__)
#include <sys/prctl.h>
#elif defined(__APPLE__)
#include <sys/event.h>
#include <sys/types.h>
#include <sys/wait.h>
#endif

static int run(int argc, char **argv);

int main(int argc, char **argv) {
    if (argc < 2) {
        fprintf(stderr, "pdeathsig: usage: pdeathsig <command> [args...]\\n");
        return 2;
    }
    return run(argc, argv);
}

#if defined(__linux__)
static int run(int argc, char **argv) {
    (void)argc;
    if (prctl(PR_SET_PDEATHSIG, SIGTERM) == -1) {
        perror("pdeathsig: prctl");
        return 127;
    }
    // Race: parent may already be gone. PDEATHSIG won't fire because
    // there's nothing to fire on. Detect via reparenting to PID 1.
    if (getppid() == 1) {
        return 0;
    }
    execvp(argv[1], &argv[1]);
    perror("pdeathsig: execvp");
    return 127;
}

#elif defined(__APPLE__)
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

static int run(int argc, char **argv) {
    (void)argc;
    pid_t parent_pid = getppid();
    if (parent_pid == 1) {
        return 0;
    }

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
        execvp(argv[1], &argv[1]);
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
    EV_SET(&changes[0], parent_pid, EVFILT_PROC, EV_ADD | EV_ONESHOT,
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

    // Race: parent may have died between getppid() and EV_SET. EVFILT_PROC
    // on a dead pid silently never fires, so recheck explicitly.
    if (kill(parent_pid, 0) == -1 && errno == ESRCH) {
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
        if (fired == parent_pid) {
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

#else
static int run(int argc, char **argv) {
    (void)argc; (void)argv;
    fprintf(stderr, "pdeathsig: unsupported platform\\n");
    return 127;
}
#endif
`;

/**
 * Where the compiled shim lands. Versioned so a source bump
 * recompiles instead of reusing a stale binary.
 */
export function pdeathsigCachePath(): string {
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
  if (installInFlight) {
    return installInFlight;
  }
  installInFlight = (async () => {
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
    } finally {
      installInFlight = null;
    }
  })();
  return installInFlight;
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
 * Wrap an argv pair so the resulting spawn dies with its parent.
 * If `pdeathsigBin` is `null` the argv is returned unchanged — caller
 * gets the unwrapped behavior (orphan-on-kill -9).
 */
export function wrapWithPdeathsig(
  pdeathsigBin: string | null,
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (!pdeathsigBin) {
    return { command, args };
  }
  return { command: pdeathsigBin, args: [command, ...args] };
}
