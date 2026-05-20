#!/usr/bin/env tsx
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureJsBuildIdentity,
  verifyJsBuildIdentity,
} from "../packages/runtime/src/js-build-identity.ts";
import {
  captureNodeAsyncContinuations,
  restoreNodeAsyncContinuations,
} from "../packages/runtime/src/node-async-continuation.ts";
import {
  captureNodeRuntimeAdapterDocument,
  collectNodeRuntimeAdapterRefusals,
  restoreNodeRuntimeAdapterRoots,
} from "../packages/runtime/src/node-runtime-adapter.ts";
import { RUNTIME_ADAPTER_BUNDLE_FILE } from "../packages/runtime/src/runtime-adapter.ts";
import { validatePortableSnapshotBundle } from "../packages/runtime/src/vm/portable-snapshot.ts";
import { createPiStyleAgentState } from "../packages/microvm/assets/pi-style-agent-target.mjs";
import type {
  RuntimeAdapterDocument,
  RuntimeAdapterResource,
} from "../packages/runtime/src/runtime-adapter.ts";

const REPO_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const USAGE =
  "usage: tsx scripts/pi-style-runtime-target.ts [verify] [--out-dir path] [--json] [--keep]";

type Args = { outDir?: string; json: boolean; keep: boolean };

// fallow-ignore-next-line complexity
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const temporary = !args.outDir;
  const outDir = args.outDir ?? mkdtempSync(join(tmpdir(), "machinen-pi-runtime-target-"));
  try {
    const summary = await verifyPiStyleRuntimeTarget(outDir);
    if (args.json) {
      process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } else {
      console.log(
        `pi-style-runtime-target: restored semantic graph on ${summary.hostArch}; live process refused (${summary.liveRefusal.code})`,
      );
    }
  } finally {
    if (temporary && !args.keep) {
      rmSync(outDir, { recursive: true, force: true });
    }
  }
}

// fallow-ignore-next-line complexity
export async function verifyPiStyleRuntimeTarget(outDir: string) {
  mkdirSync(outDir, { recursive: true });
  const bundleDir = join(outDir, "bundle");
  const state = createPiStyleAgentState();
  const buildIdentity = captureJsBuildIdentity({
    rootDir: REPO_ROOT,
    entrypoints: ["packages/microvm/assets/pi-style-agent-target.mjs"],
    packageJsonPath: "package.json",
    lockfilePath: "pnpm-lock.yaml",
  });
  const runtimeAdapter = captureNodeRuntimeAdapterDocument(
    { agent: state },
    {
      target: {
        id: "pi-style-node-agent",
        name: "pi-style-node-agent",
        executable: "packages/microvm/assets/pi-style-agent-target.mjs",
      },
      build: buildIdentity.build,
      process: {
        argv: ["node", "pi-style-agent-target.mjs"],
        env: { PI_STYLE_AGENT: "1" },
        cwd: "/work",
      },
      includeStdioRefusals: true,
      nativeHandleRefusals: [
        { id: "agent:pty", kind: "pty", message: "interactive PTY sessions need host recreation" },
        { id: "agent:socket", kind: "socket", message: "agent sockets need host port rebinding" },
        {
          id: "agent:child",
          kind: "child-process",
          message: "child processes need process-tree recipes",
        },
      ],
    },
  );
  const asyncState = captureNodeAsyncContinuations([
    {
      id: "turn:resume",
      kind: "promise",
      handlerToken: "resume-turn",
      payload: { sharedSession: state.sharedSession, nextTurn: 3 },
    },
  ]);
  writeBundle(bundleDir, runtimeAdapter, buildIdentity, asyncState);
  const bundle = validatePortableSnapshotBundle(bundleDir);
  const restoredRoots = restoreNodeRuntimeAdapterRoots(bundle.runtimeAdapter!);
  const restoredAgent = (restoredRoots.agent ?? {}) as ReturnType<typeof createPiStyleAgentState>;
  const asyncRestored = await restoreNodeAsyncContinuations(asyncState, {
    "resume-turn": (payload) => {
      const value = payload as { sharedSession: { id: string }; nextTurn: number };
      return `${value.sharedSession.id}:${value.nextTurn}`;
    },
  });
  const buildCheck = verifyJsBuildIdentity(buildIdentity, {
    rootDir: REPO_ROOT,
    entrypoints: ["packages/microvm/assets/pi-style-agent-target.mjs"],
    packageJsonPath: "package.json",
    lockfilePath: "pnpm-lock.yaml",
  });
  const identityPreserved = restoredAgent.tools.get("bash") === restoredAgent.activeTool;
  const sharedPreserved = restoredAgent.tools.get("read")?.session === restoredAgent.sharedSession;
  if (!identityPreserved || !sharedPreserved || !buildCheck.accepted) {
    throw new Error("pi-style runtime target semantic restore failed");
  }
  return {
    formatVersion: 1,
    hostArch: hostArch(),
    bundleDir,
    target: "pi-style-node-agent",
    semanticStateRestored: true,
    identityPreserved,
    sharedPreserved,
    asyncContinuation: asyncRestored[0]?.result,
    liveProcessRestored: false,
    liveRefusal: runtimeAdapter.restore.refusal!,
    resourceRefusals: collectNodeRuntimeAdapterRefusals(runtimeAdapter).map(
      (refusal) => refusal.code,
    ),
    buildIdentityAccepted: buildCheck.accepted,
  };
}

