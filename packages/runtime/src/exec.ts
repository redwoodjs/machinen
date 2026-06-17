// Host-side exec client — pairs with assets/exec-agent.zig.
//
// Opens the UDS the vsock bridge is listening on, sends the cmd, demuxes
// the framed output stream until an `X <code>\n` terminator, returns
// stdout/stderr + the exit code.
//
// Guest exec-agent wire opcodes:
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
//     image: "./rootfs-debian-arm64.tar.gz", // or rootfs-debian-amd64.tar.gz
//     cmd: ["/sbin/machinen-exec-agent"],
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
    return runWithRetry(udsPath, opts, "run", (socket) => runOnSocket(socket, cmd, opts));
  },

  async reseedVmstate(
    udsPath: string,
    seedHex: string,
    opts: VsockExecOptions = {},
  ): Promise<VsockExecResult> {
    return runWithRetry(udsPath, opts, "reseedVmstate", (socket) =>
      runReseedOnSocket(socket, seedHex, opts),
    );
  },

  async syncVmstate(udsPath: string, opts: VsockExecOptions = {}): Promise<VsockExecResult> {
    return runWithRetry(udsPath, opts, "syncVmstate", (socket) => runSyncOnSocket(socket, opts));
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

  async listPtySessions(udsPath: string): Promise<Array<{ name: string; pid: number }>> {
    const socket = await connectWithRetry(udsPath, {});
    try {
      const res = await runFramedRequestOnSocket(
        socket,
        () => {
          socket.write("PTYLIST\n");
        },
        {},
      );
      return parsePtySessionList(res.stdout);
    } finally {
      await endSocket(socket);
    }
  },

  async killPtySession(udsPath: string, name: string): Promise<boolean> {
    validatePtySessionName(name);
    const socket = await connectWithRetry(udsPath, {});
    try {
      const nameBuf = Buffer.from(name, "utf8");
      const res = await runFramedRequestOnSocket(
        socket,
        () => {
          socket.write(`PTYKILL ${nameBuf.length}\n`);
          socket.write(nameBuf);
        },
        {},
      );
      return res.exitCode === 0;
    } finally {
      await endSocket(socket);
    }
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
  /** Named persistent PTY session to create or reattach. Defaults to `default`; pass `false` for a one-shot PTY. */
  sessionName?: string | false;
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

async function runWithRetry(
  udsPath: string,
  opts: VsockExecOptions,
  label: string,
  runSocket: (socket: Socket) => Promise<VsockExecResult>,
): Promise<VsockExecResult> {
  const connectTimeout = opts.connectTimeoutMs ?? 30_000;
  const retryMs = opts.retryMs ?? 250;
  const deadline = Date.now() + connectTimeout;
  debug("%s uds=%s connectTimeoutMs=%d", label, udsPath, connectTimeout);
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
      const res = await runSocket(socket);
      debug(
        "%s done attempt=%d exit=%d stdout=%dB stderr=%dB elapsed=%dms",
        label,
        attempt,
        res.exitCode,
        res.stdout.length,
        res.stderr.length,
        Date.now() - t0,
      );
      return res;
    } catch (err) {
      lastErr = err as Error;
      if (!isTransientAgentError(lastErr)) {
        debug("%s failed (non-transient) attempt=%d err=%s", label, attempt, lastErr.message);
        throw lastErr;
      }
      debug(
        "%s transient err attempt=%d code=%s msg=%s — retrying",
        label,
        attempt,
        (lastErr as Error & { code?: string }).code,
        lastErr.message,
      );
    } finally {
      await endSocket(socket);
    }
    await new Promise((r) => setTimeout(r, retryMs));
  }
  debug("%s gave up after %dms attempts=%d", label, connectTimeout, attempt);
  throw new ExecError(
    "EXEC_AGENT_UNAVAILABLE",
    `VsockExec.${label}: agent did not respond within ${connectTimeout}ms: ${lastErr?.message ?? "no error"}`,
    { retryable: true, cause: lastErr ?? undefined },
  );
}

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
    return runFramedRequestOnSocket(
      socket,
      () => {
        socket.write(`EXEC2 ${buf.length}\n`);
        socket.write(buf);
      },
      opts,
    );
  }
  return runFramedRequestOnSocket(
    socket,
    () => {
      socket.write(`EXEC ${cmd}\n`);
    },
    opts,
  );
}

