import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  captureMovePidDependencyGraph,
  classifyMovePidDependencyGraph,
} from "../move-pid-graph.ts";

interface ProcFixtureOptions {
  exe?: string;
  argv?: string[];
  processState?: string;
  threadState?: string;
  tracerPid?: number;
  fds?: Array<{ fd: number; target: string; fdinfo?: string }>;
  net?: Partial<Record<"tcp" | "udp" | "raw" | "icmp" | "unix", string>>;
  deletedCwd?: boolean;
}

function makeProcFixture(options: ProcFixtureOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "machinen-move-proc-"));
  const pid = 1234;
  const pidDir = join(root, String(pid));
  mkdirSync(join(pidDir, "fd"), { recursive: true });
  mkdirSync(join(pidDir, "fdinfo"), { recursive: true });
  mkdirSync(join(pidDir, "task", String(pid)), { recursive: true });
  mkdirSync(join(pidDir, "net"), { recursive: true });
  mkdirSync(join(pidDir, "ns"), { recursive: true });

  const exe = options.exe ?? "/usr/bin/ping";
  const argv = options.argv ?? ["ping", "127.0.0.1"];
  writeFileSync(
    join(pidDir, "status"),
    `Name:\t${argv[0] ?? "process"}\nState:\t${options.processState ?? "S (sleeping)"}\nPPid:\t1\nTracerPid:\t${options.tracerPid ?? 0}\nThreads:\t1\n`,
  );
  writeFileSync(join(pidDir, "cmdline"), `${argv.join("\u0000")}\u0000`);
  writeFileSync(join(pidDir, "environ"), "PATH=/bin\u0000TERM=xterm\u0000");
  symlinkSync(exe, join(pidDir, "exe"));
  symlinkSync(options.deletedCwd ? "/tmp/gone (deleted)" : "/", join(pidDir, "cwd"));
  symlinkSync("net:[4026531992]", join(pidDir, "ns", "net"));

  for (const fd of options.fds ?? [{ fd: 3, target: "socket:[4242]" }]) {
    symlinkSync(fd.target, join(pidDir, "fd", String(fd.fd)));
    writeFileSync(
      join(pidDir, "fdinfo", String(fd.fd)),
      fd.fdinfo ?? "pos:\t0\nflags:\t02000002\n",
    );
  }

  writeFileSync(
    join(pidDir, "task", String(pid), "status"),
    `Name:\t${argv[0] ?? "process"}\nState:\t${options.threadState ?? "S (sleeping)"}\n`,
  );
  writeFileSync(join(pidDir, "task", String(pid), "syscall"), "47 0x3 0x0 0x0\n");
  writeFileSync(join(pidDir, "task", String(pid), "wchan"), "do_epoll_wait\n");

  for (const [table, text] of Object.entries(options.net ?? { icmp: icmpRow("4242") })) {
    writeFileSync(join(pidDir, "net", table), text);
  }
  return { root, pid };
}

function icmpRow(inode: string, queue = "00000000:00000000") {
  return `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:0001 0100007F:0000 01 ${queue} 00:00000000 00000000 1000        0 ${inode}\n`;
}

function tcpRow(inode: string, state = "0A", queue = "00000000:00000000") {
  return `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:1F90 00000000:0000 ${state} ${queue} 00:00000000 00000000 1000        0 ${inode}\n`;
}

function udpRow(inode: string, queue = "00000000:00000000") {
  return `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:1F90 00000000:0000 07 ${queue} 00:00000000 00000000 1000        0 ${inode}\n`;
}

function rawRow(inode: string, protocolHex = "0001", queue = "00000000:00000000") {
  return `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 00000000:${protocolHex} 00000000:0000 07 ${queue} 00:00000000 00000000 1000        0 ${inode}\n`;
}

function unixRow(inode: string) {
  return `Num       RefCount Protocol Flags    Type St Inode Path\n00000000: 00000002 00000000 00010000 0001 01 ${inode} /tmp/example.sock\n`;
}

