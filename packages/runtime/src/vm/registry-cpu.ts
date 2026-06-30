import type { CpuControlResult } from "../cpu-cgroup.ts";
import { planBootRegistryCpuNative } from "../native/boot-plan.ts";
import type { RegistryEntry } from "../registry.ts";
import type { ResolvedCpuResourcePolicy } from "./cpu-resources.ts";

type CpuRegistryEntry = NonNullable<RegistryEntry["cpu"]>;

export function registryCpu(
  policy: ResolvedCpuResourcePolicy | undefined,
  control: CpuControlResult,
): CpuRegistryEntry | undefined {
  return planBootRegistryCpuNative({ policy, control });
}
