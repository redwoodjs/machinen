import { BootError, type ErrorCode, type MachinenErrorOptions } from "../errors.ts";
import { callRuntimeHelper } from "../native-helper.ts";
import type { BootMemoryResourceOptions } from "../vm/memory-resources.ts";

type RootDiskPlanMode = "unset" | "false" | "path" | "true";

export interface NativeBootPlanInput {
  memoryMib?: number;
  resourcesMemory?: BootMemoryResourceOptions;
  autoMemoryMib?: number;
  hostTotalBytes?: number;
  vmmMemoryPreset: boolean;
  hasImage: boolean;
  hasCmd: boolean;
  rootDisk: RootDiskPlanMode;
}

export interface NativeBootPlanResult {
  memoryCeilingMib: number | null;
  vmmMemory: string | null;
  wantsRootDisk: boolean;
}

export function planBootCoreNative(input: NativeBootPlanInput): NativeBootPlanResult {
  return callRuntimeHelper({
    command: "boot-plan",
    data: {
      memoryMib: numberText(input.memoryMib),
      resourcesMemory: input.resourcesMemory
        ? {
            maxMib: numberTextRequired(input.resourcesMemory.maxMib),
            reclaim: input.resourcesMemory.reclaim ?? null,
          }
        : null,
      autoMemoryMib: numberText(input.autoMemoryMib),
      hostTotalBytes: numberText(input.hostTotalBytes),
      vmmMemoryPreset: input.vmmMemoryPreset,
      hasImage: input.hasImage,
      hasCmd: input.hasCmd,
      rootDisk: input.rootDisk,
    },
    errorCode: "BOOT_MEMORY_INVALID",
    makeError: bootPlanError,
    isData: isNativeBootPlanResult,
  });
}

export function rootDiskPlanMode(rootDisk: boolean | string | undefined): RootDiskPlanMode {
  if (rootDisk === false) {
    return "false";
  }
  if (rootDisk === true) {
    return "true";
  }
  if (typeof rootDisk === "string") {
    return "path";
  }
  return "unset";
}

function bootPlanError(code: ErrorCode, message: string, opts?: MachinenErrorOptions): Error {
  return new BootError(code, message, opts);
}

function numberText(value: number | undefined): string | null {
  return value === undefined ? null : String(value);
}

function numberTextRequired(value: number): string {
  return String(value);
}

function isNativeBootPlanResult(value: unknown): value is NativeBootPlanResult {
  if (!value || typeof value !== "object") {
    return false;
  }
  const data = value as Partial<NativeBootPlanResult>;
  return (
    nullableNonNegativeNumber(data.memoryCeilingMib) &&
    (data.vmmMemory === null || typeof data.vmmMemory === "string") &&
    typeof data.wantsRootDisk === "boolean"
  );
}

function nullableNonNegativeNumber(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}
