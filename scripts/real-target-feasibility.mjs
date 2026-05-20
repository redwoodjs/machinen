#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  REPO_ROOT,
  bundleFileStats as sharedBundleFileStats,
  hostArch,
  jsonDocument,
  readJson,
  sha256File,
  unsupportedVocabulary,
} from "./controlled-corpus-utils.mjs";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
} from "./proof-script-utils.mjs";

const USAGE =
  "usage: node scripts/real-target-feasibility.mjs [verify|restore] [--out-dir path] [--bundle path] [--json] [--keep]";
const TARGET_ID = "machinen-cli-node";
const BUILD_ID = "4224224224224220";
const CLI_SOURCE = join(REPO_ROOT, "packages/cli/src/cli.ts");
const CLI_PACKAGE = join(REPO_ROOT, "packages/cli/package.json");
const BUNDLE_FILE = "real-target.json";
const LIVE_REFUSAL = {
  code: "runtime-heap-unsupported",
  message:
    "live Node process restore needs a runtime adapter that can enumerate JS roots, object identity, async queues, and native handles",
  detail: {
    requiredMetadata: [
      "Node runtime version and V8 heap/serializer compatibility",
      "module graph and source/build identity",
      "semantic JS roots with reference ids",
      "native handles for stdio, sockets, timers, child processes, and PTYs",
    ],
  },
};

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.mode === "restore") {
    emitRestore(args);
    return;
  }

  const workspace = createWorkspace(args, "machinen-real-target-feasibility-");
  try {
    emitResult(verifyRealTarget(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

function parseArgs(argv) {
  if (argv[0] === "restore") {
    return { ...parseRestoreArgs(argv.slice(1)), mode: "restore" };
  }
  const rest = argv[0] === "verify" ? argv.slice(1) : argv;
  return { ...parseVerifyArgs(rest, USAGE), bundle: "", mode: "verify" };
}

const RESTORE_ARG_HANDLERS = [
  { match: (arg) => arg === "--bundle", apply: restoreBundleArg },
  { match: (arg) => arg.startsWith("--bundle="), apply: restoreInlineBundleArg },
  { match: (arg) => arg === "--json", apply: restoreJsonArg },
  { match: (arg) => arg === "--help" || arg === "-h", apply: restoreHelpArg },
];

function parseRestoreArgs(argv) {
  const state = { bundle: "", json: false, outDir: "", keep: false };
  for (let index = 0; index < argv.length; index++) {
    const handler = RESTORE_ARG_HANDLERS.find((candidate) => candidate.match(argv[index]));
    if (!handler) {
      throw new Error(`unknown restore argument: ${argv[index]}`);
    }
    index = handler.apply(state, argv, index);
  }
  return state;
}

function restoreBundleArg(state, argv, index) {
  state.bundle = requireValue(argv[index + 1], "--bundle");
  return index + 1;
}

function restoreInlineBundleArg(state, argv, index) {
  state.bundle = argv[index].slice("--bundle=".length);
  return index;
}

function restoreJsonArg(state, _argv, index) {
  state.json = true;
  return index;
}

function restoreHelpArg() {
  console.error(USAGE);
  process.exit(0);
}

function requireValue(value, flag) {
  if (!value) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function verifyRealTarget(outDir) {
  mkdirSync(outDir, { recursive: true });
  const bundleDir = join(outDir, "bundle");
  const target = captureTargetMetadata();
  writeBundle(bundleDir, target);
  const restoreEvent = restoreBundle(bundleDir);
  const mismatchRefusal = restoreWithMismatchedSource(bundleDir);
  validateRestore(target, restoreEvent, mismatchRefusal);
  return {
    formatVersion: 1,
    hostArch: hostArch(),
    target,
    bundleDir,
    restoreEvent,
    mismatchRefusal,
    plan: supportPlan(target),
    bundleFiles: bundleFileStats(bundleDir),
  };
}

function captureTargetMetadata() {
  const source = readFileSync(CLI_SOURCE, "utf8");
  const pkg = readJson(CLI_PACKAGE);
  return {
    formatVersion: 1,
    target: {
      id: TARGET_ID,
      name: pkg.name,
      version: pkg.version,
      kind: "real-node-cli",
      executable: pkg.bin?.machinen || "./dist/cli.js",
      source: CLI_SOURCE,
      package: CLI_PACKAGE,
    },
    sourceGuestArch: hostArch(),
    buildIdentity: {
      sourceSha256: sha256File(CLI_SOURCE),
      packageSha256: sha256File(CLI_PACKAGE),
    },
    semanticMetadata: {
      commandSurface: commandSurface(source),
      imports: importSummary(source),
      runtime: { name: "node", minimumMajor: 20, observed: process.versions.node },
      resources: resourceModel(),
    },
    restore: {
      semanticMetadataSupported: true,
      liveProcessSupported: false,
      refusal: LIVE_REFUSAL,
    },
  };
}

function commandSurface(source) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === "// Surface:");
  assert(start >= 0, "CLI source is missing Surface comment");
  return lines
    .slice(start + 1)
    .filter((line) => line.startsWith("//   machinen"))
    .map((line) => line.replace(/^\/\/\s+/, ""));
}

function importSummary(source) {
  const imports = [...source.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1]);
  return {
    builtin: imports.filter((name) => name.startsWith("node:")),
    workspace: imports.filter((name) => name.startsWith("@machinen/")),
    relative: imports.filter((name) => name.startsWith(".")),
    external: imports.filter(
      (name) =>
        !name.startsWith("node:") && !name.startsWith("@machinen/") && !name.startsWith("."),
    ),
  };
}

function resourceModel() {
  return {
    captured: ["argv", "env", "cwd", "module-graph"],
    refused: [
      {
        kind: "fd",
        code: "fd-kind-unsupported",
        reason: "stdio and inherited file descriptors are native handles",
      },
      {
        kind: "socket",
        code: "resource-unsupported",
        reason: "port forwards and sockets need host-specific rebinding",
      },
      {
        kind: "timer",
        code: "runtime-heap-unsupported",
        reason: "Node timers and async queues need a runtime adapter",
      },
      {
        kind: "pty",
        code: "resource-unsupported",
        reason: "interactive attach/fork paths need PTY handle recreation",
      },
    ],
  };
}

function writeBundle(bundleDir, target) {
  mkdirSync(bundleDir, { recursive: true });
  mkdirSync(join(bundleDir, "logs"), { recursive: true });
  writeFileSync(join(bundleDir, "memory.bin"), Buffer.alloc(0));
  for (const [name, value] of bundleDocuments(target)) {
    writeFileSync(join(bundleDir, name), jsonDocument(value));
  }
  writeFileSync(join(bundleDir, "logs/source-target.log"), `${TARGET_ID} metadata captured\n`);
}

function bundleDocuments(target) {
  return [
    ["manifest.json", manifest(target)],
    ["objects.json", objects(target)],
    ["relocations.json", relocations()],
    ["resources.json", resources(target)],
    [BUNDLE_FILE, target],
  ];
}

function manifest(target) {
  return {
    formatVersion: 1,
    sourceGuestArch: target.sourceGuestArch,
    allowedTargetGuestArchs: ["arm64", "amd64"],
    program: {
      name: target.target.name,
      executable: target.target.executable,
      identity: `com.redwoodjs.machinen.${TARGET_ID}`,
    },
    sourceBuild: { buildId: BUILD_ID, version: target.target.version },
    targetBuild: { version: target.target.version },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
    },
    checkpointContinuation: { name: "machinen_cli_semantic_metadata" },
    restoreEntrypoint: { name: "machinen_cli_runtime_adapter" },
    process: {
      argv: ["machinen", "--help"],
      env: { MACHINEN_REAL_TARGET_PROBE: "1" },
      cwd: process.cwd(),
    },
    features: ["real-target-feasibility", "node-cli-semantic-metadata", "runtime-adapter-refusal"],
    unsupported: unsupportedVocabulary(),
  };
}

