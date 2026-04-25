// Unit tests for the VM registry (#98).
//
// Exercises writeEntry/readEntry/findEntry/list/removeEntry/claimName
// against a scratch MACHINEN_REGISTRY_DIR, plus round-trips
// boot()→list()→attach() against a long-running /usr/bin/yes "VMM" so
// we don't need real HVF.

import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RegistryError, attach, boot, list, type RegistryEntry } from "../index.ts";
import {
  claimName,
  findEntry,
  isAlive,
  readEntry,
  removeEntry,
  registryRoot,
  writeEntry,
} from "../registry.ts";

describe("registry primitives", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "machinen-registry-test-"));
    process.env.MACHINEN_REGISTRY_DIR = scratchDir;
  });

  afterEach(() => {
    delete process.env.MACHINEN_REGISTRY_DIR;
    rmSync(scratchDir, { recursive: true, force: true });
  });

  it("registryRoot honors MACHINEN_REGISTRY_DIR", () => {
    expect(registryRoot()).toBe(scratchDir);
  });

  it("writeEntry → readEntry round-trips by pid", () => {
    const entry: RegistryEntry = {
      pid: process.pid,
      name: "test-vm",
      socketPath: "/tmp/fake.sock",
      imagePath: "/tmp/fake.tar.gz",
      startedAt: 1_700_000_000_000,
    };
    writeEntry(entry);
    expect(readEntry(process.pid)).toEqual(entry);
  });

  it("removeEntry drops the directory + name pin", () => {
    writeEntry({
      pid: process.pid,
      name: "to-remove",
      socketPath: "/tmp/fake.sock",
      startedAt: Date.now(),
    });
    expect(readEntry(process.pid)).toBeDefined();
    expect(findEntry({ name: "to-remove" })).toBeDefined();
    removeEntry(process.pid);
    expect(readEntry(process.pid)).toBeUndefined();
    expect(findEntry({ name: "to-remove" })).toBeUndefined();
  });

  it("isAlive returns true for this process and false for a known-dead pid", () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(999_999_999)).toBe(false);
  });

  it("list skips entries whose pid is dead and prunes them", () => {
    writeEntry({
      pid: process.pid,
      name: "alive",
      socketPath: "/tmp/fake.sock",
      startedAt: Date.now(),
    });
    writeEntry({
      pid: 999_999_999,
      socketPath: "/tmp/fake-dead.sock",
      startedAt: Date.now(),
    });
    const results = list();
    expect(results.map((e) => e.pid)).toEqual([process.pid]);
    expect(readEntry(999_999_999)).toBeUndefined();
  });

  it("findEntry returns undefined when neither pid nor name is given", () => {
    expect(findEntry({})).toBeUndefined();
  });

  it("findEntry looks up by name (via pin file → pid)", () => {
    writeEntry({
      pid: process.pid,
      name: "worker",
      socketPath: "/tmp/e1.sock",
      startedAt: Date.now(),
    });
    const hit = findEntry({ name: "worker" });
    expect(hit?.pid).toBe(process.pid);
    expect(hit?.name).toBe("worker");
  });

  it("findEntry looks up by pid", () => {
    writeEntry({
      pid: process.pid,
      name: "by-pid",
      socketPath: "/tmp/e2.sock",
      startedAt: Date.now(),
    });
    const hit = findEntry({ pid: process.pid });
    expect(hit?.name).toBe("by-pid");
  });

  it("findEntry returns undefined for an unknown name", () => {
    expect(findEntry({ name: "nope" })).toBeUndefined();
  });

  it("claimName succeeds when free, fails when held by a live pid", () => {
    expect(claimName("first", process.pid)).toBe(true);
    expect(claimName("first", process.pid + 1)).toBe(false);
  });

  it("claimName recovers stale pins (held by a dead pid)", () => {
    expect(claimName("recycled", 999_999_999)).toBe(true);
    // The dead-pid pin should be replaced by our live one on retry.
    expect(claimName("recycled", process.pid)).toBe(true);
  });
});

