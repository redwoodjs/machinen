// macOS provider configuration and prepared-bundle validation.
//
// The MVP loads a prepared VM bundle. It never installs a guest, so every
// other source format is refused by name instead of being coerced into a
// bundle shape it does not have.

import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";

import { BootError } from "../../errors.ts";

/** Options accepted under `boot({ macos: ... })`. */
export interface MacosBootOptions {
  /**
   * Prepared VM bundle. A directory containing `config.json` and the
   * disk image it names. This is the only source kind the MVP accepts.
   */
  source: MacosSource;
  /** SSH transport settings. Key-based only. */
  ssh: MacosSshOptions;
  /** Guest RAM in MiB. Defaults to 4096. */
  memoryMib?: number;
  /** Guest vCPU count. Defaults to 4. */
  cpuCount?: number;
}

export type MacosSource = {
  kind: "prepared-bundle";
  /** Absolute or cwd-relative path to the bundle directory. */
  path: string;
};

export interface MacosSshOptions {
  /** Guest user name. */
  user: string;
  /**
   * Private key path. Never written to the registry, never passed on a
   * command line, and never logged.
   */
  identityFile: string;
  /** Guest port. Defaults to 22. */
  port?: number;
  /** Optional guest address override. Normally discovered from the runner. */
  host?: string;
}

/** Parsed and validated bundle description. */
export interface MacosBundle {
  /** Absolute bundle directory. */
  path: string;
  /** Absolute disk image path the bundle declares. */
  diskImage: string;
  /** Absolute auxiliary-storage path when the bundle declares one. */
  auxiliaryStorage?: string;
  /** Absolute hardware-model path when the bundle declares one. */
  hardwareModel?: string;
}

const REQUIRED_BUNDLE_FILES = ["config.json"] as const;

/** Formats this provider recognizes well enough to refuse with a reason. */
const REJECTED_FORMATS: ReadonlyArray<{ test: (path: string) => boolean; reason: string }> = [
  {
    test: (p) => p.toLowerCase().endsWith(".ipsw"),
    reason:
      "an IPSW is a guest installer image, not a bootable bundle. " +
      "Installing a macOS guest is not implemented; prepare a bundle first.",
  },
  {
    test: (p) => p.toLowerCase().endsWith(".tart"),
    reason:
      "a Tart image is a different format. Convert it to a prepared bundle, " +
      "or run it with Tart outside Machinen.",
  },
  {
    test: (p) => p.toLowerCase().endsWith(".vzvm"),
    reason:
      "no universal .vzvm format is established. Pass the bundle directory " +
      "that contains config.json.",
  },
];

/**
 * Validate the configured source and return the resolved bundle. Runs
 * before any process spawn so a bad path fails cheaply and names the
 * problem.
 */
export function resolveMacosBundle(source: MacosSource, cwd: string = process.cwd()): MacosBundle {
  if (source.kind !== "prepared-bundle") {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      `unsupported macOS source kind ${JSON.stringify(source.kind)}. ` +
        'The only supported kind is "prepared-bundle".',
    );
  }
  const path = isAbsolute(source.path) ? source.path : resolve(cwd, source.path);
  const rejection = REJECTED_FORMATS.find((entry) => entry.test(path));
  if (rejection) {
    throw new BootError("PROVIDER_IMAGE_INVALID", `cannot boot ${path}: ${rejection.reason}`);
  }
  if (!existsSync(path)) {
    throw new BootError("PROVIDER_IMAGE_INVALID", `macOS bundle not found: ${path}`);
  }
  if (!statSync(path).isDirectory()) {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      `macOS bundle must be a directory containing config.json, but ${path} is a file.`,
    );
  }
  for (const name of REQUIRED_BUNDLE_FILES) {
    const candidate = join(path, name);
    if (!existsSync(candidate)) {
      throw new BootError(
        "PROVIDER_IMAGE_INVALID",
        `macOS bundle ${path} is missing ${name}. ` +
          "The bundle must describe its disk image and hardware model.",
      );
    }
  }
  const config = readBundleConfig(join(path, "config.json"));
  return {
    path,
    diskImage: resolveBundleMember(path, config.diskImage, "diskImage"),
    auxiliaryStorage:
      config.auxiliaryStorage === undefined
        ? undefined
        : resolveBundleMember(path, config.auxiliaryStorage, "auxiliaryStorage"),
    hardwareModel:
      config.hardwareModel === undefined
        ? undefined
        : resolveBundleMember(path, config.hardwareModel, "hardwareModel"),
  };
}

interface BundleConfig {
  diskImage?: unknown;
  auxiliaryStorage?: unknown;
  hardwareModel?: unknown;
}

function readBundleConfig(path: string): BundleConfig {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new BootError("PROVIDER_IMAGE_INVALID", `macOS bundle config at ${path} is not JSON.`, {
      cause: err,
    });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      `macOS bundle config at ${path} must be an object.`,
    );
  }
  return parsed as BundleConfig;
}

function resolveBundleMember(bundlePath: string, value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      `macOS bundle ${bundlePath} must name ${field} as a non-empty string.`,
    );
  }
  const resolved = isAbsolute(value) ? value : join(bundlePath, value);
  if (!existsSync(resolved)) {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      `macOS bundle ${bundlePath} references ${field} at ${resolved}, which does not exist.`,
    );
  }
  return resolved;
}

/** Validate SSH options. Rejects password-shaped configuration outright. */
export function validateMacosSsh(ssh: MacosSshOptions): void {
  if (!ssh.user) {
    throw new BootError("PROVIDER_TRANSPORT_FAILED", "macOS SSH user is required.");
  }
  if (!ssh.identityFile) {
    throw new BootError(
      "PROVIDER_TRANSPORT_FAILED",
      "macOS SSH requires an identityFile. Password authentication is not supported.",
    );
  }
  if (!existsSync(ssh.identityFile)) {
    throw new BootError(
      "PROVIDER_TRANSPORT_FAILED",
      `macOS SSH identity file not found: ${ssh.identityFile}`,
    );
  }
  const port = ssh.port ?? 22;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new BootError("PROVIDER_TRANSPORT_FAILED", `invalid SSH port ${String(port)}.`);
  }
}

export function validateMacosResources(opts: MacosBootOptions): {
  memoryMib: number;
  cpuCount: number;
} {
  const memoryMib = opts.memoryMib ?? 4096;
  const cpuCount = opts.cpuCount ?? 4;
  if (!Number.isInteger(memoryMib) || memoryMib < 2048) {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      `macOS guests need at least 2048 MiB of RAM, got ${String(memoryMib)}.`,
    );
  }
  if (!Number.isInteger(cpuCount) || cpuCount < 1) {
    throw new BootError(
      "PROVIDER_IMAGE_INVALID",
      `macOS guests need at least 1 vCPU, got ${String(cpuCount)}.`,
    );
  }
  return { memoryMib, cpuCount };
}
