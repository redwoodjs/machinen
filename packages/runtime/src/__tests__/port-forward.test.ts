// Unit tests for gvproxy.ts's exposePort() + spawn()'s portForward
// validation. These don't boot a VM — they stand up a tiny HTTP
// server on a unix socket that impersonates gvproxy's control API and
// verify the request shape.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exposePort } from "../gvproxy.ts";
import { spawn } from "../index.ts";

interface FakeGvproxy {
  socketPath: string;
  requests: Array<{ method: string; url: string; body: string }>;
  stop: () => Promise<void>;
}

function fakeGvproxy(
  respond: (req: IncomingMessage, res: ServerResponse, body: string) => void,
): Promise<FakeGvproxy> {
  return new Promise((done, fail) => {
    const dir = mkdtempSync(join(tmpdir(), "fakegv-"));
    const socketPath = join(dir, "net.sock");
    const requests: FakeGvproxy["requests"] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        requests.push({ method: req.method ?? "", url: req.url ?? "", body });
        respond(req, res, body);
      });
    });
    server.once("error", fail);
    server.listen(socketPath, () => {
      done({
        socketPath,
        requests,
        stop: () =>
          new Promise<void>((r) => {
            server.close(() => {
              try {
                rmSync(dir, { recursive: true, force: true });
              } catch {}
              r();
            });
          }),
      });
    });
  });
}

describe("exposePort", () => {
  let gv: FakeGvproxy | undefined;

  afterEach(async () => {
    if (gv) {
      await gv.stop();
      gv = undefined;
    }
  });

  it("POSTs the expected path + body for a 2xx response", async () => {
    gv = await fakeGvproxy((_req, res) => {
      res.statusCode = 200;
      res.end();
    });
    await exposePort(gv.socketPath, { hostPort: 8080, guestPort: 3000 });
    expect(gv.requests).toHaveLength(1);
    expect(gv.requests[0]!.method).toBe("POST");
    expect(gv.requests[0]!.url).toBe("/services/forwarder/expose");
    expect(JSON.parse(gv.requests[0]!.body)).toEqual({
      local: "127.0.0.1:8080",
      remote: "192.168.127.2:3000",
    });
  });

  it("honors hostAddr + guestAddr overrides", async () => {
    gv = await fakeGvproxy((_req, res) => {
      res.statusCode = 200;
      res.end();
    });
    await exposePort(gv.socketPath, {
      hostPort: 1234,
      guestPort: 5678,
      hostAddr: "0.0.0.0",
      guestAddr: "10.0.0.5",
    });
    expect(JSON.parse(gv.requests[0]!.body)).toEqual({
      local: "0.0.0.0:1234",
      remote: "10.0.0.5:5678",
    });
  });

  it("rejects with gvproxy's error body on non-2xx", async () => {
    gv = await fakeGvproxy((_req, res) => {
      res.statusCode = 500;
      res.end("address already in use");
    });
    await expect(exposePort(gv.socketPath, { hostPort: 8080, guestPort: 3000 })).rejects.toThrow(
      /gvproxy expose failed \(500\).*address already in use/,
    );
  });
});

describe("spawn portForward validation", () => {
  const origNetSock = process.env.MACHINEN_NET_SOCKET;
  beforeEach(() => {
    // Don't actually spin up a VMM; validation fires before we reach
    // gvproxy or the binary. Pretend a net socket is set so we hit the
    // "runtime doesn't own gvproxy" check first where relevant.
    delete process.env.MACHINEN_NET_SOCKET;
  });
  afterEach(() => {
    if (origNetSock === undefined) {
      delete process.env.MACHINEN_NET_SOCKET;
    } else {
      process.env.MACHINEN_NET_SOCKET = origNetSock;
    }
  });

  it("rejects out-of-range hostPort", async () => {
    await expect(
      spawn({ binary: "/nonexistent", portForward: [{ hostPort: 0, guestPort: 3000 }] }),
    ).rejects.toThrow(/hostPort must be an integer in 1..65535/);
  });

  it("rejects out-of-range guestPort", async () => {
    await expect(
      spawn({ binary: "/nonexistent", portForward: [{ hostPort: 8080, guestPort: 70000 }] }),
    ).rejects.toThrow(/guestPort must be an integer in 1..65535/);
  });

  it("rejects duplicate hostPort", async () => {
    await expect(
      spawn({
        binary: "/nonexistent",
        portForward: [
          { hostPort: 8080, guestPort: 3000 },
          { hostPort: 8080, guestPort: 3001 },
        ],
      }),
    ).rejects.toThrow(/duplicate hostPort 8080/);
  });

  it("rejects portForward when MACHINEN_NET_SOCKET is pre-set", async () => {
    process.env.MACHINEN_NET_SOCKET = "/tmp/whatever.sock";
    await expect(
      spawn({ binary: "/nonexistent", portForward: [{ hostPort: 8080, guestPort: 3000 }] }),
    ).rejects.toThrow(/portForward requires the runtime to own gvproxy/);
  });
});
