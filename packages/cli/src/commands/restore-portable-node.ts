import { boot } from "@machinen/runtime";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { PortableNodeSnapshotBundle } from "../clean-service/node-adapter.ts";
import { emitJson } from "../args.ts";
import { deriveBootName, guestCpu, resolveCliBaseAssets, sha256Bytes } from "../base-assets.ts";
import { handleError } from "../errors.ts";
import type { parseRestoreArgs } from "../parse-restore-args.ts";

type ParsedRestoreCommandArgs = ReturnType<typeof parseRestoreArgs>;

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function shouldPreferVmstateRestore(snapDir: string): boolean {
  if (!existsSync(join(snapDir, "state.vmstate"))) {
    return false;
  }
  const manifestPath = join(snapDir, "portable-node.json");
  if (!existsSync(manifestPath)) {
    return true;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PortableNodeSnapshotBundle;
  return manifest.sourceArch === guestCpu();
}

export function shouldRestorePortableNode(snapDir: string): boolean {
  const manifestPath = join(snapDir, "portable-node.json");
  if (!existsSync(manifestPath)) {
    return false;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PortableNodeSnapshotBundle;
  return manifest.sourceArch !== guestCpu() || !existsSync(join(snapDir, "state.vmstate"));
}

// fallow-ignore-next-line complexity
export async function cmdRestorePortableNode(
  parsed: ParsedRestoreCommandArgs,
  snapDir: string,
  json: boolean,
): Promise<number> {
  const started = Date.now();
  const manifest = JSON.parse(
    readFileSync(join(snapDir, "portable-node.json"), "utf8"),
  ) as PortableNodeSnapshotBundle;
  if (manifest.sourceArch === guestCpu()) {
    return reportPortableNodeRestoreRefusal(
      snapDir,
      json,
      manifest,
      "node-target-architecture-mismatch",
      "portable Node restore requires a destination architecture different from the source architecture; use vmstate restore for same-architecture bundles",
      started,
    );
  }
  const appTarPath = join(snapDir, manifest.appTar.path);
  const appTar = readFileSync(appTarPath);
  if (sha256Bytes(appTar) !== manifest.appTar.sha256) {
    return reportPortableNodeRestoreRefusal(
      snapDir,
      json,
      manifest,
      "node-portable-app-digest-mismatch",
      "portable Node app tarball digest does not match descriptor",
      started,
    );
  }
  const paths = await resolveCliBaseAssets();
  const name = parsed.name ?? deriveBootName(snapDir);
  const vm = await boot({
    image: paths.defaultImagePath,
    kernel: paths.kernelPath,
    dtb: paths.dtbPath,
    name,
    detached: true,
    cmd: ["sleep", "100000"],
    timeoutMs: undefined,
  }).catch(handleError);
  try {
    await vm.exec(
      "export DEBIAN_FRONTEND=noninteractive; " +
        "if ! command -v node >/dev/null 2>&1; then apt-get update && apt-get install -y --no-install-recommends nodejs curl ca-certificates; fi",
      { execTimeoutMs: 180_000 },
    );
    const targetNode = await vm.execRaw("node --version", { execTimeoutMs: 5_000 });
    if (targetNode.exitCode !== 0 || targetNode.stdout.trim() !== manifest.nodeVersion) {
      return reportPortableNodeRestoreRefusal(
        snapDir,
        json,
        manifest,
        "node-source-target-version-mismatch",
        `source Node ${manifest.nodeVersion} does not match target Node ${targetNode.stdout.trim() || "unavailable"}`,
        started,
      );
    }
    await vm.writeFile("/tmp/machinen-portable-node-app.tar.gz", appTar);
    await vm.exec(
      "rm -rf /opt/machinen-portable-node-app && mkdir -p /opt/machinen-portable-node-app && tar -xzf /tmp/machinen-portable-node-app.tar.gz -C /opt/machinen-portable-node-app",
    );
    await vm.exec(startPortableNodeCommand(manifest), { execTimeoutMs: 15_000 });
    const verify = await vm.execRaw(verifyPortableNodeCommand(manifest), { execTimeoutMs: 30_000 });
    if (verify.exitCode !== 0) {
      return reportPortableNodeRestoreRefusal(
        snapDir,
        json,
        manifest,
        "node-target-verifier-mismatch",
        verify.stderr || verify.stdout || "target verifier failed",
        started,
      );
    }
    const summary = portableNodeRestoreSummary(manifest, "completed", started, {
      migrationCompleted: true,
      targetVerifierResult: "passed",
      restoredName: vm.name ?? name,
    });
    // fallow-ignore-next-line code-duplication
    writeFileSync(
      join(snapDir, "portable-node-restore-summary.json"),
      `${JSON.stringify(summary, null, 2)}\n`,
    );
    if (json) {
      emitJson({ schema_version: 1, ...summary });
    } else {
      process.stderr.write(`restored portable Node as: ${vm.name ?? name} (pid ${vm.pid})\n`);
    }
    return 0;
  } finally {
    await vm.detach();
  }
}

function startPortableNodeCommand(manifest: PortableNodeSnapshotBundle): string {
  const nodeIndex = manifest.argv.findIndex((arg) => /(^|\/)node(?:$|[0-9.-])/u.test(arg));
  const nodeArgs = manifest.argv
    .slice(nodeIndex + 1)
    .map(shellQuote)
    .join(" ");
  return `cd /opt/machinen-portable-node-app && nohup node ${nodeArgs} >/tmp/machinen-portable-node.log 2>&1 &`;
}

function verifyPortableNodeCommand(manifest: PortableNodeSnapshotBundle): string {
  return `for i in $(seq 1 80); do got=$(curl -fsS http://127.0.0.1:${manifest.guestPort}/ 2>/dev/null | sha256sum | awk '{print $1}') && test "$got" = ${shellQuote(manifest.verifier.sha256)} && exit 0; sleep 0.25; done; cat /tmp/machinen-portable-node.log 2>/dev/null; exit 1`;
}

function reportPortableNodeRestoreRefusal(
  snapDir: string,
  json: boolean,
  manifest: PortableNodeSnapshotBundle,
  code: string,
  message: string,
  started: number,
): number {
  const summary = portableNodeRestoreSummary(manifest, "refused", started, {
    migrationCompleted: false,
    targetVerifierResult: "failed",
    refusal: { code, message },
  });
  // fallow-ignore-next-line code-duplication
  writeFileSync(
    join(snapDir, "portable-node-restore-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  if (json) {
    emitJson({ schema_version: 1, ...summary });
  } else {
    process.stderr.write(`refused portable Node restore: ${code}: ${message}\n`);
  }
  return 1;
}

function portableNodeRestoreSummary(
  manifest: PortableNodeSnapshotBundle,
  state: "completed" | "refused",
  started: number,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return {
    kind: "machinen.portable-node-restore-summary",
    formatVersion: 1,
    runtime: "node",
    subset: manifest.subset,
    state,
    sourceArch: manifest.sourceArch,
    targetArch: guestCpu(),
    elapsedMs: Date.now() - started,
    sourceIsaEmulationUsed: false,
    sourceTextReplayAcceptedAsRestore: false,
    sidecarRuntimeUsed: false,
    appHooksRequired: false,
    ...extra,
  };
}
