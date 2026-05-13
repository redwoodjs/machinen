// Host-side exec client — pairs with assets/exec-agent.zig.
//
// Opens the UDS the vsock bridge is listening on, sends the cmd, demuxes
// the framed output stream until an `X <code>\n` terminator, returns
// stdout/stderr + the exit code.
//
// Two on-the-wire opcodes:
//   `EXEC <cmd>\n`            — legacy single-line cmd (no \r or \n).
//                                Compatible with all agents.
//   `EXEC2 <byte-len>\n<cmd>` — length-prefixed cmd; supports any byte
//                                content including newlines. Requires an
//                                agent with EXEC2 support (#112).
//
// The host picks EXEC2 only when the cmd contains a newline so plain
// single-line cmds keep working with older rootfs images.
//
// Minimum-viable install primitive for `@machinen/runtime.provision()`.
//
// Usage:
//
//   const vm = await boot({
//     binary,
//     env: {
//       MACHINEN_VSOCK: "in:1978:/tmp/machinen-exec.sock",
//     },
//     image: "./rootfs-debian-arm64.tar.gz", cmd: ["/sbin/machinen-exec-agent"],
//   });
//   const res = await VsockExec.run("/tmp/machinen-exec.sock", "apt-get --version");
//   // res.exitCode, res.stdout, res.stderr

import { connect as netConnect, type Socket } from "node:net";
import type { Readable, Writable } from "node:stream";
import debugLib from "debug";
import { ExecError } from "./errors.ts";

const debug = debugLib("machinen:exec");

export interface VsockExecOptions {
  /** How long to keep retrying the UDS connect. Default 30s. */
  connectTimeoutMs?: number;
  /** Poll interval in ms while retrying. Default 250. */
  retryMs?: number;
  /**
   * Wall-clock ceiling for the spawned command. Default 5 minutes.
   * Pass `null` (or `Infinity`) to disable — appropriate for
   * long-running siblings (dev servers, file watchers, log tailers)
   * that should live for the VM's lifetime. Mirrors `boot({ timeoutMs: null })`.
   */
  execTimeoutMs?: number | null;
  /** Called with each stdout chunk as it arrives (pass-through tee). */
  onStdout?: (chunk: Buffer) => void;
  /** Called with each stderr chunk as it arrives (pass-through tee). */
  onStderr?: (chunk: Buffer) => void;
}

export interface VsockExecResult {
  exitCode: number;
  /**
   * Concatenated stdout bytes, decoded as UTF-8. Always `""` when the
   * caller passed `onStdout` — streaming callers already have the
   * bytes and a parallel buffered copy would defeat the streaming
   * (and at multi-GB volumes would crash with ERR_STRING_TOO_LONG).
   */
  stdout: string;
  /** Same shape as `stdout` for the stderr channel + `onStderr`. */
  stderr: string;
}

