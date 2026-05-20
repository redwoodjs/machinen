#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export const RUNTIME_STATE_WORKLOAD_MARKER = "MACHINEN_RUNTIME_STATE ";
const SCHEMA_VERSION = 1;
const LABEL = "runtime-state-probe-v1";
const USAGE =
  "usage: runtime-state-workload.mjs capture --out dir --runtime node|bun | restore --bundle dir --runtime node|bun";

async function runtimeStateWorkloadMain() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "capture") {
    await capture(args);
    return;
  }
  if (args.mode === "restore") {
    await restore(args);
    return;
  }
  throw new Error(USAGE);
}

const ARG_HANDLERS = new Map([
  ["--out", (args, argv, index) => setValue(args, "outDir", argv, index, "--out")],
  ["--bundle", (args, argv, index) => setValue(args, "bundleDir", argv, index, "--bundle")],
  ["--runtime", (args, argv, index) => setValue(args, "runtime", argv, index, "--runtime")],
]);

function parseArgs(argv) {
  const args = { mode: argv[0], outDir: null, bundleDir: null, runtime: detectRuntime() };
  for (let index = 1; index < argv.length; index++) {
    index = consumeArg(args, argv, index);
  }
  validateArgs(args);
  return args;
}

function consumeArg(args, argv, index) {
  if (argv[index] === "--help" || argv[index] === "-h") {
    console.log(USAGE);
    process.exit(0);
  }
  const handler = ARG_HANDLERS.get(argv[index]);
  if (!handler) {
    throw new Error(`unknown argument: ${argv[index]}`);
  }
  return handler(args, argv, index);
}

function setValue(args, key, argv, index, flag) {
  args[key] = requireValue(argv, index + 1, flag);
  return index + 1;
}

const MODE_VALIDATORS = new Map([
  ["capture", (args) => Boolean(args.outDir)],
  ["restore", (args) => Boolean(args.bundleDir)],
]);

