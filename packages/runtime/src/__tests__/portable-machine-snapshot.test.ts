import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  NATIVE_PROCESS_IMAGE_FILES,
  validateNativeProcessImageBundle,
} from "../native-process-image.ts";
import {
  PORTABLE_MACHINE_SNAPSHOT_FILES,
  PortableMachineSnapshotValidationError,
  buildPortableMachineSnapshotManifestFromNativeProcessImage,
  crossIsaVmstateRestoreRefusal,
  validatePortableMachineSnapshotBundle,
  validatePortableMachineSnapshotManifest,
  type PortableMachineSnapshotManifest,
} from "../portable-machine-snapshot.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const PORTABLE_MACHINE_SCRIPT = join(REPO_ROOT, "scripts/portable-machine-snapshot.ts");
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDir(name: string): string {
  const dir = mkdtempSync(join(tmpdir(), name));
  tempDirs.push(dir);
  return dir;
}

function manifest(
  overrides: Partial<PortableMachineSnapshotManifest> = {},
): PortableMachineSnapshotManifest {
  return {
    formatVersion: 1,
    kind: "machinen.portable-machine-snapshot",
    source: {
      guestArch: "arm64",
      vmstate: {
        rawRestore: "refused",
        refusalCode: "cross-isa-vmstate-restore-unsupported",
        reason: "raw arm64 kernel/vCPU/device state is not target amd64 state",
      },
      kernelState: "not-translated",
      deviceState: "not-translated",
    },
    target: {
      guestArch: "amd64",
      mode: "target-isa-vm-process-restore",
      execution: "target-native",
    },
    payload: {
      nativeProcessImage: {
        kind: "machinen.native-process-image",
        path: "native-process/",
      },
      resourceModel: "explicit-recipes-only",
    },
    refusals: {
      vocabularyVersion: 1,
      refusals: [crossIsaVmstateRestoreRefusal("arm64", "amd64")],
    },
    ...overrides,
  };
}

function writeNativeProcessBundle(
  dir: string,
  arches: { source: "arm64" | "amd64"; target: "arm64" | "amd64" } = {
    source: "arm64",
    target: "amd64",
  },
): void {
  mkdirSync(dir, { recursive: true });
  const refusals = { vocabularyVersion: 1, refusals: [] };
  writeFileSync(
    join(dir, NATIVE_PROCESS_IMAGE_FILES.manifest),
    JSON.stringify({
      formatVersion: 1,
      kind: "machinen.native-process-image",
      capture: { method: "external-ptrace-procfs", sourceArch: arches.source, pid: 1000 },
      target: { mode: "native-cross-isa", arch: arches.target, abi: "linux-user" },
      process: { exe: "/bin/sleep", argv: ["sleep", "1"], env: {}, cwd: "/" },
      refusals,
    }),
  );
  writeFileSync(
    join(dir, NATIVE_PROCESS_IMAGE_FILES.mappings),
    JSON.stringify({
      formatVersion: 1,
      mappings: [
        {
          id: "mapping:stack",
          kind: "stack",
          sourceStart: "0x1000",
          sourceEnd: "0x2000",
          sizeBytes: 4096,
          permissions: { read: true, write: true, execute: false, private: true, shared: false },
          captured: { file: NATIVE_PROCESS_IMAGE_FILES.memory, offset: 0, sizeBytes: 16 },
          target: { materialization: "translate" },
        },
      ],
      refusals,
    }),
  );
  writeFileSync(
    join(dir, NATIVE_PROCESS_IMAGE_FILES.threads),
    JSON.stringify({
      formatVersion: 1,
      threads: [
        {
          id: "thread:1",
          lwpid: 1000,
          state: "stopped",
          stopReason: "ptrace-stop",
          stackMapping: "mapping:stack",
          sourceRegisters: sourceRegisters(arches.source),
          syscall: { state: "outside-syscall" },
          signal: { blocked: [], pending: [], activeFrame: false, altStack: { state: "disabled" } },
          tls: { threadPointer: "0x0", rseq: { state: "absent" } },
        },
      ],
      refusals,
    }),
  );
  writeFileSync(
    join(dir, NATIVE_PROCESS_IMAGE_FILES.resources),
    JSON.stringify({ formatVersion: 1, resources: [], refusals }),
  );
  writeFileSync(
    join(dir, NATIVE_PROCESS_IMAGE_FILES.translation),
    JSON.stringify({
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: arches.source,
      targetArch: arches.target,
      codeLocations: [],
      threads: [],
      memoryRelocations: [],
      refusals,
    }),
  );
  writeFileSync(join(dir, NATIVE_PROCESS_IMAGE_FILES.memory), Buffer.alloc(16));
}

function sourceRegisters(arch: "arm64" | "amd64") {
  if (arch === "arm64") {
    return {
      arch,
      pc: "0x0",
      sp: "0x1000",
      pstate: "0x0",
      x: Array.from({ length: 31 }, () => "0x0"),
    };
  }
  return {
    arch,
    ...Object.fromEntries(
      [
        "rip",
        "rsp",
        "rflags",
        "rax",
        "rbx",
        "rcx",
        "rdx",
        "rsi",
        "rdi",
        "rbp",
        "r8",
        "r9",
        "r10",
        "r11",
        "r12",
        "r13",
        "r14",
        "r15",
        "fsBase",
        "gsBase",
      ].map((register) => [register, "0x0"]),
    ),
  };
}

