// Unit tests for the VM registry (#98).
//
// Exercises writeEntry/readEntry/findEntry/list/removeEntry/claimName
// against a scratch MACHINEN_REGISTRY_DIR, plus round-trips
// boot()→list()→attach() against a long-running /usr/bin/yes "VMM" so
// we don't need real HVF.

import { createServer } from "node:net";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RegistryError, attach, boot, list, type RegistryEntry } from "../index.ts";
import {
  claimName,
  findEntry,
  isAlive,
  patchEntry,
  readEntry,
  removeEntry,
  registryRoot,
  writeEntry,
} from "../registry.ts";
import { readProcessIdentity } from "../pid-validate.ts";

/**
 * Build a registry entry for the test runner that passes
 * `validatePid` ("alive"). Uses the OS's reported start time +
 * exe basename so the snapshot in the entry matches what
 * `validatePid` re-reads from `ps` / `/proc`.
 */
function entryForSelf(name: string): RegistryEntry {
  const observed = readProcessIdentity(process.pid);
  return {
    pid: process.pid,
    name,
    socketPath: "/tmp/fake.sock",
    vmmExe: observed?.exeBase,
    startedAt: observed?.startedAtMs ?? Date.now(),
  };
}

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

  it("writeEntry → readEntry round-trips portForward", () => {
    const entry: RegistryEntry = {
      pid: process.pid,
      name: "with-ports",
      socketPath: "/tmp/fake.sock",
      portForward: [
        { hostPort: 3000, guestPort: 3000 },
        { hostPort: 5432, guestPort: 5432, hostAddr: "0.0.0.0" },
      ],
      startedAt: 1_700_000_000_000,
    };
    writeEntry(entry);
    expect(readEntry(process.pid)).toEqual(entry);
  });

  it("removeEntry drops the directory + name pin", () => {
    writeEntry(entryForSelf("to-remove"));
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
    writeEntry(entryForSelf("alive"));
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
    writeEntry(entryForSelf("worker"));
    const hit = findEntry({ name: "worker" });
    expect(hit?.pid).toBe(process.pid);
    expect(hit?.name).toBe("worker");
  });

  it("findEntry looks up by pid", () => {
    writeEntry(entryForSelf("by-pid"));
    const hit = findEntry({ pid: process.pid });
    expect(hit?.name).toBe("by-pid");
  });

  it("findEntry returns undefined for an unknown name", () => {
    expect(findEntry({ name: "nope" })).toBeUndefined();
  });

  it("patchEntry merges a partial update without losing fields", () => {
    writeEntry(entryForSelf("with-helpers"));
    patchEntry(process.pid, {
      liveMountServers: [
        { pid: 4242, exe: "/usr/local/bin/node" },
        { pid: 4243, exe: "/usr/local/bin/pdeathsig" },
      ],
    });
    const got = readEntry(process.pid);
    expect(got?.name).toBe("with-helpers");
    expect(got?.liveMountServers).toEqual([
      { pid: 4242, exe: "/usr/local/bin/node" },
      { pid: 4243, exe: "/usr/local/bin/pdeathsig" },
    ]);
  });

  it("patchEntry is a no-op when the entry doesn't exist", () => {
    expect(() => patchEntry(999_999_999, { liveMountServers: [] })).not.toThrow();
    expect(readEntry(999_999_999)).toBeUndefined();
  });

  it("claimName succeeds when free, fails when held by a live pid", () => {
    expect(claimName("first", process.pid)).toBe(true);
    // Real-world flow: writeEntry follows claimName synchronously, so
    // pinIsStale always sees a matching <pid>/meta.json. Without it
    // here the orphan check would fire and the second claim would
    // succeed (replacing the pin).
    writeEntry(entryForSelf("first"));
    expect(claimName("first", process.pid + 1)).toBe(false);
  });

  it("claimName recovers stale pins (held by a dead pid)", () => {
    expect(claimName("recycled", 999_999_999)).toBe(true);
    // The dead-pid pin should be replaced by our live one on retry.
    expect(claimName("recycled", process.pid)).toBe(true);
  });

  it("claimName self-heals an empty stale directory at the pin path", () => {
    // Reproduces the leftover from a path-shaped child pin (pre-#268
    // removeEntry didn't prune parents): names/<name>/ ends up empty.
    mkdirSync(join(scratchDir, "names", "stranded"), { recursive: true });
    expect(claimName("stranded", process.pid)).toBe(true);
  });

  it("claimName refuses when a non-empty directory holds nested pins", () => {
    // A live child pin at names/parent/<pid> means the plain name is taken.
    mkdirSync(join(scratchDir, "names", "parent"), { recursive: true });
    writeFileSync(join(scratchDir, "names", "parent", "1234"), "1234");
    expect(claimName("parent", process.pid)).toBe(false);
  });

  it("removeEntry prunes empty parent dirs of a path-shaped pin", () => {
    writeEntry({
      pid: process.pid,
      name: "src/child",
      socketPath: "/tmp/fake.sock",
      startedAt: Date.now(),
    });
    expect(existsSync(join(scratchDir, "names", "src", "child"))).toBe(true);
    removeEntry(process.pid);
    // Both the leaf pin and the now-empty parent should be gone, so the
    // plain name "src" is claimable again.
    expect(existsSync(join(scratchDir, "names", "src"))).toBe(false);
    expect(claimName("src", process.pid)).toBe(true);
  });

  it("claimName drops an orphan pin whose meta dir is missing", () => {
    // Reproduces the bug where ls shows nothing but boot still says
    // REGISTRY_NAME_IN_USE: a name pin pointing at a pid whose
    // <pid>/meta.json is gone. kill(pid, 0) succeeds for the
    // unrelated process now sitting on that recycled pid, so the
    // pre-fix isAlive() check kept the pin pinned forever.
    mkdirSync(join(scratchDir, "names"), { recursive: true });
    // Pin points at *this* process — alive per kill(0) — but no meta dir.
    writeFileSync(join(scratchDir, "names", "orphan"), String(process.pid));
    expect(claimName("orphan", process.pid)).toBe(true);
  });

  it("claimName drops a pin whose meta says the pid was recycled", () => {
    // vmmExe basename won't match this process's exe, and startedAt=0
    // is far outside the skew window — validatePid returns "recycled".
    writeEntry({
      pid: process.pid,
      name: "ghost",
      socketPath: "/tmp/fake.sock",
      vmmExe: "/never-installed-binary",
      startedAt: 0,
    });
    expect(claimName("ghost", process.pid)).toBe(true);
    // Stale meta dir should be reaped too — otherwise the next list()
    // would still see it and have to clean up redundantly.
    expect(readEntry(process.pid)).toBeUndefined();
  });

  it("list() prunes a recycled-pid entry and its pin", () => {
    writeEntry({
      pid: process.pid,
      name: "stale-vmm",
      socketPath: "/tmp/fake.sock",
      vmmExe: "/never-installed-binary",
      startedAt: 0,
    });
    expect(list().some((e) => e.name === "stale-vmm")).toBe(false);
    expect(readEntry(process.pid)).toBeUndefined();
    expect(findEntry({ name: "stale-vmm" })).toBeUndefined();
  });

  it("list() sweeps empty pin-parent dirs left over from pre-#268 entries", () => {
    // Pre-#268 path-shaped pins didn't prune their parents on remove,
    // so old `proof-*` / `dbg-*` empty dirs accumulate under names/.
    mkdirSync(join(scratchDir, "names", "proof-65761"), { recursive: true });
    mkdirSync(join(scratchDir, "names", "dbg-65992"), { recursive: true });
    list();
    expect(existsSync(join(scratchDir, "names", "proof-65761"))).toBe(false);
    expect(existsSync(join(scratchDir, "names", "dbg-65992"))).toBe(false);
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
