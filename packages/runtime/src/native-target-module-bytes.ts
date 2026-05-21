/** Target-native module byte materialization for real utility continuation. */

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { NativeProcessImageRefusal } from "./native-process-image.ts";
import type { NativeRealUtilityTargetModule } from "./native-real-utility-code-map.ts";

export interface NativeTargetModuleByteMaterializationRequest {
  module: NativeRealUtilityTargetModule;
  targetRoot?: string;
  relativeStart: string;
  sizeBytes: number;
  fileOffset?: number;
  expectedBuildId?: string;
}

export interface NativeTargetModuleByteMaterialization {
  moduleId: string;
  path: string;
  buildId: string;
  relativeStart: string;
  relativeEnd: string;
  fileOffset: number;
  sizeBytes: number;
  bytes: Uint8Array;
  sourceTextReusedAsTargetCode: false;
}

export interface NativeTargetModuleByteMaterializationResult {
  materialized?: NativeTargetModuleByteMaterialization;
  refusals: NativeProcessImageRefusal[];
}

export function materializeNativeTargetModuleBytes(
  request: NativeTargetModuleByteMaterializationRequest,
): NativeTargetModuleByteMaterializationResult {
  const rva = BigInt(request.relativeStart);
  const rvaEnd = rva + BigInt(request.sizeBytes);
  const rangeRefusal = validateExecutableRange(request.module, rva, rvaEnd);
  if (rangeRefusal) {
    return { refusals: [rangeRefusal] };
  }

  const path = resolveTargetPath(request.targetRoot, request.module.path);
  if (!existsSync(path)) {
    return {
      refusals: [
        refusal("target-module-file-missing", `target module file is missing: ${path}`, {
          path,
          module: request.module.id,
        }),
      ],
    };
  }

  const file = readFileSync(path);
  const buildId = sha256(file);
  const expectedBuildId = request.expectedBuildId ?? request.module.buildId;
  if (normalizeBuildId(buildId) !== normalizeBuildId(expectedBuildId)) {
    return {
      refusals: [
        refusal(
          "target-build-id-mismatch",
          `target module ${request.module.logicalName} build ${buildId} does not match expected ${expectedBuildId}`,
          { path, targetBuildId: buildId, expectedTargetBuildId: expectedBuildId },
        ),
      ],
    };
  }

  const fileOffset = request.fileOffset ?? Number(rva);
  const bytesRefusal = validateFileRange(path, file.byteLength, fileOffset, request.sizeBytes);
  if (bytesRefusal) {
    return { refusals: [bytesRefusal] };
  }

  return {
    materialized: {
      moduleId: request.module.id,
      path,
      buildId,
      relativeStart: hex(rva),
      relativeEnd: hex(rvaEnd),
      fileOffset,
      sizeBytes: request.sizeBytes,
      bytes: file.subarray(fileOffset, fileOffset + request.sizeBytes),
      sourceTextReusedAsTargetCode: false,
    },
    refusals: [],
  };
}

function validateExecutableRange(
  module: NativeRealUtilityTargetModule,
  start: bigint,
  end: bigint,
): NativeProcessImageRefusal | undefined {
  const ranges = module.executableRanges ?? [];
  const mapped = ranges.some(
    (range) => start >= BigInt(range.relativeStart) && end <= BigInt(range.relativeEnd),
  );
  if (mapped) {
    return undefined;
  }
  return refusal(
    "target-code-rva-unmapped",
    `target module ${module.logicalName} does not map RVA ${hex(start)}..${hex(end)} as executable code`,
    { module: module.id, relativeStart: hex(start), relativeEnd: hex(end) },
  );
}

function validateFileRange(
  path: string,
  fileSizeBytes: number,
  fileOffset: number,
  sizeBytes: number,
): NativeProcessImageRefusal | undefined {
  const end = fileOffset + sizeBytes;
  if (fileOffset >= 0 && sizeBytes > 0 && end <= fileSizeBytes) {
    return undefined;
  }
  return refusal(
    "target-module-range-unreadable",
    `target module range ${fileOffset}..${end} is outside ${path}`,
    { path, fileOffset, sizeBytes, fileSizeBytes },
  );
}

function resolveTargetPath(targetRoot: string | undefined, modulePath: string): string {
  if (!targetRoot) {
    return modulePath;
  }
  if (isAbsolute(modulePath)) {
    return join(targetRoot, modulePath.slice(1));
  }
  return join(targetRoot, modulePath);
}

function refusal(
  code: NativeProcessImageRefusal["code"],
  message: string,
  detail?: Record<string, unknown>,
): NativeProcessImageRefusal {
  return detail ? { code, message, detail } : { code, message };
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function normalizeBuildId(value: string): string {
  return value.toLowerCase();
}

function hex(value: bigint): string {
  return `0x${value.toString(16)}`;
}
