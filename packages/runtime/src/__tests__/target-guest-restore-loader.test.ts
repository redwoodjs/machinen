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
      "--timeout-seconds",
      "5",
      "--stack-target-start",
      "0x500000000000",
      "--stack-size",
      "65536",
      "--stack-pointer",
      "0x500000010000",
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

  it("refuses invalid continuation addresses", () => {
    expect(() =>
      validateTargetGuestRestoreDescriptor(
        descriptor({
          continuation: { ...descriptor().continuation, targetAddress: "700300000000" },
        }),
      ),
    ).toThrow(/targetAddress must be a hex address/);
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
        `#include <string.h>\n#include <unistd.h>\n#include <stdio.h>\nint main(int argc, char **argv) {\n  char buf[3] = {0};\n  int saw_cloexec = 0;\n  for (int i = 1; i + 1 < argc; i++) {\n    if (strcmp(argv[i], "--set-cloexec-fd") == 0 && strcmp(argv[i + 1], "7") == 0) saw_cloexec = 1;\n  }\n  if (read(7, buf, 2) != 2) return 41;\n  if (strcmp(buf, "cd") != 0) return 42;\n  if (!saw_cloexec) return 43;\n  printf("fd-check:%s\\n", buf);\n  return 0;\n}\n`,
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
});
