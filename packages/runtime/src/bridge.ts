// Generic guest↔host RPC channel — see #217.
//
// Pairs with vsock port 1979 inside the guest. Boot wires the VMM with
//   MACHINEN_VSOCK=...,out:1979:/tmp/machinen-bridge.sock
// so any guest process that connects to AF_VSOCK CID 2 port 1979 gets
// bridged to this UDS, where the runtime parses JSON-RPC 2.0 frames
// and dispatches to methods registered via `vm.expose(method, handler)`.
//
// Wire format (line-delimited JSON, one frame per line):
//   request:      {"jsonrpc":"2.0","id":<n|str>,"method":"<m>","params":<any?>}
//   notification: {"jsonrpc":"2.0","method":"<m>","params":<any?>}
//   response:     {"jsonrpc":"2.0","id":<n|str>,"result":<any>}
//   error:        {"jsonrpc":"2.0","id":<n|str|null>,"error":{"code":<n>,"message":<s>,"data":<any?>}}
//
// The runtime is intentionally agnostic to method names — there are no
// built-in handlers. Callers register whatever methods make sense for
// their VM. A common consumer is `vm.fork()`:
//
//   vm.expose("fork", async (params) => {
//     const f = await vm.fork({ name: params?.name });
//     await f.detach();
//     return { name: f.name, pid: f.pid };
//   });
//
// Notifications (no `id`) get no reply, even on dispatch error. This
// matches JSON-RPC 2.0 §4.1 and is the right call for fire-and-forget
// events.

import debugLib from "debug";
import { createServer, type Server, type Socket } from "node:net";

const debug = debugLib("machinen:bridge");

/** Default vsock port the guest connects to. Documented; not configurable. */
export const BRIDGE_VSOCK_PORT = 1979;

/** Bound on a single JSON line. Anything larger is dropped. Mirrors the
 *  exec/file agent caps so a malicious or buggy guest can't OOM the
 *  runtime by spamming an unterminated line. */
const MAX_LINE_BYTES = 64 * 1024;

/** JSON-RPC 2.0 standard error codes (subset we use). */
export const BridgeErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INTERNAL_ERROR: -32603,
} as const;

export type BridgeHandler = (params: unknown) => unknown | Promise<unknown>;

export interface BridgeServerOptions {
  /** UDS path to listen on. Created (and removed on `close`) by the server. */
  udsPath: string;
  /**
   * Method registry. The bridge looks up handlers by name on each
   * incoming request. Mutating the map after `start()` is fine —
   * vm.expose / vm.unexpose work that way.
   */
  methods: Map<string, BridgeHandler>;
}

export interface BridgeServer {
  /** Stop accepting new connections, close existing ones. Idempotent. */
  close(): Promise<void>;
}

/**
 * Start a bridge UDS server listening on `udsPath`. Each connection
 * stays open for the lifetime of the guest process that connected;
 * multiple frames per connection are supported.
 */
export async function startBridgeServer(opts: BridgeServerOptions): Promise<BridgeServer> {
  const conns = new Set<Socket>();
  const server = createServer((sock) => {
    conns.add(sock);
    sock.on("close", () => conns.delete(sock));
    sock.on("error", (err) => debug("socket error: %s", err.message));
    void handleConnection(sock, opts.methods);
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
      if (closed) return;
      closed = true;
      for (const sock of conns) {
        sock.destroy();
      }
      conns.clear();
      await new Promise<void>((done) => server.close(() => done()));
      debug("closed udsPath=%s", opts.udsPath);
    },
  };
}

async function handleConnection(sock: Socket, methods: Map<string, BridgeHandler>): Promise<void> {
  let buf = Buffer.alloc(0);
  sock.on("data", (chunk: Buffer) => {
    buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
    while (true) {
      const nl = buf.indexOf(0x0a);
      if (nl < 0) {
        if (buf.length > MAX_LINE_BYTES) {
          debug("dropping connection: line exceeds %d bytes", MAX_LINE_BYTES);
          sock.destroy();
          return;
        }
        break;
      }
      const line = buf.subarray(0, nl);
      buf = buf.subarray(nl + 1);
      if (line.length === 0) continue;
      if (line.length > MAX_LINE_BYTES) {
        debug("dropping line: %d bytes > %d", line.length, MAX_LINE_BYTES);
        continue;
      }
      // Concurrent dispatch is fine — JSON-RPC carries the id back, so
      // out-of-order responses are correct. Each response is one atomic
      // sock.write() so frames don't interleave on the wire.
      void dispatch(line.toString("utf8"), sock, methods);
    }
  });
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

async function dispatch(
  line: string,
  sock: Socket,
  methods: Map<string, BridgeHandler>,
): Promise<void> {
  let req: JsonRpcRequest;
  try {
    req = JSON.parse(line) as JsonRpcRequest;
  } catch (err) {
    debug("parse error: %s", err instanceof Error ? err.message : String(err));
    writeError(sock, null, BridgeErrorCode.PARSE_ERROR, "parse error");
    return;
  }
  if (typeof req !== "object" || req === null || typeof req.method !== "string") {
    writeError(sock, req?.id ?? null, BridgeErrorCode.INVALID_REQUEST, "invalid request");
    return;
  }
  const isNotification = !("id" in req) || req.id === undefined;
  const handler = methods.get(req.method);
  if (!handler) {
    debug("method not found: %s", req.method);
    if (!isNotification) {
      writeError(
        sock,
        req.id ?? null,
        BridgeErrorCode.METHOD_NOT_FOUND,
        `method not found: ${req.method}`,
      );
    }
    return;
  }
  try {
    const result = await handler(req.params);
    if (!isNotification) {
      writeResult(sock, req.id ?? null, result);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    debug("handler '%s' threw: %s", req.method, message);
    if (!isNotification) {
      writeError(sock, req.id ?? null, BridgeErrorCode.INTERNAL_ERROR, message);
    }
  }
}

function writeResult(sock: Socket, id: number | string | null, result: unknown): void {
  const frame = JSON.stringify({ jsonrpc: "2.0", id, result: result ?? null }) + "\n";
  if (sock.writable) sock.write(frame);
}

function writeError(
  sock: Socket,
  id: number | string | null,
  code: number,
  message: string,
  data?: unknown,
): void {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  const frame = JSON.stringify({ jsonrpc: "2.0", id, error }) + "\n";
  if (sock.writable) sock.write(frame);
}
