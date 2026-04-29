// Host-side VsockWinsize wiring (#177).
//
// Stands in a UDS server for the in-guest winsize-agent so the test
// covers the same call path vm.ts uses: connect, send the initial
// size, react to a "resize" event by sending again, close on exit.
// The dedup-against-last-sent contract gets its own assertion because
// vm.ts (and any future caller) leans on it to debounce SIGWINCH
// storms — losing it would re-introduce the smear-on-resize bug this
// issue exists to fix.

import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WinsizeError } from "../errors.ts";
import { VsockWinsize } from "../winsize.ts";

interface FakeAgent {
  server: Server;
  udsPath: string;
  /** Lines received over the wire — `cols rows` without the trailing \n. */
  received: string[];
  /** Resolves the next time the agent sees `count` total lines. */
  waitFor: (count: number) => Promise<void>;
  close: () => Promise<void>;
}

async function startFakeAgent(udsPath: string): Promise<FakeAgent> {
  const received: string[] = [];
  let buf = "";
  const waiters: Array<{ count: number; done: () => void }> = [];

  const server = createServer((sock: Socket) => {
    sock.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8");
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        received.push(line);
        for (const w of waiters.splice(0, waiters.length)) {
          if (received.length >= w.count) w.done();
          else waiters.push(w);
        }
      }
    });
  });

  await new Promise<void>((done, fail) => {
    server.once("error", fail);
    server.listen(udsPath, () => {
      server.off("error", fail);
      done();
    });
  });

  return {
    server,
    udsPath,
    received,
    waitFor(count) {
      if (received.length >= count) return Promise.resolve();
      return new Promise((done) => waiters.push({ count, done }));
    },
    close() {
      return new Promise<void>((done) => server.close(() => done()));
    },
  };
}

describe("VsockWinsize", () => {
  let tmp: string;
  let udsPath: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "winsize-test-"));
    udsPath = join(tmp, "winsize.sock");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("sends the initial size and forwards subsequent resizes", async () => {
    const agent = await startFakeAgent(udsPath);
    const ws = await VsockWinsize.connect(udsPath, { timeoutMs: 2_000 });

    // vm.ts pattern: send initial size, then hook host SIGWINCH to
    // forward later sizes via a stdout-like emitter.
    const fakeStdout = new EventEmitter() as EventEmitter & {
      columns: number;
      rows: number;
    };
    fakeStdout.columns = 80;
    fakeStdout.rows = 24;

    ws.send(fakeStdout.columns, fakeStdout.rows);
    fakeStdout.on("resize", () => ws.send(fakeStdout.columns, fakeStdout.rows));

    await agent.waitFor(1);
    expect(agent.received).toEqual(["80 24"]);

    fakeStdout.columns = 132;
    fakeStdout.rows = 50;
    fakeStdout.emit("resize");

    await agent.waitFor(2);
    expect(agent.received).toEqual(["80 24", "132 50"]);

    ws.close();
    await agent.close();
  });

  it("dedups duplicate sizes so SIGWINCH storms don't spam the bridge", async () => {
    const agent = await startFakeAgent(udsPath);
    const ws = await VsockWinsize.connect(udsPath, { timeoutMs: 2_000 });

    ws.send(100, 30);
    ws.send(100, 30); // identical — must be dropped
    ws.send(100, 30);
    ws.send(100, 31); // different rows — must go through

    await agent.waitFor(2);
    // Give the dedup'd sends a beat to (incorrectly) leak through if
    // the contract is broken.
    await new Promise((r) => setTimeout(r, 50));
    expect(agent.received).toEqual(["100 30", "100 31"]);

    ws.close();
    await agent.close();
  });

  it("times out with WINSIZE_AGENT_UNAVAILABLE when no UDS is listening", async () => {
    // udsPath was never bound — connect should retry until the deadline.
    const t0 = Date.now();
    await expect(
      VsockWinsize.connect(udsPath, { timeoutMs: 200, retryMs: 25 }),
    ).rejects.toBeInstanceOf(WinsizeError);
    // Should respect the timeout (with some slack); a regression that
    // ignored the deadline would either return immediately or hang.
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(150);
    expect(elapsed).toBeLessThan(2_000);
  });

  it("send() after close is a silent no-op (process-exit safety)", async () => {
    const agent = await startFakeAgent(udsPath);
    const ws = await VsockWinsize.connect(udsPath, { timeoutMs: 2_000 });

    ws.send(80, 24);
    await agent.waitFor(1);
    ws.close();

    // vm.ts has a `process.stdout.on("resize", ...)` listener that may
    // fire between the wait()-returns and the process.exit(); the close
    // path must not throw if a resize sneaks in there.
    expect(() => ws.send(120, 40)).not.toThrow();

    await new Promise((r) => setTimeout(r, 50));
    expect(agent.received).toEqual(["80 24"]);

    await agent.close();
  });
});