function withFixture(options: ProcFixtureOptions, fn: (root: string, pid: number) => void) {
  const fixture = makeProcFixture(options);
  try {
    fn(fixture.root, fixture.pid);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
}

describe("move pid dependency graph", () => {
  it("detects a paused ping socket candidate from guest procfs", () => {
    withFixture({}, (root, pid) => {
      const graph = captureMovePidDependencyGraph({
        pid,
        procRoot: root,
        observationConsistency: "paused-vm-atomic",
      });
      expect(graph.kind).toBe("machinen.move.guest-pid-dependency-graph");
      expect(graph.decision).toBe("accepted");
      expect(graph.process?.argv).toEqual(["ping", "127.0.0.1"]);
      expect(graph.sockets).toMatchObject([{ inode: "4242", protocol: "ping-dgram-icmp" }]);
      expect(graph.adapterCandidates[0]).toMatchObject({ adapter: "ping-socket" });
      expect(classifyMovePidDependencyGraph(graph)).toMatchObject({
        decision: "accepted",
        shapeId: "shape-ping-socket",
      });
    });
  });

  it("ignores namespace sockets not owned by the pid fd graph", () => {
    withFixture(
      {
        net: {
          icmp: `${icmpRow("4242")}${icmpRow("9999", "00000000:00000008").split("\n").slice(1).join("\n")}`,
        },
      },
      (root, pid) => {
        const graph = captureMovePidDependencyGraph({ pid, procRoot: root });
        expect(graph.sockets.map((socket) => socket.inode)).toEqual(["4242"]);
        expect(graph.refusals).toEqual([]);
      },
    );
  });

  it("refuses queued socket bytes before selecting an adapter", () => {
    withFixture({ net: { icmp: icmpRow("4242", "00000000:00000004") } }, (root, pid) => {
      const graph = captureMovePidDependencyGraph({ pid, procRoot: root });
      expect(graph.decision).toBe("refused");
      expect(graph.refusals).toMatchObject([{ code: "socket-queued-bytes" }]);
      expect(graph.adapterCandidates).toEqual([]);
    });
  });

  it("detects raw ICMP but refuses non-ICMP raw sockets", () => {
    withFixture({ net: { raw: rawRow("4242") } }, (root, pid) => {
      const graph = captureMovePidDependencyGraph({ pid, procRoot: root });
      expect(graph.sockets).toMatchObject([{ protocol: "raw-icmp" }]);
      expect(classifyMovePidDependencyGraph(graph)).toMatchObject({
        decision: "accepted",
        shapeId: "shape-ping-socket",
      });
    });
    withFixture({ net: { raw: rawRow("4242", "003A") } }, (root, pid) => {
      const graph = captureMovePidDependencyGraph({ pid, procRoot: root });
      expect(graph.refusals).toMatchObject([{ code: "raw-socket-protocol-untranslated" }]);
    });
  });

  it("detects listener/udp/unix resource candidates without claiming full process translation", () => {
    const cases: ProcFixtureOptions[] = [
      { exe: "/usr/bin/nc", argv: ["nc", "-l", "8080"], net: { tcp: tcpRow("4242") } },
      { exe: "/usr/bin/socat", argv: ["socat"], net: { udp: udpRow("4242") } },
      { exe: "/usr/bin/socat", argv: ["socat"], net: { unix: unixRow("4242") } },
    ];
    for (const options of cases) {
      withFixture(options, (root, pid) => {
        const graph = captureMovePidDependencyGraph({ pid, procRoot: root });
        expect(graph.adapterCandidates.length).toBeGreaterThan(0);
        expect(classifyMovePidDependencyGraph(graph)).toMatchObject({
          decision: "refused",
          shapeId: "no-proven-process-translator",
        });
      });
    }
  });

  it("refuses connected tcp, ptrace, active thread, deleted path, pipe, pty, unknown fd, and no-adapter shapes", () => {
    const cases: Array<[string, ProcFixtureOptions, string]> = [
      ["connected tcp", { net: { tcp: tcpRow("4242", "01") } }, "tcp-connected-peer-untranslated"],
      ["ptrace", { tracerPid: 99 }, "ptrace-owned-process"],
      ["active thread", { threadState: "R (running)" }, "active-thread"],
      ["deleted cwd", { deletedCwd: true }, "deleted-path-dependency"],
      ["pipe", { fds: [{ fd: 1, target: "pipe:[222]" }], net: {} }, "pipe-queue-state-unobserved"],
      ["pty", { fds: [{ fd: 0, target: "/dev/pts/3" }], net: {} }, "pty-queue-state-unobserved"],
      ["unknown fd", { fds: [{ fd: 9, target: "memfd:foo" }], net: {} }, "unknown-fd"],
      [
        "epoll",
        { fds: [{ fd: 4, target: "anon_inode:[eventpoll]" }], net: {} },
        "epoll-interest-graph-untranslated",
      ],
      [
        "no adapter",
        { exe: "/bin/sleep", argv: ["sleep", "10"], fds: [], net: {} },
        "no-translator-adapter",
      ],
    ];
    for (const [, options, code] of cases) {
      withFixture(options, (root, pid) => {
        const classification = classifyMovePidDependencyGraph(
          captureMovePidDependencyGraph({ pid, procRoot: root }),
        );
        expect(classification.decision).toBe("refused");
        expect(classification.shapeId).toBe(code);
      });
    }
  });

  it("surfaces eventfd and timerfd resource candidates without overclaiming process restore", () => {
    const cases: ProcFixtureOptions[] = [
      {
        fds: [
          {
            fd: 4,
            target: "anon_inode:[eventfd]",
            fdinfo: "pos:\t0\nflags:\t02000002\neventfd-count:\t0\n",
          },
        ],
        net: {},
      },
      {
        fds: [
          {
            fd: 5,
            target: "anon_inode:[timerfd]",
            fdinfo: "pos:\t0\nflags:\t02000002\nclockid:\t1\nticks:\t0\n",
          },
        ],
        net: {},
      },
    ];
    for (const options of cases) {
      withFixture(options, (root, pid) => {
        const graph = captureMovePidDependencyGraph({ pid, procRoot: root });
        expect(graph.adapterCandidates.length).toBe(1);
        expect(classifyMovePidDependencyGraph(graph)).toMatchObject({
          decision: "refused",
          shapeId: "no-proven-process-translator",
        });
      });
    }
  });

  it("refuses readable timerfd expirations", () => {
    withFixture(
      {
        fds: [
          {
            fd: 5,
            target: "anon_inode:[timerfd]",
            fdinfo: "pos:\t0\nflags:\t02000002\nclockid:\t1\nticks:\t2\n",
          },
        ],
        net: {},
      },
      (root, pid) => {
        const graph = captureMovePidDependencyGraph({ pid, procRoot: root });
        expect(graph.refusals).toMatchObject([
          { code: "timerfd-readable-expiration-untranslated" },
        ]);
      },
    );
  });
});
