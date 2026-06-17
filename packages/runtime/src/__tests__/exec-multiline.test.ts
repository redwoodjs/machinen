// Multi-line vm.exec + vm.writeFile() — #112.
//
// Covers two related fixes:
//   1. VsockExec.run no longer rejects cmds containing newlines; it
//      switches to the length-prefixed `EXEC2 <bytes>\n<payload>` opcode
//      when needed. Plain newline-free cmds still go out as
//      `EXEC <cmd>\n` so older agents keep working.
//   2. `vm.writeFile()` ships file contents as base64 inside a single
//      shell pipeline so the workaround that every install-hook author
//      was writing by hand lives in one tested place.
//
// All tests use a local UDS that pretends to be the exec-agent — no
// VMM, no rootfs. The fake agent records the wire bytes it received so
// we can assert the host picks the right opcode for each shape of cmd.

import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { VsockExec } from "../exec.ts";
import { buildWriteFileCmd, buildWriteFileCmds } from "../index.ts";

interface FakeRequest {
  /** Raw bytes the host sent before the agent wrote its `X 0` reply. */
  raw: Buffer;
  /** Header line up to the first \n, ASCII-decoded. */
  header: string;
  /** Cmd bytes carried by the request — the slice after the header. */
  body: Buffer;
}

/**
 * Local UDS server that speaks just enough of the exec-agent protocol
 * to answer one cmd per connection. Recognizes both `EXEC <cmd>\n` and
 * `EXEC2 <len>\n<payload>` so the host's opcode picker can be exercised
 * without a real VM. Captures the request bytes so callers can assert
 * the wire format.
 */
function startFakeAgent(socketPath: string): {
  server: Server;
  requests: FakeRequest[];
  stop: () => Promise<void>;
} {
  const requests: FakeRequest[] = [];
  const server = createServer((sock: Socket) => {
    let buf = Buffer.alloc(0);
    let phase: "header" | "body" = "header";
    let bodyLen = 0;
    let header = "";
    sock.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      while (true) {
        if (phase === "header") {
          const nl = buf.indexOf(0x0a);
          if (nl === -1) {
            return;
          }
          header = buf.subarray(0, nl).toString("utf8");
          buf = buf.subarray(nl + 1);
          if (header.startsWith("EXEC2 ") || header.startsWith("RESEED ")) {
            bodyLen = Number.parseInt(header.slice(header.indexOf(" ") + 1), 10);
            phase = "body";
            continue;
          }
          // Legacy EXEC: cmd is everything after "EXEC " in the header.
          const body = Buffer.from(header.startsWith("EXEC ") ? header.slice(5) : "", "utf8");
          requests.push({
            raw: Buffer.concat([Buffer.from(header), Buffer.from("\n")]),
            header,
            body,
          });
          sock.write("X 0\n");
          sock.end();
          return;
        }
        if (buf.length < bodyLen) {
          return;
        }
        const body = buf.subarray(0, bodyLen);
        buf = buf.subarray(bodyLen);
        const raw = Buffer.concat([Buffer.from(`${header}\n`, "utf8"), body]);
        requests.push({ raw, header, body });
        sock.write("X 0\n");
        sock.end();
        return;
      }
    });
  });
  server.listen(socketPath);
  return {
    server,
    requests,
    stop: () =>
      new Promise<void>((done) => {
        server.close(() => done());
      }),
  };
}

