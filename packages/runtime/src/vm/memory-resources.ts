import type { BootCpuResourceOptions } from "./cpu-resources.ts";
import { planBootCoreNative } from "../native/boot-plan.ts";
import { autoSizeMemoryMib } from "./helpers.ts";

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

export function resolveMemoryCeilingMib(
  opts: { memory?: number; resources?: BootResourcesOptions },
  autoSize: () => number = autoSizeMemoryMib,
): number {
  const hasExplicit = opts.memory !== undefined || opts.resources?.memory !== undefined;
  const plan = planBootCoreNative({
    memoryMib: opts.memory,
    resourcesMemory: opts.resources?.memory,
    autoMemoryMib: !hasExplicit && autoSize !== autoSizeMemoryMib ? autoSize() : undefined,
    vmmMemoryPreset: false,
    hasImage: false,
    hasCmd: false,
    rootDisk: "false",
  });
  if (plan.memoryCeilingMib === null) {
    throw new Error("boot: native memory planner returned no ceiling");
  }
  return plan.memoryCeilingMib;
}