export const VsockExec = {
  /**
   * Run `cmd` inside the guest via the exec-agent. The command string
   * is passed verbatim to `sh -c` inside the guest, so shell syntax
   * (pipes, redirection, env) works.
   *
   * Resolves once the agent returns an exit code. Rejects only on I/O
   * failure or timeout — a non-zero exit is a normal result; the
   * caller decides what to do.
   *
   * The TCP UDS → vsock bridge accepts host-side connections even
   * before the guest has bound its side of port 1978 (the agent is
   * started by the workload, which has to wait for the kernel to
   * reach userspace). Such early connections get immediately reset
   * when the bridge tries to forward them. We retry on those resets
   * until the agent is actually listening.
   */
  /**
   * @throws {ExecError} EXEC_AGENT_UNAVAILABLE (retryable) |
   *   EXEC_AGENT_TIMEOUT (retryable) | EXEC_PROTOCOL
   */
  async run(udsPath: string, cmd: string, opts: VsockExecOptions = {}): Promise<VsockExecResult> {
    const connectTimeout = opts.connectTimeoutMs ?? 30_000;
    const retryMs = opts.retryMs ?? 250;
    const deadline = Date.now() + connectTimeout;
    debug("run uds=%s cmd=%j connectTimeoutMs=%d", udsPath, cmd, connectTimeout);
    const t0 = Date.now();
    let lastErr: Error | null = null;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      const socket = await connectWithRetry(udsPath, {
        ...opts,
        connectTimeoutMs: Math.max(0, deadline - Date.now()),
      });
      try {
        const res = await runOnSocket(socket, cmd, opts);
        debug(
          "run done attempt=%d exit=%d stdout=%dB stderr=%dB elapsed=%dms",
          attempt,
          res.exitCode,
          res.stdout.length,
          res.stderr.length,
          Date.now() - t0,
        );
        return res;
      } catch (err) {
        lastErr = err as Error;
        // EPIPE on write / unexpected close-before-X — the agent
        // probably wasn't listening yet. Retry the whole command.
        if (!isTransientAgentError(lastErr)) {
          debug("run failed (non-transient) attempt=%d err=%s", attempt, lastErr.message);
          throw lastErr;
        }
        debug(
          "run transient err attempt=%d code=%s msg=%s — retrying",
          attempt,
          (lastErr as Error & { code?: string }).code,
          lastErr.message,
        );
      } finally {
        await endSocket(socket);
      }
      await new Promise((r) => setTimeout(r, retryMs));
    }
    debug("run gave up after %dms attempts=%d", connectTimeout, attempt);
    throw new ExecError(
      "EXEC_AGENT_UNAVAILABLE",
      `VsockExec.run: agent did not respond within ${connectTimeout}ms: ${lastErr?.message ?? "no error"}`,
      { retryable: true, cause: lastErr ?? undefined },
    );
  },

  /**
   * PTY-mode session against the exec-agent (#133). Bytes flow
   * bidirectionally between `opts.stdin` (host keystrokes) and
   * `opts.stdout` (workload's pty output); the returned handle's
   * `.resize(cols, rows)` propagates window-size changes to the
   * guest's `ioctl(TIOCSWINSZ)`, and `.cancel()` disconnects (the
   * agent then closes its master fd, which sends SIGHUP to the
   * workload's session and reaps the child).
   *
   * Resolves with `{ exitCode }` once the workload exits and the
   * agent emits the X frame. The stdin listener attaches eagerly —
   * the caller is responsible for putting the host terminal in raw
   * mode beforehand (so Ctrl-C, arrows, etc. reach the guest as
   * untranslated bytes) and restoring it after `result` settles.
   *
   * Connect retries are intentionally absent here: PTY sessions are
   * always against an already-running VM whose agent is up. If the
   * UDS isn't reachable on the first try, that's a real error worth
   * surfacing — not a transient bring-up race like the `run()` path.
   */
  startPty(udsPath: string, cmd: string, opts: VsockExecPtyOptions): VsockExecPtyHandle {
    return startPtyImpl(udsPath, cmd, opts);
  },
} as const;

export interface VsockExecPtyOptions {
  /** Initial window size; the guest passes this to forkpty()'s winp. */
  cols: number;
  rows: number;
  /**
   * Host-side input source. Each `data` chunk is forwarded as an
   * `I <n>\n<bytes>` frame. Caller wires `process.stdin` (in raw
   * mode) here for an interactive shell.
   */
  stdin: Readable;
  /**
   * Host-side sink for PTY master output (`O <n>\n<bytes>` frames).
   * Caller wires `process.stdout`.
   */
  stdout: Writable;
  /** Connect timeout (ms). Default 5000 — agent should already be up. */
  connectTimeoutMs?: number;
}

export interface VsockExecPtyResult {
  exitCode: number;
}

export interface VsockExecPtyHandle {
  /** Resolves with the workload's exit code once X arrives. */
  readonly result: Promise<VsockExecPtyResult>;
  /** Send a TIOCSWINSZ update. Hook from host's SIGWINCH. */
  resize(cols: number, rows: number): void;
  /** Disconnect; agent will SIGHUP the workload. */
  cancel(): void;
}

function isTransientAgentError(err: Error): boolean {
  // Node tags socket errors with `code`; cast narrowly.
  const code = (err as Error & { code?: string }).code;
  if (code === "EPIPE" || code === "ECONNRESET") {
    return true;
  }
  return /agent closed connection before X frame/.test(err.message);
}

// EXEC's guest-side `readLine` uses a 4096-byte buffer (see
// packages/microvm/assets/exec-agent.zig). Anything approaching that
// length must take the EXEC2 path or the agent will overflow and
// log "bad header". 3500 leaves comfortable slack for the `EXEC `
// prefix, the trailing `\n`, and minor encoding overhead.
const EXEC_LEGACY_MAX_BYTES = 3500;

