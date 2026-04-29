// VsockExec.run wall-clock timeout — #158.
//
// `execTimeoutMs` defaults to 5 minutes; passing `null` or `Infinity`
// disables it so long-running siblings (dev servers, watchers) can
// outlive the default ceiling. These tests stand up a local UDS that
// holds the connection open without ever sending an X frame so we can
// observe whether the host's deadline fires.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VsockExec } from "../exec.ts";

function startStallingAgent(socketPath: string): {
  server: Server;
  sockets: Socket[];
  stop: () => Promise<void>;
} {
  const sockets: Socket[] = [];
  const server = createServer((sock: Socket) => {
    sockets.push(sock);
    // Drain the EXEC header so the host's write doesn't backpressure,
    // but never reply with O/E/X — we want the host's wall-clock timer
    // to be the only thing that can settle the call.
    sock.on("data", () => {});
    sock.on("error", () => {});
  });
  server.listen(socketPath);
  return {
    server,
    sockets,
    stop: () =>
      new Promise<void>((done) => {
        for (const s of sockets) {
          if (!s.destroyed) {
            s.destroy();
          }
        }
        server.close(() => done());
      }),
  };
}

describe("VsockExec.run execTimeoutMs", () => {
  let workDir: string;
  let agent: ReturnType<typeof startStallingAgent> | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "machinen-exec-timeout-"));
  });
  afterEach(async () => {
    if (agent) {
      await agent.stop();
      agent = undefined;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  it("rejects with EXEC_AGENT_TIMEOUT when the wall-clock deadline elapses", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startStallingAgent(uds);
    await expect(VsockExec.run(uds, "sleep forever", { execTimeoutMs: 50 })).rejects.toMatchObject({
      code: "EXEC_AGENT_TIMEOUT",
    });
  });

  it("error message hints at { execTimeoutMs: null } as the escape hatch", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startStallingAgent(uds);
    await expect(VsockExec.run(uds, "sleep forever", { execTimeoutMs: 30 })).rejects.toThrow(
      /execTimeoutMs: null/,
    );
  });

  it("does not fire the timer when execTimeoutMs is null (long-running sibling)", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startStallingAgent(uds);
    let settled = false;
    // Short connectTimeoutMs so the post-stop retry loop in
    // VsockExec.run gives up fast and the test can finish.
    const p = VsockExec.run(uds, "tail -F /var/log/foo", {
      execTimeoutMs: null,
      connectTimeoutMs: 1_000,
    }).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    // Wait long enough that, were the wall-clock timer firing on a
    // short fallback, it would have already rejected. 250ms is plenty
    // — we only need to prove the timer didn't fire.
    await new Promise((r) => setTimeout(r, 250));
    expect(settled).toBe(false);
    // Tear down the fake agent so the call eventually resolves with
    // EXEC_AGENT_UNAVAILABLE (close-before-X). That's fine — we only
    // care that it didn't reject *via the wall-clock timer* earlier.
    await agent.stop();
    agent = undefined;
    await p;
  });

  it("does not fire the timer when execTimeoutMs is Infinity", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startStallingAgent(uds);
    let settled = false;
    const p = VsockExec.run(uds, "watch", {
      execTimeoutMs: Infinity,
      connectTimeoutMs: 1_000,
    }).then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await new Promise((r) => setTimeout(r, 250));
    expect(settled).toBe(false);
    await agent.stop();
    agent = undefined;
    await p;
  });
});
