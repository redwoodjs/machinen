import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { inventoryNativeActualTargetModules } from "../native-actual-target-module-inventory.ts";
import type { NativeRealUtilitySourceModule } from "../native-real-utility-code-map.ts";

const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function sourceModule(
  path: string,
  kind: NativeRealUtilitySourceModule["kind"] = "shared-object",
): NativeRealUtilitySourceModule {
  const id = `module:${basename(path)}`;
  return {
    id,
    logicalName: basename(path),
    path,
    arch: "arm64",
    kind,
    buildId: `source:${basename(path)}`,
    loadBias: "0x400000",
    textMapping: `mapping:${basename(path)}`,
    sourceStart: "0x400000",
    sourceEnd: "0x410000",
  };
}

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), "native-actual-target-modules-test-"));
  TMP.push(root);
  return root;
}

function writeTarget(root: string, path: string, bytes = `${path}:amd64-target`) {
  const resolved = join(root, path.startsWith("/") ? path.slice(1) : path);
  mkdirSync(dirname(resolved), { recursive: true });
  writeFileSync(resolved, bytes);
}

describe("native actual target module inventory", () => {
  it("does not invent target modules without an explicit root or module path", () => {
    const result = inventoryNativeActualTargetModules({
      sourceModules: [sourceModule("/usr/lib/aarch64-linux-gnu/libc.so.6")],
      targetArch: "amd64",
    });

    expect(result.targetModules).toEqual([]);
  });

  it("maps Debian multiarch source modules to an explicit amd64 target root", () => {
    const root = tempRoot();
    writeTarget(root, "/usr/bin/sleep");
    writeTarget(root, "/usr/lib/x86_64-linux-gnu/libc.so.6");
    writeTarget(root, "/lib64/ld-linux-x86-64.so.2");

    const result = inventoryNativeActualTargetModules({
      sourceModules: [
        sourceModule("/usr/bin/sleep", "pie-executable"),
        sourceModule("/usr/lib/aarch64-linux-gnu/libc.so.6"),
        sourceModule("/usr/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1"),
      ],
      targetArch: "amd64",
      targetRoot: root,
    });

    expect(result.targetModules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ logicalName: "sleep", path: "/usr/bin/sleep" }),
        expect.objectContaining({
          logicalName: "libc.so.6",
          path: "/usr/lib/x86_64-linux-gnu/libc.so.6",
          kind: "shared-object",
          arch: "amd64",
          executable: true,
        }),
        expect.objectContaining({
          logicalName: "ld-linux-x86-64.so.2",
          path: "/lib64/ld-linux-x86-64.so.2",
        }),
      ]),
    );
    expect(result.targetModules.map((module) => module.loadBias)).toEqual([
      "0x700000000000",
      "0x700100000000",
      "0x700200000000",
    ]);
    expect(
      result.targetModules.every(
        (module) =>
          module.buildId.length === 64 &&
          module.executableRanges?.[0]?.relativeStart === "0x0" &&
          /^0x[1-9a-f][0-9a-f]*$/.test(module.executableRanges[0].relativeEnd),
      ),
    ).toBe(true);
  });

  it("uses an explicit target executable path without mapping shared objects from the host", () => {
    const root = tempRoot();
    const explicitTarget = join(root, "target-sleep");
    writeFileSync(explicitTarget, "target executable");

    const result = inventoryNativeActualTargetModules({
      sourceModules: [
        sourceModule("/usr/bin/sleep", "pie-executable"),
        sourceModule("/usr/lib/aarch64-linux-gnu/libc.so.6"),
      ],
      targetArch: "amd64",
      explicitTargetModulePath: explicitTarget,
    });

    expect(result.targetModules).toHaveLength(1);
    expect(result.targetModules[0]).toMatchObject({
      logicalName: "target-sleep",
      path: explicitTarget,
      kind: "pie-executable",
    });
  });
});
