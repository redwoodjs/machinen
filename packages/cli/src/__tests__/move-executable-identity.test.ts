import type { MoveDescriptor, VmHandle } from "@machinen/runtime";
import { describe, expect, it } from "vitest";

import { validateMoveLoadTargetInVm } from "../move-executable-identity.ts";

const descriptor: MoveDescriptor = {
  formatVersion: 1,
  kind: "machinen.move.descriptor",
  rootPid: 71,
  scannedAt: "2026-06-08T00:00:00.000Z",
  nodes: [],
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
    capture: {
      sourceVm: { pid: 100, name: "source" },
      executablePackage: {
        path: "/usr/bin/ping",
        realPath: "/usr/bin/ping",
        packageName: "iputils-ping",
        version: "3:20221126-1+deb12u1",
        architecture: "arm64",
      },
    },
  },
};

describe("move executable identity validation", () => {
  it("accepts path/package/version parity on a distinct target VM", async () => {
    const vm = mockVm(
      200,
      "PKG\tiputils-ping\t3:20221126-1+deb12u1\tamd64\nEXE\t/usr/bin/ping\t/usr/bin/ping\n",
    );

    const validation = await validateMoveLoadTargetInVm(vm, descriptor, "/usr/bin/ping");

    expect(validation).toMatchObject({ state: "ready", refusals: [] });
  });

  it("refuses loading back into the same local VM", async () => {
    const vm = mockVm(
      100,
      "PKG\tiputils-ping\t3:20221126-1+deb12u1\tarm64\nEXE\t/usr/bin/ping\t/usr/bin/ping\n",
    );

    const validation = await validateMoveLoadTargetInVm(vm, descriptor, "/usr/bin/ping");

    expect(validation.refusals).toContainEqual(
      expect.objectContaining({ code: "target-process-context-unsupported" }),
    );
  });

  it("refuses target package version mismatch before native resume", async () => {
    const vm = mockVm(
      200,
      "PKG\tiputils-ping\t3:older\tamd64\nEXE\t/usr/bin/ping\t/usr/bin/ping\n",
    );

    const validation = await validateMoveLoadTargetInVm(vm, descriptor, "/usr/bin/ping");

    expect(validation.refusals).toContainEqual(
      expect.objectContaining({
        code: "target-build-mismatch",
        detail: expect.objectContaining({ failure: "version" }),
      }),
    );
  });
});

function mockVm(pid: number, stdout: string): VmHandle {
  return {
    pid,
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    wait: undefined,
    kill: undefined,
    detach: undefined,
    output: undefined,
    errorOutput: undefined,
    exec: undefined,
    execRaw: async () => ({ exitCode: 0, stdout, stderr: "" }),
    execPty: undefined,
    writeFile: undefined,
    snapshot: undefined,
    memory: undefined,
  } as unknown as VmHandle;
}