describe("portable machine snapshot boundary", () => {
  it("accepts the narrow cross-ISA target-VM process-restore metadata shape", () => {
    expect(validatePortableMachineSnapshotManifest(manifest())).toMatchObject({
      kind: "machinen.portable-machine-snapshot",
      source: {
        guestArch: "arm64",
        vmstate: { rawRestore: "refused" },
        kernelState: "not-translated",
        deviceState: "not-translated",
      },
      target: {
        guestArch: "amd64",
        mode: "target-isa-vm-process-restore",
        execution: "target-native",
      },
      payload: {
        nativeProcessImage: { kind: "machinen.native-process-image" },
        resourceModel: "explicit-recipes-only",
      },
    });
  });

  it("validates a portable machine bundle around a native process image", () => {
    const rootDir = tempDir("portable-machine-bundle-");
    const nativeProcessDir = join(rootDir, PORTABLE_MACHINE_SNAPSHOT_FILES.nativeProcessImage);
    writeNativeProcessBundle(nativeProcessDir);
    const nativeProcessImage = validateNativeProcessImageBundle(nativeProcessDir);
    writeFileSync(
      join(rootDir, PORTABLE_MACHINE_SNAPSHOT_FILES.manifest),
      JSON.stringify(
        buildPortableMachineSnapshotManifestFromNativeProcessImage(nativeProcessImage),
      ),
    );

    expect(validatePortableMachineSnapshotBundle(rootDir)).toMatchObject({
      manifest: {
        source: { guestArch: "arm64" },
        target: { guestArch: "amd64" },
      },
      nativeProcessImage: {
        manifest: {
          capture: { sourceArch: "arm64" },
          target: { arch: "amd64" },
        },
      },
    });
  });

  it("refuses portable machine bundles whose native process arches do not match", () => {
    const rootDir = tempDir("portable-machine-bad-arch-");
    const nativeProcessDir = join(rootDir, PORTABLE_MACHINE_SNAPSHOT_FILES.nativeProcessImage);
    writeNativeProcessBundle(nativeProcessDir, { source: "amd64", target: "arm64" });
    writeFileSync(
      join(rootDir, PORTABLE_MACHINE_SNAPSHOT_FILES.manifest),
      JSON.stringify(manifest()),
    );

    expect(() => validatePortableMachineSnapshotBundle(rootDir)).toThrow(
      /native process source arch must match/,
    );
  });

  it("refuses portable machine bundles whose native process path escapes the bundle", () => {
    const rootDir = tempDir("portable-machine-path-escape-");
    writeFileSync(
      join(rootDir, PORTABLE_MACHINE_SNAPSHOT_FILES.manifest),
      JSON.stringify(
        manifest({
          payload: {
            nativeProcessImage: { kind: "machinen.native-process-image", path: "../outside" },
            resourceModel: "explicit-recipes-only",
          },
        }),
      ),
    );

    expect(() => validatePortableMachineSnapshotBundle(rootDir)).toThrow(/stay inside/);
  });

  it("script creates a portable machine bundle from a native process bundle", () => {
    const nativeProcessDir = tempDir("portable-machine-script-native-");
    const outDir = tempDir("portable-machine-script-out-");
    writeNativeProcessBundle(nativeProcessDir);

    const result = spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        PORTABLE_MACHINE_SCRIPT,
        "verify",
        "--native-process-bundle",
        nativeProcessDir,
        "--out-dir",
        outDir,
        "--json",
      ],
      { cwd: REPO_ROOT, encoding: "utf8", env: process.env, maxBuffer: 5 * 1024 * 1024 },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      bundleCreated: true,
      portableMachineBundle: outDir,
      sourceGuestArch: "arm64",
      targetGuestArch: "amd64",
      targetExecution: "target-native",
    });
    expect(validatePortableMachineSnapshotBundle(outDir).manifest.kind).toBe(
      "machinen.portable-machine-snapshot",
    );
  });

  it("records a precise raw cross-ISA vmstate refusal", () => {
    expect(crossIsaVmstateRestoreRefusal("arm64", "amd64")).toEqual({
      code: "cross-isa-vmstate-restore-unsupported",
      message: "raw whole-VM vmstate cannot be restored across guest ISAs",
      detail: {
        sourceArch: "arm64",
        targetArch: "amd64",
        requiredPath: "target-isa-vm-process-restore",
      },
    });
  });

  it("refuses same-ISA metadata because this contract is specifically cross-ISA", () => {
    expect(() =>
      validatePortableMachineSnapshotManifest(
        manifest({
          target: {
            guestArch: "arm64",
            mode: "target-isa-vm-process-restore",
            execution: "target-native",
          },
        }),
      ),
    ).toThrow(PortableMachineSnapshotValidationError);
  });

  it("refuses metadata that tries to replay raw vmstate", () => {
    const unsafe = manifest() as unknown as { source: { vmstate: { rawRestore: string } } };
    unsafe.source.vmstate.rawRestore = "translated";

    expect(() => validatePortableMachineSnapshotManifest(unsafe)).toThrow(
      /rawRestore must be "refused"/,
    );
  });

  it("refuses metadata that would use source ISA or sidecar execution", () => {
    expect(() =>
      validatePortableMachineSnapshotManifest(
        manifest({
          target: {
            guestArch: "amd64",
            mode: "target-isa-vm-process-restore",
            execution: "target-native",
          },
        }),
      ),
    ).not.toThrow();

    const unsafe = manifest() as unknown as { target: { execution: string } };
    unsafe.target.execution = "source-isa-emulation";
    expect(() => validatePortableMachineSnapshotManifest(unsafe)).toThrow(
      /execution must be "target-native"/,
    );
  });
});
