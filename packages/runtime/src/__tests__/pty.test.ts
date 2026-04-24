// Tests for bootPty + Supervisor's terminal integration (#51 M1.5).
//
// We fork /bin/sh under a pty and ask it questions that only make
// sense when the child sees a real terminal:
//   - `tty` prints /dev/pts/N (proving isatty(0) = true inside).
//   - `stty size` prints "rows cols" (proving TIOCGWINSZ works).
//   - After resize(), `stty size` reflects the new shape.

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Sandboxes, Supervisor, bootPty } from "../index.ts";

async function read(handle: { stdout: NodeJS.ReadableStream }, ms: number): Promise<Buffer> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    const onData = (c: Buffer) => chunks.push(c);
    handle.stdout.on("data", onData);
    setTimeout(() => {
      handle.stdout.off("data", onData);
      done(Buffer.concat(chunks));
    }, ms).unref();
  });
}

describe("bootPty", () => {
  it("the child sees a real TTY on stdin (tty prints /dev/pts/N)", async () => {
    const vm = bootPty({
      binary: "/bin/sh",
      args: ["-c", "tty; exit"],
    });
    const out = (await read(vm, 500)).toString();
    await vm.wait();
    // Linux emits `/dev/pts/N`, macOS emits `/dev/ttys0NN` (no trailing slash).
    expect(out).toMatch(/\/dev\/(pts\/|ttys)/);
  });

  it("resize() reshapes the pty — stty size reflects the new rows/cols", async () => {
    const vm = bootPty({
      binary: "/bin/sh",
      args: ["-c", "stty size; sleep 0.1; stty size; exit"],
      cols: 80,
      rows: 24,
    });
    // Give sh time to print the first size, then resize.
    await new Promise((r) => setTimeout(r, 50));
    vm.resize(132, 50);
    const out = (await read(vm, 400)).toString();
    await vm.wait();
    // First line has initial shape, second has the resized shape.
    const lines = out.split(/\r?\n/).filter((l) => /^\d+\s+\d+/.test(l));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[1]).toMatch(/^50\s+132/);
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