function runReseedOnSocket(
  socket: Socket,
  seedHex: string,
  opts: VsockExecOptions,
): Promise<VsockExecResult> {
  const buf = Buffer.from(seedHex, "ascii");
  return runFramedRequestOnSocket(
    socket,
    () => {
      socket.write(`RESEED ${buf.length}\n`);
      socket.write(buf);
    },
    opts,
  );
}

function runSyncOnSocket(socket: Socket, opts: VsockExecOptions): Promise<VsockExecResult> {
  return runFramedRequestOnSocket(
    socket,
    () => {
      socket.write("SYNC\n");
    },
    opts,
  );
}

function runFramedRequestOnSocket(
  socket: Socket,
  writeRequest: () => void,
  opts: VsockExecOptions,
): Promise<VsockExecResult> {
  writeRequest();

  return new Promise<VsockExecResult>((done, fail) => {
    const parser: ExecFrameParserState = {
      stdoutBufs: [],
      stderrBufs: [],
      exitCode: null,
      buf: Buffer.alloc(0),
      awaitingBytes: 0,
      payloadTag: null,
      opts,
    };

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
      if (parser.exitCode === null) {
        fail(
          new ExecError(
            "EXEC_AGENT_UNAVAILABLE",
            "VsockExec.run: agent closed connection before X frame",
            { retryable: true },
          ),
        );
      } else {
        done({
          exitCode: parser.exitCode,
          stdout: Buffer.concat(parser.stdoutBufs).toString("utf8"),
          stderr: Buffer.concat(parser.stderrBufs).toString("utf8"),
        });
      }
    };

    socket.on("data", (data: Buffer) => {
      parser.buf = parser.buf.length === 0 ? data : Buffer.concat([parser.buf, data]);
      try {
        stepExecParser(parser);
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

type ExecPayloadTag = "O" | "E";

interface ExecFrameParserState {
  stdoutBufs: Buffer[];
  stderrBufs: Buffer[];
  exitCode: number | null;
  buf: Buffer;
  awaitingBytes: number;
  payloadTag: ExecPayloadTag | null;
  opts: VsockExecOptions;
}

function stepExecParser(state: ExecFrameParserState): void {
  while (true) {
    if (state.awaitingBytes > 0) {
      if (!consumeExecPayload(state)) {
        return;
      }
      continue;
    }
    const header = readExecHeader(state);
    if (!header) {
      return;
    }
    if (header.tag === "X") {
      state.exitCode = header.exitCode;
      return;
    }
    state.awaitingBytes = header.length;
    state.payloadTag = header.tag;
  }
}

function consumeExecPayload(state: ExecFrameParserState): boolean {
  if (state.buf.length === 0) {
    return false;
  }
  const take = Math.min(state.awaitingBytes, state.buf.length);
  const chunk = state.buf.subarray(0, take);
  state.buf = state.buf.subarray(take);
  state.awaitingBytes -= take;
  deliverExecPayload(state, chunk);
  clearPayloadTagIfComplete(state);
  return true;
}

function deliverExecPayload(state: ExecFrameParserState, chunk: Buffer): void {
  if (state.payloadTag === "O") {
    pushExecPayload(chunk, state.opts.onStdout, state.stdoutBufs);
    return;
  }
  if (state.payloadTag === "E") {
    pushExecPayload(chunk, state.opts.onStderr, state.stderrBufs);
  }
}

function pushExecPayload(
  chunk: Buffer,
  onChunk: ((chunk: Buffer) => void) | undefined,
  sink: Buffer[],
): void {
  if (onChunk) {
    onChunk(chunk);
  } else {
    sink.push(chunk);
  }
}

function clearPayloadTagIfComplete(state: ExecFrameParserState): void {
  if (state.awaitingBytes === 0) {
    state.payloadTag = null;
  }
}

type ExecFrameHeader = { tag: "X"; exitCode: number } | { tag: ExecPayloadTag; length: number };

function readExecHeader(state: ExecFrameParserState): ExecFrameHeader | undefined {
  const nl = state.buf.indexOf(0x0a);
  if (nl === -1) {
    return undefined;
  }
  const line = state.buf.subarray(0, nl).toString("ascii");
  state.buf = state.buf.subarray(nl + 1);
  return parseExecHeaderLine(line);
}

function parseExecHeaderLine(line: string): ExecFrameHeader {
  const [tag, nStr] = line.split(" ");
  if (tag === "X") {
    return { tag, exitCode: Number.parseInt(nStr ?? "0", 10) };
  }
  if (tag !== "O" && tag !== "E") {
    throw new ExecError("EXEC_PROTOCOL", `VsockExec: unknown frame tag ${JSON.stringify(tag)}`);
  }
  const length = parseExecFrameLength(nStr);
  return { tag, length };
}

function parseExecFrameLength(nStr: string | undefined): number {
  const length = Number.parseInt(nStr ?? "", 10);
  if (!Number.isFinite(length) || length < 0) {
    throw new ExecError("EXEC_PROTOCOL", `VsockExec: bad frame length ${JSON.stringify(nStr)}`);
  }
  return length;
}

interface ConnectRetrySettings {
  totalMs: number;
  deadline: number;
  retryMs: number;
}

interface ConnectRetryState {
  attempt: number;
  lastErr: Error | null;
}

async function connectWithRetry(udsPath: string, opts: VsockExecOptions): Promise<Socket> {
  const settings = connectRetrySettings(opts);
  const state: ConnectRetryState = { attempt: 0, lastErr: null };
  while (Date.now() < settings.deadline) {
    const socket = await tryConnectAttempt(udsPath, settings.retryMs, state);
    if (socket) {
      return socket;
    }
  }
  throw connectRetryError(udsPath, settings.totalMs, state);
}

function connectRetrySettings(opts: VsockExecOptions): ConnectRetrySettings {
  const totalMs = opts.connectTimeoutMs ?? 30_000;
  return {
    totalMs,
    deadline: Date.now() + totalMs,
    retryMs: opts.retryMs ?? 250,
  };
}

async function tryConnectAttempt(
  udsPath: string,
  retryMs: number,
  state: ConnectRetryState,
): Promise<Socket | null> {
  state.attempt++;
  try {
    const socket = await connectOnce(udsPath);
    logRetriedConnect(state.attempt);
    return socket;
  } catch (err) {
    state.lastErr = err as Error;
    await new Promise((resolveSleep) => setTimeout(resolveSleep, retryMs));
    return null;
  }
}

function logRetriedConnect(attempt: number): void {
  if (attempt > 1) {
    debug("connect ok after attempt=%d", attempt);
  }
}

function connectRetryError(udsPath: string, totalMs: number, state: ConnectRetryState): ExecError {
  debug(
    "connect gave up uds=%s after %dms attempts=%d lastErr=%s",
    udsPath,
    totalMs,
    state.attempt,
    state.lastErr?.message,
  );
  return new ExecError(
    "EXEC_AGENT_UNAVAILABLE",
    `VsockExec: could not reach ${udsPath} within ${totalMs}ms: ${connectRetryMessage(state.lastErr)}`,
    { retryable: true, cause: state.lastErr ?? undefined },
  );
}

function connectRetryMessage(lastErr: Error | null): string {
  if (lastErr === null) {
    return "no error";
  }
  return lastErr.message;
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

interface PtyParserState {
  buffer: Buffer;
  awaitingBytes: number;
}

interface PtyParserHandlers {
  stdout: Writable;
  onExit: (code: number) => void;
  onError: (err: Error) => void;
}

type PtyFrameHeader =
  | { kind: "exit"; code: number }
  | { kind: "stdout"; bytes: number }
  | { kind: "error"; error: ExecError };

function createPtyParserState(): PtyParserState {
  return { buffer: Buffer.alloc(0), awaitingBytes: 0 };
}

function ingestPtyOutput(state: PtyParserState, data: Buffer, handlers: PtyParserHandlers): void {
  state.buffer = state.buffer.length === 0 ? data : Buffer.concat([state.buffer, data]);
  while (consumeNextPtyFrame(state, handlers)) {}
}

function consumeNextPtyFrame(state: PtyParserState, handlers: PtyParserHandlers): boolean {
  if (state.awaitingBytes > 0) {
    return consumePtyPayload(state, handlers.stdout);
  }
  const line = takePtyHeaderLine(state);
  return line === undefined ? false : handlePtyHeaderLine(state, line, handlers);
}

function consumePtyPayload(state: PtyParserState, stdout: Writable): boolean {
  if (state.buffer.length === 0) {
    return false;
  }
  const take = Math.min(state.awaitingBytes, state.buffer.length);
  stdout.write(state.buffer.subarray(0, take));
  state.buffer = state.buffer.subarray(take);
  state.awaitingBytes -= take;
  return true;
}

function takePtyHeaderLine(state: PtyParserState): string | undefined {
  const nl = state.buffer.indexOf(0x0a);
  if (nl === -1) {
    return undefined;
  }
  const line = state.buffer.subarray(0, nl).toString("ascii");
  state.buffer = state.buffer.subarray(nl + 1);
  return line;
}

function handlePtyHeaderLine(
  state: PtyParserState,
  line: string,
  handlers: PtyParserHandlers,
): boolean {
  const header = parsePtyHeaderLine(line);
  if (header.kind === "error") {
    handlers.onError(header.error);
    return false;
  }
  if (header.kind === "exit") {
    handlers.onExit(header.code);
    return false;
  }
  state.awaitingBytes = header.bytes;
  return true;
}

function parsePtyHeaderLine(line: string): PtyFrameHeader {
  const [tag, nStr] = line.split(" ");
  if (tag === "X") {
    return { kind: "exit", code: Number.parseInt(nStr ?? "0", 10) };
  }
  if (tag === "O") {
    return parsePtyOutputHeader(nStr);
  }
  return {
    kind: "error",
    error: new ExecError("EXEC_PROTOCOL", `VsockExec.startPty: unknown PTY frame tag ${tag}`),
  };
}

function parsePtyOutputHeader(nStr: string | undefined): PtyFrameHeader {
  const bytes = Number.parseInt(nStr ?? "", 10);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return {
      kind: "error",
      error: new ExecError(
        "EXEC_PROTOCOL",
        `VsockExec.startPty: bad O frame length ${JSON.stringify(nStr)}`,
      ),
    };
  }
  return { kind: "stdout", bytes };
}

function parsePtySessionList(stdout: string): Array<{ name: string; pid: number }> {
  return stdout
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
      const [name, pidStr] = line.split("\t");
      const pid = Number.parseInt(pidStr ?? "", 10);
      if (!name || !Number.isFinite(pid)) {
        throw new ExecError(
          "EXEC_PROTOCOL",
          `VsockExec.listPtySessions: bad row ${JSON.stringify(line)}`,
        );
      }
      return { name, pid };
    });
}

function validatePtySessionName(name: string): void {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(name)) {
    throw new ExecError(
      "EXEC_PROTOCOL",
      "PTY session names must be 1-64 characters and contain only letters, digits, dot, underscore, or dash",
    );
  }
}

const DEFAULT_PTY_SESSION_NAME = "default";

function writePtyStartFrame(socket: Socket, cmd: string, opts: VsockExecPtyOptions): void {
  const cmdBuf = Buffer.from(cmd, "utf8");
  if (opts.sessionName === false) {
    socket.write(`PTY ${opts.cols} ${opts.rows} ${cmdBuf.length}\n`);
    if (cmdBuf.length > 0) {
      socket.write(cmdBuf);
    }
    return;
  }
  const sessionName = opts.sessionName ?? DEFAULT_PTY_SESSION_NAME;
  validatePtySessionName(sessionName);
  const nameBuf = Buffer.from(sessionName, "utf8");
  socket.write(`PTYSESSION ${opts.cols} ${opts.rows} ${nameBuf.length} ${cmdBuf.length}\n`);
  socket.write(nameBuf);
  if (cmdBuf.length > 0) {
    socket.write(cmdBuf);
  }
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

  const parser = createPtyParserState();

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
    ingestPtyOutput(parser, data, {
      stdout: opts.stdout,
      onExit: (code) => {
        exitCode = code;
      },
      onError: reject,
    });
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
      writePtyStartFrame(socket, cmd, opts);
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
