import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { resolveBaseDtb, resolveBaseKernel } from "../base-assets.ts";
import { BootError } from "../errors.ts";
import { planBootKernelDtbNative } from "../native/boot-plan.ts";
import type { BootOptions } from "./boot.ts";

export function setupKernelDtbEnv(opts: BootOptions, env: Record<string, string>): void {
  const cwd = opts.cwd ?? process.cwd();
  const resolveDefaults = shouldResolveDefaultBootAssets(opts);
  const kernelInput =
    opts.kernel ?? (resolveDefaults ? resolveBaseKernel(undefined, cwd) : undefined);
  const dtbInput = opts.dtb ?? (resolveDefaults ? resolveBaseDtb(undefined, cwd) : undefined);
  const kernelPath = resolveOptionalBootPath(
    kernelInput,
    opts.cwd,
    "BOOT_KERNEL_NOT_FOUND",
    "kernel",
  );
  const dtbPath = resolveOptionalBootPath(dtbInput, opts.cwd, "BOOT_DTB_NOT_FOUND", "dtb");
  const plan = planBootKernelDtbNative({ kernelPath, dtbPath });
  if (plan.kernelPath) {
    env.MACHINEN_KERNEL = plan.kernelPath;
  }
  if (plan.dtbPath) {
    env.MACHINEN_DTB = plan.dtbPath;
  }
}

function shouldResolveDefaultBootAssets(opts: BootOptions): boolean {
  return opts.binary === undefined;
}

function resolveOptionalBootPath(
  input: string | undefined,
  cwd: string | undefined,
  code: "BOOT_KERNEL_NOT_FOUND" | "BOOT_DTB_NOT_FOUND",
  label: "kernel" | "dtb",
): string | undefined {
  if (!input) {
    return undefined;
  }
  const abs = resolve(cwd ?? process.cwd(), input);
  if (!existsSync(abs)) {
    throw new BootError(code, `${label} not found: ${abs}`);
  }
  return abs;
}