describe("VsockExec multi-line wire format", () => {
  let workDir: string;
  let agent: { server: Server; requests: FakeRequest[]; stop: () => Promise<void> } | undefined;

  beforeEach(() => {
    workDir = mkdtempSync(join(tmpdir(), "machinen-exec-multiline-"));
  });
  afterEach(async () => {
    if (agent) {
      await agent.stop();
      agent = undefined;
    }
    rmSync(workDir, { recursive: true, force: true });
  });

  it("uses legacy EXEC opcode for newline-free cmds (back-compat)", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startFakeAgent(uds);
    const res = await VsockExec.run(uds, "echo hello");
    expect(res.exitCode).toBe(0);
    expect(agent.requests).toHaveLength(1);
    expect(agent.requests[0]!.header).toBe("EXEC echo hello");
  });

  it("sends vmstate reseed over direct RESEED opcode", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startFakeAgent(uds);
    const seed = "ab".repeat(64);
    const res = await VsockExec.reseedVmstate(uds, seed);
    expect(res.exitCode).toBe(0);
    expect(agent.requests[0]!.header).toBe(`RESEED ${seed.length}`);
    expect(agent.requests[0]!.body.toString("ascii")).toBe(seed);
  });

  it("sends vmstate snapshot sync over direct SYNC opcode", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startFakeAgent(uds);
    const res = await VsockExec.syncVmstate(uds);
    expect(res.exitCode).toBe(0);
    expect(agent.requests[0]!.header).toBe("SYNC");
  });

  it("switches to EXEC2 length-prefix opcode when cmd contains newlines", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startFakeAgent(uds);
    const cmd = `cat > /etc/foo <<'EOF'\nline1\nline2\nEOF`;
    const res = await VsockExec.run(uds, cmd);
    expect(res.exitCode).toBe(0);
    expect(agent.requests).toHaveLength(1);
    const req = agent.requests[0]!;
    const expectedLen = Buffer.byteLength(cmd, "utf8");
    expect(req.header).toBe(`EXEC2 ${expectedLen}`);
    expect(req.body.toString("utf8")).toBe(cmd);
  });

  it("preserves utf-8 byte length, not character count, in EXEC2 header", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startFakeAgent(uds);
    // 3 chars, 6 utf-8 bytes; the agent reads bytes, not codepoints.
    const cmd = `echo 'éé\né'`;
    await VsockExec.run(uds, cmd);
    const req = agent.requests[0]!;
    expect(req.header).toBe(`EXEC2 ${Buffer.byteLength(cmd, "utf8")}`);
    expect(req.body.toString("utf8")).toBe(cmd);
  });

  it("accepts a CR-only command via EXEC2 (no longer rejected)", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startFakeAgent(uds);
    const cmd = "echo a\rb";
    const res = await VsockExec.run(uds, cmd);
    expect(res.exitCode).toBe(0);
    expect(agent.requests[0]!.header.startsWith("EXEC2 ")).toBe(true);
  });

  // The agent's `readLine` uses a 4096-byte buffer; a newline-free cmd
  // bigger than that overflows it and the agent logs "bad header" then
  // closes. vm.writeFile() of a multi-hundred-KB binary tripped this.
  // The host must promote to EXEC2 on size, not just on newlines.
  it("switches to EXEC2 for large newline-free cmds (4096-byte agent buffer)", async () => {
    const uds = join(workDir, "exec.sock");
    agent = startFakeAgent(uds);
    const cmd = `echo ${"a".repeat(8000)}`;
    const res = await VsockExec.run(uds, cmd);
    expect(res.exitCode).toBe(0);
    const req = agent.requests[0]!;
    expect(req.header).toBe(`EXEC2 ${Buffer.byteLength(cmd, "utf8")}`);
    expect(req.body.toString("utf8")).toBe(cmd);
  });
});

describe("buildWriteFileCmd", () => {
  it("emits a single-line shell pipeline (compatible with legacy EXEC)", () => {
    const cmd = buildWriteFileCmd("/etc/foo.conf", "hello\n");
    expect(cmd).not.toMatch(/\n/);
    expect(cmd).toContain("base64 -d");
    expect(cmd).toContain("> '/etc/foo.conf'");
    expect(cmd).toContain("mkdir -p");
  });

  it("encodes contents as base64 so binary + special chars survive", () => {
    const contents = "newlines\nquotes 'and' \"more\"\n";
    const cmd = buildWriteFileCmd("/tmp/x", contents);
    const expectedB64 = Buffer.from(contents, "utf8").toString("base64");
    expect(cmd).toContain(`'${expectedB64}'`);
  });

  it("accepts Buffer contents", () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0xff]);
    const cmd = buildWriteFileCmd("/tmp/x", buf);
    expect(cmd).toContain(`'${buf.toString("base64")}'`);
  });

  it("appends `chmod` when mode is set", () => {
    const cmd = buildWriteFileCmd("/usr/local/bin/foo", "#!/bin/sh\n", { mode: 0o755 });
    expect(cmd).toMatch(/&& chmod 755 '\/usr\/local\/bin\/foo'$/);
  });

  it("uses >> when append is set", () => {
    const cmd = buildWriteFileCmd("/var/log/x", "more\n", { append: true });
    expect(cmd).toContain(">> '/var/log/x'");
    expect(cmd).not.toMatch(/[^>]> '\/var\/log\/x'/);
  });

  it("skips mkdir when recursive: false", () => {
    const cmd = buildWriteFileCmd("/etc/foo", "x", { recursive: false });
    expect(cmd).not.toContain("mkdir");
  });

  it("safely escapes single quotes in the guest path", () => {
    const cmd = buildWriteFileCmd("/tmp/it's-fine", "x");
    // Standard shell escape: ' \' '. The path is now '...it'\''s-fine'.
    expect(cmd).toContain(`'/tmp/it'\\''s-fine'`);
  });

  it("rejects out-of-range modes", () => {
    expect(() => buildWriteFileCmd("/x", "y", { mode: -1 })).toThrow(RangeError);
    expect(() => buildWriteFileCmd("/x", "y", { mode: 0o10000 })).toThrow(RangeError);
    expect(() => buildWriteFileCmd("/x", "y", { mode: 1.5 })).toThrow(RangeError);
  });
});

