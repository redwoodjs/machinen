// Host-side bridge listener (#217).
//
// Stands up a UDS bridge server bound to an `RpcTarget`, then connects
// a client over the same UDS using capnweb's RpcSession with an
// in-process socket transport identical to the one the runtime uses
// internally. That way the test exercises the real wire — newline-
// framed Cap'n Web messages — not a mocked dispatcher.

import { mkdtempSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RpcSession, RpcTarget, type RpcTransport } from "capnweb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startBridgeServer, type BridgeServer } from "../bridge.ts";

class EchoApi extends RpcTarget {
  greet(name: string): string {
    return `hello ${name}`;
  }
  add(a: number, b: number): number {
    return a + b;
  }
  boom(): never {
    throw new Error("kaboom");
  }
}

class OtherApi extends RpcTarget {
  greet(name: string): string {
    return `hi ${name}`;
  }
}

function clientTransport(sock: Socket): RpcTransport {
  let buf: Buffer = Buffer.alloc(0);
  const queue: string[] = [];
  const waiters: Array<{ resolve: (v: string) => void; reject: (e: Error) => void }> = [];
  let closeError: Error | undefined;

  sock.on("data", (chunk: Buffer) => {
    buf = Buffer.concat([buf, chunk]);
    while (true) {
      const nl = buf.indexOf(0x0a);
      if (nl < 0) {
        break;
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
    closeError ??= new Error("client socket closed");
    while (waiters.length > 0) {
      waiters.shift()!.reject(closeError);
    }
  });
  sock.on("error", (err) => {
    closeError = err;
    while (waiters.length > 0) {
      waiters.shift()!.reject(err);
    }
  });

  return {
    async send(message: string) {
      await new Promise<void>((done, fail) => {
        sock.write(message + "\n", (err) => (err ? fail(err) : done()));
      });
    },
    receive() {
      if (queue.length > 0) {
        return Promise.resolve(queue.shift()!);
      }
      if (closeError) {
        return Promise.reject(closeError);
      }
      return new Promise<string>((resolve, reject) => waiters.push({ resolve, reject }));
    },
    abort() {
      sock.destroy();
    },
  };
}

async function dialBridge(udsPath: string): Promise<{
  session: RpcSession<RpcTarget>;
  sock: Socket;
}> {
  const sock = await new Promise<Socket>((resolve, reject) => {
    const s = connect(udsPath, () => resolve(s));
    s.once("error", reject);
  });
  const session = new RpcSession<RpcTarget>(clientTransport(sock));
  return { session, sock };
}

describe("startBridgeServer", () => {
  let tmp: string;
  let udsPath: string;
  let server: BridgeServer | undefined;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "machinen-bridge-test-"));
    udsPath = join(tmp, "bridge.sock");
    server = undefined;
  });

  afterEach(async () => {
    if (server) {
      await server.close();
    }
    rmSync(tmp, { recursive: true, force: true });
  });

  it("dispatches an RpcTarget method call back to the host", async () => {
    const target = new EchoApi();
    server = await startBridgeServer({ udsPath, getTarget: () => target });

    const { session, sock } = await dialBridge(udsPath);
    try {
      const stub = session.getRemoteMain() as unknown as EchoApi;
      const greeting = await stub.greet("world");
      expect(greeting).toBe("hello world");
      const sum = await stub.add(2, 3);
      expect(sum).toBe(5);
    } finally {
      sock.destroy();
    }
  });

  it("propagates thrown handler errors as RPC errors", async () => {
    const target = new EchoApi();
    server = await startBridgeServer({ udsPath, getTarget: () => target });

    const { session, sock } = await dialBridge(udsPath);
    try {
      const stub = session.getRemoteMain() as unknown as EchoApi;
      await expect(stub.boom()).rejects.toThrow(/kaboom/);
    } finally {
      sock.destroy();
    }
  });

  it("honors live target swap for connections opened after the swap", async () => {
    let target: RpcTarget = new EchoApi();
    server = await startBridgeServer({ udsPath, getTarget: () => target });

    {
      const { session, sock } = await dialBridge(udsPath);
      try {
        const stub = session.getRemoteMain() as unknown as EchoApi;
        expect(await stub.greet("world")).toBe("hello world");
      } finally {
        sock.destroy();
      }
    }

    target = new OtherApi();

    {
      const { session, sock } = await dialBridge(udsPath);
      try {
        const stub = session.getRemoteMain() as unknown as OtherApi;
        expect(await stub.greet("world")).toBe("hi world");
      } finally {
        sock.destroy();
      }
    }
  });

  it("closes existing connections when close() is called", async () => {
    const target = new EchoApi();
    server = await startBridgeServer({ udsPath, getTarget: () => target });

    const { sock } = await dialBridge(udsPath);
    const closed = new Promise<void>((resolve) => sock.once("close", () => resolve()));
    await server.close();
    server = undefined;
    await closed; // would hang if close() didn't kick the connection
    expect(sock.destroyed).toBe(true);
  });

  it("close() is idempotent", async () => {
    const target = new EchoApi();
    server = await startBridgeServer({ udsPath, getTarget: () => target });
    await server.close();
    await server.close();
    server = undefined;
  });
});
