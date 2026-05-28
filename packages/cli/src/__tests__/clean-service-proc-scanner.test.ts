import { describe, expect, it } from "vitest";

import {
  firstRefusal,
  inspectElfStatic,
  inspectFd,
  inspectMemoryMaps,
  inspectMountState,
  inspectProcessTopology,
  inspectTcpRows,
  inspectUnixSockets,
  parseMaps,
  parseMountInfo,
  parseProcessStat,
  parseTcpTable,
  parseUnixSocketTable,
  summarizeKernelDecisions,
} from "../clean-service/proc-scanner.ts";

describe("clean-service /proc scanner fd decisions", () => {
  it("supports app-root fds and refuses outside-root fds", () => {
    expect(inspectFd({ fd: 4, link: "/opt/app/config.json", appRoot: "/opt/app" })).toMatchObject({
      kind: "supported",
      code: "clean-service-app-root-fd-captured",
    });
    expect(
      inspectFd({
        fd: 5,
        link: "/etc/machinen/config.json",
        appRoot: "/opt/app",
        declaredImmutableInputs: ["/etc/machinen"],
      }),
    ).toMatchObject({
      kind: "supported",
      code: "clean-service-immutable-input-fd-captured",
    });
    expect(inspectFd({ fd: 6, link: "/var/lib/app/state.db", appRoot: "/opt/app" })).toMatchObject({
      kind: "refused",
      code: "clean-service-open-fd-unsupported",
    });
  });

  it("refuses deleted files and unmodeled fd objects", () => {
    expect(inspectFd({ fd: 7, link: "/tmp/cache (deleted)", appRoot: "/opt/app" })).toMatchObject({
      kind: "refused",
      code: "clean-service-deleted-open-file-unsupported",
    });
    expect(inspectFd({ fd: 8, link: "pipe:[123]", appRoot: "/opt/app" })).toMatchObject({
      kind: "refused",
      code: "clean-service-open-fd-unsupported",
    });
    expect(inspectFd({ fd: 9, link: "anon_inode:[timerfd]", appRoot: "/opt/app" })).toMatchObject({
      kind: "refused",
      code: "clean-service-timerfd-state-unsupported",
    });
  });

  it("treats stdio and runtime epoll/eventfd as irrelevant or recreated state", () => {
    expect(inspectFd({ fd: 1, link: "pipe:[1]", appRoot: "/opt/app" })).toMatchObject({
      kind: "irrelevant",
      code: "clean-service-stdio-fd-irrelevant",
    });
    expect(
      inspectFd({ fd: 10, link: "anon_inode:[eventpoll]", appRoot: "/opt/app" }),
    ).toMatchObject({
      kind: "supported",
      code: "clean-service-epoll-recreated-by-runtime-start",
    });
  });
});

describe("clean-service /proc scanner sockets", () => {
  it("supports expected listeners and refuses active or unexpected TCP", () => {
    const rows = parseTcpTable(
      `  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n   0: 0100007F:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000 0 0 10\n   1: 0100007F:0FA0 0100007F:C001 01 00000000:00000000 00:00000000 00000000 0 0 11\n`,
    );
    const decisions = inspectTcpRows(rows, new Set(["10", "11"]), new Set([3000]));
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "supported", code: "clean-service-listener-rebound" }),
        expect.objectContaining({
          kind: "refused",
          code: "clean-service-active-session-unsupported",
        }),
      ]),
    );
  });

  it("refuses unmodeled Unix sockets", () => {
    const rows = parseUnixSocketTable(
      `Num       RefCount Protocol Flags    Type St Inode Path\n00000000: 00000002 00000000 00010000 0001 01 42 /tmp/app.sock\n`,
    );
    expect(inspectUnixSockets(rows, new Set(["42"]))).toEqual([
      expect.objectContaining({ kind: "refused", code: "clean-service-unix-socket-unsupported" }),
    ]);
  });
});

describe("clean-service /proc scanner maps, mounts, topology, and ELF", () => {
  it("supports runtime libraries while refusing durable mmap and app native extensions", () => {
    const decisions = inspectMemoryMaps(
      parseMaps(
        `7f00-7f10 r--p 00000000 00:00 0 /usr/lib/libpython3.11.so\n7f10-7f20 rw-s 00000000 00:00 0 /var/lib/app/pg_wal/0001\n7f20-7f30 r-xp 00000000 00:00 0 /opt/app/addon.node\n`,
      ),
      "/opt/app",
    );
    expect(decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "supported",
          code: "clean-service-runtime-library-from-target-policy",
        }),
        expect.objectContaining({
          kind: "refused",
          code: "clean-service-shared-memory-unsupported",
        }),
        expect.objectContaining({
          kind: "refused",
          code: "clean-service-mmapped-durable-state-unsupported",
        }),
        expect.objectContaining({
          kind: "refused",
          code: "clean-service-native-extension-state-unsupported",
        }),
      ]),
    );
  });

  it("classifies process topology and mount state", () => {
    const primary = parseProcessStat("100 (node) S 1 100 100 0 -1 0")!;
    const child = parseProcessStat("101 (worker) S 100 100 100 0 -1 0")!;
    const sharedProcessGroup = parseProcessStat("102 (helper) S 1 100 100 0 -1 0")!;
    expect(firstRefusal(inspectProcessTopology(primary, [primary, child]))).toMatchObject({
      code: "clean-service-process-topology-unsupported",
    });
    expect(
      firstRefusal(inspectProcessTopology(primary, [primary, sharedProcessGroup])),
    ).toMatchObject({
      code: "clean-service-process-topology-unsupported",
    });

    const mounts = parseMountInfo(
      "1 0 8:1 / / rw,relatime - ext4 /dev/vda rw\n2 1 9:1 / /mnt rw,relatime - virtiofs host rw\n",
    );
    expect(inspectMountState("/mnt/app", mounts)[0]).toMatchObject({
      kind: "refused",
      code: "clean-service-mount-state-ambiguous",
    });
  });

  it("detects static ELF absence of program interpreter", () => {
    const elf = Buffer.alloc(64);
    elf.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0);
    elf.writeUInt16LE(2, 16);
    elf.writeUInt16LE(0x3e, 18);
    elf.writeBigUInt64LE(64n, 32);
    elf.writeUInt16LE(56, 54);
    elf.writeUInt16LE(0, 56);
    expect(inspectElfStatic(elf)).toMatchObject({
      validElf: true,
      hasProgramInterpreter: false,
      elfType: 2,
    });
  });

  it("summarizes supported, irrelevant, and refused outcomes", () => {
    expect(
      summarizeKernelDecisions([
        { kind: "supported", code: "a", message: "a" },
        { kind: "irrelevant", code: "b", message: "b" },
        { kind: "refused", code: "c", message: "c" },
      ]),
    ).toEqual({ supported: 1, irrelevant: 1, refused: 1 });
  });
});
