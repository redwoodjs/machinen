import { execFileSync as nodeExecFileSync, spawnSync } from "node:child_process";
import { existsSync as nodeExistsSync, readFileSync as nodeReadFileSync } from "node:fs";
import { BootError } from "./errors.ts";

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

function defaultProbeHost(): NestedVirtProbeHost {
  return {
    platform: process.platform,
    arch: process.arch,
    existsSync: nodeExistsSync,
    readText: (path) => nodeReadFileSync(path, "utf8"),
    execFileSync: (file, args) => nodeExecFileSync(file, args, { encoding: "utf8" }),
  };
}

function unsupported(reason: string): NestedVirtProbeResult {
  return { supported: false, reason };
}

function trimLower(value: string): string {
  return value.trim().toLowerCase();
}

function isDisabledKernelToggle(value: string): boolean {
  const v = trimLower(value);
  return v === "0" || v === "n" || v === "no" || v === "false" || v === "off";
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

function darwinMajor(version: string | undefined): number | undefined {
  const first = version?.split(".")[0];
  if (!first || !/^[0-9]+$/.test(first)) {
    return undefined;
  }
  return Number(first);
}

function appleSiliconGeneration(brand: string | undefined): number | undefined {
  const m = brand?.match(/\bApple\s+M(\d+)\b/i);
  return m ? Number(m[1]) : undefined;
}

export function probeNestedVirtualization(host = defaultProbeHost()): NestedVirtProbeResult {
  if (host.arch !== "arm64") {
    return unsupported(`${UNSUPPORTED_MESSAGE}; this host is ${host.arch}, not arm64`);
  }
  if (host.platform === "linux") {
    return probeLinuxNestedVirtualization(host);
  }
  if (host.platform === "darwin") {
    return probeDarwinNestedVirtualization(host);
  }
  return unsupported(`${UNSUPPORTED_MESSAGE}; ${host.platform} hosts are not supported`);
}

function probeLinuxNestedVirtualization(host: NestedVirtProbeHost): NestedVirtProbeResult {
  if (!host.existsSync("/dev/kvm")) {
    return unsupported(`${UNSUPPORTED_MESSAGE}; /dev/kvm is not present`);
  }
  const disabled = firstDisabledLinuxNestedToggle(host);
  if (disabled) {
    return unsupported(`${UNSUPPORTED_MESSAGE}; ${disabled}`);
  }
  return { supported: true };
}

function firstDisabledLinuxNestedToggle(host: NestedVirtProbeHost): string | undefined {
  for (const path of [
    "/sys/module/kvm/parameters/nested",
    "/sys/module/kvm_arm/parameters/nested",
  ]) {
    if (!host.existsSync(path)) {
      continue;
    }
    const value = host.readText(path);
    if (isDisabledKernelToggle(value)) {
      return `${path} is ${value.trim() || "disabled"}`;
    }
  }
  return undefined;
}

function probeDarwinNestedVirtualization(host: NestedVirtProbeHost): NestedVirtProbeResult {
  if (sysctl(host, "kern.hv_support") !== "1") {
    return unsupported(`${UNSUPPORTED_MESSAGE}; Hypervisor.framework support is not available`);
  }
  const osReason = unsupportedDarwinVersionReason(host);
  if (osReason) {
    return unsupported(osReason);
  }
  const cpuReason = unsupportedAppleSiliconReason(host);
  if (cpuReason) {
    return unsupported(cpuReason);
  }
  return { supported: true };
}

function unsupportedDarwinVersionReason(host: NestedVirtProbeHost): string | undefined {
  const major = darwinMajor(swVersProductVersion(host));
  if (major !== undefined && major < 15) {
    return `${UNSUPPORTED_MESSAGE}; macOS ${major} is older than macOS 15`;
  }
  return undefined;
}

function unsupportedAppleSiliconReason(host: NestedVirtProbeHost): string | undefined {
  const generation = appleSiliconGeneration(sysctl(host, "machdep.cpu.brand_string"));
  if (generation !== undefined && generation < 3) {
    return `${UNSUPPORTED_MESSAGE}; Apple M${generation} does not expose nested EL2`;
  }
  return undefined;
}

export function preflightNestedVirtualization(host = defaultProbeHost()): void {
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
