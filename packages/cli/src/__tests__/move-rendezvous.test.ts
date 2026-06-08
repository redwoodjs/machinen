import type { MoveDescriptor, VmHandle } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import { runMoveTargetDirectLoaderInVm } from "../move-rendezvous.ts";

const descriptor: MoveDescriptor = {
  formatVersion: 1,
  kind: "machinen.move.descriptor",
  rootPid: 71,
  scannedAt: "2026-06-08T00:00:00.000Z",
  nodes: [
    {
      pid: 71,
      ppid: 1,
      command: "ping",
      argv: ["ping", "google.com"],
      cwd: "/",
      exe: "/usr/bin/ping",
    },
  ],
  edges: [],
  translatedStateClasses: ["process-identity", "argv-env-cwd"],
  refusedStateClasses: [],
  target: "cross-isa-target-native-pid-translation",
  productSurface: "machinen move",
  resourcePlan: {
    kind: "machinen.move.resource-plan",
    source: "guest-procfs",
    resources: [],
    fdTableEntries: [],
    targetGuestResources: [],
    refusals: [],
    acceptedSubsets: [],
    capture: { pingState: { ntransmitted: 4, nreceived: 4, nerrors: 0, lastSequence: 4 } },
  },
};

const sleepDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 72,
  nodes: [
    {
      pid: 72,
      ppid: 1,
      command: "sleep",
      argv: ["sleep", "30"],
      cwd: "/",
      exe: "/bin/sleep",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: { sleepState: { originalMs: 30_000, elapsedMs: 7_100, remainingMs: 22_900 } },
  },
};

const tailDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 73,
  nodes: [
    {
      pid: 73,
      ppid: 1,
      command: "tail",
      argv: ["tail", "-f", "/tmp/source.log"],
      cwd: "/",
      exe: "/usr/bin/tail",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: {
      tailState: {
        path: "/tmp/source.log",
        offset: 128,
        followMode: "poll-or-inotify",
      },
    },
  },
};

const lessDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 74,
  nodes: [
    {
      pid: 74,
      ppid: 1,
      command: "less",
      argv: ["less", "+42", "/tmp/page.txt"],
      cwd: "/",
      exe: "/usr/bin/less",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: { lessState: { path: "/tmp/page.txt", line: 42, terminal: "script-pty" } },
  },
};

const viDescriptor: MoveDescriptor = {
  ...descriptor,
  rootPid: 75,
  nodes: [
    {
      pid: 75,
      ppid: 1,
      command: "vi",
      argv: ["vi", "+9", "/tmp/edit.txt"],
      cwd: "/",
      exe: "/usr/bin/vi",
    },
  ],
  resourcePlan: {
    ...descriptor.resourcePlan!,
    capture: {
      viState: { path: "/tmp/edit.txt", line: 9, mode: "normal-read-only", terminal: "script-pty" },
    },
  },
};

const dirtyViDescriptor: MoveDescriptor = {
  ...viDescriptor,
  resourcePlan: {
    ...viDescriptor.resourcePlan!,
    capture: {
      viState: {
        path: "/tmp/edit.txt",
        line: 9,
        mode: "normal-dirty-buffer",
        terminal: "script-pty",
        dirtyText: "moved text",
        searchPattern: "needle",
      },
    },
  },
};

