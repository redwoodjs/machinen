// Regression: when a caller passes `onStdout` / `onStderr` to
// `VsockExec.run`, the implementation should NOT also collect those
// chunks into the buffered `stdout` / `stderr` fields of the result.
//
// History: the chunk handler was unconditionally pushing every byte
// into `stdoutBufs` / `stderrBufs` alongside the user-visible callback.
// At `finish()` the buffered copy was concatenated with
// `Buffer.concat(...).toString("utf8")`, which throws
// `ERR_STRING_TOO_LONG` once the cumulative output crosses V8's max
// string length (~512 MiB). The snapshot-dump path streams ~2 GiB of
// criu tar bytes through `onStdout` into a host-side `tar -x`, so
// every snapshot of a workload over ~512 MiB of dirty pages was
// failing with an unhelpful V8 error.
//
// We drive the protocol directly over a Unix-socket pair — no VM, no
// agent binary. That keeps the test cheap and the regression specific
// to the exec.ts contract.

import { createServer, type Server, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VsockExec } from "../exec.ts";

let scratch: string;
let server: Server | undefined;
let udsPath: string;

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "machinen-exec-streaming-"));
  udsPath = join(scratch, "exec.sock");
});

afterEach(async () => {
  if (server) {
    await new Promise<void>((done) => server!.close(() => done()));
    server = undefined;
  }
  rmSync(scratch, { recursive: true, force: true });
});

/**
 * Bring up a one-shot fake exec-agent. On the first connection it
 * reads (and discards) the EXEC header line, then writes the supplied
 * sequence of stdout / stderr chunks framed in the exec-agent wire
 * format (`O <byte-len>\n<bytes>` / `E <byte-len>\n<bytes>`), then
 * `X 0\n`, then closes.
 */
async function startFakeAgent(chunks: Array<{ stream: "O" | "E"; bytes: Buffer }>): Promise<void> {
  server = createServer((sock: Socket) => {
    let header = Buffer.alloc(0);
    sock.on("data", (chunk: Buffer) => {
      header = Buffer.concat([header, chunk]);
      const nl = header.indexOf(0x0a);
      if (nl < 0) {
        return;
      }
      sock.removeAllListeners("data");
      for (const { stream, bytes } of chunks) {
        sock.write(`${stream} ${bytes.length}\n`);
        sock.write(bytes);
      }
      sock.write("X 0\n");
      sock.end();
    });
  });
  await new Promise<void>((done, fail) => {
    server!.once("error", fail);
    server!.listen(udsPath, () => {
      server!.off("error", fail);
      done();
    });
  });
}

describe("VsockExec — streaming callback drops buffered collection", () => {
  it("stdout result is empty when onStdout is provided; callback sees every byte", async () => {
    // 4 chunks × 64 KiB = 256 KiB total — large enough to exercise the
    // chunk loop, small enough to keep the test cheap. The regression
    // bug surfaces at hundreds of MB; we don't try to reproduce the
    // V8 limit itself (memory expensive in CI) — we lock down the
    // contract that prevents it.
    const chunkBytes = Buffer.alloc(64 * 1024, 0x41);
    const chunks = Array.from({ length: 4 }, () => ({
      stream: "O" as const,
      bytes: chunkBytes,
    }));
    await startFakeAgent(chunks);

    let streamed = 0;
    const result = await VsockExec.run(udsPath, "echo hi", {
      onStdout: (chunk) => {
        streamed += chunk.length;
      },
      connectTimeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    // The contract: streaming callers get bytes on the callback, the
    // buffered result fields stay empty. Without this guard the
    // implementation collects a parallel copy, which is the root
    // cause of the >512 MiB ERR_STRING_TOO_LONG crash.
    expect(result.stdout).toBe("");
    expect(streamed).toBe(chunkBytes.length * chunks.length);
  });

  it("stderr result is empty when onStderr is provided; callback sees every byte", async () => {
    const chunkBytes = Buffer.alloc(8 * 1024, 0x42);
    const chunks = Array.from({ length: 3 }, () => ({
      stream: "E" as const,
      bytes: chunkBytes,
    }));
    await startFakeAgent(chunks);

    let streamed = 0;
    const result = await VsockExec.run(udsPath, "echo hi", {
      onStderr: (chunk) => {
        streamed += chunk.length;
      },
      connectTimeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(streamed).toBe(chunkBytes.length * chunks.length);
  });

  it("without callbacks, both result fields buffer the full output (existing contract)", async () => {
    // Sanity that the non-streaming path still collects normally —
    // otherwise the fix would over-correct and break every existing
    // caller that relies on `result.stdout`.
    await startFakeAgent([
      { stream: "O", bytes: Buffer.from("hello-stdout") },
      { stream: "E", bytes: Buffer.from("hello-stderr") },
    ]);

    const result = await VsockExec.run(udsPath, "echo hi", {
      connectTimeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("hello-stdout");
    expect(result.stderr).toBe("hello-stderr");
  });

  it("mixed: onStdout set, onStderr unset — only the streamed side is empty", async () => {
    await startFakeAgent([
      { stream: "O", bytes: Buffer.from("streamed-stdout") },
      { stream: "E", bytes: Buffer.from("buffered-stderr") },
    ]);

    let streamed = "";
    const result = await VsockExec.run(udsPath, "echo hi", {
      onStdout: (chunk) => {
        streamed += chunk.toString("utf8");
      },
      connectTimeoutMs: 5_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(streamed).toBe("streamed-stdout");
    expect(result.stderr).toBe("buffered-stderr");
  });
});
