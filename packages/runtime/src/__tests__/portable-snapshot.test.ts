import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { restore } from "../index.ts";
import {
  portableSnapshotSchemas,
  validatePortableSnapshotBundle,
  validatePortableSnapshotDocuments,
} from "../vm/portable-snapshot.ts";
import { performSnapshot } from "../vm/snapshot.ts";

const TMP: string[] = [];
const ORIGINAL_SNAPSHOT_ENGINE = process.env.MACHINEN_SNAPSHOT_ENGINE;

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
  restoreOriginalSnapshotEngine();
});

function restoreOriginalSnapshotEngine(): void {
  if (ORIGINAL_SNAPSHOT_ENGINE === undefined) {
    delete process.env.MACHINEN_SNAPSHOT_ENGINE;
  } else {
    process.env.MACHINEN_SNAPSHOT_ENGINE = ORIGINAL_SNAPSHOT_ENGINE;
  }
}

function unsupported() {
  return { vocabularyVersion: 1, refusals: [] };
}

function tinyManifest(overrides: Record<string, unknown> = {}) {
  return {
    formatVersion: 1,
    sourceGuestArch: "arm64",
    allowedTargetGuestArchs: ["arm64", "amd64"],
    program: {
      name: "portable-proof",
      executable: "/usr/local/bin/machinen-portable-proof",
      identity: "com.redwoodjs.machinen.portable-proof",
    },
    sourceBuild: { buildId: "0123456789abcdef", version: "0.1.0" },
    targetBuild: { version: "0.1.x" },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: {
        outsideSignalHandlers: true,
        outsideSyscalls: true,
      },
    },
    checkpointContinuation: { name: "machinen_portable_checkpoint" },
    restoreEntrypoint: { name: "machinen_restore_main" },
    process: {
      argv: ["/usr/local/bin/machinen-portable-proof", "--restore-proof"],
      env: { MACHINEN_PORTABLE_PROOF: "1" },
      cwd: "/",
    },
    features: ["proof-workload"],
    unsupported: unsupported(),
    ...overrides,
  };
}

function tinyDocs(manifestOverrides: Record<string, unknown> = {}) {
  return {
    manifest: tinyManifest(manifestOverrides),
    objects: {
      formatVersion: 1,
      objects: [
        {
          id: "app-state",
          kind: "global",
          type: "AppState",
          sizeBytes: 16,
          sourceAddress: "0x1000",
          memory: { offset: 0, sizeBytes: 16 },
        },
        {
          id: "heap-1",
          kind: "heap",
          type: "uint8_t[16]",
          sizeBytes: 16,
          sourceAddress: "0x2000",
          allocation: { id: 1, sourceAddress: "0x2000" },
          memory: { offset: 16, sizeBytes: 16 },
        },
      ],
      unsupported: unsupported(),
    },
    relocations: {
      formatVersion: 1,
      relocations: [
        {
          fromObject: "app-state",
          fromOffset: 8,
          toObject: "heap-1",
          addend: 0,
          kind: "pointer",
          sourcePointer: "0x2000",
        },
      ],
      unsupported: unsupported(),
    },
    resources: {
      formatVersion: 1,
      resources: [
        { id: "argv", kind: "argv", state: "captured", argv: ["portable-proof"] },
        { id: "env", kind: "env", state: "captured", env: { PORTABLE_PROOF: "1" } },
        { id: "cwd", kind: "cwd", state: "captured", path: "/" },
        {
          id: "file-1",
          kind: "file",
          state: "captured",
          path: "/tmp/proof-resource.txt",
          fd: 3,
          flags: ["read"],
          offset: 4,
        },
      ],
      unsupported: unsupported(),
    },
  };
}

function writeTinyBundle(manifestOverrides: Record<string, unknown> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "portable-snapshot-"));
  TMP.push(dir);
  const docs = tinyDocs(manifestOverrides);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(docs.manifest));
  writeFileSync(join(dir, "objects.json"), JSON.stringify(docs.objects));
  writeFileSync(join(dir, "relocations.json"), JSON.stringify(docs.relocations));
  writeFileSync(join(dir, "resources.json"), JSON.stringify(docs.resources));
  writeFileSync(join(dir, "memory.bin"), Buffer.alloc(32));
  mkdirSync(join(dir, "logs"));
  return dir;
}

async function withSnapshotEngine<T>(engine: string, fn: () => Promise<T>): Promise<T> {
  const old = process.env.MACHINEN_SNAPSHOT_ENGINE;
  process.env.MACHINEN_SNAPSHOT_ENGINE = engine;
  try {
    return await fn();
  } finally {
    if (old === undefined) {
      delete process.env.MACHINEN_SNAPSHOT_ENGINE;
    } else {
      process.env.MACHINEN_SNAPSHOT_ENGINE = old;
    }
  }
}

function fakeSnapshotContext() {
  return {
    pid: 12345,
    diskPath: "/tmp/scratch.img",
    execRaw: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    wait: async () => ({ code: 0, signal: null }),
    kill: async () => {},
    teeGuestConsole: undefined,
    errorOutput: async () => "",
  } as never;
}

