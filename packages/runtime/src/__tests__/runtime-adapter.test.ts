import { describe, expect, it } from "vitest";
import {
  RUNTIME_ADAPTER_BUNDLE_FILE,
  RuntimeAdapterValidationError,
  assertRuntimeAdapterDocument,
  runtimeAdapterSchemas,
  validateRuntimeAdapterDocument,
} from "../runtime-adapter.ts";
import type { RuntimeAdapterDocument } from "../runtime-adapter.ts";

const SHA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

function unsupported(refusals: RuntimeAdapterDocument["unsupported"]["refusals"] = []) {
  return { vocabularyVersion: 1 as const, refusals };
}

function nodeGraphDocument(
  overrides: Partial<RuntimeAdapterDocument> = {},
): RuntimeAdapterDocument {
  const document: RuntimeAdapterDocument = {
    formatVersion: 1,
    adapter: {
      id: "node-cooperative-adapter",
      protocolVersion: 1,
      runtime: "node",
      name: "Machinen cooperative Node adapter",
      version: "0.1.0",
      features: ["semantic-roots", "object-identity", "native-resource-refusals"],
      entrypoints: {
        capture: {
          command: "node",
          args: ["adapter.mjs", "capture", "--out", "<dir>"],
          transport: "sidecar-json",
          env: { MACHINEN_RUNTIME_ADAPTER: "1" },
        },
        restore: {
          command: "node",
          args: ["adapter.mjs", "restore", "--bundle", "<dir>"],
          transport: "sidecar-json",
          env: { MACHINEN_RUNTIME_ADAPTER: "1" },
        },
      },
    },
    target: {
      id: "runtime-state-probe",
      name: "runtime-state-probe",
      executable: "packages/microvm/assets/runtime-state-workload.mjs",
      sourceGuestArch: "arm64",
      allowedTargetGuestArchs: ["arm64", "amd64"],
    },
    runtime: {
      name: "node",
      version: "22.0.0",
      engine: { name: "v8", version: "12.4.254" },
      serializerCompatibility: {
        semanticGraph: { supported: true, format: "machinen-runtime-adapter-v1" },
        rawHeap: {
          supported: false,
          refusal: {
            code: "runtime-heap-unsupported",
            message: "raw V8 heap bytes are not a portable restore contract",
          },
        },
        v8Serialize: {
          supported: true,
          versionBound: true,
          portable: false,
          api: "node:v8.serialize",
        },
        structuredClone: { supported: true, persistentFormat: false },
        heapSnapshot: {
          inspected: true,
          restoreSupported: false,
          finding: "heap snapshots are inspection evidence, not a restore format",
        },
      },
    },
    build: {
      identity: {
        sourceSha256: SHA,
        packageSha256: SHA,
        moduleGraphSha256: SHA,
      },
      modules: [
        { specifier: "node:fs", kind: "builtin" },
        { specifier: "./runtime-state-workload.mjs", kind: "relative", sha256: SHA },
      ],
    },
    process: {
      argv: ["node", "runtime-state-workload.mjs", "restore"],
      env: { MACHINEN_RUNTIME_PROBE: "1" },
      cwd: "/work",
    },
    graph: {
      roots: [
        { name: "counter", value: { kind: "number", value: 4210 } },
        {
          name: "values",
          value: {
            kind: "array",
            items: [4, 2, 1, 8, 16].map((value) => ({ kind: "number", value })),
          },
        },
        { name: "left", value: { kind: "ref", objectId: "object:left" } },
        { name: "right", value: { kind: "ref", objectId: "object:right" } },
        { name: "shared", value: { kind: "ref", objectId: "object:shared" } },
        { name: "map", value: { kind: "ref", objectId: "object:map" } },
      ],
      objects: [
        {
          id: "object:left",
          kind: "object",
          properties: {
            name: { kind: "string", value: "left" },
            ordinal: { kind: "number", value: 1 },
            shared: { kind: "ref", objectId: "object:shared" },
          },
        },
        {
          id: "object:right",
          kind: "object",
          properties: {
            name: { kind: "string", value: "right" },
            ordinal: { kind: "number", value: 2 },
            shared: { kind: "ref", objectId: "object:shared" },
          },
        },
        {
          id: "object:map",
          kind: "map",
          entries: [
            {
              key: { kind: "string", value: "left" },
              value: { kind: "ref", objectId: "object:left" },
            },
            {
              key: { kind: "string", value: "right" },
              value: { kind: "ref", objectId: "object:right" },
            },
            {
              key: { kind: "string", value: "shared" },
              value: { kind: "ref", objectId: "object:shared" },
            },
          ],
        },
        {
          id: "object:shared",
          kind: "object",
          properties: {
            label: { kind: "string", value: "shared-runtime-object" },
            weight: { kind: "number", value: 9001 },
          },
        },
      ],
      identityAssertions: [
        { left: "root.left.shared", right: "root.right.shared", same: true },
        { left: "root.map.get('shared')", right: "root.shared", same: true },
      ],
      checksumHex: "0x421421",
    },
    resources: {
      resources: [
        {
          id: "argv",
          kind: "argv",
          state: "captured",
          recipe: { kind: "argv", detail: { argv: ["node", "runtime-state-workload.mjs"] } },
        },
        {
          id: "env",
          kind: "env",
          state: "captured",
          recipe: { kind: "env", detail: { MACHINEN_RUNTIME_PROBE: "1" } },
        },
        {
          id: "cwd",
          kind: "cwd",
          state: "captured",
          recipe: { kind: "cwd", detail: { cwd: "/work" } },
        },
        {
          id: "node:stdio:1",
          kind: "fd",
          state: "refused",
          refusal: {
            code: "fd-kind-unsupported",
            message: "stdio is a native file descriptor and needs a handle recipe",
          },
        },
        {
          id: "node:timer-queue",
          kind: "timer",
          state: "refused",
          refusal: {
            code: "runtime-heap-unsupported",
            message: "timer queues need async continuation metadata",
          },
        },
      ],
      unsupported: unsupported(),
    },
    restore: {
      semanticStateSupported: true,
      liveProcessSupported: false,
      requiredMetadata: [
        "semantic JS roots with reference ids",
        "module graph and source/build identity",
        "native handle recipes or refusals",
        "async queue continuation metadata",
      ],
      refusal: {
        code: "runtime-heap-unsupported",
        message: "live process restore needs a runtime adapter; raw heap bytes are refused",
      },
    },
    bundleMapping: {
      manifestFeatures: ["runtime-adapter", "js-object-identity"],
      sidecarFiles: [RUNTIME_ADAPTER_BUNDLE_FILE],
      objects: [
        {
          portableObjectId: "js-root-state",
          role: "runtime-roots",
          graphObjectIds: ["object:left", "object:right", "object:shared", "object:map"],
        },
        { portableObjectId: "js-runtime-metadata", role: "runtime-metadata" },
      ],
      resources: [
        { portableResourceId: "argv", runtimeResourceId: "argv" },
        { portableResourceId: "env", runtimeResourceId: "env" },
        { portableResourceId: "cwd", runtimeResourceId: "cwd" },
        { portableResourceId: "node:timer-queue", runtimeResourceId: "node:timer-queue" },
      ],
    },
    unsupported: unsupported(),
  };
  return { ...document, ...overrides };
}

