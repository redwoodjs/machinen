// Tests for the #51 M1 multiplex layer (Sandboxes + Supervisor).
//
// Uses `cat` processes as stand-ins for VMs — cheap, predictable,
// stdin-echoes-to-stdout — so we can exercise the routing logic
// without booting anything.

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { Sandboxes, type VmHandle, Supervisor, boot } from "../index.ts";

async function fakeVm(args: string[] = []): Promise<VmHandle> {
  return boot({ binary: "/bin/cat", args, timeoutMs: 10_000 });
}

// Drain helper — read `ms` worth of pending data off the output stream.
async function drain(stream: NodeJS.ReadableStream, ms: number): Promise<Buffer> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    const onData = (c: Buffer) => chunks.push(c);
    stream.on("data", onData);
    setTimeout(() => {
      stream.off("data", onData);
      done(Buffer.concat(chunks));
    }, ms).unref();
  });
}

describe("Sandboxes", () => {
  it("add + list + get + remove track live handles", async () => {
    const reg = new Sandboxes();
    const a = await fakeVm();
    const b = await fakeVm();
    try {
      reg.add("alice", a);
      reg.add("bob", b);
      expect(
        reg
          .list()
          .map((r) => r.id)
          .sort(),
      ).toEqual(["alice", "bob"]);
      expect(reg.get("alice")?.id).toBe("alice");
      reg.remove("alice");
      expect(reg.list().map((r) => r.id)).toEqual(["bob"]);
    } finally {
      await a.kill();
      await b.kill();
    }
  });

  it("add rejects a duplicate id", async () => {
    const reg = new Sandboxes();
    const a = await fakeVm();
    try {
      reg.add("x", a);
      expect(() => reg.add("x", a)).toThrow(/already registered/);
    } finally {
      await a.kill();
    }
  });

  it("onOutput fires for new stdout bytes; scrollback captures history", async () => {
    const reg = new Sandboxes({ scrollbackBytes: 128 });
    const vm = await fakeVm();
    try {
      reg.add("echo", vm);

      // Write some bytes BEFORE subscribing — should still land in scrollback.
      vm.stdin.write("hello ");
      await new Promise((r) => setTimeout(r, 100));

      const seen: Buffer[] = [];
      const unsub = reg.onOutput("echo", (chunk) => {
        seen.push(chunk);
      });

      vm.stdin.write("world\n");
      await new Promise((r) => setTimeout(r, 100));
      unsub();

      const entry = reg.get("echo")!;
      expect(entry.scrollback.toString()).toContain("hello ");
      expect(Buffer.concat(seen).toString()).toContain("world");
    } finally {
      await vm.kill();
    }
  });

  it("scrollback is bounded by scrollbackBytes", async () => {
    const reg = new Sandboxes({ scrollbackBytes: 16 });
    const vm = await fakeVm();
    try {
      reg.add("bounded", vm);
      vm.stdin.write("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ");
      await new Promise((r) => setTimeout(r, 150));
      const entry = reg.get("bounded")!;
      expect(entry.scrollback.length).toBeLessThanOrEqual(16);
      expect(entry.scrollback.toString().endsWith("WXYZ")).toBe(true);
    } finally {
      await vm.kill();
    }
  });

  it("auto-removes an entry when the VM exits", async () => {
    const reg = new Sandboxes();
    // `true` exits immediately.
    const vm = await boot({ binary: "/usr/bin/true" });
    reg.add("quick", vm);
    await vm.wait();
    // Let the wait().then(remove) callback settle.
    await new Promise((r) => setTimeout(r, 50));
    expect(reg.list().find((r) => r.id === "quick")).toBeUndefined();
  });
});

describe("Supervisor", () => {
  it("forwards typed bytes to the attached sandbox and echoes its output", async () => {
    const reg = new Sandboxes();
    const vm = await fakeVm();
    reg.add("cat", vm);

    const input = new PassThrough();
    const output = new PassThrough();
    const sup = new Supervisor({ sandboxes: reg, input, output });
    const done = sup.run();

    sup.attach("cat");
    input.write("ping-pong\n");
    const got = (await drain(output, 250)).toString();
    expect(got).toContain("ping-pong");

    sup.stop();
    await done;
    await vm.kill();
  });

  it("routes bytes to the CURRENTLY-attached sandbox, not any other", async () => {
    const reg = new Sandboxes();
    const a = await fakeVm();
    const b = await fakeVm();
    reg.add("a", a);
    reg.add("b", b);

    const input = new PassThrough();
    const output = new PassThrough();
    const sup = new Supervisor({ sandboxes: reg, input, output });
    const done = sup.run();

    sup.attach("a");
    input.write("to-a\n");
    await new Promise((r) => setTimeout(r, 150));

    sup.attach("b"); // detaches a, attaches b
    input.write("to-b\n");
    await new Promise((r) => setTimeout(r, 150));

    // Drain output and check both strings appear (order is A then B).
    const got = (await drain(output, 50)).toString();
    expect(got).toContain("to-b");

    // a's stdin got only "to-a"; b's stdin got only "to-b". Each
    // sandbox's scrollback proves routing was per-sandbox.
    expect(reg.get("a")!.scrollback.toString()).toContain("to-a");
    expect(reg.get("a")!.scrollback.toString()).not.toContain("to-b");
    expect(reg.get("b")!.scrollback.toString()).toContain("to-b");
    expect(reg.get("b")!.scrollback.toString()).not.toContain("to-a");

    sup.stop();
    await done;
    await a.kill();
    await b.kill();
  });

  it("detaches on Ctrl-] Ctrl-] and goes back to command mode", async () => {
    const reg = new Sandboxes();
    const vm = await fakeVm();
    reg.add("cat", vm);

    const input = new PassThrough();
    const output = new PassThrough();
    const sup = new Supervisor({ sandboxes: reg, input, output });
    const done = sup.run();

    sup.attach("cat");
    input.write(Buffer.from([0x1d, 0x1d])); // Ctrl-] Ctrl-]
    await new Promise((r) => setTimeout(r, 100));

    // After detach, typing "hello" without a / prefix is an unknown
    // command, not forwarded to cat.
    input.write("hello\n");
    await new Promise((r) => setTimeout(r, 100));
    const got = (await drain(output, 50)).toString();
    expect(got).toContain("detached from cat");
    expect(got).toContain("unknown input");
    expect(reg.get("cat")!.scrollback.toString()).not.toContain("hello");

    sup.stop();
    await done;
    await vm.kill();
  });

  it("/ls prints the registered ids", async () => {
    const reg = new Sandboxes();
    const a = await fakeVm();
    const b = await fakeVm();
    reg.add("one", a);
    reg.add("two", b);

    const input = new PassThrough();
    const output = new PassThrough();
    const sup = new Supervisor({ sandboxes: reg, input, output });
    const done = sup.run();

    input.write("/ls\n");
    await new Promise((r) => setTimeout(r, 100));
    const got = (await drain(output, 50)).toString();
    expect(got).toMatch(/one/);
    expect(got).toMatch(/two/);

    sup.stop();
    await done;
    await a.kill();
    await b.kill();
  });
});
