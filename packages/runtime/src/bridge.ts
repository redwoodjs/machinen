// Generic guest↔host RPC channel — see #217.
//
// Pairs with vsock port 1979 inside the guest. Boot wires the VMM with
//   MACHINEN_VSOCK=...,out:1979:/tmp/machinen-bridge.sock
// so any guest process that connects to AF_VSOCK CID 2 port 1979 gets
// bridged to this UDS, where the runtime hands the connection to a
// Cap'n Web `RpcSession` whose `localMain` is the host-side target.
//
// The user-facing API is just a JS class extending `RpcTarget` from
// capnweb. Methods on the class are the bridge surface; nothing else is
// exposed. `boot({ bridge })` takes a factory `(vm) => new MyApi(vm)`
// so the target can hold a reference to the VmHandle without the
// chicken-and-egg of `vm.bridge = new MyApi(vm)`. `vm.bridge` is a
// writable property — assigning a new target affects sessions opened
// after the assignment; in-flight sessions keep their original target.
//
// Wire framing: newline-delimited Cap'n Web messages. capnweb's
// `RpcTransport` is message-oriented (one `send`/`receive` per logical
// message), so we frame each message with a trailing `\n`. capnweb's
// own messages are single-line JSON arrays — never contain raw
// newlines — so newline framing is unambiguous.

import debugLib from "debug";
import { RpcSession, type RpcTarget, type RpcTransport } from "capnweb";
import { createServer, type Server, type Socket } from "node:net";

const debug = debugLib("machinen:bridge");

/** Default vsock port the guest connects to. Documented; not configurable. */
export const BRIDGE_VSOCK_PORT = 1979;

/** Bound on a single message frame. Anything larger drops the connection.
 *  Mirrors the exec/file agent caps so a malicious or buggy guest can't
 *  OOM the runtime by spamming an unterminated line. */
const MAX_FRAME_BYTES = 64 * 1024;

/**
 * Looked up on each new connection so live `vm.bridge =` swaps take
 * effect for sessions opened after the swap. Returning `undefined`
 * means "no bridge target configured" — connections in that state
 * see an empty surface (every method call resolves to a "method not
 * found"-shaped Cap'n Web error).
 */
export type BridgeTargetGetter = () => RpcTarget | undefined;

export interface BridgeServerOptions {
  /** UDS path to listen on. Created (and removed on `close`) by the server. */
  udsPath: string;
  /** Per-connection lookup of the current bridge target. */
  getTarget: BridgeTargetGetter;
}

export interface BridgeServer {
  /** Stop accepting new connections, close existing ones. Idempotent. */
  close(): Promise<void>;
}

/**
 * Start a bridge UDS server listening on `udsPath`. Each connection
 * is wrapped in an `RpcSession` whose `localMain` is the target
 * `getTarget()` returns at the time the connection is accepted.
 */
export async function startBridgeServer(opts: BridgeServerOptions): Promise<BridgeServer> {
  const sessions = new Set<{ sock: Socket; session: RpcSession }>();
  const server: Server = createServer((sock) => {
    sock.on("error", (err) => debug("socket error: %s", err.message));
    const target = opts.getTarget();
    const transport = socketTransport(sock);
    const session = new RpcSession(transport, target);
    const entry = { sock, session };
    sessions.add(entry);
    sock.on("close", () => sessions.delete(entry));
  });
  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(opts.udsPath, () => {
      server.off("error", fail);
      done();
    });
  });
  debug("listening udsPath=%s", opts.udsPath);

  let closed = false;
  return {
    async close() {
      if (closed) {
        return;
      }
      closed = true;
      for (const { sock } of sessions) {
        sock.destroy();
      }
      sessions.clear();
      await new Promise<void>((done) => server.close(() => done()));
      debug("closed udsPath=%s", opts.udsPath);
    },
  };
}

/**
 * Adapt a Node `Socket` to capnweb's `RpcTransport` — newline-framed
 * UTF-8 strings in both directions. Receives queue messages until the
 * session calls `receive()`; receives queue resolvers until a message
 * arrives. Either side closing the socket rejects pending receives
 * (which capnweb propagates as a session error).
 */
function socketTransport(sock: Socket): RpcTransport {
  let buf: Buffer = Buffer.alloc(0);
  const queue: string[] = [];
  const waiters: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  let closeError: Error | undefined;

  const flushClose = () => {
    while (waiters.length > 0) {
      waiters.shift()!.reject(closeError ?? new Error("bridge socket closed"));
    }
  };

  sock.on("data", (chunk: Buffer) => {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    while (true) {
      const nl = buf.indexOf(0x0a);
      if (nl < 0) {
        if (buf.length > MAX_FRAME_BYTES) {
          debug("dropping connection: frame exceeds %d bytes", MAX_FRAME_BYTES);
          closeError = new Error(`bridge frame exceeds ${MAX_FRAME_BYTES} bytes`);
          sock.destroy();
          return;
        }
        break;
      }
      if (nl > MAX_FRAME_BYTES) {
        debug("dropping frame: %d bytes > %d", nl, MAX_FRAME_BYTES);
        buf = buf.subarray(nl + 1);
        continue;
      }
      const line = buf.subarray(0, nl).toString("utf8");
      buf = buf.subarray(nl + 1);
      if (line.length === 0) {
        continue;
      }
      if (waiters.length > 0) {
        waiters.shift()!.resolve(line);
      } else {
        queue.push(line);
      }
    }
  });
  sock.on("close", () => {
    closeError ??= new Error("bridge socket closed");
    flushClose();
  });
  sock.on("error", (err) => {
    closeError = err;
    flushClose();
  });

  return {
    async send(message: string) {
      if (!sock.writable) {
        throw closeError ?? new Error("bridge socket not writable");
      }
      await new Promise<void>((done, fail) => {
        sock.write(message + "\n", (err) => (err ? fail(err) : done()));
      });
    },
    receive(): Promise<string> {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      if (closeError) {
        return Promise.reject(closeError);
      }
      return new Promise<string>((resolve, reject) => waiters.push({ resolve, reject }));
    },
    abort(reason: unknown) {
      closeError = reason instanceof Error ? reason : new Error(String(reason));
      sock.destroy();
    },
  };
}