async function runOnSocket(
  socket: Socket,
  cmd: string,
  opts: VsockExecOptions,
): Promise<VsockExecResult> {
  // Newline-free cmds use the legacy `EXEC <cmd>\n` opcode so older
  // agents (rootfs images that pre-date #112) still work. Anything with
  // an embedded newline — or anything that wouldn't fit in the agent's
  // line buffer — goes through the length-prefixed EXEC2 frame.
  const cmdBytes = Buffer.byteLength(cmd, "utf8");
  if (/\r|\n/.test(cmd) || cmdBytes > EXEC_LEGACY_MAX_BYTES) {
    const buf = Buffer.from(cmd, "utf8");
    socket.write(`EXEC2 ${buf.length}\n`);
    socket.write(buf);
  } else {
    socket.write(`EXEC ${cmd}\n`);
  }

  return new Promise<VsockExecResult>((done, fail) => {
    const stdoutBufs: Buffer[] = [];
    const stderrBufs: Buffer[] = [];
    let exitCode: number | null = null;

    // Parser state.
    let buf: Buffer = Buffer.alloc(0);
    // When in a payload phase, `awaitingBytes` > 0; otherwise we're
    // looking for the next header line.
    let awaitingBytes = 0;
    let payloadTag: "O" | "E" | null = null;

    // `null` (or `Infinity`) disables the wall-clock ceiling — the
    // command lives until it exits on its own or the VM goes away. The
    // default 5-min cap is intentional for one-shot install/build steps
    // where exceeding it means something's wedged; long-running
    // siblings (dev servers, watchers) should opt out explicitly.
    const deadlineOpt = opts.execTimeoutMs;
    const deadline =
      deadlineOpt === null || deadlineOpt === Infinity ? null : (deadlineOpt ?? 5 * 60 * 1000);
    const timer =
      deadline === null
        ? null
        : setTimeout(() => {
            fail(
              new ExecError(
                "EXEC_AGENT_TIMEOUT",
                `VsockExec.run: timed out after ${deadline}ms (default). ` +
                  `Long-running siblings (dev servers, watchers) should pass ` +
                  `{ execTimeoutMs: null } to disable this ceiling.`,
                { retryable: true },
              ),
            );
            socket.destroy();
          }, deadline);
    timer?.unref();

    const finish = () => {
      if (timer) {
        clearTimeout(timer);
      }
      if (exitCode === null) {
        fail(
          new ExecError(
            "EXEC_AGENT_UNAVAILABLE",
            "VsockExec.run: agent closed connection before X frame",
            { retryable: true },
          ),
        );
      } else {
        done({
          exitCode,
          stdout: Buffer.concat(stdoutBufs).toString("utf8"),
          stderr: Buffer.concat(stderrBufs).toString("utf8"),
        });
      }
    };

    const step = () => {
      // Consume as much of the buffer as we can. Loop until we need
      // more bytes to make progress.
      while (true) {
        if (awaitingBytes > 0) {
          if (buf.length === 0) {
            return;
          }
          const take = Math.min(awaitingBytes, buf.length);
          const chunk = buf.subarray(0, take);
          buf = buf.subarray(take);
          awaitingBytes -= take;
          // Buffer for the resolved-result string field only when no
          // streaming callback is set. Callers that pass `onStdout` /
          // `onStderr` already have the bytes — keeping a parallel copy
          // here costs RAM and, at >~512 MiB cumulative, breaks
          // `Buffer.concat(...).toString("utf8")` in `finish()` with
          // ERR_STRING_TOO_LONG (V8's max string length). Streaming
          // callers see `stdout` / `stderr` come back as empty strings,
          // which is the contract: opt into the callback, take the
          // bytes there.
          if (payloadTag === "O") {
            if (opts.onStdout) {
              opts.onStdout(chunk);
            } else {
              stdoutBufs.push(chunk);
            }
          } else if (payloadTag === "E") {
            if (opts.onStderr) {
              opts.onStderr(chunk);
            } else {
              stderrBufs.push(chunk);
            }
          }
          if (awaitingBytes === 0) {
            payloadTag = null;
          }
          continue;
        }
        // Header phase: look for \n.
        const nl = buf.indexOf(0x0a);
        if (nl === -1) {
          return;
        }
        const line = buf.subarray(0, nl).toString("ascii");
        buf = buf.subarray(nl + 1);
        const [tag, nStr] = line.split(" ");
        if (tag === "X") {
          exitCode = Number.parseInt(nStr ?? "0", 10);
          return;
        }
        if (tag !== "O" && tag !== "E") {
          // Unknown frame tag — treat as protocol error and end.
          fail(
            new ExecError("EXEC_PROTOCOL", `VsockExec: unknown frame tag ${JSON.stringify(tag)}`),
          );
          socket.destroy();
          return;
        }
        const n = Number.parseInt(nStr ?? "", 10);
        if (!Number.isFinite(n) || n < 0) {
          fail(
            new ExecError("EXEC_PROTOCOL", `VsockExec: bad frame length ${JSON.stringify(nStr)}`),
          );
          socket.destroy();
          return;
        }
        awaitingBytes = n;
        payloadTag = tag;
      }
    };

    socket.on("data", (data: Buffer) => {
      buf = buf.length === 0 ? data : Buffer.concat([buf, data]);
      try {
        step();
      } catch (e) {
        fail(e as Error);
        socket.destroy();
      }
    });
    socket.on("error", (err) => {
      if (timer) {
        clearTimeout(timer);
      }
      fail(err);
    });
    socket.on("close", () => {
      finish();
    });
  });
}

