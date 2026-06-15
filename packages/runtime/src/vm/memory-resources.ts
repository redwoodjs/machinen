import { BootError } from "../errors.ts";
import type { BootCpuResourceOptions } from "./cpu-resources.ts";
import { autoSizeMemoryMib, validateMemoryMib } from "./helpers.ts";

export interface BootResourcesOptions {
  /**
   * Goal-driven memory policy: a fixed guest-visible ceiling whose host
   * footprint grows on touched pages and shrinks through balloon free-
   * page reporting.
   */
  memory?: BootMemoryResourceOptions;
  /**
   * Goal-driven CPU policy: guest-visible vCPU count, host CPU quota,
   * and relative fairness weight.
   */
  cpu?: BootCpuResourceOptions;
}

export interface BootMemoryResourceOptions {
  /** Guest-visible RAM ceiling in MiB. */
  maxMib: number;
  /**
   * Reclaim policy for guest-free pages. `auto` uses the always-present
   * virtio-balloon free-page-reporting path.
   */
  reclaim?: "auto";
}

type MemoryCeilingInput = {
  memory?: number;
  resources?: BootResourcesOptions;
};

export function resolveMemoryCeilingMib(
  opts: { memory?: number; resources?: BootResourcesOptions },
  autoSize: () => number = autoSizeMemoryMib,
): number {
  return resolveExplicitMemoryCeilingMib(opts) ?? autoSize();
}

export function resolveExplicitMemoryCeilingMib(opts: MemoryCeilingInput): number | undefined {
  const aliasCeiling = opts.memory !== undefined ? validateMemoryMib(opts.memory) : undefined;
  const resourceCeiling = resolveResourceMemoryCeiling(opts.resources?.memory);
  if (
    aliasCeiling !== undefined &&
    resourceCeiling !== undefined &&
    aliasCeiling !== resourceCeiling
  ) {
    throw new BootError(
      "BOOT_MEMORY_INVALID",
      `boot: memory (${aliasCeiling} MiB) conflicts with resources.memory.maxMib (${resourceCeiling} MiB). Use one value.`,
    );
  }
  return resourceCeiling ?? aliasCeiling;
}

function resolveResourceMemoryCeiling(
  memory: BootMemoryResourceOptions | undefined,
): number | undefined {
  if (memory === undefined) {
    return undefined;
  }
  validateMemoryReclaim(memory.reclaim);
  return validateMemoryMib(memory.maxMib);
}

function validateMemoryReclaim(reclaim: BootMemoryResourceOptions["reclaim"] | undefined): void {
  if (reclaim === undefined || reclaim === "auto") {
    return;
  }
  throw new BootError(
    "BOOT_MEMORY_INVALID",
    `boot: resources.memory.reclaim must be "auto" when set (got ${JSON.stringify(reclaim)}).`,
  );
}
