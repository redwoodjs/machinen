import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
  TargetGuestRestoreLoaderValidationError,
  buildNativeActualResumeTrampolineArgs,
  buildTargetGuestRestoreLoaderArgv,
  parseTargetGuestRestoreDescriptor,
  serializeTargetGuestRestoreDescriptor,
  validateTargetGuestRestoreDescriptor,
  type TargetGuestRestoreDescriptor,
} from "../target-guest-restore-loader.ts";

const REPO_ROOT = resolve(import.meta.dirname, "../../../..");
const LOADER_SOURCE = join(REPO_ROOT, "packages/microvm/assets/target-guest-restore-loader.c");
const LOADER_PREFIX = "MACHINEN_TARGET_GUEST_RESTORE_LOADER ";
const HAS_CC = spawnSync("cc", ["--version"], { stdio: "ignore" }).status === 0;

const resumeRegisters = {
  rax: "0x2121212121212121",
  rdi: "0x7171717171717171",
  rsi: "0x6161616161616161",
  rdx: "0x6262626262626262",
  rcx: "0x6363636363636363",
  r8: "0x8888888888888888",
  r9: "0x9999999999999999",
  r10: "0x1010101010101010",
  r11: "0x1111111111111111",
};

const translatedFrame = {
  kind: "single-target-caller-frame" as const,
  framePointer: "0x50000000ff80",
  canonicalFrameAddress: "0x50000000fff0",
  returnAddressSlot: "0x50000000fff0",
  returnAddress: "0x700300000080",
  unwindId: "target:realspin-final-jump",
  calleeSaved: [
    { register: "rbx" as const, value: "0x1111111122222222" },
    { register: "r12" as const, value: "0x1234567890abcdef" },
    { register: "r13" as const, value: "0x1313131313131313" },
    { register: "r14" as const, value: "0x1414141414141414" },
    { register: "r15" as const, value: "0x1515151515151515" },
  ],
  slots: [
    {
      offset: 0,
      value: "0x4652414d45504153",
      classification: "non-pointer-data" as const,
    },
    {
      offset: 8,
      value: "0x535441434b534c54",
      classification: "non-pointer-data" as const,
    },
  ],
};

function descriptor(
  overrides: Partial<TargetGuestRestoreDescriptor> = {},
): TargetGuestRestoreDescriptor {
  return {
    kind: TARGET_GUEST_RESTORE_DESCRIPTOR_KIND,
    targetArch: "amd64",
    continuation: {
      codeFile: "/tmp/machinen-target-bytes.bin",
      fileOffset: 0,
      codeSize: 16,
      targetAddress: "0x700300000000",
      timeoutSeconds: 5,
      stackTargetStart: "0x500000000000",
      stackSize: 65_536,
      stackPointer: "0x500000010000",
    },
    resources: [],
    memory: [],
    ...overrides,
  };
}