describe("buildWriteFileCmds (chunking)", () => {
  it("returns a single cmd for small payloads (matches buildWriteFileCmd)", () => {
    const cmds = buildWriteFileCmds("/etc/foo.conf", "hello\n", { mode: 0o644 });
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toBe(buildWriteFileCmd("/etc/foo.conf", "hello\n", { mode: 0o644 }));
  });

  // Linux's MAX_ARG_STRLEN caps a single argv element at 128 KB; the
  // exec-agent runs cmds via `sh -c <cmd>`, so a 200 KB binary's base64
  // pipeline (~270 KB) blows past it and execve fails with E2BIG → 127.
  // Chunking writes the base64 in append-batches and decodes once.
  it("splits large payloads into setup + N append + finalize cmds, each < 128 KB", () => {
    const big = Buffer.alloc(200 * 1024, 0x5a);
    const cmds = buildWriteFileCmds("/sbin/winsize", big, { mode: 0o755 });
    expect(cmds.length).toBeGreaterThanOrEqual(3);
    for (const c of cmds) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThan(128 * 1024);
    }
    expect(cmds[0]).toContain("mkdir -p");
    const stageMatch = /(\/tmp\/\.machinen-wf\.[a-f0-9]+)/.exec(cmds[0]!);
    expect(stageMatch).not.toBeNull();
    const stage = stageMatch![1]!;
    expect(cmds[0]).toContain(`: > ${stage}`);
    const stageRe = new RegExp(`^printf %s '[A-Za-z0-9+/=]+' >> ${stage.replace(/\./g, "\\.")}$`);
    for (const c of cmds.slice(1, -1)) {
      expect(c).toMatch(stageRe);
    }
    const final = cmds[cmds.length - 1]!;
    expect(final).toContain(`base64 -d < ${stage} > '/sbin/winsize'`);
    expect(final).toContain(`rm -f ${stage}`);
    expect(final).toContain("chmod 755 '/sbin/winsize'");
  });

  // The earlier $$ scheme broke here: each cmd ran in its own `sh -c`,
  // so $$ expanded to a different PID per invocation and the chunks
  // scattered across files. The host must bake a fixed suffix in.
  it("uses a single host-generated staging path across every cmd", () => {
    const big = Buffer.alloc(200 * 1024, 0x42);
    const cmds = buildWriteFileCmds("/sbin/x", big);
    const stages = cmds.map((c) => /(\/tmp\/\.machinen-wf\.[a-f0-9]+)/.exec(c)?.[1]);
    for (const s of stages) {
      expect(s).toBeDefined();
    }
    expect(new Set(stages).size).toBe(1);
    for (const c of cmds) {
      expect(c).not.toContain("$$");
    }
  });

  it("reconstructs the original bytes when the chunked cmds are replayed", () => {
    // Simulate the guest: run the cmds against a shell-like reducer.
    const big = Buffer.from(Array.from({ length: 150 * 1024 }, (_, i) => (i * 7 + 11) & 0xff));
    const cmds = buildWriteFileCmds("/tmp/out", big);
    let staged = "";
    for (const c of cmds) {
      // Pull the base64 chunk out of `printf %s '<b64>' >> /tmp/...`.
      const m = /^printf %s '([A-Za-z0-9+/=]+)' >> /.exec(c);
      if (m) {
        staged += m[1]!;
      }
    }
    expect(Buffer.from(staged, "base64").equals(big)).toBe(true);
  });

  it("uses >> (append) in the finalize step when opts.append is set", () => {
    const big = Buffer.alloc(100 * 1024);
    const cmds = buildWriteFileCmds("/var/log/x", big, { append: true });
    const final = cmds[cmds.length - 1]!;
    expect(final).toContain(">> '/var/log/x'");
    expect(final).not.toMatch(/[^>]> '\/var\/log\/x'/);
  });

  it("validates mode up front before staging anything", () => {
    const big = Buffer.alloc(100 * 1024);
    expect(() => buildWriteFileCmds("/x", big, { mode: -1 })).toThrow(RangeError);
    expect(() => buildWriteFileCmds("/x", big, { mode: 0o10000 })).toThrow(RangeError);
  });
});
