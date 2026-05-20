import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RUNTIME_ADAPTER_BUNDLE_FILE } from "../runtime-adapter.ts";
import { captureNodeRuntimeAdapterDocument } from "../node-runtime-adapter.ts";
import { validatePortableSnapshotBundle } from "../vm/portable-snapshot.ts";

const TMP: string[] = [];

afterEach(() => {
  for (const dir of TMP.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function unsupported() {
  return { vocabularyVersion: 1, refusals: [] };
}

function writeBundle(mutator?: (docs: ReturnType<typeof bundleDocs>) => void): string {
  const dir = mkdtempSync(join(tmpdir(), "machinen-runtime-adapter-bundle-"));
  TMP.push(dir);
  const docs = bundleDocs();
  mutator?.(docs);
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(docs.manifest));
  writeFileSync(join(dir, "objects.json"), JSON.stringify(docs.objects));
  writeFileSync(join(dir, "relocations.json"), JSON.stringify(docs.relocations));
  writeFileSync(join(dir, "resources.json"), JSON.stringify(docs.resources));
  writeFileSync(join(dir, RUNTIME_ADAPTER_BUNDLE_FILE), JSON.stringify(docs.runtimeAdapter));
  writeFileSync(join(dir, "memory.bin"), Buffer.alloc(0));
  mkdirSync(join(dir, "logs"));
  return dir;
}

function bundleDocs() {
  const runtimeAdapter = captureNodeRuntimeAdapterDocument(
    { state: { counter: 438 } },
    { process: { argv: ["node", "app.mjs"], env: { APP: "1" }, cwd: "/app" } },
  );
  return {
    runtimeAdapter,
    manifest: {
      formatVersion: 1,
      sourceGuestArch: "arm64",
      allowedTargetGuestArchs: ["arm64", "amd64"],
      program: { name: "node-adapter", executable: "node", identity: "node-adapter" },
      sourceBuild: { buildId: "4384384384384380", version: "0.1.0" },
      targetBuild: { version: "0.1.x" },
      checkpointAbi: {
        version: 1,
        checkpointFunction: { name: "machinen_checkpoint" },
        rootsType: "machinen_checkpoint_roots",
        restoreBundleType: "machinen_restore_bundle",
        safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
      },
      checkpointContinuation: { name: "node_runtime_adapter_checkpoint" },
      restoreEntrypoint: { name: "node_runtime_adapter_restore" },
      process: { argv: ["node", "app.mjs"], env: { APP: "1" }, cwd: "/app" },
      features: ["runtime-adapter", "node-semantic-roots", "js-object-identity"],
      unsupported: unsupported(),
    },
    objects: {
      formatVersion: 1,
      objects: [
        { id: "js-root-state", kind: "opaque", type: "runtime adapter roots" },
        { id: "js-object-graph", kind: "opaque", type: "runtime adapter graph" },
        { id: "js-runtime-metadata", kind: "opaque", type: "runtime adapter metadata" },
      ],
      unsupported: unsupported(),
    },
    relocations: { formatVersion: 1, relocations: [], unsupported: unsupported() },
    resources: {
      formatVersion: 1,
      resources: [
        { id: "argv", kind: "argv", state: "captured", argv: ["node", "app.mjs"] },
        { id: "env", kind: "env", state: "captured", env: { APP: "1" } },
        { id: "cwd", kind: "cwd", state: "captured", path: "/app" },
      ],
      unsupported: unsupported(),
    },
  };
}

describe("runtime adapter portable snapshot integration", () => {
  it("loads and validates optional runtime-adapter.json sidecars", () => {
    const bundle = validatePortableSnapshotBundle(writeBundle());
    expect(bundle.runtimeAdapter?.adapter.runtime).toBe("node");
    expect(bundle.manifest.features).toContain("runtime-adapter");
  });

  it("rejects runtime adapter mappings that are not present in portable bundle docs", () => {
    const dir = writeBundle((docs) => {
      docs.manifest.features = ["runtime-adapter"];
      docs.objects.objects = docs.objects.objects.filter(
        (object) => object.id !== "js-object-graph",
      );
      docs.resources.resources = docs.resources.resources.filter(
        (resource) => resource.id !== "cwd",
      );
    });

    expect(() => validatePortableSnapshotBundle(dir)).toThrow(/runtimeAdapter\.bundleMapping/);
  });
});
