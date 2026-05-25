import { describe, expect, it } from "vitest";

import {
  planNativeTargetFdTable,
  translateNativeResources,
} from "../native-resource-translation.ts";
import type { NativeProcessResource } from "../native-process-image.ts";

const resources: NativeProcessResource[] = [
  { id: "argv", kind: "argv", state: "captured", recipe: { argv: ["ping", "example.com"] } },
  { id: "cwd", kind: "cwd", state: "captured", path: "/tmp", recipe: { cwd: "/tmp" } },
  { id: "fd:3", kind: "file", state: "captured", fd: 3, path: "/tmp/data.txt", offset: 9 },
  { id: "fd:4", kind: "socket", state: "captured", fd: 4, path: "socket:[1]" },
  { id: "fd:5", kind: "raw-socket", state: "captured", fd: 5, path: "icmp" },
];

describe("native resource translation", () => {
  it("creates recipes for regular files and refuses brokerless sockets", () => {
    const result = translateNativeResources({ resources });

    expect(result.resources.find((resource) => resource.id === "fd:3")).toMatchObject({
      state: "recipe",
      recipe: { reopen: "/tmp/data.txt", offset: 9 },
    });
    expect(result.resources.find((resource) => resource.id === "fd:4")).toMatchObject({
      state: "refused",
      refusal: { code: "kernel-state-unsupported" },
    });
    expect(result.resources.find((resource) => resource.id === "fd:5")).toMatchObject({
      state: "refused",
      refusal: { code: "resource-kind-unsupported" },
    });
  });

  it("plans the raw-icmp-v1 loopback echo descriptor subset", () => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:58:raw-icmp",
          kind: "raw-socket",
          state: "captured",
          fd: 58,
          path: "socket:[raw-icmp]",
          flags: ["octal:2"],
          recipe: {
            rawIcmpModel: "loopback-echo-v1",
            family: "inet4",
            socketType: "raw",
            protocol: "icmp",
            destination: "127.0.0.1",
            capability: "cap-net-raw",
            networkNamespace: "target-loopback",
            route: "loopback",
            identifier: 0x4d49,
            sequence: 1,
            inFlightPackets: "none",
            receiveQueue: "empty",
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries).toEqual([
      expect.objectContaining({ targetFd: 58, kind: "synthetic-raw-icmp" }),
    ]);
    expect(plan.targetGuestResources).toEqual([
      {
        kind: "synthetic-raw-icmp",
        fd: 58,
        identifier: 0x4d49,
        sequence: 1,
        closeOnExec: false,
      },
    ]);
  });

  it("plans the ping-socket-v1 loopback echo descriptor subset", () => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:59:ping-socket",
          kind: "socket",
          state: "captured",
          fd: 59,
          path: "socket:[ping-socket]",
          flags: ["octal:2"],
          recipe: {
            pingSocketModel: "loopback-echo-v1",
            family: "inet4",
            socketType: "dgram",
            protocol: "icmp",
            destination: "127.0.0.1",
            credentialPolicy: "target-ping-group-range",
            uid: 0,
            gid: 0,
            pingGroupRangeStart: 0,
            pingGroupRangeEnd: 2147483647,
            networkNamespace: "target-loopback",
            route: "loopback",
            identifier: 0x4d50,
            sequence: 2,
            inFlightPackets: "none",
            receiveQueue: "empty",
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries).toEqual([
      expect.objectContaining({ targetFd: 59, kind: "synthetic-ping-socket" }),
    ]);
    expect(plan.targetGuestResources).toEqual([
      {
        kind: "synthetic-ping-socket",
        fd: 59,
        identifier: 0x4d50,
        sequence: 2,
        uid: 0,
        gid: 0,
        pingGroupRangeStart: 0,
        pingGroupRangeEnd: 2147483647,
        closeOnExec: false,
      },
    ]);
  });

  it.each([
    ["gid outside target ping_group_range", { gid: 10, pingGroupRangeEnd: 0 }],
    ["wrong network namespace", { networkNamespace: "source-netns" }],
    ["stale route provenance", { route: "source-route-cache" }],
  ])("keeps unsafe ping-socket-v1 variants fail-closed: %s", (_name, override) => {
    const recipe = {
      pingSocketModel: "loopback-echo-v1",
      family: "inet4",
      socketType: "dgram",
      protocol: "icmp",
      destination: "127.0.0.1",
      credentialPolicy: "target-ping-group-range",
      uid: 0,
      gid: 0,
      pingGroupRangeStart: 0,
      pingGroupRangeEnd: 2147483647,
      networkNamespace: "target-loopback",
      route: "loopback",
      identifier: 0x4d50,
      sequence: 2,
      inFlightPackets: "none",
      receiveQueue: "empty",
      ...override,
    };
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:59:ping-socket",
          kind: "socket",
          state: "captured",
          fd: 59,
          path: "socket:[ping-socket]",
          flags: ["octal:2"],
          recipe,
        },
      ],
    });

    expect(plan.refusals).toEqual([
      expect.objectContaining({ code: "target-socket-syscall-state-unsupported" }),
    ]);
    expect(plan.targetGuestResources).toEqual([]);
  });

  it("keeps unsafe raw-icmp-v1 variants fail-closed", () => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:58:raw-icmp",
          kind: "raw-socket",
          state: "captured",
          fd: 58,
          path: "socket:[raw-icmp]",
          flags: ["octal:2"],
          recipe: {
            rawIcmpModel: "loopback-echo-v1",
            family: "inet4",
            socketType: "raw",
            protocol: "icmp",
            destination: "192.0.2.1",
            capability: "cap-net-raw",
            networkNamespace: "target-loopback",
            route: "loopback",
            identifier: 0x4d49,
            sequence: 1,
            inFlightPackets: "none",
            receiveQueue: "empty",
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([
      expect.objectContaining({ code: "target-socket-syscall-state-unsupported" }),
    ]);
    expect(plan.targetGuestResources).toEqual([]);
  });

  it("uses host capabilities for raw sockets and PTYs", () => {
    const result = translateNativeResources({
      hostCapabilities: ["raw-socket", "pty"],
      resources: [
        { id: "fd:raw", kind: "raw-socket", state: "captured", fd: 7, path: "icmp" },
        { id: "fd:pty", kind: "pty", state: "captured", fd: 8, path: "/dev/pts/3" },
      ],
    });

    expect(result.refusals).toEqual([]);
    expect(result.resources.map((resource) => resource.recipe)).toEqual([
      { broker: "raw-socket", fd: 7, path: "icmp" },
      { broker: "pty", fd: 8, path: "/dev/pts/3" },
    ]);
  });

  it("applies explicit inherited stdio policy without treating kernel buffers as migrated", () => {
    const withoutPolicy = translateNativeResources({
      inheritedStdio: { mode: "require-explicit" },
      resources: [
        { id: "fd:1", kind: "pipe", state: "captured", fd: 1, path: "pipe:[stdout]" },
        { id: "fd:2", kind: "socket", state: "captured", fd: 2, path: "socket:[stderr]" },
      ],
    });
    expect(withoutPolicy.refusals.map((refusal) => refusal.code)).toEqual([
      "inherited-stdio-policy-required",
      "inherited-stdio-policy-required",
    ]);

    const withPolicy = translateNativeResources({
      inheritedStdio: { mode: "inherit-output" },
      resources: [
        { id: "fd:0", kind: "pipe", state: "captured", fd: 0, path: "pipe:[stdin]" },
        { id: "fd:1", kind: "pipe", state: "captured", fd: 1, path: "pipe:[stdout]" },
        { id: "fd:2", kind: "socket", state: "captured", fd: 2, path: "socket:[stderr]" },
        { id: "fd:3", kind: "pipe", state: "captured", fd: 3, path: "pipe:[nonstdio]" },
        { id: "fd:4", kind: "file", state: "captured", fd: 4, path: "/tmp/data.txt", offset: 5 },
      ],
    });

    expect(withPolicy.resources.find((resource) => resource.id === "fd:1")?.recipe).toEqual({
      inherit: "stdout",
      fd: 1,
    });
    expect(withPolicy.resources.find((resource) => resource.id === "fd:2")?.recipe).toEqual({
      inherit: "stderr",
      fd: 2,
    });
    expect(withPolicy.resources.find((resource) => resource.id === "fd:4")?.recipe).toMatchObject({
      reopen: "/tmp/data.txt",
      offset: 5,
    });
    expect(withPolicy.refusals.map((refusal) => refusal.code)).toEqual([
      "stdin-buffer-state-unsupported",
      "non-stdio-kernel-state-unsupported",
    ]);
  });

  it("allows explicit synthetic empty-pipe resources for one-fd ppoll proofs", () => {
    const result = translateNativeResources({
      syntheticEmptyPipeFds: [10],
      resources: [
        {
          id: "fd:10",
          kind: "pipe",
          state: "captured",
          fd: 10,
          path: "pipe:[1]",
          flags: ["octal:0"],
        },
        {
          id: "fd:12",
          kind: "pipe",
          state: "captured",
          fd: 12,
          path: "pipe:[1]",
          flags: ["octal:1"],
        },
        { id: "fd:11", kind: "pipe", state: "captured", fd: 11, path: "pipe:[2]" },
      ],
    });

    expect(result.resources.find((resource) => resource.id === "fd:10")).toMatchObject({
      state: "recipe",
      recipe: { synthetic: "empty-pipe-read-end", fd: 10 },
    });
    expect(result.resources.find((resource) => resource.id === "fd:12")).toMatchObject({
      state: "recipe",
      recipe: { synthetic: "empty-pipe-write-end", fd: 12, pairedReadFd: 10 },
    });
    expect(result.refusals).toEqual([
      expect.objectContaining({ code: "kernel-state-unsupported" }),
    ]);
  });

  it("plans an accepted pipe-pair-v1 descriptor pair", () => {
    const plan = planNativeTargetFdTable({
      resources: [pipePairResource(10, "read"), pipePairResource(12, "write")],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries.map((entry) => [entry.targetFd, entry.kind])).toEqual([
      [10, "synthetic-empty-pipe-read-end"],
      [12, "synthetic-empty-pipe-write-end"],
    ]);
    expect(plan.targetGuestResources).toEqual([
      { kind: "synthetic-empty-pipe", readFd: 10, writeFd: 12, closeOnExec: false },
    ]);
  });

  it.each([
    {
      name: "unknown buffer",
      resources: [
        pipePairResource(10, "read", { pipeBuffer: "unknown" }),
        pipePairResource(12, "write"),
      ],
      reason: "pipe buffer must be known empty",
    },
    {
      name: "missing write peer",
      resources: [pipePairResource(10, "read")],
      reason: "pipe pair requires exactly one read end and one write end",
    },
    {
      name: "closed peer lifetime",
      resources: [
        pipePairResource(10, "read", { peerLifetime: "closed" }),
        pipePairResource(12, "write"),
      ],
      reason: "pipe peer lifetime must be known open",
    },
    {
      name: "waiters",
      resources: [
        pipePairResource(10, "read", { pipeWaiters: "unknown" }),
        pipePairResource(12, "write"),
      ],
      reason: "pipe waiters must be known empty",
    },
    {
      name: "readable state",
      resources: [
        pipePairResource(10, "read", { readiness: "readable" }),
        pipePairResource(12, "write"),
      ],
      reason: "pipe readiness must be known not-readable",
    },
    {
      name: "unsupported flags",
      resources: [pipePairResource(10, "read", {}, ["octal:4000"]), pipePairResource(12, "write")],
      reason: "pipe fd flags are unsupported",
    },
  ])("keeps unsafe pipe pair variants fail-closed: $name", ({ resources, reason }) => {
    const plan = planNativeTargetFdTable({ resources });

    expect(plan.refusals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "kernel-state-unsupported",
          detail: expect.objectContaining({ boundary: "pipe-pair-v1", reason }),
        }),
      ]),
    );
    expect(plan.targetGuestResources).toEqual([]);
  });

  it("allows explicit synthetic empty-eventfd resources for one-fd ppoll proofs", () => {
    const result = translateNativeResources({
      syntheticEmptyEventFds: [11],
      resources: [
        {
          id: "fd:11",
          kind: "eventfd",
          state: "captured",
          fd: 11,
          path: "anon_inode:[eventfd]",
          flags: ["octal:2000002"],
          recipe: { eventfdCount: "0x0", eventfdSemaphore: 0 },
        },
      ],
    });

    expect(result.refusals).toEqual([]);
    expect(result.resources[0]).toMatchObject({
      state: "recipe",
      recipe: {
        synthetic: "empty-eventfd",
        fd: 11,
        eventfdCount: "0x0",
        eventfdSemaphore: 0,
      },
    });
  });

  it("plans an accepted eventfd-counter-v1 descriptor", () => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:11",
          kind: "eventfd",
          state: "captured",
          fd: 11,
          path: "anon_inode:[eventfd]",
          flags: ["octal:2"],
          recipe: {
            eventfdModel: "counter-v1",
            eventfdCount: "0x2a",
            eventfdSemaphore: 0,
            eventfdWaiters: "none",
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries).toEqual([
      expect.objectContaining({ targetFd: 11, kind: "synthetic-eventfd", action: "materialize" }),
    ]);
    expect(plan.targetGuestResources).toEqual([
      { kind: "synthetic-eventfd", fd: 11, initialValue: "0x2a", closeOnExec: false },
    ]);
  });

  it.each([
    {
      name: "semaphore mode",
      recipe: {
        eventfdModel: "counter-v1",
        eventfdCount: "0x2a",
        eventfdSemaphore: 1,
        eventfdWaiters: "none",
      },
      reason: "eventfd semaphore mode is unsupported",
    },
    {
      name: "unknown waiters",
      recipe: { eventfdModel: "counter-v1", eventfdCount: "0x2a", eventfdSemaphore: 0 },
      reason: "eventfd waiters must be known empty",
    },
    {
      name: "zero counter",
      recipe: {
        eventfdModel: "counter-v1",
        eventfdCount: "0x0",
        eventfdSemaphore: 0,
        eventfdWaiters: "none",
      },
      reason: "eventfd counter is outside supported bounds",
    },
    {
      name: "overflow counter",
      recipe: {
        eventfdModel: "counter-v1",
        eventfdCount: "0xffffffffffffffff",
        eventfdSemaphore: 0,
        eventfdWaiters: "none",
      },
      reason: "eventfd counter is outside supported bounds",
    },
    {
      name: "unsupported flags",
      flags: ["octal:4002"],
      recipe: {
        eventfdModel: "counter-v1",
        eventfdCount: "0x2a",
        eventfdSemaphore: 0,
        eventfdWaiters: "none",
      },
      reason: "eventfd flags are unsupported",
    },
  ])("keeps unsafe eventfd counter variants fail-closed: $name", ({ flags, recipe, reason }) => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:11",
          kind: "eventfd",
          state: "captured",
          fd: 11,
          path: "anon_inode:[eventfd]",
          flags: flags ?? ["octal:2"],
          recipe,
        },
      ],
    });

    expect(plan.refusals).toEqual([
      expect.objectContaining({
        code: "kernel-state-unsupported",
        detail: expect.objectContaining({ boundary: "eventfd-counter-v1", reason }),
      }),
    ]);
    expect(plan.targetGuestResources).toEqual([]);
  });

  it("allows explicit synthetic timerfd resources for one-fd ppoll proofs", () => {
    const result = translateNativeResources({
      syntheticTimerFds: [12],
      resources: [
        {
          id: "fd:12",
          kind: "timer",
          state: "captured",
          fd: 12,
          path: "anon_inode:[timerfd]",
          flags: ["octal:2000002"],
          recipe: { timerfdTicks: "0x0", timerfdIntervalSeconds: 0, timerfdIntervalNanoseconds: 0 },
        },
      ],
    });

    expect(result.refusals).toEqual([]);
    expect(result.resources[0]).toMatchObject({
      state: "recipe",
      recipe: {
        synthetic: "timerfd",
        fd: 12,
        timerfdTicks: "0x0",
      },
    });
  });

  it("plans an accepted timerfd-descriptor-v1 descriptor", () => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:12",
          kind: "timer",
          state: "captured",
          fd: 12,
          path: "anon_inode:[timerfd]",
          flags: ["octal:2"],
          recipe: {
            timerfdModel: "descriptor-v1",
            timerfdClockId: 1,
            timerfdTicks: 0,
            timerfdSettimeFlags: 0,
            timerfdValueSeconds: 5,
            timerfdValueNanoseconds: 100,
            timerfdIntervalSeconds: 0,
            timerfdIntervalNanoseconds: 0,
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries).toEqual([
      expect.objectContaining({ targetFd: 12, kind: "synthetic-timerfd", action: "materialize" }),
    ]);
    expect(plan.targetGuestResources).toEqual([
      {
        kind: "synthetic-timerfd",
        fd: 12,
        clockId: 1,
        settimeFlags: 0,
        valueSeconds: 5,
        valueNanoseconds: 100,
        intervalSeconds: 0,
        intervalNanoseconds: 0,
        closeOnExec: false,
      },
    ]);
  });

  it.each([
    {
      name: "periodic interval",
      recipe: {
        timerfdModel: "descriptor-v1",
        timerfdClockId: 1,
        timerfdTicks: 0,
        timerfdSettimeFlags: 0,
        timerfdValueSeconds: 5,
        timerfdValueNanoseconds: 0,
        timerfdIntervalSeconds: 1,
        timerfdIntervalNanoseconds: 0,
      },
      reason: "timerfd periodic interval is unsupported",
    },
    {
      name: "expired ticks",
      recipe: {
        timerfdModel: "descriptor-v1",
        timerfdClockId: 1,
        timerfdTicks: 1,
        timerfdSettimeFlags: 0,
        timerfdValueSeconds: 0,
        timerfdValueNanoseconds: 0,
        timerfdIntervalSeconds: 0,
        timerfdIntervalNanoseconds: 0,
      },
      reason: "timerfd has unread expirations or overrun state",
    },
    {
      name: "absolute timer",
      recipe: {
        timerfdModel: "descriptor-v1",
        timerfdClockId: 1,
        timerfdTicks: 0,
        timerfdSettimeFlags: 1,
        timerfdValueSeconds: 5,
        timerfdValueNanoseconds: 0,
        timerfdIntervalSeconds: 0,
        timerfdIntervalNanoseconds: 0,
      },
      reason: "timerfd absolute/cancel-on-set semantics are unsupported",
    },
    {
      name: "ambiguous clock",
      recipe: {
        timerfdModel: "descriptor-v1",
        timerfdClockId: 0,
        timerfdTicks: 0,
        timerfdSettimeFlags: 0,
        timerfdValueSeconds: 5,
        timerfdValueNanoseconds: 0,
        timerfdIntervalSeconds: 0,
        timerfdIntervalNanoseconds: 0,
      },
      reason: "timerfd clock is unsupported",
    },
    {
      name: "unsupported flags",
      flags: ["octal:4002"],
      recipe: {
        timerfdModel: "descriptor-v1",
        timerfdClockId: 1,
        timerfdTicks: 0,
        timerfdSettimeFlags: 0,
        timerfdValueSeconds: 5,
        timerfdValueNanoseconds: 0,
        timerfdIntervalSeconds: 0,
        timerfdIntervalNanoseconds: 0,
      },
      reason: "timerfd flags are unsupported",
    },
  ])("keeps unsafe timerfd descriptor variants fail-closed: $name", ({ flags, recipe, reason }) => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:12",
          kind: "timer",
          state: "captured",
          fd: 12,
          path: "anon_inode:[timerfd]",
          flags: flags ?? ["octal:2"],
          recipe,
        },
      ],
    });

    expect(plan.refusals).toEqual([
      expect.objectContaining({
        code: "kernel-state-unsupported",
        detail: expect.objectContaining({ boundary: "timerfd-descriptor-v1", reason }),
      }),
    ]);
    expect(plan.targetGuestResources).toEqual([]);
  });

  it("plans an accepted epoll interest list when every watched fd has a target recipe", () => {
    const plan = planNativeTargetFdTable({
      syntheticEmptyEventFds: [10],
      resources: [
        {
          id: "fd:10",
          kind: "eventfd",
          state: "captured",
          fd: 10,
          path: "anon_inode:[eventfd]",
          flags: ["octal:2"],
        },
        {
          id: "fd:12",
          kind: "epoll",
          state: "captured",
          fd: 12,
          path: "anon_inode:[eventpoll]",
          flags: ["octal:2"],
          recipe: {
            epollModel: "interest-list-v1",
            watches: [{ fd: 10, events: 1, data: "0x45504f4c4c" }],
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries.map((entry) => [entry.targetFd, entry.kind])).toEqual([
      [10, "synthetic-empty-eventfd"],
      [12, "synthetic-epoll"],
    ]);
    expect(plan.targetGuestResources).toEqual([
      { kind: "synthetic-empty-eventfd", fd: 10, closeOnExec: false },
      {
        kind: "synthetic-epoll",
        fd: 12,
        watches: [{ fd: 10, events: 1, data: "0x45504f4c4c" }],
        closeOnExec: false,
      },
    ]);
  });

  it("plans an accepted signalfd descriptor when queues and signal frames are empty", () => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:13",
          kind: "signalfd",
          state: "captured",
          fd: 13,
          path: "anon_inode:[signalfd]",
          flags: ["octal:4000"],
          recipe: {
            signalfdModel: "empty-queue-v1",
            signalMask: "0x0000000000000200",
            flags: 2048,
            pendingSignals: "none",
            queuedSiginfo: "empty",
            activeSignalFrame: false,
            altStackState: "disabled",
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries).toEqual([
      expect.objectContaining({
        targetFd: 13,
        kind: "synthetic-signalfd",
        action: "materialize",
      }),
    ]);
    expect(plan.targetGuestResources).toEqual([
      {
        kind: "synthetic-signalfd",
        fd: 13,
        signalMask: "0x200",
        flags: 2048,
        closeOnExec: false,
      },
    ]);
  });

  it.each([
    {
      name: "pending signal queue",
      recipe: { pendingSignals: "process" },
      reason: "pending signals and queued siginfo must be empty",
    },
    {
      name: "queued siginfo",
      recipe: { queuedSiginfo: "non-empty" },
      reason: "pending signals and queued siginfo must be empty",
    },
    {
      name: "active signal frame",
      recipe: { activeSignalFrame: true },
      reason: "active signal frames remain unsupported",
    },
    {
      name: "active alt stack",
      recipe: { altStackState: "enabled" },
      reason: "active signal alt-stack state remains unsupported",
    },
    {
      name: "malformed mask",
      recipe: { signalMask: "200" },
      reason: "signalfd recipe requires a finite mask and flags",
    },
    {
      name: "unsupported flags",
      recipe: { flags: 1 },
      reason: "signalfd flags are unsupported",
    },
  ])("keeps unsafe signalfd descriptor variants fail-closed: $name", ({ recipe, reason }) => {
    const plan = planNativeTargetFdTable({
      resources: [
        {
          id: "fd:13",
          kind: "signalfd",
          state: "captured",
          fd: 13,
          path: "anon_inode:[signalfd]",
          recipe: {
            signalfdModel: "empty-queue-v1",
            signalMask: "0x200",
            flags: 0,
            pendingSignals: "none",
            queuedSiginfo: "empty",
            activeSignalFrame: false,
            altStackState: "disabled",
            ...recipe,
          },
        },
      ],
    });

    expect(plan.refusals).toEqual([
      expect.objectContaining({
        code: "target-signalfd-state-unsupported",
        detail: expect.objectContaining({ reason }),
      }),
    ]);
    expect(plan.targetGuestResources).not.toContainEqual(
      expect.objectContaining({ kind: "synthetic-signalfd", fd: 13 }),
    );
  });

  it.each([
    {
      name: "missing watched fd recipe",
      watch: { fd: 20, events: 1, data: "0x1" },
      reason: "epoll watched fd has no accepted target recipe",
    },
    {
      name: "edge-triggered watch",
      watch: { fd: 10, events: 0x80000001, data: "0x1" },
      reason: "epoll edge-triggered or one-shot delivery state is unsupported",
    },
    {
      name: "nested epoll",
      watch: { fd: 13, events: 1, data: "0x1" },
      extra: {
        id: "fd:13",
        kind: "epoll" as const,
        state: "captured" as const,
        fd: 13,
        recipe: {
          epollModel: "interest-list-v1",
          watches: [{ fd: 10, events: 1, data: "0x13" }],
        },
      },
      reason: "nested epoll and self-watch state remain unsupported",
    },
  ])("keeps unsafe epoll interest-list variants fail-closed: $name", ({ watch, extra, reason }) => {
    const resourcesWithUnsafe = [
      {
        id: "fd:10",
        kind: "eventfd" as const,
        state: "captured" as const,
        fd: 10,
        path: "anon_inode:[eventfd]",
        flags: ["octal:2"],
      },
      ...(extra ? [extra] : []),
      {
        id: "fd:12",
        kind: "epoll" as const,
        state: "captured" as const,
        fd: 12,
        path: "anon_inode:[eventpoll]",
        flags: ["octal:2"],
        recipe: { epollModel: "interest-list-v1", watches: [watch] },
      },
    ];
    const plan = planNativeTargetFdTable({
      syntheticEmptyEventFds: [10],
      resources: resourcesWithUnsafe,
    });

    expect(plan.refusals).toEqual([
      expect.objectContaining({
        code: "target-epoll-syscall-state-unsupported",
        detail: expect.objectContaining({ reason }),
      }),
    ]);
    expect(plan.targetGuestResources).not.toContainEqual(
      expect.objectContaining({ kind: "synthetic-epoll", fd: 12 }),
    );
  });

  it("uses exact refusal codes for generic and stateful kernel fd resources", () => {
    const result = translateNativeResources({
      resources: [
        { id: "fd:9", kind: "fd", state: "captured", fd: 9 },
        { id: "fd:10", kind: "pipe", state: "captured", fd: 10, path: "pipe:[1]" },
        { id: "fd:11", kind: "eventfd", state: "captured", fd: 11, path: "anon_inode:[eventfd]" },
        { id: "fd:12", kind: "timer", state: "captured", fd: 12, path: "anon_inode:[timerfd]" },
        { id: "fd:13", kind: "epoll", state: "captured", fd: 13, path: "anon_inode:[eventpoll]" },
      ],
    });

    expect(result.refusals.map((refusal) => refusal.code)).toEqual([
      "fd-kind-unsupported",
      "kernel-state-unsupported",
      "kernel-state-unsupported",
      "kernel-state-unsupported",
      "kernel-state-unsupported",
    ]);
  });

  it("records required models for sockets, epoll, and signalfd before target execution", () => {
    const result = translateNativeResources({
      resources: [
        {
          id: "fd:listen",
          kind: "socket",
          state: "captured",
          fd: 20,
          path: "socket:[listen]",
          recipe: { socketState: "listen", queuedConnections: 1 },
        },
        {
          id: "fd:socketpair",
          kind: "socket",
          state: "captured",
          fd: 23,
          path: "socket:[pair]",
          recipe: { socketState: "connected", peer: "socket:[other]" },
        },
        {
          id: "fd:epoll-nested",
          kind: "epoll",
          state: "captured",
          fd: 21,
          path: "anon_inode:[eventpoll]",
          recipe: { watchedFds: [20, 22], nested: true, edgeTriggered: true },
        },
        {
          id: "fd:signalfd",
          kind: "signalfd",
          state: "captured",
          fd: 22,
          path: "anon_inode:[signalfd]",
          recipe: { mask: "0x2", queuedSignals: [{ signo: 2 }] },
        },
      ],
    });

    expect(result.refusals).toEqual([
      expect.objectContaining({
        code: "kernel-state-unsupported",
        detail: expect.objectContaining({
          id: "fd:listen",
          requiredModel: expect.arrayContaining([
            "accept/connect/listen queue state",
            "credentials and namespaces",
          ]),
        }),
      }),
      expect.objectContaining({
        code: "kernel-state-unsupported",
        detail: expect.objectContaining({
          id: "fd:socketpair",
          requiredModel: expect.arrayContaining(["peer endpoint identity"]),
        }),
      }),
      expect.objectContaining({
        code: "kernel-state-unsupported",
        detail: expect.objectContaining({
          id: "fd:epoll-nested",
          requiredModel: expect.arrayContaining([
            "interest list",
            "nested epoll and wakeup ordering",
          ]),
        }),
      }),
      expect.objectContaining({
        code: "kernel-state-unsupported",
        detail: expect.objectContaining({
          id: "fd:signalfd",
          requiredModel: expect.arrayContaining([
            "pending signal queue",
            "siginfo payload provenance",
          ]),
        }),
      }),
    ]);
  });

  it("plans a deterministic target fd table and target guest resource recipes", () => {
    const plan = planNativeTargetFdTable({
      inheritedStdio: { mode: "inherit-output" },
      syntheticEmptyPipeFds: [3],
      syntheticEmptyEventFds: [6],
      expectedFds: [0, 1, 2, 3, 4, 5, 6],
      resources: [
        { id: "fd:6", kind: "eventfd", state: "captured", fd: 6, flags: ["octal:2000002"] },
        {
          id: "fd:4",
          kind: "pipe",
          state: "captured",
          fd: 4,
          path: "pipe:[1]",
          flags: ["octal:1"],
        },
        {
          id: "fd:3",
          kind: "pipe",
          state: "captured",
          fd: 3,
          path: "pipe:[1]",
          flags: ["octal:0"],
        },
        {
          id: "fd:5",
          kind: "file",
          state: "captured",
          fd: 5,
          path: "/tmp/data.txt",
          offset: 7,
          flags: ["octal:2000000"],
        },
        { id: "fd:1", kind: "pipe", state: "captured", fd: 1, path: "pipe:[stdout]" },
        { id: "fd:2", kind: "socket", state: "captured", fd: 2, path: "socket:[stderr]" },
      ],
    });

    expect(plan.refusals).toEqual([]);
    expect(plan.entries.map((entry) => [entry.targetFd, entry.kind, entry.action])).toEqual([
      [0, "close-fd", "close"],
      [1, "inherit-stdio", "materialize"],
      [2, "inherit-stdio", "materialize"],
      [3, "synthetic-empty-pipe-read-end", "materialize"],
      [4, "synthetic-empty-pipe-write-end", "materialize"],
      [5, "reopen-file", "materialize"],
      [6, "synthetic-empty-eventfd", "materialize"],
    ]);
    expect(plan.entries.find((entry) => entry.targetFd === 5)).toMatchObject({
      closeOnExec: true,
      targetGuestRecipe: {
        kind: "reopen-file",
        fd: 5,
        path: "/tmp/data.txt",
        offset: 7,
        access: 0,
        closeOnExec: true,
      },
    });
    expect(plan.targetGuestResources).toEqual([
      { kind: "close-fd", fd: 0, reason: "missing-captured-fd" },
      { kind: "inherit-stdio", fd: 1, stream: "stdout", closeOnExec: false },
      { kind: "inherit-stdio", fd: 2, stream: "stderr", closeOnExec: false },
      { kind: "synthetic-empty-pipe", readFd: 3, closeOnExec: false, writeFd: 4 },
      {
        kind: "reopen-file",
        fd: 5,
        path: "/tmp/data.txt",
        offset: 7,
        access: 0,
        closeOnExec: true,
      },
      { kind: "synthetic-empty-eventfd", fd: 6, closeOnExec: true },
    ]);
  });

  it("refuses duplicate fds and unsupported descriptors before target execution", () => {
    const plan = planNativeTargetFdTable({
      resources: [
        { id: "fd:3a", kind: "file", state: "captured", fd: 3, path: "/tmp/a" },
        { id: "fd:3b", kind: "file", state: "captured", fd: 3, path: "/tmp/b" },
        { id: "fd:4", kind: "socket", state: "captured", fd: 4, path: "socket:[4]" },
      ],
    });

    expect(plan.refusals.map((refusal) => refusal.code)).toEqual([
      "target-fd-table-duplicate",
      "kernel-state-unsupported",
    ]);
    expect(plan.entries).toEqual([
      expect.objectContaining({ targetFd: 4, kind: "refused", action: "refuse" }),
    ]);
    expect(plan.targetGuestResources).toEqual([]);
  });
});

function pipePairResource(
  fd: number,
  end: "read" | "write",
  recipe: Record<string, unknown> = {},
  flags = [end === "read" ? "octal:0" : "octal:1"],
): NativeProcessResource {
  return {
    id: `fd:${fd}`,
    kind: "pipe",
    state: "captured",
    fd,
    path: "pipe:[pair]",
    flags,
    recipe: {
      pipeModel: "empty-pair-v1",
      pipeBuffer: "empty",
      peerLifetime: "open",
      pipeWaiters: "none",
      readiness: "not-readable",
      ...recipe,
    },
  };
}