function writeBundle(
  bundleDir: string,
  runtimeAdapter: RuntimeAdapterDocument,
  buildIdentity: unknown,
  asyncState: unknown,
) {
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(join(bundleDir, "logs"), { recursive: true });
  writeFileSync(join(bundleDir, "memory.bin"), Buffer.alloc(0));
  writeJson(join(bundleDir, "manifest.json"), manifest(runtimeAdapter));
  writeJson(join(bundleDir, "objects.json"), objects());
  writeJson(join(bundleDir, "relocations.json"), {
    formatVersion: 1,
    relocations: [],
    unsupported: unsupported(),
  });
  writeJson(join(bundleDir, "resources.json"), resources(runtimeAdapter.resources.resources));
  writeJson(join(bundleDir, RUNTIME_ADAPTER_BUNDLE_FILE), runtimeAdapter);
  writeJson(join(bundleDir, "js-build-identity.json"), buildIdentity);
  writeJson(join(bundleDir, "node-async-continuations.json"), asyncState);
  writeFileSync(join(bundleDir, "logs/source-target.log"), "pi-style runtime target captured\n");
}

function manifest(runtimeAdapter: RuntimeAdapterDocument) {
  return {
    formatVersion: 1,
    sourceGuestArch: hostArch(),
    allowedTargetGuestArchs: ["arm64", "amd64"],
    program: { name: "pi-style-node-agent", executable: "node", identity: "pi-style-node-agent" },
    sourceBuild: { buildId: "4394394394394390", version: "0.1.0" },
    targetBuild: { version: "0.1.x" },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
    },
    checkpointContinuation: { name: "pi_style_agent_semantic_checkpoint" },
    restoreEntrypoint: { name: "pi_style_agent_runtime_adapter_restore" },
    process: {
      argv: ["node", "pi-style-agent-target.mjs"],
      env: { PI_STYLE_AGENT: "1" },
      cwd: "/work",
    },
    features: ["pi-style-runtime-target", ...runtimeAdapter.bundleMapping.manifestFeatures],
    unsupported: unsupported(),
  };
}

function objects() {
  return {
    formatVersion: 1,
    objects: [
      { id: "js-root-state", kind: "opaque", type: "pi-style runtime roots" },
      { id: "js-object-graph", kind: "opaque", type: "pi-style runtime graph" },
      { id: "js-runtime-metadata", kind: "opaque", type: "pi-style runtime metadata" },
    ],
    unsupported: unsupported(),
  };
}

function resources(adapterResources: RuntimeAdapterResource[]) {
  return {
    formatVersion: 1,
    resources: adapterResources.map(portableResource),
    unsupported: unsupported(),
  };
}

function portableResource(resource: RuntimeAdapterResource) {
  return {
    id: resource.id,
    kind: portableResourceKind(resource.kind),
    state: resource.state,
    argv: portableArgv(resource),
    env: portableEnv(resource),
    path: portablePath(resource),
    refusal: resource.refusal,
  };
}

function portableArgv(resource: RuntimeAdapterResource): string[] | undefined {
  return resource.id === "argv"
    ? (resource.recipe?.detail?.argv as string[] | undefined)
    : undefined;
}

function portableEnv(resource: RuntimeAdapterResource): Record<string, string> | undefined {
  return resource.id === "env"
    ? (resource.recipe?.detail?.env as Record<string, string> | undefined)
    : undefined;
}

function portablePath(resource: RuntimeAdapterResource): string | undefined {
  return resource.id === "cwd" ? (resource.recipe?.detail?.cwd as string | undefined) : undefined;
}

function portableResourceKind(kind: string) {
  return ["argv", "fd", "file", "socket", "timer", "signal", "cwd", "env"].includes(kind)
    ? kind
    : "unknown";
}

// fallow-ignore-next-line complexity
function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, keep: false };
  const rest = argv[0] === "verify" ? argv.slice(1) : argv;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    if (arg === "--out-dir") {
      args.outDir = rest[++i];
    } else if (arg === "--json") {
      args.json = true;
    } else if (arg === "--keep") {
      args.keep = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(USAGE);
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return args;
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, jsonReplacer, 2)}\n`);
}

function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Promise) {
    return "<pending>";
  }
  return value;
}

function unsupported() {
  return { vocabularyVersion: 1, refusals: [] };
}

function hostArch() {
  return process.arch === "x64" ? "amd64" : "arm64";
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(
      `pi-style-runtime-target: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
