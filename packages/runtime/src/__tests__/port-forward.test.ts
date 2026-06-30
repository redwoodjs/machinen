// Unit tests for gvproxy.ts's exposePort() + boot()'s portForward
// validation. These don't boot a VM — they stand up a tiny HTTP
// server on a unix socket that impersonates gvproxy's control API and
// verify the request shape.

import { execFileSync } from "node:child_process";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createNetServer, type AddressInfo, type Server } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { describePortHolder, exposePort, probeHostPortFree } from "../gvproxy.ts";
import { boot } from "../index.ts";

let helperTmp: string | undefined;
let previousHelper: string | undefined;

beforeAll(() => {
  helperTmp = mkdtempSync(join(tmpdir(), "machinen-runtime-helper-test-"));
  execFileSync("zig", ["build", "--prefix", helperTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousHelper = process.env.MACHINEN_RUNTIME_HELPER;
  process.env.MACHINEN_RUNTIME_HELPER = join(helperTmp, "bin", "machinen-runtime-helper");
});

afterAll(() => {
  if (previousHelper === undefined) {
    delete process.env.MACHINEN_RUNTIME_HELPER;
  } else {
    process.env.MACHINEN_RUNTIME_HELPER = previousHelper;
  }
  if (helperTmp) {
    rmSync(helperTmp, { recursive: true, force: true });
  }
});

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

  it("rejects with GVPROXY_EXPOSE_FAILED + body for generic non-2xx", async () => {
    gv = await fakeGvproxy((_req, res) => {
      res.statusCode = 500;
      res.end("malformed body");
    });
    await expect(
      exposePort(gv.socketPath, { hostPort: 8080, guestPort: 3000 }),
    ).rejects.toMatchObject({
      code: "GVPROXY_EXPOSE_FAILED",
      message: expect.stringMatching(/gvproxy expose failed \(500\).*malformed body/),
    });
  });

  it("maps `address already in use` 500 body to GVPROXY_PORT_IN_USE", async () => {
    gv = await fakeGvproxy((_req, res) => {
      res.statusCode = 500;
      res.end("listen tcp 127.0.0.1:5173: bind: address already in use");
    });
    await expect(
      exposePort(gv.socketPath, { hostPort: 5173, guestPort: 3000 }),
    ).rejects.toMatchObject({
      code: "GVPROXY_PORT_IN_USE",
      message: expect.stringContaining("127.0.0.1:5173 is already in use"),
    });
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
      boot({ binary: "/nonexistent", portForward: [{ hostPort: 0, guestPort: 3000 }] }),
    ).rejects.toThrow(/hostPort must be an integer in 1..65535/);
  });

  it("rejects out-of-range guestPort", async () => {
    await expect(
      boot({ binary: "/nonexistent", portForward: [{ hostPort: 8080, guestPort: 70000 }] }),
    ).rejects.toThrow(/guestPort must be an integer in 1..65535/);
  });

  it("rejects duplicate hostPort", async () => {
    await expect(
      boot({
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
      boot({ binary: "/nonexistent", portForward: [{ hostPort: 8080, guestPort: 3000 }] }),
    ).rejects.toThrow(/portForward requires the runtime to own gvproxy/);
  });
});

// Helper: bind on 127.0.0.1:0, return the chosen port and a stop fn.
async function holdEphemeralPort(): Promise<{ port: number; stop: () => Promise<void> }> {
  const srv: Server = createNetServer();
  await new Promise<void>((done, fail) => {
    srv.once("error", fail);
    srv.listen(0, "127.0.0.1", () => {
      srv.removeListener("error", fail);
      done();
    });
  });
  const port = (srv.address() as AddressInfo).port;
  return {
    port,
    stop: () =>
      new Promise<void>((done) => {
        srv.close(() => done());
      }),
  };
}

describe("probeHostPortFree", () => {
  it("returns null when the port is free", async () => {
    const held = await holdEphemeralPort();
    await held.stop();
    // Port is free now (briefly). Probe should report null.
    expect(await probeHostPortFree("127.0.0.1", held.port)).toBeNull();
  });

  it("returns EADDRINUSE when the port is held by another listener", async () => {
    const held = await holdEphemeralPort();
    try {
      const errno = await probeHostPortFree("127.0.0.1", held.port);
      expect(errno).toBe("EADDRINUSE");
    } finally {
      await held.stop();
    }
  });

  it("releases the probe socket so the port is bindable immediately after", async () => {
    // Pick a free port via the OS, probe it, then bind it. If the
    // probe leaks the socket, this bind would fail with EADDRINUSE.
    const held = await holdEphemeralPort();
    const port = held.port;
    await held.stop();
    expect(await probeHostPortFree("127.0.0.1", port)).toBeNull();
    const second = createNetServer();
    await new Promise<void>((done, fail) => {
      second.once("error", fail);
      second.listen(port, "127.0.0.1", () => {
        second.removeListener("error", fail);
        done();
      });
    });
    await new Promise<void>((done) => second.close(() => done()));
  });
});

describe("boot pre-flight bind probe", () => {
  const origNetSock = process.env.MACHINEN_NET_SOCKET;
  beforeEach(() => {
    delete process.env.MACHINEN_NET_SOCKET;
  });
  afterEach(() => {
    if (origNetSock === undefined) {
      delete process.env.MACHINEN_NET_SOCKET;
    } else {
      process.env.MACHINEN_NET_SOCKET = origNetSock;
    }
  });

  it("rejects with BOOT_PORT_FORWARD_IN_USE when host port is already bound", async () => {
    const held = await holdEphemeralPort();
    try {
      // binary: "/nonexistent" would normally error with BOOT_VMM_MISSING,
      // but the probe runs before binary resolution, so the in-use port
      // is what surfaces.
      await expect(
        boot({
          binary: "/nonexistent",
          portForward: [{ hostPort: held.port, guestPort: 3000 }],
        }),
      ).rejects.toMatchObject({
        code: "BOOT_PORT_FORWARD_IN_USE",
        message: expect.stringContaining(`127.0.0.1:${held.port}`),
      });
      // The message either names the actual holder PID (via lsof) or
      // falls back to the orphan-gvproxy hypothesis when lsof isn't
      // available. Both shapes are valid — accept either.
      await expect(
        boot({
          binary: "/nonexistent",
          portForward: [{ hostPort: held.port, guestPort: 3000 }],
        }),
      ).rejects.toThrow(/held by .* \(pid \d+\)|orphaned gvproxy.*pkill -f gvproxy/);
    } finally {
      await held.stop();
    }
  });

  it("range/duplicate validation fires before the probe", async () => {
    // If the probe ran first, this would surface BOOT_PORT_FORWARD_IN_USE
    // for whatever port it tried. The duplicate-hostPort check must
    // win because the user's input is malformed.
    await expect(
      boot({
        binary: "/nonexistent",
        portForward: [
          { hostPort: 8080, guestPort: 3000 },
          { hostPort: 8080, guestPort: 3001 },
        ],
      }),
    ).rejects.toMatchObject({ code: "BOOT_PORT_FORWARD_CONFLICT" });
  });
});

describe("describePortHolder", () => {
  it("returns null for a port with no LISTEN holder", async () => {
    // Pick a free ephemeral port via the OS, release it, then ask who
    // holds it. Nothing does, so lsof exits nonzero and we should get null.
    const held = await holdEphemeralPort();
    const port = held.port;
    await held.stop();
    expect(await describePortHolder(port)).toBeNull();
  });

  it("identifies the holder PID + command when the port is bound", async () => {
    const held = await holdEphemeralPort();
    try {
      const desc = await describePortHolder(held.port);
      // Skip when lsof isn't on PATH (some minimal CI containers); the
      // helper's contract is that a missing tool returns null and
      // callers degrade gracefully.
      if (desc === null) {
        return;
      }
      // Holder is this test process — node, running from the host's
      // node_modules (not under ~/.machinen). Don't pin the exact
      // command, since macOS ps may truncate; pin the pid format.
      expect(desc).toMatch(/held by .+ \(pid \d+\)/);
      expect(desc).toContain(String(process.pid));
    } finally {
      await held.stop();
    }
  });
});
