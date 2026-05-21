import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  NATIVE_PROCESS_IMAGE_FILES,
  assertNativeProcessImageDocuments,
  isNativeProcessImageBundle,
  nativeProcessImageSchemas,
  validateNativeProcessImageBundle,
  validateNativeProcessImageDocuments,
  type NativeProcessImageDocuments,
} from "../native-process-image.ts";

function validImage(): NativeProcessImageDocuments {
  return {
    manifest: {
      formatVersion: 1,
      kind: "machinen.native-process-image",
      capture: {
        method: "external-ptrace-procfs",
        sourceArch: "arm64",
        pid: 4242,
        capturedAt: "2026-05-19T00:00:00.000Z",
      },
      target: {
        mode: "native-cross-isa",
        arch: "amd64",
        abi: "linux-user",
      },
      process: {
        exe: "/usr/bin/controlled-native",
        argv: ["/usr/bin/controlled-native", "--continue"],
        env: { LANG: "C" },
        cwd: "/tmp",
      },
      refusals: emptyRefusals(),
    },
    mappings: {
      formatVersion: 1,
      mappings: [
        {
          id: "mapping:text",
          kind: "text",
          sourceStart: "0x400000",
          sourceEnd: "0x401000",
          sizeBytes: 4096,
          permissions: {
            read: true,
            write: false,
            execute: true,
            private: true,
            shared: false,
          },
          file: {
            path: "/usr/bin/controlled-native",
            offset: 0,
            buildId: "aabbccdd",
          },
          target: {
            materialization: "translate",
            targetStart: "0x140000000",
          },
        },
        {
          id: "mapping:stack:main",
          kind: "stack",
          sourceStart: "0x7ffeffff0000",
          sourceEnd: "0x7fff00000000",
          sizeBytes: 4096,
          permissions: {
            read: true,
            write: true,
            execute: false,
            private: true,
            shared: false,
          },
          captured: {
            file: NATIVE_PROCESS_IMAGE_FILES.memory,
            offset: 0,
            sizeBytes: 4096,
          },
          target: {
            materialization: "translate",
            targetStart: "0x7ffffffef000",
          },
        },
        {
          id: "mapping:vdso",
          kind: "vdso",
          sourceStart: "0xffff00000000",
          sourceEnd: "0xffff00001000",
          sizeBytes: 4096,
          permissions: {
            read: true,
            write: false,
            execute: true,
            private: false,
            shared: true,
          },
          target: {
            materialization: "recreate",
            reason: "kernel mapping is recreated by the target kernel",
          },
        },
      ],
      refusals: emptyRefusals(),
    },
    threads: {
      formatVersion: 1,
      threads: [
        {
          id: "thread:main",
          lwpid: 4242,
          state: "stopped",
          stopReason: "ptrace-stop",
          stackMapping: "mapping:stack:main",
          sourceRegisters: {
            arch: "arm64",
            pc: "0x400120",
            sp: "0x7ffefffff000",
            pstate: "0x60000000",
            x: Array.from({ length: 31 }, () => "0x0"),
          },
          syscall: { state: "outside-syscall" },
          signal: {
            blocked: [],
            pending: [],
            activeFrame: false,
            altStack: { state: "disabled" },
          },
          tls: {
            threadPointer: "0x7ffeffffe000",
            rseq: { state: "absent" },
          },
        },
      ],
      refusals: emptyRefusals(),
    },
    resources: {
      formatVersion: 1,
      resources: [
        { id: "argv", kind: "argv", state: "captured", recipe: { argv: ["controlled-native"] } },
        { id: "cwd", kind: "cwd", state: "recipe", path: "/tmp", recipe: { cwd: "/tmp" } },
      ],
      refusals: emptyRefusals(),
    },
    translation: {
      formatVersion: 1,
      mode: "native-cross-isa",
      sourceArch: "arm64",
      targetArch: "amd64",
      codeLocations: [
        {
          id: "code:resume",
          sourceMapping: "mapping:text",
          sourceAddress: "0x400120",
          targetAddress: "0x140000120",
          state: "mapped",
        },
      ],
      threads: [
        {
          sourceThreadId: "thread:main",
          state: "translated",
          targetRegisters: {
            arch: "amd64",
            rip: "0x140000120",
            rsp: "0x7ffffffeff00",
            rflags: "0x202",
            rax: "0x0",
            rbx: "0x0",
            rcx: "0x0",
            rdx: "0x0",
            rsi: "0x0",
            rdi: "0x0",
            rbp: "0x7ffffffeff80",
            r8: "0x0",
            r9: "0x0",
            r10: "0x0",
            r11: "0x0",
            r12: "0x0",
            r13: "0x0",
            r14: "0x0",
            r15: "0x0",
            fsBase: "0x7ffff7d00000",
            gsBase: "0x0",
          },
        },
      ],
      memoryRelocations: [],
      refusals: emptyRefusals(),
    },
  };
}

