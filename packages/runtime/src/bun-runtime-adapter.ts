import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import type { RuntimeAdapterRefusal } from "./runtime-adapter.ts";

export interface ProbeBunRuntimeAdapterOptions {
  bunCommand?: string;
  packagedExecutablePath?: string;
}

export interface BunPackagedExecutableIdentity {
  path: string;
  sha256: string;
}

export type BunRuntimeAdapterProbe =
  | {
      runtime: "bun";
      available: true;
      version: string;
      semanticGraph: "sidecar-required";
      packagedExecutable?: BunPackagedExecutableIdentity;
      refusal?: RuntimeAdapterRefusal;
    }
  | {
      runtime: "bun";
      available: false;
      refusal: RuntimeAdapterRefusal;
      packagedExecutable?: BunPackagedExecutableIdentity;
    };

export function probeBunRuntimeAdapter(
  options: ProbeBunRuntimeAdapterOptions = {},
): BunRuntimeAdapterProbe {
  const bunCommand = options.bunCommand ?? "bun";
  const packaged = options.packagedExecutablePath
    ? inspectBunPackagedExecutable(options.packagedExecutablePath)
    : undefined;
  if (packaged && "refusal" in packaged) {
    return { runtime: "bun", available: false, refusal: packaged.refusal };
  }
  const packagedIdentity = packaged && "identity" in packaged ? packaged.identity : undefined;
  const version = spawnSync(bunCommand, ["--version"], { encoding: "utf8" });
  if (version.status !== 0) {
    return {
      runtime: "bun",
      available: false,
      refusal: {
        code: "runtime-adapter-missing",
        message: `${bunCommand} executable is not available; install Bun or provide a Bun runtime adapter sidecar`,
        detail: { command: bunCommand },
      },
      packagedExecutable: packagedIdentity,
    };
  }
  return {
    runtime: "bun",
    available: true,
    version: version.stdout.trim(),
    semanticGraph: "sidecar-required",
    packagedExecutable: packagedIdentity,
    refusal: {
      code: "runtime-heap-unsupported",
      message:
        "Bun semantic graph restore needs an in-process adapter or sidecar; raw heap bytes are not portable",
    },
  };
}

export function inspectBunPackagedExecutable(
  path: string,
):
  | { accepted: true; identity: BunPackagedExecutableIdentity }
  | { accepted: false; refusal: RuntimeAdapterRefusal } {
  if (!existsSync(path)) {
    return {
      accepted: false,
      refusal: {
        code: "target-build-mismatch",
        message:
          "Bun packaged executable identity could not be checked because the file is missing",
        detail: { path },
      },
    };
  }
  return {
    accepted: true,
    identity: { path, sha256: createHash("sha256").update(readFileSync(path)).digest("hex") },
  };
}