describe("move target direct loader", () => {
  it("launches original target sleep with only the remaining duration", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t654",
        "LOAD_LOG\t/tmp/machinen-move-loader.log",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-sleep-started",
        "PATCH\tsleep-remaining\tready\t23",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, sleepDescriptor);

    expect(commands[0]).toContain("'/bin/sleep' '23'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-sleep-remaining-loader",
      executable: "/bin/sleep",
      argv: ["/bin/sleep", "23"],
      targetPid: 654,
      refusals: [],
    });
  });

  it("launches original target tail from the captured file offset", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t777",
        "LOAD_LOG\t/tmp/machinen-move-loader.log",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-tail-follow-started",
        "PATCH\ttail-offset\tready\t/tmp/source.log\t128",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, tailDescriptor);

    expect(commands[0]).toContain("'/usr/bin/tail' -c '+129' -f -- '/tmp/source.log'");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-tail-offset-loader",
      executable: "/usr/bin/tail",
      argv: ["/usr/bin/tail", "-c", "+129", "-f", "/tmp/source.log"],
      targetPid: 777,
      refusals: [],
    });
  });

  it("launches original target less under a script PTY at the captured line", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t778",
        "LOAD_LOG\t/tmp/machinen-move-loader.typescript",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-less-script-pty-started",
        "PATCH\tless-script-pty\tready\t/tmp/page.txt\t42\t779",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, lessDescriptor);

    expect(commands[0]).toContain("/usr/bin/less");
    expect(commands[0]).toContain("+42 --");
    expect(commands[0]).toContain("/tmp/page.txt");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-less-script-pty-loader",
      executable: "/usr/bin/less",
      argv: ["/usr/bin/less", "+42", "/tmp/page.txt"],
      targetPid: 778,
      refusals: [],
    });
  });

  it("launches original target vi under a script PTY at the captured line", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t780",
        "LOAD_LOG\t/tmp/machinen-move-loader.typescript",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-vi-script-pty-started",
        "PATCH\tvi-script-pty\tready\t/tmp/edit.txt\t9\t781",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, viDescriptor);

    expect(commands[0]).toContain("/usr/bin/vi");
    expect(commands[0]).toContain("+9 --");
    expect(commands[0]).toContain("/tmp/edit.txt");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-vi-readonly-script-pty-loader",
      executable: "/usr/bin/vi",
      argv: ["/usr/bin/vi", "+9", "/tmp/edit.txt"],
      targetPid: 780,
      refusals: [],
    });
  });

  it("launches original target vi with captured dirty text and search state", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t782",
        "LOAD_LOG\t/tmp/machinen-move-loader.typescript",
        "SAFE_BOUNDARY\tsleep-timer\ttarget-vi-script-pty-started",
        "PATCH\tvi-script-pty\tready\t/tmp/edit.txt\t9\t783",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, dirtyViDescriptor);

    expect(commands[0]).toContain("+/needle");
    expect(commands[0]).toContain("+normal! Go");
    expect(commands[0]).toContain("moved text");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-vi-readonly-script-pty-loader",
      executable: "/usr/bin/vi",
      targetPid: 782,
      refusals: [],
    });
  });

  it("launches original target ping and accepts a frozen pre-send capture", async () => {
    const commands: string[] = [];
    const vm = mockVm(
      commands,
      [
        "LOAD_PID\t321",
        "LOAD_LOG\t/tmp/machinen-move-loader.log",
        "UNAME\tx86_64",
        "SAFE_BOUNDARY\tpre-send-icmp\tsendto",
        "FREEZE\tptrace-attached\tstatus:4991",
        "REG_AMD64\t0x1\t0x2\t0x3\t0x4\t0x5\t0x6\t0x7\t0x8\t0x9\t0xa\t0xb\t0xc\t0xd\t0xe\t0xf\t0x10\t0x11\t0x12\t0x13\t0x14",
        "PATCH\tping-rts\t0x1000\t4\t4\t0",
        "PATCH\tping-send-buffer\tready\t0x2000\t64\t5",
      ].join("\n"),
    );

    const loader = await runMoveTargetDirectLoaderInVm(vm, descriptor);

    expect(commands[0]).toContain("--load-ping-state 4 4 0");
    expect(commands[0]).toContain("/usr/bin/ping");
    expect(commands[0]).toContain("google.com");
    expect(loader).toMatchObject({
      state: "ready",
      strategy: "target-original-ping-direct-loader",
      targetPid: 321,
      refusals: [],
    });
  });

  it("refuses when target ping does not reach the direct-loader boundary", async () => {
    const vm = mockVm([], "LOAD_PID\t321\nSAFE_BOUNDARY\trefused\ttimeout\n");

    const loader = await runMoveTargetDirectLoaderInVm(vm, descriptor);

    expect(loader.refusals).toContainEqual(expect.objectContaining({ code: "active-syscall" }));
  });
});

function mockVm(commands: string[], stdout: string): VmHandle {
  return {
    pid: 200,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    wait: undefined,
    kill: undefined,
    detach: undefined,
    output: undefined,
    errorOutput: undefined,
    exec: undefined,
    execRaw: async (cmd: string) => {
      commands.push(cmd);
      return { exitCode: 0, stdout, stderr: "" };
    },
    execPty: undefined,
    writeFile: undefined,
    snapshot: undefined,
    memory: undefined,
  } as unknown as VmHandle;
}