function emptyRefusals() {
  return { vocabularyVersion: 1 as const, refusals: [] };
}

function cloneImage(): NativeProcessImageDocuments {
  return structuredClone(validImage());
}

describe("native process image format", () => {
  it("exports JSON schemas for every bundle document", () => {
    expect(nativeProcessImageSchemas.manifest.$id).toMatch(/manifest\.schema\.json$/);
    expect(nativeProcessImageSchemas.mappings.$id).toMatch(/mappings\.schema\.json$/);
    expect(nativeProcessImageSchemas.threads.$id).toMatch(/threads\.schema\.json$/);
    expect(nativeProcessImageSchemas.resources.$id).toMatch(/resources\.schema\.json$/);
    expect(nativeProcessImageSchemas.translation.$id).toMatch(/translation\.schema\.json$/);
  });

  it("validates a hand-written single-thread native cross-ISA image", () => {
    const image = validImage();
    expect(validateNativeProcessImageDocuments(image)).toEqual([]);
    expect(() => assertNativeProcessImageDocuments(image)).not.toThrow();
  });

  it("rejects missing architecture-specific register metadata", () => {
    const image = cloneImage();
    delete (image.threads.threads[0]!.sourceRegisters as unknown as Record<string, unknown>).pc;

    expect(validateNativeProcessImageDocuments(image)).toContain(
      "threads.threads[0].sourceRegisters.pc must be a hex address",
    );
  });

  it("validates captured syscall arguments and syscall frame pointers", () => {
    const image = cloneImage();
    image.threads.threads[0]!.syscall = {
      state: "inside-syscall",
      number: 115,
      name: "clock_nanosleep",
      arguments: ["0x0", "0x0", "0x1000", "0x0", "0x0", "0x0"],
      stackPointer: "0x7ffefffff000",
      instructionPointer: "0x400120",
    };

    expect(validateNativeProcessImageDocuments(image)).toEqual([]);

    image.threads.threads[0]!.syscall.arguments = ["0x0", "not-hex"];
    expect(validateNativeProcessImageDocuments(image)).toEqual(
      expect.arrayContaining([
        "threads.threads[0].syscall.arguments must contain exactly 6 item(s)",
        "threads.threads[0].syscall.arguments[1] must be a hex address",
      ]),
    );
  });

  it("rejects threads and code locations that reference missing mappings", () => {
    const image = cloneImage();
    image.threads.threads[0]!.stackMapping = "mapping:missing";
    image.translation.codeLocations[0]!.sourceMapping = "mapping:missing";

    expect(validateNativeProcessImageDocuments(image)).toEqual(
      expect.arrayContaining([
        'threads.threads[0].stackMapping references unknown mapping "mapping:missing"',
        'translation.codeLocations[0].sourceMapping references unknown mapping "mapping:missing"',
      ]),
    );
  });

  it("requires raw capture architecture and translated target architecture to stay distinct", () => {
    const image = cloneImage();
    image.manifest.target.arch = "arm64";
    image.translation.targetArch = "arm64";

    expect(validateNativeProcessImageDocuments(image)).toEqual(
      expect.arrayContaining([
        "manifest.target.arch must differ from manifest.capture.sourceArch",
        "translation.targetArch must differ from translation.sourceArch",
      ]),
    );
  });

  it("validates a bundle directory and requires the raw memory file", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-native-image-"));
    try {
      const image = validImage();
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.manifest, image.manifest);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.mappings, image.mappings);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.threads, image.threads);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.resources, image.resources);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.translation, image.translation);
      writeFileSync(join(dir, NATIVE_PROCESS_IMAGE_FILES.memory), Buffer.alloc(4096));

      expect(isNativeProcessImageBundle(dir)).toBe(true);
      expect(validateNativeProcessImageBundle(dir).translation.targetArch).toBe("amd64");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing raw memory payload for bundle validation", () => {
    const dir = mkdtempSync(join(tmpdir(), "machinen-native-image-missing-memory-"));
    try {
      const image = validImage();
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.manifest, image.manifest);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.mappings, image.mappings);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.threads, image.threads);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.resources, image.resources);
      writeJson(dir, NATIVE_PROCESS_IMAGE_FILES.translation, image.translation);

      expect(() => validateNativeProcessImageBundle(dir)).toThrow(/native-memory\.bin is missing/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

function writeJson(dir: string, name: string, value: unknown): void {
  writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
}
