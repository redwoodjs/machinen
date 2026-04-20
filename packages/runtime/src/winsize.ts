// Host-side terminal-resize forwarder — #51 M1.5 follow-up.
//
// The Supervisor already knows how to reshape the host pty on
// SIGWINCH. What it can't do is tell the GUEST to reshape its own
// ttys. The vsock bridge (#44) gives us a byte pipe into the guest;
// this class wraps that pipe with a tiny "C R\n" protocol that a
// matching guest agent (`test-fixtures/winsize-agent.py`) translates
// into `ioctl(fd, TIOCSWINSZ)` on /dev/console + /dev/ttyAMA0 + any
// tty-owning process's fd 0/1/2.
//
// Usage:
//
//   // 1. boot the VMM with a vsock port mapped through
//   const vm = await spawn({
//     binary: VMM,
//     env: { MACHINEN_VSOCK: "in:1974:/tmp/machinen-winsize.sock" },
//   });
//
//   // 2. connect once the guest agent is listening
//   const ws = await VsockWinsize.connect("/tmp/machinen-winsize.sock");
//
//   // 3. wrap the vm's resize (or hook the Supervisor's
//   //    forwardResize path) so every host resize fans out to both
//   //    the host pty (if spawnPty was used) and the guest agent
//   ws.send(process.stdout.columns ?? 80, process.stdout.rows ?? 24);

import { connect as netConnect, type Socket } from "node:net";

export interface VsockWinsizeOptions {
  /** How long to keep retrying the UDS connect. Default 10s. */
  timeoutMs?: number;
  /** Poll interval in ms while retrying. Default 250. */
  retryMs?: number;
}

export class VsockWinsize {
  private socket: Socket;
  private closed = false;
  private lastSent: { cols: number; rows: number } | null = null;

  private constructor(socket: Socket) {
    this.socket = socket;
    socket.on("error", () => {
      this.closed = true;
    });
    socket.on("close", () => {
      this.closed = true;
    });
  }

  /**
   * Open a host Unix socket and keep retrying until the vsock bridge
   * + guest agent wire themselves up. Resolves once the TCP-like
   * connect completes — the agent may still be registering the
   * vsock listener on its side, but any bytes we send will be
   * buffered by the bridge's connection table.
   */
  static async connect(udsPath: string, opts: VsockWinsizeOptions = {}): Promise<VsockWinsize> {
    const deadline = Date.now() + (opts.timeoutMs ?? 10_000);
    const retryMs = opts.retryMs ?? 250;
    // First successful connect wins; any earlier ENOENT / ECONNREFUSED
    // just means the bridge hasn't opened the UDS yet.
    let lastErr: Error | null = null;
    while (Date.now() < deadline) {
      try {
        const s = await connectOnce(udsPath);
        return new VsockWinsize(s);
      } catch (err) {
        lastErr = err as Error;
        await new Promise((r) => setTimeout(r, retryMs));
      }
    }
    throw new Error(
      `VsockWinsize.connect(${udsPath}) gave up after ${opts.timeoutMs ?? 10_000}ms: ${lastErr?.message ?? "no error"}`,
    );
  }

  /**
   * Send a new size. Idempotent against the most recent send — repeats
   * are dropped so a chatty SIGWINCH doesn't spam the bridge.
   */
  send(cols: number, rows: number): void {
    if (this.closed) return;
    if (this.lastSent && this.lastSent.cols === cols && this.lastSent.rows === rows) {
      return;
    }
    this.lastSent = { cols, rows };
    this.socket.write(`${cols} ${rows}\n`);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.socket.end();
  }
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
