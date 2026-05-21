import { describe, expect, it } from "vitest";

import { translateNativeResources } from "../native-resource-translation.ts";
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
});
