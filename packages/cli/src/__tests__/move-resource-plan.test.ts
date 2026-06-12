import { describe, expect, it } from "vitest";

import { buildMoveResourcePlan, parseGuestMoveResourceScan } from "../move-resource-plan.ts";

const pingNode = {
  pid: 71,
  ppid: 70,
  command: "ping",
  argv: ["ping", "127.0.0.1"],
  cwd: "/root",
};

describe("move resource plan", () => {
  it("captures ping socket procfs evidence before refusing missing sequence state", () => {
    const scan = parseGuestMoveResourceScan(
      [
        "AGENT\tmachinen-move-capture-v1",
        "STATUS\t1000\t1000",
        "PING_RANGE\t0\t2147483647",
        "FD\t59\tsocket:[12345]",
        "FDINFO\t59\tflags:\t02",
        "NET_ICMP\t0: 0100007F:4D50 0100007F:0000 07 00000000:00000000 00:00000000 00000000 1000 0 12345",
      ].join("\n"),
    );

    const plan = buildMoveResourcePlan(pingNode, scan);

    expect(plan.resources).toContainEqual(
      expect.objectContaining({
        kind: "socket",
        recipe: expect.objectContaining({
          pingSocketModel: "loopback-echo-v1",
          destination: "127.0.0.1",
          identifier: 0x4d50,
          uid: 1000,
          gid: 1000,
        }),
      }),
    );
    expect(plan.refusals).toContainEqual(
      expect.objectContaining({ code: "target-socket-syscall-state-unsupported" }),
    );
    expect(plan.acceptedSubsets).toEqual([]);
  });

  it("maps known anon-inode fds to distinct resource kinds", () => {
    const scan = parseGuestMoveResourceScan(
      [
        "STATUS\t1000\t1000",
        "FD\t3\tanon_inode:[eventfd]",
        "FDINFO\t3\tflags:\t02",
        "FD\t4\tanon_inode:[eventpoll]",
        "FDINFO\t4\tflags:\t02",
        "FD\t5\tanon_inode:[timerfd]",
        "FDINFO\t5\tflags:\t02",
        "FD\t6\tanon_inode:[signalfd]",
        "FDINFO\t6\tflags:\t02",
        "FD\t7\tanon_inode:[fanotify]",
      ].join("\n"),
    );

    const plan = buildMoveResourcePlan(pingNode, scan);

    expect(plan.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ fd: 3, kind: "eventfd" }),
        expect.objectContaining({ fd: 4, kind: "epoll" }),
        expect.objectContaining({ fd: 5, kind: "timer" }),
        expect.objectContaining({ fd: 6, kind: "signalfd" }),
        expect.objectContaining({ fd: 7, kind: "unknown", path: "anon_inode:[fanotify]" }),
      ]),
    );
  });

  it("captures external ping sockets but refuses until sequence state is translated", () => {
    const scan = parseGuestMoveResourceScan(
      [
        "STATUS\t0\t0",
        "PING_RANGE\t0\t2147483647",
        "FD\t3\tsocket:[99]",
        "FDINFO\t3\tflags:\t02",
        "NET_ICMP\t0: 0A00020F:4D50 08080808:0000 07 00000000:00000000 00:00000000 00000000 0 0 99",
      ].join("\n"),
    );

    const plan = buildMoveResourcePlan({ ...pingNode, argv: ["ping", "google.com"] }, scan);

    expect(plan.resources).toContainEqual(
      expect.objectContaining({
        kind: "socket",
        recipe: expect.objectContaining({
          pingSocketModel: "external-target-egress-v1",
          destination: "8.8.8.8",
          networkNamespace: "target-network",
          route: "target-egress",
        }),
      }),
    );
    expect(plan.refusals).toContainEqual(
      expect.objectContaining({
        code: "non-stdio-kernel-state-unsupported",
        detail: expect.objectContaining({ kind: "socket", fd: 3 }),
      }),
    );
  });
});