async function connectWithRetry(udsPath: string, opts: VsockExecOptions): Promise<Socket> {
  const totalMs = opts.connectTimeoutMs ?? 30_000;
  const deadline = Date.now() + totalMs;
  const retryMs = opts.retryMs ?? 250;
  let lastErr: Error | null = null;
  let attempt = 0;
  while (Date.now() < deadline) {
    attempt++;
    try {
      const s = await connectOnce(udsPath);
      if (attempt > 1) {
        debug("connect ok after attempt=%d", attempt);
      }
      return s;
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  debug(
    "connect gave up uds=%s after %dms attempts=%d lastErr=%s",
    udsPath,
    totalMs,
    attempt,
    lastErr?.message,
  );
  throw new ExecError(
    "EXEC_AGENT_UNAVAILABLE",
    `VsockExec: could not reach ${udsPath} within ${totalMs}ms: ${lastErr?.message ?? "no error"}`,
    { retryable: true, cause: lastErr ?? undefined },
  );
}

function connectOnce(udsPath: string): Promise<Socket> {
  return new Promise((done, fail) => {
    const s = netConnect(udsPath);
    const onErr = (e: Error) => {
      s.removeListener("connect", onConnect);
      fail(e);
    };
    const onConnect = () => {
      s.removeListener("error", onErr);
      done(s);
    };
    s.once("error", onErr);
    s.once("connect", onConnect);
  });
}

function endSocket(s: Socket): Promise<void> {
  return new Promise((done) => {
    if (s.destroyed) {
      done();
      return;
    }
    s.once("close", () => done());
    s.end();
  });
}

// Wire `cols`/`rows` + the existing `cmd` into the PTY opcode header,
// then plug bidirectional pumps onto an already-connected socket. Why
// a separate helper: keeps `startPty` readable — the public method is
// "build a handle, kick off connect+pumps, return"; the actual frame
// machinery lives here.
function startPtyImpl(udsPath: string, cmd: string, opts: VsockExecPtyOptions): VsockExecPtyHandle {
  let socket: Socket | null = null;
  let exitCode: number | null = null;
  let settled = false;
  let resolveResult: (r: VsockExecPtyResult) => void;
  let rejectResult: (e: Error) => void;
  const result = new Promise<VsockExecPtyResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  // O-frame parser state: we may receive partial frames across
  // socket data events. `awaitingBytes` > 0 means we're inside an
  // O payload; otherwise we're scanning for the next header line.
  let parseBuf: Buffer = Buffer.alloc(0);
  let awaitingBytes = 0;

  const reject = (err: Error) => {
    if (settled) {
      return;
    }
    settled = true;
    rejectResult(err);
    if (socket && !socket.destroyed) {
      socket.destroy();
    }
  };

  const resolve = () => {
    if (settled) {
      return;
    }
    settled = true;
    if (exitCode === null) {
      rejectResult(
        new ExecError("EXEC_AGENT_UNAVAILABLE", "VsockExec.startPty: agent closed before X frame", {
          retryable: false,
        }),
      );
      return;
    }
    resolveResult({ exitCode });
  };

  const onSocketData = (data: Buffer) => {
    parseBuf = parseBuf.length === 0 ? data : Buffer.concat([parseBuf, data]);
    while (true) {
      if (awaitingBytes > 0) {
        if (parseBuf.length === 0) {
          return;
        }
        const take = Math.min(awaitingBytes, parseBuf.length);
        const chunk = parseBuf.subarray(0, take);
        parseBuf = parseBuf.subarray(take);
        awaitingBytes -= take;
        opts.stdout.write(chunk);
        continue;
      }
      const nl = parseBuf.indexOf(0x0a);
      if (nl === -1) {
        return;
      }
      const line = parseBuf.subarray(0, nl).toString("ascii");
      parseBuf = parseBuf.subarray(nl + 1);
      const [tag, nStr] = line.split(" ");
      if (tag === "X") {
        exitCode = Number.parseInt(nStr ?? "0", 10);
        // Agent will close right after; wait for `close` event so we
        // don't race the rest of the buffered O bytes.
        return;
      }
      if (tag !== "O") {
        reject(new ExecError("EXEC_PROTOCOL", `VsockExec.startPty: unknown PTY frame tag ${tag}`));
        return;
      }
      const n = Number.parseInt(nStr ?? "", 10);
      if (!Number.isFinite(n) || n < 0) {
        reject(
          new ExecError(
            "EXEC_PROTOCOL",
            `VsockExec.startPty: bad O frame length ${JSON.stringify(nStr)}`,
          ),
        );
        return;
      }
      awaitingBytes = n;
    }
  };

  const onStdinData = (chunk: Buffer | string) => {
    if (!socket || socket.destroyed) {
      return;
    }
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    if (buf.length === 0) {
      return;
    }
    // I <n>\n<bytes>. Two writes are fine — TCP-over-vsock will pass
    // the bytes through in order, and the guest's readLine + readExact
    // pair handles the split correctly.
    socket.write(`I ${buf.length}\n`);
    socket.write(buf);
  };

  // Kick off the connect + setup. We don't retry: the caller is
  // attaching to an already-running VM whose agent is up. A first-try
  // failure is real.
  void (async () => {
    try {
      const connectTimeoutMs = opts.connectTimeoutMs ?? 5_000;
      socket = await connectOnceWithTimeout(udsPath, connectTimeoutMs);
      const cmdBuf = Buffer.from(cmd, "utf8");
      socket.write(`PTY ${opts.cols} ${opts.rows} ${cmdBuf.length}\n`);
      if (cmdBuf.length > 0) {
        socket.write(cmdBuf);
      }
      socket.on("data", onSocketData);
      socket.on("error", (err) => reject(err));
      socket.on("close", () => {
        opts.stdin.removeListener("data", onStdinData);
        resolve();
      });
      opts.stdin.on("data", onStdinData);
      debug("startPty connected uds=%s cols=%d rows=%d", udsPath, opts.cols, opts.rows);
    } catch (err) {
      reject(err as Error);
    }
  })();

  return {
    result,
    resize(cols, rows) {
      if (!socket || socket.destroyed) {
        return;
      }
      socket.write(`R ${cols} ${rows}\n`);
    },
    cancel() {
      if (socket && !socket.destroyed) {
        socket.destroy();
      }
    },
  };
}

// One-shot connect with an explicit timeout. Distinct from
// `connectWithRetry` because PTY sessions don't want the bring-up
// retry loop — see startPty's comment.
function connectOnceWithTimeout(udsPath: string, timeoutMs: number): Promise<Socket> {
  return new Promise((done, fail) => {
    const s = netConnect(udsPath);
    const timer = setTimeout(() => {
      s.destroy();
      fail(
        new ExecError(
          "EXEC_AGENT_UNAVAILABLE",
          `VsockExec.startPty: connect to ${udsPath} timed out after ${timeoutMs}ms`,
          { retryable: false },
        ),
      );
    }, timeoutMs);
    s.once("error", (e) => {
      clearTimeout(timer);
      fail(e);
    });
    s.once("connect", () => {
      clearTimeout(timer);
      done(s);
    });
  });
}
