import { describe, expect, it } from "vitest";
import { planTargetGuestProcessContextRestore } from "../target-guest-process-context-restore.ts";
import type { NativeProcessImageDocuments } from "../native-process-image.ts";

function auxvHex(values: { pageSize: number; clockTick: number; unsafe?: boolean }): string {
  const pairs: Array<[bigint, bigint]> = [
    [6n, BigInt(values.pageSize)],
    [17n, BigInt(values.clockTick)],
    ...(values.unsafe
      ? ([
          [33n, 0x7fff0000n],
          [25n, 0x7fff0100n],
          [31n, 0x7fff0200n],
          [7n, 0x7fff0300n],
        ] satisfies Array<[bigint, bigint]>)
      : []),
    [0n, 0n],
  ];
  const bytes = Buffer.alloc(16 * pairs.length);
  pairs.forEach(([key, value], index) => {
    bytes.writeBigUInt64LE(key, index * 16);
    bytes.writeBigUInt64LE(value, index * 16 + 8);
  });
  return bytes.toString("hex");
}

function documents(
  overrides: Partial<NativeProcessImageDocuments["manifest"]["process"]> = {},
): NativeProcessImageDocuments {
  const process = {
    exe: "/bin/target",
    argv: ["/bin/target", "--machinen-argv-token", "ok"],
    env: { MACHINEN_CONTEXT_TOKEN: "process-context" },
    cwd: "/",
    ...overrides,
  };
  return {
    rootDir: "/tmp/native-process",
    manifest: {
      formatVersion: 1,
      kind: "machinen.native-process-image",
      capture: { method: "external-ptrace-procfs", sourceArch: "arm64", pid: 42 },
      target: { mode: "native-cross-isa", arch: "amd64", abi: "linux-user" },
      process,
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
    mappings: { formatVersion: 1, mappings: [], refusals: { vocabularyVersion: 1, refusals: [] } },
    threads: { formatVersion: 1, threads: [], refusals: { vocabularyVersion: 1, refusals: [] } },
    resources: {
      formatVersion: 1,
      resources: [
        { id: "argv", kind: "argv", state: "captured", recipe: { argv: process.argv } },
        { id: "env", kind: "env", state: "captured", recipe: { env: process.env } },
        {
          id: "cwd",
          kind: "cwd",
          state: "recipe",
          path: process.cwd,
          recipe: { cwd: process.cwd },
        },
        {
          id: "auxv",
          kind: "auxv",
          state: "captured",
          recipe: { bytesHex: auxvHex({ pageSize: 4096, clockTick: 100 }) },
        },
      ],
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
    translation: {
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: "arm64",
      targetArch: "amd64",
      codeLocations: [],
      threads: [],
      memoryRelocations: [],
      refusals: { vocabularyVersion: 1, refusals: [] },
    },
  };
}

describe("target guest process-context restore", () => {
  it("plans metadata-only argv/env/cwd/auxv handoff steps", () => {
    const plan = planTargetGuestProcessContextRestore(documents());

    expect(plan).toMatchObject({
      state: "planned",
      mode: "metadata-only",
      steps: [
        { action: "record-argv", argc: 3, argvBytes: 34 },
        { action: "record-env", envCount: 1 },
        { action: "record-cwd", cwdHex: "2f" },
        { action: "record-auxv", auxvBytes: 48 },
      ],
    });
  });

  it("plans target env and cwd application for a controlled profile", () => {
    const plan = planTargetGuestProcessContextRestore(documents(), {
      mode: "apply-target-env-cwd",
    });

    expect(plan).toMatchObject({
      state: "planned",
      mode: "apply-target-env-cwd",
      steps: [
        { action: "record-argv" },
        { action: "clear-env", envCount: 1 },
        {
          action: "set-env",
          keyHex: "4d414348494e454e5f434f4e544558545f544f4b454e",
          valueHex: "70726f636573732d636f6e74657874",
        },
        { action: "verify-env", envCount: 1 },
        { action: "chdir", cwdHex: "2f" },
        { action: "record-auxv" },
      ],
    });
  });

  it("plans target-visible argv/env/cwd/auxv verifier steps", () => {
    const plan = planTargetGuestProcessContextRestore(documents(), {
      mode: "apply-target-visible-context",
    });

    expect(plan).toMatchObject({
      state: "planned",
      mode: "apply-target-visible-context",
      steps: expect.arrayContaining([
        expect.objectContaining({
          action: "materialize-argv",
          tokenIndex: 1,
          tokenHex: "2d2d6d616368696e656e2d617267762d746f6b656e",
        }),
        expect.objectContaining({ action: "verify-env-value" }),
        expect.objectContaining({ action: "verify-cwd", cwdHex: "2f" }),
        expect.objectContaining({ action: "verify-auxv-selected", pageSize: 4096, clockTick: 100 }),
      ]),
    });
  });

  it("plans target initial-stack argv/env pointer materialization with selected auxv policy", () => {
    const docs = documents({ env: { FIRST: "one", SECOND: "two" } });
    docs.resources.resources.find((resource) => resource.kind === "env")!.recipe = {
      env: docs.manifest.process.env,
    };
    docs.resources.resources.find((resource) => resource.kind === "auxv")!.recipe = {
      bytesHex: auxvHex({ pageSize: 4096, clockTick: 100, unsafe: true }),
    };

    const plan = planTargetGuestProcessContextRestore(docs, {
      mode: "apply-target-initial-stack",
      initialStackTargetStart: "0x600000002000",
    });

    expect(plan).toMatchObject({
      state: "planned",
      mode: "apply-target-initial-stack",
      steps: expect.arrayContaining([
        expect.objectContaining({
          action: "set-argv-entry",
          index: 0,
          valueHex: "2f62696e2f746172676574",
        }),
        expect.objectContaining({ action: "clear-env", envCount: 2 }),
        expect.objectContaining({ action: "verify-cwd", cwdHex: "2f" }),
        expect.objectContaining({
          action: "record-auxv-policy",
          materializedKeys: "AT_PAGESZ,AT_CLKTCK",
          refusedKeys: "AT_SYSINFO_EHDR,AT_RANDOM,AT_EXECFN,AT_BASE",
        }),
        expect.objectContaining({
          action: "materialize-initial-stack",
          targetStart: "0x600000002000",
          argc: 3,
          envCount: 2,
          pageSize: 4096,
          clockTick: 100,
        }),
        expect.objectContaining({ action: "verify-initial-stack", targetStart: "0x600000002000" }),
      ]),
    });
    if (plan.state !== "planned") {
      throw new Error("expected process-context plan to be planned");
    }
    const materialize = plan.steps.find((step) => step.action === "materialize-initial-stack");
    expect(materialize).toMatchObject({ pageSize: 4096, clockTick: 100 });
    expect(materialize).not.toHaveProperty("auxvHex");
    expect(materialize).not.toHaveProperty("randomPointer");
    expect(materialize).not.toHaveProperty("execfnPointer");
    expect(materialize).not.toHaveProperty("basePointer");
  });

  it("records all source-owned and target-variant auxv keys as refused", () => {
    const docs = documents();
    docs.resources.resources.find((resource) => resource.kind === "auxv")!.recipe = {
      bytesHex: auxvHex({ pageSize: 16384, clockTick: 250, unsafe: true }),
    };

    const plan = planTargetGuestProcessContextRestore(docs, {
      mode: "apply-target-initial-stack",
      initialStackTargetStart: "0x600000004000",
    });

    expect(plan).toMatchObject({
      state: "planned",
      steps: expect.arrayContaining([
        expect.objectContaining({
          action: "record-auxv-policy",
          materializedKeys: "AT_PAGESZ,AT_CLKTCK",
          refusedKeys: "AT_SYSINFO_EHDR,AT_RANDOM,AT_EXECFN,AT_BASE",
        }),
        expect.objectContaining({
          action: "materialize-initial-stack",
          pageSize: 16384,
          clockTick: 250,
        }),
      ]),
    });
  });

  it("refuses target-visible context without controlled tokens or selected auxv", () => {
    const bad = documents({ argv: ["/bin/target"], env: {}, cwd: "/" });
    bad.resources.resources.find((resource) => resource.kind === "auxv")!.recipe = {
      bytesHex: "01000000000000000020000000000000",
    };

    const plan = planTargetGuestProcessContextRestore(bad, {
      mode: "apply-target-visible-context",
    });

    expect(plan).toMatchObject({
      state: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({
          detail: expect.objectContaining({
            reason: "target-visible context requires controlled argv token",
          }),
        }),
        expect.objectContaining({
          detail: expect.objectContaining({
            reason: "target-visible context requires MACHINEN_CONTEXT_TOKEN",
          }),
        }),
        expect.objectContaining({
          detail: expect.objectContaining({
            reason: "target-visible context requires selected safe auxv entries",
          }),
        }),
      ]),
    });
  });

  it("refuses malformed process context and inconsistent resources", () => {
    const bad = documents({ argv: [], cwd: "relative" });
    bad.resources.resources.find((resource) => resource.kind === "auxv")!.recipe = {
      bytesHex: "xyz",
    };

    const plan = planTargetGuestProcessContextRestore(bad);

    expect(plan).toMatchObject({
      state: "refused",
      refusals: expect.arrayContaining([
        expect.objectContaining({ code: "target-process-context-unsupported" }),
      ]),
    });
  });
});
