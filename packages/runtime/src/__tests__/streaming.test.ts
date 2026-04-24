// Streaming log smoke test — #83.
//
// Exercises the framing path in VsockExec.run with a local UDS that
// acts like the guest exec-agent: send an early chunk, pause, then send
// a late chunk and an exit frame. Asserts the `onStdout` callback fires
// *before* the whole command returns — i.e. output streams instead of
// being collected and delivered at the end.
//
// No VMM involved. This is the primitive that every onLog path in the
// runtime is built on, so a fast local check here catches regressions
// without paying the cost of a full boot.

import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VsockExec } from "../exec.ts";

describe("VsockExec streaming", () => {
  let workDir: string;
  let server: Server | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "machinen-streaming-"));
  });
  afterEach(async () => {
    if (server) {
      await new Promise<void>((done) => server!.close(() => done()));
      server = undefined;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  it("delivers onStdout chunks as they arrive, not only after exit", async () => {
    const udsPath = join(workDir, "exec.sock");
    const gapMs = 150;
    let earlyWrittenAt = 0;
    let lateWrittenAt = 0;
    server = createServer((sock: Socket) => {
      sock.once("data", () => {
        // Agent-shape framing: O <len>\n<payload>
        const early = "early\n";
        sock.write(`O ${early.length}\n${early}`);
        earlyWrittenAt = Date.now();
        setTimeout(() => {
          const late = "late\n";
          sock.write(`O ${late.length}\n${late}`);
          lateWrittenAt = Date.now();
          sock.write("X 0\n");
          sock.end();
        }, gapMs);
      });
    });
    await new Promise<void>((done) => server!.listen(udsPath, () => done()));

    const chunks: { t: number; data: string }[] = [];
    const res = await VsockExec.run(udsPath, "pretend-cmd", {
      onStdout: (c) => chunks.push({ t: Date.now(), data: c.toString("utf8") }),
    });

    expect(res.exitCode).toBe(0);
    expect(res.stdout).toBe("early\nlate\n");

    // Two streamed chunks, not one merged one.
    expect(chunks.length).toBe(2);
    expect(chunks[0]!.data).toBe("early\n");
    expect(chunks[1]!.data).toBe("late\n");

    // The first chunk must arrive well before the second is written —
    // that's the streaming guarantee. Use a generous margin to stay
    // robust on a loaded CI box; the real gap is `gapMs`.
    expect(chunks[0]!.t).toBeLessThan(lateWrittenAt - gapMs / 2);
    expect(chunks[0]!.t).toBeGreaterThanOrEqual(earlyWrittenAt);
  });
});
