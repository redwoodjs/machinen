import type { CpuControlResult } from "../cpu-cgroup.ts";
import type { RegistryEntry } from "../registry.ts";
import type { ResolvedCpuResourcePolicy } from "./cpu-resources.ts";

type CpuRegistryEntry = NonNullable<RegistryEntry["cpu"]>;

export function registryCpu(
  policy: ResolvedCpuResourcePolicy | undefined,
  control: CpuControlResult,
): CpuRegistryEntry | undefined {
  if (!policy) {
    return undefined;
  }
  return {
    maxVcpus: policy.maxVcpus,
    quotaCpus: policy.quotaCpus,
    weight: policy.weight,
    enforcement: {
      status: control.status,
      reason: control.reason,
    },
  };
}
