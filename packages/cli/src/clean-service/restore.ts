import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { boot, type VmHandle } from "@machinen/runtime";

import {
  runtimePolicyForComponent,
  selectRestorableCleanServiceComponent,
  validateCleanServiceManifest,
  versionsArePatchCompatible,
  type CleanServiceComponent,
  type CleanServiceManifest,
} from "./manifest.ts";

interface CleanServiceBaseAssetPaths {
  defaultImagePath: string;
  kernelPath: string;
  dtbPath?: string;
}

interface RestoreCleanServiceOptions {
  snapDir: string;
  json: boolean;
  name?: string;
  resolveCliBaseAssets: () => Promise<CleanServiceBaseAssetPaths>;
  guestCpu: () => "arm64" | "amd64";
  deriveBootName: (imageOverride: string | undefined) => string;
  emitJson: (value: unknown) => void;
  shellQuote: (value: string) => string;
}

export function shouldRestoreCleanService(
  snapDir: string,
  guestCpu: () => "arm64" | "amd64",
): boolean {
  const manifestPath = join(snapDir, "portable-clean-service.json");
  if (!existsSync(manifestPath)) {
    return false;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as CleanServiceManifest;
  return manifest.sourceArch !== guestCpu() || !existsSync(join(snapDir, "state.vmstate"));
}

// fallow-ignore-next-line complexity
export async function cmdRestoreCleanService(opts: RestoreCleanServiceOptions): Promise<number> {
  const started = Date.now();
  const manifest = JSON.parse(
    readFileSync(join(opts.snapDir, "portable-clean-service.json"), "utf8"),
  ) as CleanServiceManifest;
  const schemaErrors = validateCleanServiceManifest(manifest);
  if (schemaErrors.length > 0) {
    return reportCleanServiceRestoreRefusal(
      opts,
      manifest,
      "clean-service-manifest-schema-invalid",
      schemaErrors.join("; "),
      started,
    );
  }
  const selection = selectRestorableCleanServiceComponent(manifest);
  if (!selection.ok || !selection.component) {
    return reportCleanServiceRestoreRefusal(
      opts,
      manifest,
      selection.code ?? "clean-service-required-component-unsupported",
      selection.message ?? "clean-service manifest has no restorable service component",
      started,
    );
  }
  const component = selection.component;
  if (manifest.sourceArch === opts.guestCpu()) {
    return reportCleanServiceRestoreRefusal(
      opts,
      manifest,
      "clean-service-target-architecture-mismatch",
      "portable clean-service restore requires a destination architecture different from the source architecture; use vmstate restore for same-architecture bundles",
      started,
    );
  }
  const artifact = readFileSync(join(opts.snapDir, component.artifact.path));
  if (sha256Bytes(artifact) !== component.artifact.sha256) {
    return reportCleanServiceRestoreRefusal(
      opts,
      manifest,
      "clean-service-artifact-digest-mismatch",
      "clean-service artifact digest does not match the manifest",
      started,
    );
  }
  const paths = await opts.resolveCliBaseAssets();
  const name = opts.name ?? opts.deriveBootName(opts.snapDir);
  const vm = await boot({
    image: paths.defaultImagePath,
    kernel: paths.kernelPath,
    dtb: paths.dtbPath,
    name,
    detached: true,
    cmd: ["sleep", "100000"],
    timeoutMs: undefined,
  });
  try {
    const runtimeReady = await prepareCleanServiceRuntime(vm, component);
    if (runtimeReady.ok === false) {
      return reportCleanServiceRestoreRefusal(
        opts,
        manifest,
        runtimeReady.code,
        runtimeReady.message,
        started,
      );
    }
    await vm.writeFile("/tmp/machinen-clean-service-app.tar.gz", artifact);
    await vm.exec(
      "rm -rf /opt/machinen-clean-service-app && mkdir -p /opt/machinen-clean-service-app && tar -xzf /tmp/machinen-clean-service-app.tar.gz -C /opt/machinen-clean-service-app",
    );
    await vm.exec(startCleanServiceCommand(component, opts.shellQuote), { execTimeoutMs: 15_000 });
    const verify = await vm.execRaw(verifyCleanServiceCommand(component, opts.shellQuote), {
      execTimeoutMs: 30_000,
    });
    if (verify.exitCode !== 0) {
      return reportCleanServiceRestoreRefusal(
        opts,
        manifest,
        "clean-service-verifier-mismatch",
        verify.stderr || verify.stdout || "target verifier failed",
        started,
      );
    }
    const summary = cleanServiceRestoreSummary(manifest, opts.guestCpu(), "completed", started, {
      migrationCompleted: true,
      targetVerifierResult: "passed",
      restoredName: vm.name ?? name,
    });
    // fallow-ignore-next-line code-duplication
    writeFileSync(
      join(opts.snapDir, "portable-clean-service-restore-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    if (opts.json) {
      opts.emitJson({ schema_version: 1, ...summary });
    } else {
      process.stderr.write(`restored clean service as: ${vm.name ?? name} (pid ${vm.pid})\n`);
    }
    return 0;
  } finally {
    await vm.detach();
  }
}

// fallow-ignore-next-line complexity
async function prepareCleanServiceRuntime(
  vm: VmHandle,
  component: CleanServiceComponent,
): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  if (component.runtime === "node") {
    const policy = runtimePolicyForComponent(component);
    const packages = policy.packageSet?.packages ?? ["nodejs", "curl", "ca-certificates"];
    // fallow-ignore-next-line code-duplication
    await vm.exec(
      "export DEBIAN_FRONTEND=noninteractive; " +
        "if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends " +
        packages.map(shellQuoteForGuest).join(" ") +
        "; fi",
      { execTimeoutMs: 180_000 },
    );
    // fallow-ignore-next-line code-duplication
    const target = await vm.execRaw("node --version", { execTimeoutMs: 5_000 });
    if (target.exitCode !== 0) {
      return {
        ok: false,
        code: "clean-service-runtime-unavailable",
        message: `target Node runtime is unavailable; ${policy.remediation}`,
      };
    }
    if (!versionsArePatchCompatible(component.runtimeVersion, target.stdout.trim())) {
      return {
        ok: false,
        code: "clean-service-runtime-policy-mismatch",
        message: `source Node ${component.runtimeVersion} is not compatible with target Node ${target.stdout.trim() || "unavailable"}; policy=${policy.compatibility}; ${policy.remediation}`,
      };
    }
    return { ok: true };
  }
  if (component.runtime === "python") {
    const policy = runtimePolicyForComponent(component);
    const packages = policy.packageSet?.packages ?? [
      "python3.11",
      "python3.11-minimal",
      "libpython3.11-minimal",
      "libpython3.11-stdlib",
      "media-types",
      "curl",
      "ca-certificates",
    ];
    // fallow-ignore-next-line code-duplication
    await vm.exec(
      "export DEBIAN_FRONTEND=noninteractive; " +
        "if ! command -v python3 >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends " +
        packages.map(shellQuoteForGuest).join(" ") +
        "; fi; " +
        "if ! command -v python3 >/dev/null 2>&1 && command -v python3.11 >/dev/null 2>&1; then ln -sf /usr/bin/python3.11 /usr/bin/python3; fi",
      { execTimeoutMs: 180_000 },
    );
    // fallow-ignore-next-line code-duplication
    const target = await vm.execRaw("(python3 --version || python3.11 --version) 2>&1", {
      execTimeoutMs: 5_000,
    });
    if (target.exitCode !== 0) {
      return {
        ok: false,
        code: "clean-service-runtime-unavailable",
        message: `target Python runtime is unavailable; ${policy.remediation}`,
      };
    }
    if (!versionsArePatchCompatible(component.runtimeVersion, target.stdout.trim())) {
      return {
        ok: false,
        code: "clean-service-runtime-policy-mismatch",
        message: `source Python ${component.runtimeVersion} is not compatible with target Python ${target.stdout.trim() || "unavailable"}; policy=${policy.compatibility}; ${policy.remediation}`,
      };
    }
    return { ok: true };
  }
  if (component.runtime === "go") {
    await vm.exec(
      "if ! command -v curl >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends curl ca-certificates; fi",
      {
        execTimeoutMs: 180_000,
      },
    );
    return { ok: true };
  }
  return {
    ok: false,
    code: "clean-service-runtime-unavailable",
    message: `unsupported clean-service runtime: ${String(component.runtime)}`,
  };
}

function startCleanServiceCommand(
  component: CleanServiceComponent,
  shellQuote: (value: string) => string,
): string {
  if (component.runtime === "go") {
    const executableRelativePath =
      typeof component.provenance.executableRelativePath === "string"
        ? component.provenance.executableRelativePath
        : component.argv[0]?.split("/").pop();
    const args = component.argv.slice(1).map(shellQuote).join(" ");
    return `cd /opt/machinen-clean-service-app && chmod +x ${shellQuote(`./${executableRelativePath}`)} && nohup ${shellQuote(`./${executableRelativePath}`)} ${args} >/tmp/machinen-clean-service.log 2>&1 &`;
  }
  const runtimeIndex = component.argv.findIndex((arg) => runtimeArgPattern(component).test(arg));
  const runtimeArgs = component.argv
    .slice(Math.max(runtimeIndex, 0) + 1)
    .map(shellQuote)
    .join(" ");
  const runtime = component.runtime === "python" ? "python3" : "node";
  return `cd /opt/machinen-clean-service-app && nohup ${runtime} ${runtimeArgs} >/tmp/machinen-clean-service.log 2>&1 &`;
}

function runtimeArgPattern(component: CleanServiceComponent): RegExp {
  if (component.runtime === "python") {
    return /(^|\/)python3?(?:$|[0-9.-])/u;
  }
  if (component.runtime === "go") {
    return /^$/u;
  }
  return /(^|\/)node(?:$|[0-9.-])/u;
}

function verifyCleanServiceCommand(
  component: CleanServiceComponent,
  shellQuote: (value: string) => string,
): string {
  return `for i in $(seq 1 80); do got=$(curl -fsS http://127.0.0.1:${component.guestPort}/ 2>/dev/null | sha256sum | awk '{print $1}') && test "$got" = ${shellQuote(component.verifier.sha256)} && exit 0; sleep 0.25; done; cat /tmp/machinen-clean-service.log 2>/dev/null; exit 1`;
}

function reportCleanServiceRestoreRefusal(
  opts: RestoreCleanServiceOptions,
  manifest: CleanServiceManifest,
  code: string,
  message: string,
  started: number,
): number {
  const summary = cleanServiceRestoreSummary(manifest, opts.guestCpu(), "refused", started, {
    migrationCompleted: false,
    targetVerifierResult: "failed",
    refusal: { code, message },
  });
  // fallow-ignore-next-line code-duplication
  writeFileSync(
    join(opts.snapDir, "portable-clean-service-restore-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  if (opts.json) {
    opts.emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(`refused clean-service restore: ${code}: ${message}\n`);
  }
  return 1;
}

function cleanServiceRestoreSummary(
  manifest: CleanServiceManifest,
  targetArch: "arm64" | "amd64",
  state: "completed" | "refused",
  started: number,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: "machinen.clean-service-restore-summary",
    formatVersion: 1,
    runtime: manifest.components.map((component) => component.runtime).join(","),
    subset: manifest.components.map((component) => component.subset).join(","),
    state,
    sourceArch: manifest.sourceArch,
    targetArch,
    elapsedMs: Date.now() - started,
    sourceIsaEmulationUsed: false,
    sourceTextReplayAcceptedAsRestore: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    metadataOnlyContinuation: false,
    ...extra,
  };
}

function sha256Bytes(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function shellQuoteForGuest(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