function validateArgs(args) {
  const isValid = MODE_VALIDATORS.get(args.mode);
  if (!isValid?.(args)) {
    throw new Error(USAGE);
  }
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function capture(args) {
  mkdirSync(args.outDir, { recursive: true });
  const state = buildRuntimeState();
  const semanticState = semanticStateFromGraph(state, args.runtime);
  const serializerEvidence = await inspectSerializers(state, args.outDir, args.runtime);
  const document = {
    formatVersion: 1,
    schema: "com.redwoodjs.machinen.runtime-state-probe",
    runtime: runtimeDescriptor(args.runtime),
    sourceGuestArch: hostArch(),
    semanticState,
    serializerEvidence,
    conclusion: runtimeConclusion(args.runtime, serializerEvidence),
  };
  writeFileSync(join(args.outDir, "runtime-state.json"), jsonDocument(document));
  const marker = markerLine({
    mode: "capture",
    runtime: args.runtime,
    arch: hostArch(),
    counter: semanticState.roots.counter,
    checksum_hex: semanticState.checksumHex,
    identity_preserved: semanticState.identityAssertions.every((assertion) => assertion.same),
    v8_serialize_supported: serializerEvidence.v8Serialize.supported,
    structured_clone_supported: serializerEvidence.structuredClone.supported,
  });
  writeFileSync(join(args.outDir, "target.log"), `${marker}\n`);
  console.log(marker);
}

async function restore(args) {
  const document = JSON.parse(readFileSync(join(args.bundleDir, "runtime-state.json"), "utf8"));
  const graph = rebuildGraph(document.semanticState);
  const validation = validateGraph(graph, document.semanticState);
  const v8Restore = await restoreV8Payload(args.bundleDir, args.runtime);
  const marker = markerLine({
    mode: "restore",
    runtime: args.runtime,
    arch: hostArch(),
    counter: graph.counter,
    checksum_hex: checksumGraph(graph),
    identity_preserved: validation.identityPreserved,
    references_restored: validation.referencesRestored,
    v8_deserialize_ok: v8Restore.ok,
  });
  console.log(marker);
}

function buildRuntimeState() {
  const shared = { label: "shared-runtime-object", weight: 9001, flags: ["hot", "portable"] };
  const left = { name: "left", ordinal: 1, shared };
  const right = { name: "right", ordinal: 2, shared };
  const state = {
    label: LABEL,
    counter: 4210,
    values: [4, 2, 1, 8, 16],
    shared,
    left,
    right,
    list: [left, right, shared],
    map: new Map([
      ["left", left],
      ["right", right],
      ["shared", shared],
    ]),
  };
  return state;
}

function semanticStateFromGraph(state, runtime) {
  const roots = {
    label: state.label,
    counter: state.counter,
    values: state.values,
    left: "object:left",
    right: "object:right",
    shared: "object:shared",
    map: "object:map",
  };
  const objects = [
    {
      id: "object:shared",
      kind: "object",
      properties: {
        label: state.shared.label,
        weight: state.shared.weight,
        flags: state.shared.flags,
      },
      references: {},
    },
    {
      id: "object:left",
      kind: "object",
      properties: { name: state.left.name, ordinal: state.left.ordinal },
      references: { shared: "object:shared" },
    },
    {
      id: "object:right",
      kind: "object",
      properties: { name: state.right.name, ordinal: state.right.ordinal },
      references: { shared: "object:shared" },
    },
    {
      id: "object:map",
      kind: "map",
      entries: [
        ["left", "object:left"],
        ["right", "object:right"],
        ["shared", "object:shared"],
      ],
    },
  ];
  return {
    formatVersion: 1,
    runtime,
    roots,
    objects,
    identityAssertions: identityAssertions(state),
    checksumHex: checksumGraph(state),
    nativeHandles: nativeHandles(runtime),
  };
}

function identityAssertions(state) {
  return [
    {
      left: "root.left.shared",
      right: "root.right.shared",
      same: state.left.shared === state.right.shared,
    },
    { left: "root.list[2]", right: "root.shared", same: state.list[2] === state.shared },
    {
      left: "root.map.get('shared')",
      right: "root.shared",
      same: state.map.get("shared") === state.shared,
    },
  ];
}

function nativeHandles(runtime) {
  return [
    {
      id: `${runtime}:stdio:1`,
      kind: "fd",
      state: "refused",
      refusal: {
        code: "fd-kind-unsupported",
        message: "runtime stdio is a native file descriptor and is not replayed by this proof",
      },
    },
    {
      id: `${runtime}:timer-queue`,
      kind: "timer",
      state: "refused",
      refusal: {
        code: "runtime-heap-unsupported",
        message: "runtime timer queues and native handles need a runtime adapter",
      },
    },
  ];
}

async function inspectSerializers(state, outDir, runtime) {
  const structuredCloneEvidence = inspectStructuredClone(state);
  const jsonEvidence = inspectJson(state);
  const v8Evidence =
    runtime === "node"
      ? await inspectNodeV8Serialize(state, outDir)
      : {
          supported: false,
          reason: "Bun does not expose Node's V8 serialization contract as a portable restore API",
        };
  return {
    v8Serialize: v8Evidence,
    structuredClone: structuredCloneEvidence,
    json: jsonEvidence,
    heapSnapshot: {
      inspected: runtime === "node",
      restoreSupported: false,
      finding:
        "heap snapshots are useful for inspection, but this proof does not treat them as a stable cross-ISA restore format",
    },
  };
}

async function inspectNodeV8Serialize(state, outDir) {
  const v8 = await import("node:v8");
  const payload = v8.serialize(state);
  const roundTrip = v8.deserialize(payload);
  writeFileSync(join(outDir, "node-v8-state.bin"), payload);
  return {
    supported: true,
    bytes: payload.length,
    preservesIdentity: identityAssertions(roundTrip).every((assertion) => assertion.same),
    preservesMap: roundTrip.map instanceof Map,
    versionBound: true,
    api: "node:v8.serialize",
  };
}

function inspectStructuredClone(state) {
  if (typeof structuredClone !== "function") {
    return { supported: false, reason: "structuredClone is not available" };
  }
  const cloned = structuredClone(state);
  return {
    supported: true,
    preservesIdentity: identityAssertions(cloned).every((assertion) => assertion.same),
    preservesMap: cloned.map instanceof Map,
    persistentFormat: false,
  };
}

function inspectJson(state) {
  const parsed = JSON.parse(JSON.stringify(state));
  return {
    supported: true,
    preservesIdentity: parsed.left.shared === parsed.right.shared,
    preservesMap: parsed.map && Object.keys(parsed.map).length > 0,
    finding:
      "JSON preserves values but loses object identity and Map shape without a sidecar graph encoding",
  };
}

async function restoreV8Payload(bundleDir, runtime) {
  const payloadPath = join(bundleDir, "node-v8-state.bin");
  if (runtime !== "node" || !existsSync(payloadPath)) {
    return { ok: false, reason: "no compatible V8 payload" };
  }
  const v8 = await import("node:v8");
  const restored = v8.deserialize(readFileSync(payloadPath));
  return {
    ok: identityAssertions(restored).every((assertion) => assertion.same),
    preservesMap: restored.map instanceof Map,
  };
}

function rebuildGraph(semanticState) {
  const byId = instantiateObjects(semanticState.objects);
  connectObjectReferences(semanticState.objects, byId);
  return rebuildRoots(semanticState.roots, byId);
}

function instantiateObjects(objects) {
  return new Map(objects.map((object) => [object.id, emptyRuntimeObject(object)]));
}

function emptyRuntimeObject(object) {
  return object.kind === "map" ? new Map() : { ...object.properties };
}

function connectObjectReferences(objects, byId) {
  objects.forEach((object) => connectRuntimeObject(object, byId.get(object.id), byId));
}

function connectRuntimeObject(object, target, byId) {
  Object.entries(object.references || {}).forEach(([name, ref]) => {
    target[name] = byId.get(ref);
  });
  if (object.kind === "map") {
    object.entries.forEach(([key, ref]) => target.set(key, byId.get(ref)));
  }
}

function rebuildRoots(roots, byId) {
  return {
    label: roots.label,
    counter: roots.counter,
    values: roots.values,
    shared: byId.get(roots.shared),
    left: byId.get(roots.left),
    right: byId.get(roots.right),
    list: [byId.get(roots.left), byId.get(roots.right), byId.get(roots.shared)],
    map: byId.get(roots.map),
  };
}

function validateGraph(graph, semanticState) {
  const checksum = checksumGraph(graph);
  if (checksum !== semanticState.checksumHex) {
    throw new Error(`semantic checksum mismatch: ${checksum} !== ${semanticState.checksumHex}`);
  }
  return {
    identityPreserved: identityAssertions(graph).every((assertion) => assertion.same),
    referencesRestored:
      graph.left.shared.label === "shared-runtime-object" &&
      graph.map.get("shared") === graph.shared,
  };
}

function checksumGraph(graph) {
  const hashInput = JSON.stringify({
    label: graph.label,
    counter: graph.counter,
    values: graph.values,
    shared: graph.shared,
    left: { name: graph.left.name, ordinal: graph.left.ordinal, shared: graph.left.shared.label },
    right: {
      name: graph.right.name,
      ordinal: graph.right.ordinal,
      shared: graph.right.shared.label,
    },
    mapKeys: [...graph.map.keys()],
  });
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(hashInput, "utf8")) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `0x${hash.toString(16)}`;
}