function objects(target) {
  return {
    formatVersion: 1,
    objects: [
      {
        id: "machinen-cli-command-surface",
        kind: "opaque",
        type: "Node CLI command surface",
        sizeBytes: target.semanticMetadata.commandSurface.length,
      },
      {
        id: "machinen-cli-module-graph",
        kind: "opaque",
        type: "Node ESM import graph summary",
        sizeBytes: importCount(target.semanticMetadata.imports),
      },
      {
        id: "machinen-cli-runtime-handles",
        kind: "opaque",
        type: "Node runtime/native handle refusals",
        sizeBytes: target.semanticMetadata.resources.refused.length,
      },
    ],
    unsupported: unsupportedVocabulary(),
  };
}

function importCount(imports) {
  return (
    imports.builtin.length +
    imports.workspace.length +
    imports.relative.length +
    imports.external.length
  );
}

function relocations() {
  return { formatVersion: 1, relocations: [], unsupported: unsupportedVocabulary() };
}

function resources(target) {
  return {
    formatVersion: 1,
    resources: [
      { id: "argv", kind: "argv", state: "captured", argv: ["machinen", "--help"] },
      { id: "env", kind: "env", state: "captured", env: { MACHINEN_REAL_TARGET_PROBE: "1" } },
      { id: "cwd", kind: "cwd", state: "captured", path: process.cwd() },
      ...target.semanticMetadata.resources.refused.map((item, index) => ({
        id: `refused-${index}-${item.kind}`,
        kind: item.kind === "pty" ? "unknown" : item.kind,
        state: "refused",
        fd: item.kind === "fd" ? 1 : undefined,
        refusal: { code: item.code, message: item.reason },
      })),
    ],
    unsupported: unsupportedVocabulary(),
  };
}