describe("portable snapshot schemas", () => {
  it("exports JSON schemas for each portable bundle document", () => {
    expect(portableSnapshotSchemas.manifest.$id).toMatch(/manifest\.schema\.json$/);
    expect(portableSnapshotSchemas.objects.$id).toMatch(/objects\.schema\.json$/);
    expect(portableSnapshotSchemas.relocations.$id).toMatch(/relocations\.schema\.json$/);
    expect(portableSnapshotSchemas.resources.$id).toMatch(/resources\.schema\.json$/);
  });

  it("validates a tiny hand-written portable bundle", () => {
    const dir = writeTinyBundle();
    expect(validatePortableSnapshotBundle(dir).manifest.program.name).toBe("portable-proof");
  });

  it("rejects invalid architecture metadata with a clear error", () => {
    const dir = writeTinyBundle({ sourceGuestArch: "riscv64" });
    expect(() => validatePortableSnapshotBundle(dir)).toThrow(
      /manifest\.sourceGuestArch must be one of: arm64, amd64/,
    );
  });

  it("rejects invalid build metadata with a clear error", () => {
    const dir = writeTinyBundle({ sourceBuild: { buildId: "not-a-build-id" } });
    expect(() => validatePortableSnapshotBundle(dir)).toThrow(
      /manifest\.sourceBuild\.buildId must be 8-128 hex characters/,
    );
  });

  it("rejects invalid restore entrypoint metadata with a clear error", () => {
    const dir = writeTinyBundle({ restoreEntrypoint: { name: "not a symbol" } });
    expect(() => validatePortableSnapshotBundle(dir)).toThrow(
      /manifest\.restoreEntrypoint\.name must be a valid symbol name/,
    );
  });

  it("requires the cooperative checkpoint ABI to name the safe point contract", () => {
    const docs = tinyDocs({
      checkpointAbi: {
        version: 1,
        checkpointFunction: { name: "machinen_checkpoint" },
        rootsType: "machinen_checkpoint_roots",
        restoreBundleType: "machinen_restore_bundle",
        safePoint: {
          outsideSignalHandlers: true,
          outsideSyscalls: false,
        },
      },
    });
    expect(validatePortableSnapshotDocuments(docs)).toContain(
      "manifest.checkpointAbi.safePoint.outsideSyscalls must be true",
    );
  });

  it("validates allocator metadata for captured heap objects", () => {
    const docs = tinyDocs();
    expect(validatePortableSnapshotDocuments(docs)).toEqual([]);
  });

  it("rejects invalid allocation source addresses", () => {
    const docs = tinyDocs();
    docs.objects.objects[1]!.allocation = { id: 1, sourceAddress: "not-hex" };
    expect(validatePortableSnapshotDocuments(docs)).toContain(
      "objects.objects[1].allocation.sourceAddress must be a hex address",
    );
  });

  it("validates relocation source pointers", () => {
    const docs = tinyDocs();
    docs.relocations.relocations[0]!.sourcePointer = "not-hex";
    expect(validatePortableSnapshotDocuments(docs)).toContain(
      "relocations.relocations[0].sourcePointer must be a hex address",
    );
  });

  it("validates semantic resource metadata", () => {
    const docs = tinyDocs();
    docs.resources.resources[3]!.offset = -1;
    expect(validatePortableSnapshotDocuments(docs)).toContain(
      "resources.resources[3].offset must be a non-negative integer",
    );
  });

  it("accepts the initial stable refusal diagnostics vocabulary", () => {
    const refusalCodes = [
      "thread-count-unsupported",
      "thread-not-at-barrier",
      "thread-inside-syscall",
      "signal-handler-active",
      "mapping-executable-anonymous",
      "fd-kind-unsupported",
      "pointer-outside-known-object",
      "target-build-mismatch",
      "architecture-pair-unsupported",
    ];
    const docs = tinyDocs({
      unsupported: {
        vocabularyVersion: 1,
        refusals: refusalCodes.map((code) => ({
          code,
          message: `refused: ${code}`,
        })),
      },
    });
    expect(validatePortableSnapshotDocuments(docs)).toEqual([]);
  });

  it("rejects unknown refusal diagnostics", () => {
    const docs = tinyDocs({
      unsupported: {
        vocabularyVersion: 1,
        refusals: [{ code: "surprise-refusal", message: "nope" }],
      },
    });
    expect(validatePortableSnapshotDocuments(docs)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^manifest\.unsupported\.refusals\[0\]\.code must be one of:/),
      ]),
    );
  });

  it("reports missing target build metadata without reading from disk", () => {
    const docs = tinyDocs({ targetBuild: {} });
    expect(validatePortableSnapshotDocuments(docs)).toContain(
      "manifest.targetBuild must include buildId or version",
    );
  });
});

describe("portable snapshot engine selector", () => {
  it("snapshot routes to the explicit portable engine with an unsupported-workload error", async () => {
    await withSnapshotEngine("portable", async () => {
      await expect(
        performSnapshot(fakeSnapshotContext(), { outDir: "/tmp/no-write" }),
      ).rejects.toMatchObject({
        code: "SNAPSHOT_PORTABLE_UNSUPPORTED",
        message: expect.stringMatching(/portable snapshot engine is experimental/),
      });
    });
  });

  it("restore routes to portable only when explicitly selected", async () => {
    const dir = writeTinyBundle();
    await expect(restore({ snapDir: dir, binary: "/bin/sh" })).rejects.toThrow(
      /requires MACHINEN_SNAPSHOT_ENGINE=portable/,
    );

    await withSnapshotEngine("portable", async () => {
      await expect(restore({ snapDir: dir, binary: "/bin/sh" })).rejects.toMatchObject({
        code: "BOOT_PORTABLE_UNSUPPORTED",
        message: expect.stringMatching(/portable snapshot engine is experimental/),
      });
    });
  });
});
