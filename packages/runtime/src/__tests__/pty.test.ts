// Tests for bootPty + Supervisor's terminal integration (#51 M1.5).
//
// We fork /bin/sh under a pty and ask it questions that only make
// sense when the child sees a real terminal:
//   - `tty` prints /dev/pts/N (proving isatty(0) = true inside).
//   - `stty size` prints "rows cols" (proving TIOCGWINSZ works).
//   - After resize(), `stty size` reflects the new shape.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, type Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandboxes, Supervisor, bootPty } from "../index.ts";

let nativeTmp: string | undefined;
let previousPty: string | undefined;

beforeAll(() => {
  nativeTmp = mkdtempSync(join(tmpdir(), "machinen-pty-test-"));
  execFileSync("zig", ["build", "--prefix", nativeTmp], {
    cwd: join(process.cwd(), "packages", "runtime/native"),
    stdio: "pipe",
  });
  previousPty = process.env.MACHINEN_PTY;
  process.env.MACHINEN_PTY = join(nativeTmp, "bin", "machinen-pty");
});

afterAll(() => {
  if (previousPty === undefined) {
    delete process.env.MACHINEN_PTY;
  } else {
    process.env.MACHINEN_PTY = previousPty;
  }
  if (nativeTmp) {
    rmSync(nativeTmp, { recursive: true, force: true });
  }
});

function waitForText(
  stream: Readable,
  chunks: Buffer[],
  expected: RegExp,
  timeoutMs = 3_000,
): Promise<string> {
  const snapshot = () => Buffer.concat(chunks).toString("utf8");
  const current = snapshot();
  if (expected.test(current)) {
    return Promise.resolve(current);
  }

  return new Promise((done, fail) => {
    const cleanup = () => {
      clearTimeout(timer);
      stream.off("data", onData);
    };
    const onData = () => {
      const text = snapshot();
      if (expected.test(text)) {
        cleanup();
        done(text);
      }
    };
    const timer = setTimeout(() => {
      cleanup();
      fail(new Error(`timed out waiting for ${expected}; saw ${JSON.stringify(snapshot())}`));
    }, timeoutMs);
    stream.on("data", onData);
    onData();
  });
}

describe("bootPty", () => {
  it("the child sees a real TTY on stdin (tty prints /dev/pts/N)", async () => {
    const vm = bootPty({
      binary: "/bin/sh",
      args: ["-c", "tty; sleep 1"],
    });
    const chunks: Buffer[] = [];
    vm.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    try {
      // Linux emits `/dev/pts/N`, macOS emits `/dev/ttys0NN` (no trailing slash).
      const out = await waitForText(vm.stdout, chunks, /\/dev\/(pts\/|ttys)/);
      expect(out).toMatch(/\/dev\/(pts\/|ttys)/);
    } finally {
      await vm.kill();
    }
  });

  it("resize() reshapes the pty — stty size reflects the new rows/cols", async () => {
    const vm = bootPty({
      binary: "/bin/sh",
      args: ["-c", "stty size; IFS= read -r _; stty size; exit"],
      cols: 80,
      rows: 24,
    });
    const chunks: Buffer[] = [];
    vm.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    try {
      // Give sh time to print the first size, then resize and release
      // the read gate so the second stty observes the new size.
      await new Promise((r) => setTimeout(r, 50));
      vm.resize(132, 50);
      vm.stdin.end("\n");
      await new Promise((r) => setTimeout(r, 300));
      const out = Buffer.concat(chunks).toString("utf8");
      // First line has initial shape, second has the resized shape.
      const lines = out.split(/\r?\n/).filter((l) => /^\d+\s+\d+/.test(l));
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[1]).toMatch(/^50\s+132/);
    } finally {
      await vm.kill();
    }
  });

  it("the handle plugs into Sandboxes.add just like a piped VmHandle", async () => {
    const reg = new Sandboxes();
    // Keep the child alive long enough for Sandboxes.add to subscribe
    // and observe output. `sleep` with no exit makes wait() pend, so
    // the auto-remove-on-exit doesn't fire under us.
    const vm = bootPty({
      binary: "/bin/sh",
      args: ["-c", "printf 'hi-pty-sandbox'; sleep 2"],
    });
    try {
      reg.add("sh", vm as unknown as Parameters<Sandboxes["add"]>[1]);
      await new Promise((r) => setTimeout(r, 400));
      const scrollback = reg.get("sh")?.scrollback.toString() ?? "";
      expect(scrollback).toContain("hi-pty-sandbox");
    } finally {
      await vm.kill();
    }
  });
});

describe("Supervisor + pty", () => {
  it("forwards SIGWINCH to the attached pty via resize()", async () => {
    const reg = new Sandboxes();
    const resizes: Array<[number, number]> = [];
    const fake = {
      pid: 1,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      resize: (c: number, r: number) => resizes.push([c, r]),
      wait: () => new Promise<{ code: null; signal: null }>(() => {}),
      kill: async () => {},
      output: async () => "",
      errorOutput: async () => "",
    };
    reg.add("fake", fake as unknown as Parameters<Sandboxes["add"]>[1]);

    const input = new PassThrough();
    const output = new PassThrough();
    // Pretend stdout is a TTY so forwardResize kicks in. Emitting
    // SIGWINCH on `process` will drive the handler we installed.
    (output as unknown as { isTTY: boolean; columns: number; rows: number }).isTTY = true;
    (output as unknown as { columns: number }).columns = 120;
    (output as unknown as { rows: number }).rows = 40;

    const sup = new Supervisor({
      sandboxes: reg,
      input,
      output,
      forwardResize: true,
      rawTtyOnAttach: false,
    });
    const done = sup.run();
    sup.attach("fake");

    // First resize call is made synchronously on attach so the sandbox
    // sees the current shape.
    expect(resizes.length).toBeGreaterThanOrEqual(1);

    (output as unknown as { columns: number }).columns = 80;
    (output as unknown as { rows: number }).rows = 24;
    process.emit("SIGWINCH" as never);
    await new Promise((r) => setTimeout(r, 50));
    // Last resize call should reflect the new size.
    expect(resizes[resizes.length - 1]).toEqual([80, 24]);

    sup.detach();
    sup.stop();
    await done;
  });
});
