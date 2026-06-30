// Host-side terminal-resize forwarder — #51 M1.5 follow-up.
//
// The Supervisor already knows how to reshape the host pty on
// SIGWINCH. What it can't do is tell the GUEST to reshape its own
// ttys. The vsock bridge (#44) gives us a byte pipe into the guest;
// this class wraps a native helper that connects to that pipe and
// forwards a tiny "C R\n" protocol to the guest agent
// (`assets/winsize-agent.zig`).

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { WinsizeError } from "./errors.ts";
import { resolveWinsizeShim } from "./native/winsize.ts";

export interface VsockWinsizeOptions {
  /** How long to keep retrying the UDS connect. Default 10s. */
  timeoutMs?: number;
  /** Poll interval in ms while retrying. Default 250. */
  retryMs?: number;
}

export class VsockWinsize {
  private child: ChildProcessWithoutNullStreams;
  private closed = false;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;
    child.on("error", () => {
      this.closed = true;
    });
    child.on("close", () => {
      this.closed = true;
    });
  }

  /**
   * Open a host Unix socket and keep retrying until the vsock bridge
   * + guest agent wire themselves up. Resolves once the native helper
   * connects; any bytes sent afterward are relayed to the bridge.
   */
  static async connect(udsPath: string, opts: VsockWinsizeOptions = {}): Promise<VsockWinsize> {
    const timeoutMs = opts.timeoutMs ?? 10_000;
    const retryMs = opts.retryMs ?? 250;
    const child = spawn(
      resolveWinsizeShim(),
      ["--timeout-ms", String(timeoutMs), "--retry-ms", String(retryMs), "--", udsPath],
      { stdio: "pipe" },
    );

    await waitForReady(child, udsPath, timeoutMs);
    return new VsockWinsize(child);
  }

  /**
   * Send a new size. Idempotence against the most recent send is owned
   * by the native helper so SIGWINCH storms do not spam the bridge.
   */
  // fallow-ignore-next-line unused-class-member
  send(cols: number, rows: number): void {
    if (this.closed) {
      return;
    }
    this.child.stdin.write(`${cols} ${rows}\n`);
  }

  // fallow-ignore-next-line unused-class-member
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.child.stdin.end();
  }
}

function waitForReady(
  child: ChildProcessWithoutNullStreams,
  udsPath: string,
  timeoutMs: number,
): Promise<void> {
  return new Promise((done, fail) => {
    let settled = false;
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(
        new WinsizeError(
          "WINSIZE_AGENT_UNAVAILABLE",
          `VsockWinsize.connect(${udsPath}) gave up after ${timeoutMs}ms: native helper did not report readiness`,
          { retryable: true },
        ),
      );
    }, timeoutMs + 1_000);

    const finish = (err?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.stdout.off("data", onStdout);
      child.stderr.off("data", onStderr);
      child.off("error", onError);
      child.off("exit", onExit);
      if (err) {
        fail(err);
      } else {
        done();
      }
    };
    const onStdout = (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
      if (stdout.includes("READY\n")) {
        finish();
      }
    };
    const onStderr = (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    };
    const onError = (err: Error) => {
      finish(
        new WinsizeError(
          "WINSIZE_AGENT_UNAVAILABLE",
          `VsockWinsize.connect(${udsPath}) failed to start native helper: ${err.message}`,
          { retryable: true, cause: err },
        ),
      );
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(
        new WinsizeError(
          "WINSIZE_AGENT_UNAVAILABLE",
          `VsockWinsize.connect(${udsPath}) gave up after ${timeoutMs}ms: ${stderr.trim() || `native helper exited ${code ?? signal ?? "without a status"}`}`,
          { retryable: true },
        ),
      );
    };

    child.stdout.on("data", onStdout);
    child.stderr.on("data", onStderr);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}