function markerLine(payload) {
  return `${RUNTIME_STATE_WORKLOAD_MARKER}${JSON.stringify({ schema_version: SCHEMA_VERSION, ...payload })}`;
}

const RUNTIME_DESCRIPTORS = new Map([
  ["node", () => ({ name: "node", version: process.versions.node, v8: process.versions.v8 })],
  ["bun", () => ({ name: "bun", version: globalThis.Bun?.version || "unknown" })],
]);

function runtimeDescriptor(runtime) {
  const describe =
    RUNTIME_DESCRIPTORS.get(runtime) || (() => ({ name: runtime, version: "unknown" }));
  return describe();
}

function runtimeConclusion(runtime, evidence) {
  if (runtime === "node" && evidence.v8Serialize.supported) {
    return "Node can restore this tiny graph from semantic state. v8.serialize is useful evidence, but a runtime-version-aware adapter plus graph sidecar is safer than raw heap bytes.";
  }
  return `${runtime} needs a runtime adapter or sidecar graph encoding for portable restore of object identity, Maps, and native handles.`;
}

function detectRuntime() {
  if (globalThis.Bun) {
    return "bun";
  }
  if (globalThis.process?.versions?.node) {
    return "node";
  }
  return "unknown";
}

function hostArch() {
  if (process.arch === "arm64") {
    return "arm64";
  }
  if (process.arch === "x64") {
    return "amd64";
  }
  return process.arch;
}

function jsonDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isDirectRun() {
  return process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
}

if (isDirectRun()) {
  runtimeStateWorkloadMain().catch((error) => {
    console.error(`machinen-runtime-state-workload: ${error.message}`);
    process.exit(1);
  });
}
