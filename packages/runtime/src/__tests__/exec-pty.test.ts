// PTY-over-vsock wire protocol — #133.
//
// Pairs with assets/exec-agent.zig. These tests exercise the host
// side without a real VM by standing up a local UDS server that
// records the bytes the host sent and replays canned O/X frames so
// we can assert the round-trip framing.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VsockExec } from "../exec.ts";

function startCapturingAgent(
  socketPath: string,
  replay: (sock: Socket) => void,
): {
  server: Server;
  received: Buffer[];
  stop: () => Promise<void>;
} {
  const received: Buffer[] = [];
  const server = createServer((sock: Socket) => {
    sock.on("data", (chunk: Buffer) => {
      received.push(Buffer.from(chunk));
    });
    replay(sock);
  });
  server.listen(socketPath);
  return {
    server,
    received,
    stop: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

function collectBytes(buffers: Buffer[]): Buffer {
  return Buffer.concat(buffers);
}

class CapturingWritable extends Writable {
  chunks: Buffer[] = [];
  _write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
    this.chunks.push(Buffer.from(chunk));
    cb();
  }
  bytes(): Buffer {
    return Buffer.concat(this.chunks);
  }
}

describe("VsockExec.startPty wire protocol", () => {
  let tmpDir: string;
  let socketPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "machinen-exec-pty-"));
    socketPath = join(tmpDir, "agent.sock");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("uses the default persistent PTY session when sessionName is omitted", async () => {
    // Agent: just send X 0 + close so the host resolves quickly. We
    // care about what the host wrote on the wire, not the response.
    const agent = startCapturingAgent(socketPath, (sock) => {
      // Tiny delay so the host has a chance to write the header
      // before we close from under it.
      setTimeout(() => {
        sock.write("X 0\n");
        sock.end();
      }, 10);
    });
    try {
      const stdin = new PassThrough();
      const stdout = new CapturingWritable();
      const handle = VsockExec.startPty(socketPath, "bash -i", {
        cols: 132,
        rows: 50,
        stdin,
        stdout,
        connectTimeoutMs: 2_000,
      });
      const res = await handle.result;
      expect(res.exitCode).toBe(0);
      const sent = collectBytes(agent.received).toString("utf8");
      expect(sent.startsWith("PTYSESSION 132 50 7 7\n")).toBe(true);
      expect(sent.slice("PTYSESSION 132 50 7 7\n".length)).toContain("defaultbash -i");
    } finally {
      await agent.stop();
    }
  });

  it("sends a one-shot PTY header when sessionName is false", async () => {
    const agent = startCapturingAgent(socketPath, (sock) => {
      setTimeout(() => {
        sock.write("X 0\n");
        sock.end();
      }, 10);
    });
    try {
      const stdin = new PassThrough();
      const stdout = new CapturingWritable();
      const handle = VsockExec.startPty(socketPath, "bash -i", {
        cols: 132,
        rows: 50,
        stdin,
        stdout,
        connectTimeoutMs: 2_000,
        sessionName: false,
      });
      const res = await handle.result;
      expect(res.exitCode).toBe(0);
      const sent = collectBytes(agent.received).toString("utf8");
      expect(sent.startsWith("PTY 132 50 7\n")).toBe(true);
      expect(sent.slice("PTY 132 50 7\n".length, "PTY 132 50 7\n".length + 7)).toBe("bash -i");
    } finally {
      await agent.stop();
    }
  });

  it("sends a PTYSESSION header with session and cmd payloads", async () => {
    const agent = startCapturingAgent(socketPath, (sock) => {
      setTimeout(() => {
        sock.write("X 0\n");
        sock.end();
      }, 10);
    });
    try {
      const stdin = new PassThrough();
      const stdout = new CapturingWritable();
      const handle = VsockExec.startPty(socketPath, "pi", {
        cols: 100,
        rows: 30,
        stdin,
        stdout,
        connectTimeoutMs: 2_000,
        sessionName: "default",
      });
      await expect(handle.result).resolves.toEqual({ exitCode: 0 });
      const sent = collectBytes(agent.received).toString("utf8");
      expect(sent.startsWith("PTYSESSION 100 30 7 2\n")).toBe(true);
      expect(sent.slice("PTYSESSION 100 30 7 2\n".length)).toContain("defaultpi");
    } finally {
      await agent.stop();
    }
  });

  it("lists and kills persistent PTY sessions with control opcodes", async () => {
    const agent = startCapturingAgent(socketPath, (sock) => {
      sock.once("data", (data: Buffer) => {
        if (data.toString("utf8").startsWith("PTYLIST")) {
          sock.write("O 13\ndefault\t1234\nX 0\n");
          sock.end();
          return;
        }
        sock.write("X 1\n");
        sock.end();
      });
    });
    try {
      await expect(VsockExec.listPtySessions(socketPath)).resolves.toEqual([
        { name: "default", pid: 1234 },
      ]);
      expect(collectBytes(agent.received).toString("utf8")).toContain("PTYLIST\n");
    } finally {
      await agent.stop();
    }

    const killAgent = startCapturingAgent(socketPath, (sock) => {
      sock.once("data", () => {
        sock.write("X 0\n");
        sock.end();
      });
    });
    try {
      await expect(VsockExec.killPtySession(socketPath, "default")).resolves.toBe(true);
      expect(collectBytes(killAgent.received).toString("utf8")).toBe("PTYKILL 7\ndefault");
    } finally {
      await killAgent.stop();
    }
  });

  it("forwards stdin chunks as I <n>\\n<bytes> frames", async () => {
    const agent = startCapturingAgent(socketPath, (sock) => {
      // Wait for input, then exit.
      let inputSeen = false;
      sock.on("data", (data: Buffer) => {
        // After header + cmd + at least one I frame, exit. The
        // capturing handler on the test side already saved the bytes.
        const s = data.toString("utf8");
        if (s.includes("I ")) {
          inputSeen = true;
        }
        if (inputSeen) {
          sock.write("X 0\n");
          sock.end();
        }
      });
    });
    try {
      const stdin = new PassThrough();
      const stdout = new CapturingWritable();
      const handle = VsockExec.startPty(socketPath, "echo hi", {
        cols: 80,
        rows: 24,
        stdin,
        stdout,
        connectTimeoutMs: 2_000,
      });
      // Push a keystroke after a short delay so the connection has
      // settled and stdin's listener is hooked.
      setTimeout(() => stdin.write("hello\n"), 30);
      const res = await handle.result;
      expect(res.exitCode).toBe(0);
      const sent = collectBytes(agent.received).toString("utf8");
      // Header + cmd + then `I 6\n` + `hello\n`. Order matters; just
      // assert the I frame arrived with the right length.
      expect(sent).toContain("I 6\n");
      expect(sent.includes("hello\n")).toBe(true);
    } finally {
      await agent.stop();
    }
  });

  it("emits R <cols> <rows>\\n on resize()", async () => {
    const agent = startCapturingAgent(socketPath, (sock) => {
      setTimeout(() => {
        sock.write("X 0\n");
        sock.end();
      }, 50);
    });
    try {
      const stdin = new PassThrough();
      const stdout = new CapturingWritable();
      const handle = VsockExec.startPty(socketPath, "true", {
        cols: 80,
        rows: 24,
        stdin,
        stdout,
        connectTimeoutMs: 2_000,
      });
      // Give the connect a moment, then resize twice.
      await new Promise((r) => setTimeout(r, 20));
      handle.resize(120, 40);
      handle.resize(200, 60);
      const res = await handle.result;
      expect(res.exitCode).toBe(0);
      const sent = collectBytes(agent.received).toString("utf8");
      expect(sent).toContain("R 120 40\n");
      expect(sent).toContain("R 200 60\n");
    } finally {
      await agent.stop();
    }
  });

  it("parses O frames into stdout and resolves on X", async () => {
    const agent = startCapturingAgent(socketPath, (sock) => {
      // Send two O frames split across two writes to exercise the
      // partial-frame path, then X 42.
      setTimeout(() => {
        sock.write("O 5\nhello");
        setTimeout(() => {
          sock.write("O 6\n world");
          setTimeout(() => {
            sock.write("X 42\n");
            sock.end();
          }, 10);
        }, 10);
      }, 10);
    });
    try {
      const stdin = new PassThrough();
      const stdout = new CapturingWritable();
      const handle = VsockExec.startPty(socketPath, "x", {
        cols: 80,
        rows: 24,
        stdin,
        stdout,
        connectTimeoutMs: 2_000,
      });
      const res = await handle.result;
      expect(res.exitCode).toBe(42);
      expect(stdout.bytes().toString("utf8")).toBe("hello world");
    } finally {
      await agent.stop();
    }
  });

  it("rejects with EXEC_PROTOCOL on unknown frame tag", async () => {
    const agent = startCapturingAgent(socketPath, (sock) => {
      setTimeout(() => {
        sock.write("Z 999\n");
        sock.end();
      }, 10);
    });
    try {
      const stdin = new PassThrough();
      const stdout = new CapturingWritable();
      const handle = VsockExec.startPty(socketPath, "x", {
        cols: 80,
        rows: 24,
        stdin,
        stdout,
        connectTimeoutMs: 2_000,
      });
      await expect(handle.result).rejects.toThrow(/unknown PTY frame tag/);
    } finally {
      await agent.stop();
    }
  });
});
