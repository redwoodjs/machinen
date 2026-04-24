// Unit tests for the VM registry (#98).
//
// Exercises writeEntry/readEntry/findEntry/list/removeEntry against a
// scratch MACHINEN_REGISTRY_DIR, plus round-trips boot()→list()→attach()
// against a long-running /usr/bin/yes "VMM" so we don't need real HVF.

import { createServer } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RegistryError, attach, boot, list, type RegistryEntry } from "../index.ts";
import {
  findEntry,
  isAlive,
  newVmId,
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

  it("newVmId returns an 8-char hex string", () => {
    const id = newVmId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("registryRoot honors MACHINEN_REGISTRY_DIR", () => {
    expect(registryRoot()).toBe(scratchDir);
  });

  it("writeEntry → readEntry round-trips", () => {
    const entry: RegistryEntry = {
      id: "abcd1234",
      name: "test-vm",
      pid: process.pid,
      socketPath: "/tmp/fake.sock",
      imagePath: "/tmp/fake.tar.gz",
      startedAt: 1_700_000_000_000,
    };
    writeEntry(entry);
    expect(readEntry("abcd1234")).toEqual(entry);
  });

  it("removeEntry drops the directory", () => {
    writeEntry({
      id: "abcd1234",
      pid: process.pid,
      socketPath: "/tmp/fake.sock",
      startedAt: Date.now(),
    });
    expect(readEntry("abcd1234")).toBeDefined();
    removeEntry("abcd1234");
    expect(readEntry("abcd1234")).toBeUndefined();
  });

  it("isAlive returns true for this process and false for a known-dead pid", () => {
    expect(isAlive(process.pid)).toBe(true);
    // Pid 0 is a process group; Pid 1 is init (always alive). Use a
    // very high pid that won't exist on a normal box.
    expect(isAlive(999_999_999)).toBe(false);
  });

  it("list skips entries whose pid is dead and prunes them", () => {
    writeEntry({
      id: "alive",
      pid: process.pid,
      socketPath: "/tmp/fake.sock",
      startedAt: Date.now(),
    });
    writeEntry({
      id: "dead",
      pid: 999_999_999,
      socketPath: "/tmp/fake-dead.sock",
      startedAt: Date.now(),
    });
    const results = list();
    expect(results.map((e) => e.id)).toEqual(["alive"]);
    // Dead entry should have been pruned.
    expect(readEntry("dead")).toBeUndefined();
  });

  it("findEntry returns undefined when neither id nor name is given", () => {
    expect(findEntry({})).toBeUndefined();
  });

  it("findEntry looks up by name", () => {
    writeEntry({
      id: "e1",
      name: "worker",
      pid: process.pid,
      socketPath: "/tmp/e1.sock",
      startedAt: Date.now(),
    });
    const hit = findEntry({ name: "worker" });
    expect(hit?.id).toBe("e1");
  });

  it("findEntry returns undefined for an unknown name", () => {
    expect(findEntry({ name: "nope" })).toBeUndefined();
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
        expect(vm.id).toMatch(/^[0-9a-f]{8}$/);
        expect(vm.name).toBe("my-worker");

        // list() should include it, pid alive.
        const entries = list();
        expect(entries.some((e) => e.id === vm.id && e.name === "my-worker")).toBe(true);

        // attach({ name }) should connect and exec through the same UDS.
        const attached = await attach({ name: "my-worker" });
        try {
          expect(attached.id).toBe(vm.id);
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
    await expect(attach({ id: "deadbeef" })).rejects.toThrow(RegistryError);
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
});