function restoreBundle(bundleDir) {
  const target = readJson(join(bundleDir, BUNDLE_FILE));
  const current = captureTargetMetadata();
  const matching = compareTargetMetadata(target, current);
  if (!matching.accepted) {
    return matching;
  }
  return {
    accepted: true,
    mode: "restore",
    target: target.target.id,
    arch: hostArch(),
    semanticMetadataRestored: true,
    liveProcessRestored: false,
    commandCount: target.semanticMetadata.commandSurface.length,
    moduleImportCount: importCount(target.semanticMetadata.imports),
    refusal: target.restore.refusal,
  };
}

function compareTargetMetadata(expected, actual) {
  const expectedIdentity = expected.buildIdentity;
  const actualIdentity = actual.buildIdentity;
  if (expectedIdentity.sourceSha256 !== actualIdentity.sourceSha256) {
    return targetMismatch(
      "sourceSha256",
      expectedIdentity.sourceSha256,
      actualIdentity.sourceSha256,
    );
  }
  if (expectedIdentity.packageSha256 !== actualIdentity.packageSha256) {
    return targetMismatch(
      "packageSha256",
      expectedIdentity.packageSha256,
      actualIdentity.packageSha256,
    );
  }
  return { accepted: true };
}

function targetMismatch(field, expected, actual) {
  return {
    accepted: false,
    refusal: {
      code: "target-build-mismatch",
      message: `real target ${field} does not match bundle metadata`,
      detail: { target: TARGET_ID, field, expected, actual },
    },
  };
}

function restoreWithMismatchedSource(bundleDir) {
  const target = readJson(join(bundleDir, BUNDLE_FILE));
  const mismatched = {
    ...target,
    buildIdentity: { ...target.buildIdentity, sourceSha256: "0".repeat(64) },
  };
  return compareTargetMetadata(mismatched, captureTargetMetadata());
}

function validateRestore(target, restoreEvent, mismatchRefusal) {
  assert(restoreEvent.accepted === true, "real target metadata did not restore");
  assert(restoreEvent.semanticMetadataRestored === true, "semantic metadata was not restored");
  assert(restoreEvent.liveProcessRestored === false, "live process restore should still refuse");
  assert(
    restoreEvent.commandCount === target.semanticMetadata.commandSurface.length,
    "command surface changed",
  );
  assert(restoreEvent.refusal.code === "runtime-heap-unsupported", "missing live-process refusal");
  assert(mismatchRefusal.accepted === false, "mismatched target should refuse");
  assert(
    mismatchRefusal.refusal.code === "target-build-mismatch",
    "mismatched target refusal changed",
  );
}

function supportPlan(target) {
  return {
    chosenTarget: "Machinen Node CLI",
    reason:
      "it is a real Node command-line app with a module graph, VM operations, stdio, sockets, PTYs, and async runtime state",
    semanticRestore:
      "command surface, package identity, source identity, import graph summary, argv/env/cwd, and refusal rules restore across architectures",
    fullLiveRestoreRequires: target.restore.refusal.detail.requiredMetadata,
  };
}

function emitRestore(args) {
  const event = restoreBundle(requireRestoreBundle(args));
  if (args.json) {
    process.stdout.write(`${JSON.stringify(event, null, 2)}\n`);
    return;
  }
  console.log(restoreMessage(event));
}

function requireRestoreBundle(args) {
  const bundle = args.bundle || args.outDir;
  if (!bundle) {
    throw new Error("restore requires --bundle <path>");
  }
  return bundle;
}

function restoreMessage(event) {
  return event.accepted
    ? `real-target-feasibility: restored ${event.target} semantic metadata on ${event.arch}`
    : `real-target-feasibility: refused (${event.refusal.code})`;
}

function bundleFileStats(bundleDir) {
  return sharedBundleFileStats(bundleDir, [
    "manifest.json",
    "objects.json",
    "relocations.json",
    "resources.json",
    BUNDLE_FILE,
    "memory.bin",
  ]);
}

function printSummary(summary, temporary) {
  console.log(
    `real-target-feasibility: ${summary.hostArch} restored ${summary.target.target.name} semantic metadata`,
  );
  console.log(
    `real-target-feasibility: live process restore refused (${summary.restoreEvent.refusal.code})`,
  );
  if (temporary) {
    console.log(
      "real-target-feasibility: temporary artifacts removed; pass --keep to inspect them",
    );
  }
}

main();