describe("target guest restore loader descriptor", () => {
  it("serializes and parses fd table recipes", () => {
    const original = descriptor({
      continuation: {
        ...descriptor().continuation,
        stateReportAddress: "0x600000000000",
        translatedReturnAddress: "0x700300000080",
        resumeMode: "translated-frame",
        resumeRflags: "0x8d7",
        resumeRegisters,
      },
      translatedFrame,
      resources: [
        { kind: "close-fd", fd: 0, reason: "missing-captured-fd" },
        { kind: "inherit-stdio", fd: 1, stream: "stdout", closeOnExec: false },
        {
          kind: "reopen-file",
          fd: 7,
          path: "/tmp/data.txt",
          offset: 9,
          access: 0,
          closeOnExec: true,
        },
        { kind: "synthetic-empty-pipe", readFd: 3, writeFd: 4, closeOnExec: false },
        { kind: "synthetic-empty-eventfd", fd: 5, closeOnExec: false },
        { kind: "synthetic-timerfd", fd: 6, closeOnExec: false },
      ],
    });

    const parsed = parseTargetGuestRestoreDescriptor(
      serializeTargetGuestRestoreDescriptor(original),
    );

    expect(parsed).toEqual(original);
    expect(buildNativeActualResumeTrampolineArgs(parsed)).toEqual([
      "--code-file",
      "/tmp/machinen-target-bytes.bin",
      "--file-offset",
      "0",
      "--code-size",
      "16",
      "--target-address",
      "0x700300000000",
      "--state-report-address",
      "0x600000000000",
      "--translated-return-address",
      "0x700300000080",
      "--resume-mode",
      "translated-frame",
      "--resume-rflags",
      "0x8d7",
      "--resume-register-rax",
      "0x2121212121212121",
      "--resume-register-rdi",
      "0x7171717171717171",
      "--resume-register-rsi",
      "0x6161616161616161",
      "--resume-register-rdx",
      "0x6262626262626262",
      "--resume-register-rcx",
      "0x6363636363636363",
      "--resume-register-r8",
      "0x8888888888888888",
      "--resume-register-r9",
      "0x9999999999999999",
      "--resume-register-r10",
      "0x1010101010101010",
      "--resume-register-r11",
      "0x1111111111111111",
      "--timeout-seconds",
      "5",
      "--stack-target-start",
      "0x500000000000",
      "--stack-size",
      "65536",
      "--stack-pointer",
      "0x500000010000",
      "--translated-frame-pointer",
      "0x50000000ff80",
      "--translated-frame-cfa",
      "0x50000000fff0",
      "--translated-frame-return-address-slot",
      "0x50000000fff0",
      "--translated-frame-return-address",
      "0x700300000080",
      "--translated-frame-unwind-id",
      "target:realspin-final-jump",
      "--translated-frame-callee-rbx",
      "0x1111111122222222",
      "--translated-frame-callee-r12",
      "0x1234567890abcdef",
      "--translated-frame-callee-r13",
      "0x1313131313131313",
      "--translated-frame-callee-r14",
      "0x1414141414141414",
      "--translated-frame-callee-r15",
      "0x1515151515151515",
      "--translated-frame-slot",
      "0:0x4652414d45504153:non-pointer-data",
      "--translated-frame-slot",
      "8:0x535441434b534c54:non-pointer-data",
      "--set-cloexec-fd",
      "7",
      "--synthetic-empty-pipe-read-fd",
      "3",
      "--synthetic-empty-pipe-write-fd",
      "4",
      "--synthetic-empty-eventfd",
      "5",
      "--synthetic-timerfd",
      "6",
    ]);
  });

  it("serializes memory materialization entries into trampoline args", () => {
    const parsed = parseTargetGuestRestoreDescriptor(
      serializeTargetGuestRestoreDescriptor(
        descriptor({
          memory: [
            {
              kind: "copy-captured-bytes",
              mapping: "heap",
              targetStart: "0x600000000000",
              sizeBytes: 4096,
              permissions: "rw-p",
              sourceFile: "/tmp/native-memory.bin",
              sourceOffset: 8192,
              provenance: "native-process-image",
            },
            {
              kind: "recreate-guard",
              mapping: "guard",
              targetStart: "0x600000001000",
              sizeBytes: 4096,
              permissions: "---p",
              provenance: "guard-protection",
            },
          ],
        }),
      ),
    );

    expect(buildNativeActualResumeTrampolineArgs(parsed)).toContain(
      "/tmp/native-memory.bin:8192:0x600000000000:4096:rw-p",
    );
    expect(buildNativeActualResumeTrampolineArgs(parsed)).toContain("0x600000001000:4096");
  });

  it("builds the in-guest loader argv", () => {
    expect(buildTargetGuestRestoreLoaderArgv("/bundle/restore.desc", "/loader/trampoline")).toEqual(
      ["--descriptor", "/bundle/restore.desc", "--trampoline", "/loader/trampoline"],
    );
  });

  it("refuses unsupported target guest architectures", () => {
    const unsafe = descriptor() as unknown as TargetGuestRestoreDescriptor;
    unsafe.targetArch = "arm64" as "amd64";

    expect(() => validateTargetGuestRestoreDescriptor(unsafe)).toThrow(
      new TargetGuestRestoreLoaderValidationError(
        "target-guest-loader-target-arch-unsupported",
        "target guest loader requires amd64",
      ),
    );
  });

  it("refuses unsupported resource recipes before trampoline args are built", () => {
    expect(() =>
      parseTargetGuestRestoreDescriptor(
        `${serializeTargetGuestRestoreDescriptor(descriptor())}resource=socketpair fd=3\n`,
      ),
    ).toThrow(/unsupported resource recipe/);
  });

  it("refuses invalid fd recipes", () => {
    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({ resources: [{ kind: "synthetic-empty-eventfd", fd: 2048 }] }),
      ),
    ).toThrow(/fd in \[0, 1024\]/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({ resources: [{ kind: "synthetic-empty-pipe", readFd: 4, writeFd: 4 }] }),
      ),
    ).toThrow(/pipe read\/write fds must differ/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          resources: [
            { kind: "reopen-file", fd: 3, path: "/tmp/data.txt", offset: 0, access: 0 },
            { kind: "synthetic-empty-eventfd", fd: 3 },
          ],
        }),
      ),
    ).toThrow(/fd 3 is assigned/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({ resources: [{ kind: "inherit-stdio", fd: 1, stream: "stderr" }] }),
      ),
    ).toThrow(/stdio fd and stream do not match/);
  });

  it("refuses invalid translated frame descriptors", () => {
    expect(() => validateTargetGuestRestoreDescriptor(descriptor({ translatedFrame }))).toThrow(
      /translated frame requires a return address/,
    );

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, resumeMode: "translated-frame" },
        }),
      ),
    ).toThrow(/translated resume mode requires a frame/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            translatedReturnAddress: "0x700300000081",
          },
          translatedFrame,
        }),
      ),
    ).toThrow(/frame return address is unresolved/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            translatedReturnAddress: "0x700300000080",
          },
          translatedFrame: {
            ...translatedFrame,
            calleeSaved: translatedFrame.calleeSaved.slice(1),
          },
        }),
      ),
    ).toThrow(/register bank is incomplete/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            translatedReturnAddress: "0x700300000080",
          },
          translatedFrame: {
            ...translatedFrame,
            calleeSaved: [translatedFrame.calleeSaved[0]!, translatedFrame.calleeSaved[0]!],
          },
        }),
      ),
    ).toThrow(/duplicate translated frame register/);

    expect(() =>
      parseTargetGuestRestoreDescriptor(
        serializeTargetGuestRestoreDescriptor(
          descriptor({
            continuation: {
              ...descriptor().continuation,
              translatedReturnAddress: "0x700300000080",
            },
            translatedFrame,
          }),
        ).replace(" slot0Offset=", " calleeSavedR12=0x1 slot0Offset="),
      ),
    ).toThrow(/duplicate translated frame field/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            translatedReturnAddress: "0x700300000080",
          },
          translatedFrame: {
            ...translatedFrame,
            slots: [
              { ...translatedFrame.slots[0]!, offset: 0 },
              { ...translatedFrame.slots[1]!, offset: 0 },
            ],
          },
        }),
      ),
    ).toThrow(/duplicate translated frame slot offset/);

    expect(() =>
      parseTargetGuestRestoreDescriptor(
        serializeTargetGuestRestoreDescriptor(
          descriptor({
            continuation: {
              ...descriptor().continuation,
              translatedReturnAddress: "0x700300000080",
            },
            translatedFrame,
          }),
        )
          .replace(" slot1Offset=", " slot2Offset=")
          .replace(" slot1Value=", " slot2Value=")
          .replace(" slot1Class=", " slot2Class="),
      ),
    ).toThrow(/translated frame slots must be dense/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            translatedReturnAddress: "0x700300000080",
          },
          translatedFrame: {
            ...translatedFrame,
            slots: [{ ...translatedFrame.slots[0]!, classification: "pointer" as never }],
          },
        }),
      ),
    ).toThrow(/pointer-bearing frame slots are unsupported/);
  });

  it("refuses invalid continuation addresses", () => {
    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, targetAddress: "700300000000" },
        }),
      ),
    ).toThrow(/targetAddress must be a hex address/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, argument0: "600000000000" },
        }),
      ),
    ).toThrow(/argument0 must be a hex address/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, stateReportAddress: "600000000000" },
        }),
      ),
    ).toThrow(/stateReportAddress must be a hex address/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            translatedReturnAddress: "700300000080",
          },
        }),
      ),
    ).toThrow(/translatedReturnAddress must be a hex address/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            resumeRegisters: { ...resumeRegisters, r10: "1010101010101010" },
          },
        }),
      ),
    ).toThrow(/r10 must be a hex address/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, resumeRflags: "8d7" },
        }),
      ),
    ).toThrow(/resumeRflags must be a hex address/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, resumeRflags: "0x8d5" },
        }),
      ),
    ).toThrow(/resumeRflags must include reserved bit 1/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, resumeRflags: "0x402" },
        }),
      ),
    ).toThrow(/unsupported non-condition bits/);

    expect(() =>
      parseTargetGuestRestoreDescriptor(
        `${serializeTargetGuestRestoreDescriptor(descriptor())}resumeRegisterRax=0x1\n`,
      ),
    ).toThrow(/resume register bank is incomplete/);

    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: {
            ...descriptor().continuation,
            argument0: "0x600000000000",
            resumeRegisters,
          },
        }),
      ),
    ).toThrow(/argument0 cannot be combined with a resume register bank/);
  });

  it.skipIf(!HAS_CC)(
    "asset loader reopens file resources and forwards close-on-exec intent",
    () => {
      const outDir = mkdtempSync(join(tmpdir(), "target-guest-restore-loader-fd-test-"));
      const loader = join(outDir, "machinen-target-guest-restore-loader");
      const compileLoader = spawnSync(
        "cc",
        ["-Wall", "-Wextra", "-Werror", LOADER_SOURCE, "-o", loader],
        { encoding: "utf8" },
      );
      expect(compileLoader.status, compileLoader.stderr).toBe(0);

      const checkerSource = join(outDir, "fd-checker.c");
      const checker = join(outDir, "fd-checker");
      writeFileSync(
        checkerSource,
        `#include <string.h>\n#include <unistd.h>\n#include <stdio.h>\nint main(int argc, char **argv) {\n  char buf[3] = {0};\n  int saw_cloexec = 0;\n  int saw_state_report = 0;\n  int saw_translated_return = 0;\n  int saw_frame = 0;\n  int saw_register_bank = 0;\n  int saw_resume_register = 0;\n  int saw_resume_rflags = 0;\n  int saw_resume_mode = 0;\n  for (int i = 1; i + 1 < argc; i++) {\n    if (strcmp(argv[i], "--set-cloexec-fd") == 0 && strcmp(argv[i + 1], "7") == 0) saw_cloexec = 1;\n    if (strcmp(argv[i], "--state-report-address") == 0 && strcmp(argv[i + 1], "0x600000000000") == 0) saw_state_report = 1;\n    if (strcmp(argv[i], "--translated-return-address") == 0 && strcmp(argv[i + 1], "0x700300000080") == 0) saw_translated_return = 1;\n    if (strcmp(argv[i], "--translated-frame-pointer") == 0 && strcmp(argv[i + 1], "0x50000000ff80") == 0) saw_frame = 1;\n    if (strcmp(argv[i], "--translated-frame-callee-r15") == 0 && strcmp(argv[i + 1], "0x1515151515151515") == 0) saw_register_bank = 1;\n    if (strcmp(argv[i], "--resume-register-rdi") == 0 && strcmp(argv[i + 1], "0x7171717171717171") == 0) saw_resume_register = 1;\n    if (strcmp(argv[i], "--resume-rflags") == 0 && strcmp(argv[i + 1], "0x8d7") == 0) saw_resume_rflags = 1;\n    if (strcmp(argv[i], "--resume-mode") == 0 && strcmp(argv[i + 1], "translated-frame") == 0) saw_resume_mode = 1;\n  }\n  if (read(7, buf, 2) != 2) return 41;\n  if (strcmp(buf, "cd") != 0) return 42;\n  if (!saw_cloexec) return 43;\n  if (!saw_state_report) return 44;\n  if (!saw_translated_return) return 45;\n  if (!saw_frame) return 46;\n  if (!saw_register_bank) return 47;\n  if (!saw_resume_register) return 48;\n  if (!saw_resume_rflags) return 49;\n  if (!saw_resume_mode) return 50;\n  printf("fd-check:%s\\n", buf);\n  return 0;\n}\n`,
      );
      const compileChecker = spawnSync(
        "cc",
        ["-Wall", "-Wextra", "-Werror", checkerSource, "-o", checker],
        {
          encoding: "utf8",
        },
      );
      expect(compileChecker.status, compileChecker.stderr).toBe(0);

      const dataFile = join(outDir, "data.txt");
      writeFileSync(dataFile, "abcdef");
      const descriptorPath = join(outDir, "file.desc");
      writeFileSync(
        descriptorPath,
        serializeTargetGuestRestoreDescriptor(
          descriptor({
            continuation: {
              ...descriptor().continuation,
              stateReportAddress: "0x600000000000",
              translatedReturnAddress: "0x700300000080",
              resumeMode: "translated-frame",
              resumeRflags: "0x8d7",
              resumeRegisters,
            },
            translatedFrame,
            resources: [
              {
                kind: "reopen-file",
                fd: 7,
                path: dataFile,
                offset: 2,
                access: 0,
                closeOnExec: true,
              },
            ],
          }),
        ),
      );

      const result = spawnSync(loader, ["--descriptor", descriptorPath, "--trampoline", checker], {
        encoding: "utf8",
      });

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toContain("fd-check:cd");
      expect(result.stdout).toContain(`${LOADER_PREFIX}{"status":"completed","exitCode":0}`);
    },
  );

  it.skipIf(!HAS_CC)("asset loader reports completed and refused descriptors", () => {
    const outDir = mkdtempSync(join(tmpdir(), "target-guest-restore-loader-test-"));
    const loader = join(outDir, "machinen-target-guest-restore-loader");
    const compile = spawnSync("cc", ["-Wall", "-Wextra", "-Werror", LOADER_SOURCE, "-o", loader], {
      encoding: "utf8",
    });
    expect(compile.status, compile.stderr).toBe(0);

    const validDescriptor = join(outDir, "valid.desc");
    writeFileSync(validDescriptor, serializeTargetGuestRestoreDescriptor(descriptor()));
    const completed = spawnSync(
      loader,
      ["--descriptor", validDescriptor, "--trampoline", "/usr/bin/true"],
      { encoding: "utf8" },
    );
    expect(completed.status, completed.stderr).toBe(0);
    expect(completed.stdout).toContain(`${LOADER_PREFIX}{"status":"completed","exitCode":0}`);

    const refusedDescriptor = join(outDir, "refused.desc");
    writeFileSync(
      refusedDescriptor,
      `${serializeTargetGuestRestoreDescriptor(descriptor())}resource=socket fd=3\n`,
    );
    const refused = spawnSync(
      loader,
      ["--descriptor", refusedDescriptor, "--trampoline", "/usr/bin/true"],
      {
        encoding: "utf8",
      },
    );
    expect(refused.status).toBe(2);
    expect(refused.stdout).toContain("target-guest-loader-resource-unsupported");
  });

  it.skipIf(!HAS_CC)("asset loader fail-closes negative descriptor/resource cases", () => {
    const outDir = mkdtempSync(join(tmpdir(), "target-guest-restore-loader-negative-test-"));
    const loader = join(outDir, "machinen-target-guest-restore-loader");
    const compile = spawnSync("cc", ["-Wall", "-Wextra", "-Werror", LOADER_SOURCE, "-o", loader], {
      encoding: "utf8",
    });
    expect(compile.status, compile.stderr).toBe(0);

    const wrongArch = join(outDir, "wrong-arch.desc");
    writeFileSync(
      wrongArch,
      serializeTargetGuestRestoreDescriptor(descriptor()).replace(
        "targetArch=amd64",
        "targetArch=arm64",
      ),
    );
    const wrongArchRun = spawnSync(
      loader,
      ["--descriptor", wrongArch, "--trampoline", "/usr/bin/true"],
      { encoding: "utf8" },
    );
    expect(wrongArchRun.status).toBe(2);
    expect(wrongArchRun.stdout).toContain("target-guest-loader-target-arch-unsupported");

    const missingContinuation = join(outDir, "missing-continuation.desc");
    writeFileSync(
      missingContinuation,
      serializeTargetGuestRestoreDescriptor(descriptor()).replace(/^codeFile=.*\n/m, ""),
    );
    const missingContinuationRun = spawnSync(
      loader,
      ["--descriptor", missingContinuation, "--trampoline", "/usr/bin/true"],
      { encoding: "utf8" },
    );
    expect(missingContinuationRun.status).toBe(2);
    expect(missingContinuationRun.stdout).toContain("target-guest-loader-descriptor-invalid");

    const badFdPath = join(outDir, "bad-fd-path.desc");
    writeFileSync(
      badFdPath,
      serializeTargetGuestRestoreDescriptor(
        descriptor({
          resources: [
            {
              kind: "reopen-file",
              fd: 7,
              path: join(outDir, "missing-fd-resource.txt"),
              offset: 0,
              access: 0,
            },
          ],
        }),
      ),
    );
    const badFdPathRun = spawnSync(
      loader,
      ["--descriptor", badFdPath, "--trampoline", "/usr/bin/true"],
      { encoding: "utf8" },
    );
    expect(badFdPathRun.status).toBe(126);
    expect(badFdPathRun.stderr).toContain("open resource");
    expect(badFdPathRun.stdout).toContain(`${LOADER_PREFIX}{"status":"completed","exitCode":126}`);

    const memoryCheckerSource = join(outDir, "memory-checker.c");
    const memoryChecker = join(outDir, "memory-checker");
    writeFileSync(
      memoryCheckerSource,
      `#include <string.h>\n#include <unistd.h>\nint main(int argc, char **argv) {\n  for (int i = 1; i + 1 < argc; i++) {\n    if (strcmp(argv[i], "--materialize-memory") == 0) {\n      char *colon = strchr(argv[i + 1], ':');\n      if (colon) *colon = '\\0';\n      return access(argv[i + 1], R_OK) == 0 ? 45 : 44;\n    }\n  }\n  return 43;\n}\n`,
    );
    const compileChecker = spawnSync(
      "cc",
      ["-Wall", "-Wextra", "-Werror", memoryCheckerSource, "-o", memoryChecker],
      { encoding: "utf8" },
    );
    expect(compileChecker.status, compileChecker.stderr).toBe(0);

    const missingMemory = join(outDir, "missing-memory.desc");
    writeFileSync(
      missingMemory,
      serializeTargetGuestRestoreDescriptor(
        descriptor({
          memory: [
            {
              kind: "copy-captured-bytes",
              mapping: "heap",
              targetStart: "0x600000000000",
              sizeBytes: 4096,
              permissions: "rw-p",
              sourceFile: join(outDir, "missing-native-memory.bin"),
              sourceOffset: 0,
              provenance: "native-process-image",
            },
          ],
        }),
      ),
    );
    const missingMemoryRun = spawnSync(
      loader,
      ["--descriptor", missingMemory, "--trampoline", memoryChecker],
      { encoding: "utf8" },
    );
    expect(missingMemoryRun.status).toBe(44);
    expect(missingMemoryRun.stdout).toContain(
      `${LOADER_PREFIX}{"status":"completed","exitCode":44}`,
    );
  });
});
