import { planBootVirtiofsEnvNative } from "../native/boot-plan.ts";
import type { BootOptions } from "./boot.ts";
import { resolveLiveMounts, type ResolvedLiveMount } from "./bundle.ts";

export function setupLiveMountEnv(
  opts: BootOptions,
  env: Record<string, string>,
): ResolvedLiveMount[] {
  const liveMounts = opts.liveMounts ?? [];
  if (liveMounts.length === 0) {
    return [];
  }
  const resolved = resolveLiveMounts(liveMounts, opts.cwd);
  Object.assign(env, planBootVirtiofsEnvNative(resolved));
  return resolved;
}

export function buildMergedGuestEnv(
  opts: BootOptions,
  vsockUdsPath: string | undefined,
): Record<string, string> {
  const env = { ...opts.env };
  if (opts.name && env.MACHINEN_VM_NAME === undefined) {
    env.MACHINEN_VM_NAME = opts.name;
  }
  if (vsockUdsPath !== undefined && env.MACHINEN_VM_HOSTNAME_WAIT === undefined) {
    env.MACHINEN_VM_HOSTNAME_WAIT = "1";
  }
  return env;
}
