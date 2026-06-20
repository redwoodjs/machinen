import { spawnSync } from "node:child_process";
import { BootError } from "./errors.ts";
import {
  probeNestedVirtualizationNative,
  type NestedVirtProbeObservation,
} from "./native/nested-virt.ts";

const UNSUPPORTED_MESSAGE =
  "nested virtualization needs Linux/arm64 KVM with EL2 support, or macOS 15+ on M3/M4-class Apple Silicon";

export interface NestedVirtProbeHost {
  platform: NodeJS.Platform;
  arch: NodeJS.Architecture;
  existsSync(path: string): boolean;
  readText(path: string): string;
  execFileSync(file: string, args: string[]): string;
}

export interface NestedVirtProbeResult {
  supported: boolean;
  reason?: string;
}

export function probeNestedVirtualization(host?: NestedVirtProbeHost): NestedVirtProbeResult {
  return probeNestedVirtualizationNative(host ? observeNestedVirtHost(host) : undefined);
}

function observeNestedVirtHost(host: NestedVirtProbeHost): NestedVirtProbeObservation {
  const observed: NestedVirtProbeObservation = {
    platform: host.platform,
    arch: host.arch,
  };
  if (host.platform === "linux") {
    observed.linuxDevKvm = safeExists(host, "/dev/kvm");
    observed.linuxKvmNested = readIfPresent(host, "/sys/module/kvm/parameters/nested");
    observed.linuxKvmArmNested = readIfPresent(host, "/sys/module/kvm_arm/parameters/nested");
  } else if (host.platform === "darwin") {
    observed.darwinHvSupport = sysctl(host, "kern.hv_support") ?? null;
    observed.darwinProductVersion = swVersProductVersion(host) ?? null;
    observed.darwinCpuBrand = sysctl(host, "machdep.cpu.brand_string") ?? null;
  }
  return observed;
}

function safeExists(host: NestedVirtProbeHost, path: string): boolean {
  try {
    return host.existsSync(path);
  } catch {
    return false;
  }
}

function readIfPresent(host: NestedVirtProbeHost, path: string): string | null {
  if (!safeExists(host, path)) {
    return null;
  }
  try {
    return host.readText(path);
  } catch {
    return null;
  }
}

function sysctl(host: NestedVirtProbeHost, name: string): string | undefined {
  try {
    return host.execFileSync("/usr/sbin/sysctl", ["-n", name]).trim();
  } catch {
    try {
      return host.execFileSync("sysctl", ["-n", name]).trim();
    } catch {
      return undefined;
    }
  }
}

function swVersProductVersion(host: NestedVirtProbeHost): string | undefined {
  try {
    return host.execFileSync("/usr/bin/sw_vers", ["-productVersion"]).trim();
  } catch {
    try {
      return host.execFileSync("sw_vers", ["-productVersion"]).trim();
    } catch {
      return undefined;
    }
  }
}

export function preflightNestedVirtualization(host?: NestedVirtProbeHost): void {
  const result = probeNestedVirtualization(host);
  if (!result.supported) {
    throw new BootError("BOOT_NESTED_VIRT_UNSUPPORTED", result.reason ?? UNSUPPORTED_MESSAGE);
  }
}

export function probeVmmNestedVirtualization(
  binary: string,
  cwd: string | undefined,
  env: Record<string, string>,
): void {
  const result = spawnSync(binary, [], {
    cwd,
    env: { ...env, MACHINEN_NESTED_PROBE: "1" },
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.error) {
    throw new BootError(
      "BOOT_NESTED_VIRT_UNSUPPORTED",
      `${UNSUPPORTED_MESSAGE}; VMM nested probe failed to start: ${result.error.message}`,
      { cause: result.error },
    );
  }
  if (result.status !== 0 || !output.includes("nested virtualization supported")) {
    const detail =
      output.trim() || `VMM nested probe exited ${result.status ?? "without a status"}`;
    throw new BootError("BOOT_NESTED_VIRT_UNSUPPORTED", `${UNSUPPORTED_MESSAGE}; ${detail}`);
  }
}

export function applyNestedVirtualizationEnv(
  nested: boolean | undefined,
  env: Record<string, string>,
): void {
  if (nested) {
    env.MACHINEN_NESTED = "1";
  }
}
