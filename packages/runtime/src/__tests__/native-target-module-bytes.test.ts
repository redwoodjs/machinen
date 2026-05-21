import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { materializeNativeTargetModuleBytes } from "../native-target-module-bytes.ts";
import type { NativeRealUtilityTargetModule } from "../native-real-utility-code-map.ts";

const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function fixtureBytes() {
  const bytes = Buffer.alloc(0x3000, 0xcc);
  bytes.write("target-native-amd64-realspin", 0x1234, "utf8");
  return bytes;
}

function sha256(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function module(buildId: string): NativeRealUtilityTargetModule {
  return {
    id: "target:realspin",
    logicalName: "realspin",
    path: "/usr/bin/realspin",
    arch: "amd64",
    kind: "pie-executable",
    buildId,
    loadBias: "0x700000000000",
    textMapping: "target:mapping:realspin-text",
    executable: true,
    executableRanges: [{ relativeStart: "0x1000", relativeEnd: "0x2000" }],
  };
}

describe("native target module byte materialization", () => {
  it("materializes target-native bytes from an explicit target root", () => {
    const root = mkdtempSync(join(tmpdir(), "native-target-module-bytes-test-"));
    TMP.push(root);
    const bytes = fixtureBytes();
    const path = join(root, "usr/bin/realspin");
    mkdirSync(join(root, "usr/bin"), { recursive: true });
    writeFileSync(path, bytes, { flush: true });

    const result = materializeNativeTargetModuleBytes({
      module: module(sha256(bytes)),
      targetRoot: root,
      relativeStart: "0x1200",
      sizeBytes: 0x80,
    });

    expect(result.refusals).toEqual([]);
    expect(result.materialized).toMatchObject({
      moduleId: "target:realspin",
      path,
      relativeStart: "0x1200",
      relativeEnd: "0x1280",
      fileOffset: 0x1200,
      sizeBytes: 0x80,
      sourceTextReusedAsTargetCode: false,
    });
    expect(Buffer.from(result.materialized!.bytes).includes("target-native-amd64-realspin")).toBe(
      true,
    );
  });

  it("refuses missing files, build mismatches, unreadable ranges, and unmapped RVAs precisely", () => {
    const root = mkdtempSync(join(tmpdir(), "native-target-module-bytes-test-"));
    TMP.push(root);
    const bytes = fixtureBytes();
    const goodModule = module(sha256(bytes));
    writeFileSync(join(root, "realspin-flat"), bytes);

    expect(
      materializeNativeTargetModuleBytes({
        module: goodModule,
        targetRoot: root,
        relativeStart: "0x1200",
        sizeBytes: 0x80,
      }).refusals[0]?.code,
    ).toBe("target-module-file-missing");
    expect(
      materializeNativeTargetModuleBytes({
        module: { ...goodModule, path: "realspin-flat", buildId: "wrong" },
        targetRoot: root,
        relativeStart: "0x1200",
        sizeBytes: 0x80,
      }).refusals[0]?.code,
    ).toBe("target-build-id-mismatch");
    expect(
      materializeNativeTargetModuleBytes({
        module: { ...goodModule, path: "realspin-flat" },
        targetRoot: root,
        relativeStart: "0x1200",
        sizeBytes: 0x4000,
      }).refusals[0]?.code,
    ).toBe("target-code-rva-unmapped");
    expect(
      materializeNativeTargetModuleBytes({
        module: {
          ...goodModule,
          path: "realspin-flat",
          executableRanges: [{ relativeStart: "0x0", relativeEnd: "0x6000" }],
        },
        targetRoot: root,
        relativeStart: "0x1200",
        sizeBytes: 0x4000,
      }).refusals[0]?.code,
    ).toBe("target-module-range-unreadable");
  });
});
