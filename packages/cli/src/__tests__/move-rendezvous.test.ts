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

describe("move target direct loader", () => {
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
