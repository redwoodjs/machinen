// Host-side exec client — pairs with assets/exec-agent.zig.
//
// Opens the UDS the vsock bridge is listening on, sends `EXEC <cmd>\n`,
// demuxes the framed output stream until an `X <code>\n` terminator,
// returns stdout/stderr + the exit code.
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
import { ExecError } from "./errors.ts";

export interface VsockExecOptions {
  /** How long to keep retrying the UDS connect. Default 30s. */
  connectTimeoutMs?: number;
  /** Poll interval in ms while retrying. Default 250. */
  retryMs?: number;
  /** Cap total time spent on this command. Default 5 minutes. */
  execTimeoutMs?: number;
  /** Called with each stdout chunk as it arrives (pass-through tee). */
  onStdout?: (chunk: Buffer) => void;
  /** Called with each stderr chunk as it arrives (pass-through tee). */
  onStderr?: (chunk: Buffer) => void;
}

export interface VsockExecResult {
  exitCode: number;
  stdout: string;
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
   * @throws {ExecError} EXEC_CMD_INVALID | EXEC_AGENT_UNAVAILABLE (retryable) |
   *   EXEC_AGENT_TIMEOUT (retryable) | EXEC_PROTOCOL
   */
  async run(udsPath: string, cmd: string, opts: VsockExecOptions = {}): Promise<VsockExecResult> {
    if (/\r|\n/.test(cmd)) {
      throw new ExecError("EXEC_CMD_INVALID", "VsockExec.run: cmd must not contain newlines");
    }
    const connectTimeout = opts.connectTimeoutMs ?? 30_000;
    const retryMs = opts.retryMs ?? 250;
    const deadline = Date.now() + connectTimeout;
    let lastErr: Error | null = null;
    while (Date.now() < deadline) {
      const socket = await connectWithRetry(udsPath, {
        ...opts,
        connectTimeoutMs: Math.max(0, deadline - Date.now()),
      });
      try {
        return await runOnSocket(socket, cmd, opts);
      } catch (err) {
        lastErr = err as Error;
        // EPIPE on write / unexpected close-before-X — the agent
        // probably wasn't listening yet. Retry the whole command.
        if (!isTransientAgentError(lastErr)) {
          throw lastErr;
        }
      } finally {
        await endSocket(socket);
      }
      await new Promise((r) => setTimeout(r, retryMs));
    }
    throw new ExecError(
      "EXEC_AGENT_UNAVAILABLE",
      `VsockExec.run: agent did not respond within ${connectTimeout}ms: ${lastErr?.message ?? "no error"}`,
      { retryable: true, cause: lastErr ?? undefined },
    );
  },
} as const;

function isTransientAgentError(err: Error): boolean {
  // Node tags socket errors with `code`; cast narrowly.
  const code = (err as Error & { code?: string }).code;
  if (code === "EPIPE" || code === "ECONNRESET") {
    return true;
  }
  return /agent closed connection before X frame/.test(err.message);
}

async function runOnSocket(
  socket: Socket,
  cmd: string,
  opts: VsockExecOptions,
): Promise<VsockExecResult> {
  socket.write(`EXEC ${cmd}\n`);

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

    const deadline = opts.execTimeoutMs ?? 5 * 60 * 1000;
    const timer = setTimeout(() => {
      fail(
        new ExecError("EXEC_AGENT_TIMEOUT", `VsockExec.run: timed out after ${deadline}ms`, {
          retryable: true,
        }),
      );
      socket.destroy();
    }, deadline);
    timer.unref();

    const finish = () => {
      clearTimeout(timer);
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
          if (payloadTag === "O") {
            stdoutBufs.push(chunk);
            opts.onStdout?.(chunk);
          } else if (payloadTag === "E") {
            stderrBufs.push(chunk);
            opts.onStderr?.(chunk);
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
      clearTimeout(timer);
      fail(err);
    });
    socket.on("close", () => {
      finish();
    });
  });
}

async function connectWithRetry(udsPath: string, opts: VsockExecOptions): Promise<Socket> {
  const deadline = Date.now() + (opts.connectTimeoutMs ?? 30_000);
  const retryMs = opts.retryMs ?? 250;
  let lastErr: Error | null = null;
  while (Date.now() < deadline) {
    try {
      return await connectOnce(udsPath);
    } catch (err) {
      lastErr = err as Error;
      await new Promise((r) => setTimeout(r, retryMs));
    }
  }
  throw new ExecError(
    "EXEC_AGENT_UNAVAILABLE",
    `VsockExec: could not reach ${udsPath} within ${opts.connectTimeoutMs ?? 30_000}ms: ${lastErr?.message ?? "no error"}`,
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