describe("runtime adapter protocol", () => {
  it("exports the runtime adapter schema and sidecar file name", () => {
    expect(RUNTIME_ADAPTER_BUNDLE_FILE).toBe("runtime-adapter.json");
    expect(runtimeAdapterSchemas.document.$id).toMatch(/runtime-adapter\/document\.schema\.json$/);
  });

  it("validates the Node/Bun semantic graph shape from the runtime probes", () => {
    const document = nodeGraphDocument();
    expect(validateRuntimeAdapterDocument(document)).toEqual([]);
    expect(assertRuntimeAdapterDocument(document).graph.identityAssertions).toHaveLength(2);
  });

  it("represents the real-target live process refusal from the feasibility proof", () => {
    const document = nodeGraphDocument({
      target: {
        id: "machinen-cli-node",
        name: "@machinen/cli",
        executable: "./dist/cli.js",
        sourceGuestArch: "arm64",
        allowedTargetGuestArchs: ["arm64", "amd64"],
      },
      restore: {
        semanticStateSupported: true,
        liveProcessSupported: false,
        requiredMetadata: [
          "Node runtime version and V8 heap/serializer compatibility",
          "module graph and source/build identity",
          "semantic JS roots with reference ids",
          "native handles for stdio, sockets, timers, child processes, and PTYs",
        ],
        refusal: {
          code: "runtime-heap-unsupported",
          message:
            "live Node process restore needs JS roots, object identity, async queues, and native handles",
        },
      },
    });

    expect(validateRuntimeAdapterDocument(document)).toEqual([]);
    expect(document.restore.requiredMetadata).toContain("semantic JS roots with reference ids");
  });

  it("rejects unknown refusal codes before restore", () => {
    const document = nodeGraphDocument();
    document.restore.refusal = { code: "surprise" as never, message: "nope" };
    expect(validateRuntimeAdapterDocument(document)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^runtimeAdapter\.restore\.refusal\.code must be one of:/),
      ]),
    );
  });

  it("rejects references to missing object graph nodes", () => {
    const document = nodeGraphDocument();
    document.graph.roots.push({ name: "missing", value: { kind: "ref", objectId: "missing" } });
    expect(validateRuntimeAdapterDocument(document)).toContain(
      'runtimeAdapter.graph.roots[6].value.objectId references unknown object "missing"',
    );
  });

  it("requires an actionable refusal when full live process restore is unsupported", () => {
    const document = nodeGraphDocument();
    delete document.restore.refusal;
    expect(validateRuntimeAdapterDocument(document)).toContain(
      "runtimeAdapter.restore.refusal is required when liveProcessSupported is false",
    );
    expect(() => assertRuntimeAdapterDocument(document)).toThrow(RuntimeAdapterValidationError);
  });
});