describe("boot + attach end-to-end", () => {
  let scratchDir: string;

  beforeEach(() => {
    scratchDir = mkdtempSync(join(tmpdir(), "machinen-registry-boot-"));
    process.env.MACHINEN_REGISTRY_DIR = scratchDir;
  });

  afterEach(() => {
    delete process.env.MACHINEN_REGISTRY_DIR;
    rmSync(scratchDir, { recursive: true, force: true });
  });

  // Minimal fake exec-agent, copy of boot.test.ts's helper. Accepts
  // one connection and writes canned O/E/X frames.
  function startFakeAgent(opts: { socketPath: string; exitCode: number; stdout?: string }) {
    const server = createServer((socket) => {
      let buf = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk]);
        if (buf.indexOf(0x0a) === -1) {
          return;
        }
        if (opts.stdout) {
          const b = Buffer.from(opts.stdout, "utf8");
          socket.write(`O ${b.length}\n`);
          socket.write(b);
        }
        socket.write(`X ${opts.exitCode}\n`);
        socket.end();
      });
    });
    server.listen(opts.socketPath);
    return { stop: () => new Promise<void>((done) => server.close(() => done())) };
  }

  it("boot() writes a registry entry that list() + attach() can find", async () => {
    const udsPath = join(tmpdir(), `machinen-attach-${process.pid}.sock`);
    const agent = startFakeAgent({ socketPath: udsPath, stdout: "from-attach\n", exitCode: 0 });
    try {
      const vm = await boot({
        binary: "/usr/bin/yes",
        vmmEnv: { MACHINEN_VSOCK: `in:1978:${udsPath}` },
        name: "my-worker",
        timeoutMs: 5_000,
      });
      try {
        expect(vm.pid).toBeGreaterThan(0);
        expect(vm.name).toBe("my-worker");

        // list() should include it, pid alive.
        const entries = list();
        expect(entries.some((e) => e.pid === vm.pid && e.name === "my-worker")).toBe(true);

        // attach({ name }) should connect and exec through the same UDS.
        const attached = await attach({ name: "my-worker" });
        try {
          expect(attached.pid).toBe(vm.pid);
          const res = await attached.exec("anything");
          expect(res.exitCode).toBe(0);
          expect(res.stdout).toBe("from-attach\n");
        } finally {
          await attached.detach();
        }
      } finally {
        await vm.kill();
      }
    } finally {
      await agent.stop();
      try {
        rmSync(udsPath);
      } catch {}
    }
  });

  it("attach() throws RegistryError when no VM matches", async () => {
    await expect(attach({ name: "nothing-here" })).rejects.toThrow(RegistryError);
    await expect(attach({ pid: 999_999_999 })).rejects.toThrow(RegistryError);
  });

  it("vm.kill() removes the registry entry via child exit", async () => {
    const udsPath = join(tmpdir(), `machinen-attach-kill-${process.pid}.sock`);
    const agent = startFakeAgent({ socketPath: udsPath, exitCode: 0 });
    try {
      const vm = await boot({
        binary: "/usr/bin/yes",
        vmmEnv: { MACHINEN_VSOCK: `in:1978:${udsPath}` },
        name: "killme",
        timeoutMs: 5_000,
      });
      expect(list().some((e) => e.name === "killme")).toBe(true);
      await vm.kill();
      // Child-exit cleanup should drop the entry.
      expect(list().some((e) => e.name === "killme")).toBe(false);
    } finally {
      await agent.stop();
      try {
        rmSync(udsPath);
      } catch {}
    }
  });

  it("boot() rejects a duplicate --name with REGISTRY_NAME_IN_USE", async () => {
    const udsPath = join(tmpdir(), `machinen-attach-dup-${process.pid}.sock`);
    const agent = startFakeAgent({ socketPath: udsPath, exitCode: 0 });
    try {
      const a = await boot({
        binary: "/usr/bin/yes",
        vmmEnv: { MACHINEN_VSOCK: `in:1978:${udsPath}` },
        name: "dupe",
        timeoutMs: 5_000,
      });
      try {
        await expect(
          boot({
            binary: "/usr/bin/yes",
            vmmEnv: { MACHINEN_VSOCK: `in:1978:${udsPath}` },
            name: "dupe",
            timeoutMs: 5_000,
          }),
        ).rejects.toThrow(/already held/i);
      } finally {
        await a.kill();
      }
    } finally {
      await agent.stop();
      try {
        rmSync(udsPath);
      } catch {}
    }
  });
});
