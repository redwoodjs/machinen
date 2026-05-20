#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MARKER = "MACHINEN_CONTROLLED_BINARY ";
const FIXTURES = ["global", "heap", "stack", "resource", "threads"];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO_ROOT, "packages/microvm/assets/controlled-binary-corpus.c");
const CROSS_TARGETS = [
  { arch: "arm64", triple: "aarch64-linux-musl", output: "machinen-controlled-corpus-linux-arm64" },
  { arch: "amd64", triple: "x86_64-linux-musl", output: "machinen-controlled-corpus-linux-amd64" },
];

function main() {
  const args = parseArgs(process.argv.slice(2));
  const workspace = createWorkspace(args);

  try {
    emitResult(verifyCorpus(workspace.outDir), args, workspace);
  } finally {
    cleanupWorkspace(workspace, args);
  }
}

const ARG_HANDLERS = [
  { match: (arg) => arg === "verify", consume: keepIndex },
  { match: (arg) => arg === "--out-dir", consume: consumeOutDir },
  { match: (arg) => arg.startsWith("--out-dir="), consume: consumeInlineOutDir },
  { match: (arg) => arg === "--json", consume: consumeJson },
  { match: (arg) => arg === "--keep", consume: consumeKeep },
  { match: (arg) => arg === "--help" || arg === "-h", consume: consumeHelp },
];

function parseArgs(argv) {
  const state = { outDir: "", json: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const handler = ARG_HANDLERS.find((candidate) => candidate.match(argv[i]));
    if (!handler) {
      usage(`unknown argument: ${argv[i]}`);
    }
    i = handler.consume(state, argv, i);
  }
  return state;
}

function keepIndex(_state, _argv, index) {
  return index;
}

function consumeOutDir(state, argv, index) {
  state.outDir = resolve(requireValue(argv[index + 1], "--out-dir"));
  return index + 1;
}

function consumeInlineOutDir(state, argv, index) {
  state.outDir = resolve(argv[index].slice("--out-dir=".length));
  return index;
}

function consumeJson(state, _argv, index) {
  state.json = true;
  return index;
}

function consumeKeep(state, _argv, index) {
  state.keep = true;
  return index;
}

function consumeHelp(_state, _argv, _index) {
  printUsage();
  process.exit(0);
}

function requireValue(value, flag) {
  if (!value) {
    usage(`${flag} requires a value`);
  }
  return value;
}

function createWorkspace(args) {
  if (args.outDir) {
    return { outDir: args.outDir, temporary: false };
  }
  return { outDir: mkdtempSync(join(tmpdir(), "machinen-controlled-corpus-")), temporary: true };
}

function emitResult(summary, args, workspace) {
  if (args.json) {
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    return;
  }
  printSummary(summary, workspace.temporary && !args.keep);
}

function cleanupWorkspace(workspace, args) {
  if (workspace.temporary && !args.keep) {
    rmSync(workspace.outDir, { recursive: true, force: true });
  }
}

function verifyCorpus(outDir) {
  if (!existsSync(SOURCE)) {
    throw new Error(`missing controlled binary corpus source: ${SOURCE}`);
  }

  mkdirSync(outDir, { recursive: true });
  const native = compileNative(outDir);
  const nativeRun = runNativeFixtures(native.executable, outDir);
  const crossBuilds = compileCrossTargets(outDir);
  const summary = { source: SOURCE, native: { ...native, ...nativeRun }, crossBuilds };
  validateSummary(summary);
  return summary;
}

function compileNative(outDir) {
  const nativeDir = join(outDir, "native");
  mkdirSync(nativeDir, { recursive: true });
  const executable = join(nativeDir, "machinen-controlled-corpus");
  const compiler = process.env.CC || "cc";
  runCommand(compiler, commonCompileArgs(executable), { label: "native controlled corpus build" });
  return { compiler, executable };
}

function compileCrossTargets(outDir) {
  ensureCommand("zig");
  const crossDir = join(outDir, "cross");
  mkdirSync(crossDir, { recursive: true });

  return CROSS_TARGETS.map((target) => {
    const executable = join(crossDir, target.output);
    runCommand("zig", ["cc", "-target", target.triple, ...commonCompileArgs(executable)], {
      label: `${target.arch} controlled corpus build`,
    });
    return { ...target, executable, bytes: statSync(executable).size };
  });
}

function commonCompileArgs(executable) {
  return [
    "-std=c11",
    "-O0",
    "-g",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-pthread",
    SOURCE,
    "-o",
    executable,
  ];
}

function runNativeFixtures(executable, outDir) {
  const resourceFile = join(outDir, "controlled-resource.txt");
  const result = runCommand(executable, ["--fixture", "all", "--resource-file", resourceFile], {
    label: "native controlled corpus run",
    env: { ...process.env, MACHINEN_CONTROLLED_ENV: "1" },
  });
  const events = parseEvents(result.stdout);
  return { arch: events[0]?.arch || "unknown", events, resourceFile };
}

function parseEvents(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(MARKER)) {
      continue;
    }
    events.push(JSON.parse(line.slice(MARKER.length)));
  }
  return events;
}

function validateSummary(summary) {
  const events = summary.native.events;
  const names = events.map((event) => event.fixture);
  assert(
    JSON.stringify(names) === JSON.stringify(FIXTURES),
    `fixtures ran in wrong order: ${names.join(",")}`,
  );
  assert(
    ["arm64", "amd64"].includes(summary.native.arch),
    `unexpected native arch: ${summary.native.arch}`,
  );

  const global = requireFixture(events, "global");
  assert(global.counter === 1000, "global fixture counter changed");
  assert(global.flags === 0xa5a5, "global fixture flags changed");
  assert(global.label === "global-scalar-v1", "global fixture label changed");

  const heap = requireFixture(events, "heap");
  assert(heap.node_count === 3, "heap fixture node count changed");
  assert(
    JSON.stringify(heap.values) === JSON.stringify([11, 22, 33]),
    "heap fixture values changed",
  );
  assert(Number.isFinite(heap.checksum) && heap.checksum > 0, "heap fixture checksum missing");

  const stack = requireFixture(events, "stack");
  assert(
    stack.continuation === "controlled_nested_stack_point",
    "stack fixture continuation changed",
  );
  assert(stack.caller_counter === 1000, "stack fixture caller counter changed");
  assert(stack.live_local === 5242, "stack fixture live local changed");

  const resource = requireFixture(events, "resource");
  assert(resource.argc === 5, "resource fixture argc changed");
  assert(resource.env_seen === true, "resource fixture did not observe test environment");
  assert(
    resource.file_bytes === "machinen-controlled-resource\n".length,
    "resource fixture byte count changed",
  );
  assert(resource.file_offset === 9, "resource fixture file offset changed");

  const threads = requireFixture(events, "threads");
  assert(threads.thread_count === 2, "thread fixture count changed");
  assert(
    JSON.stringify(threads.threads.map((thread) => thread.id)) === JSON.stringify([0, 1]),
    "thread fixture ids changed",
  );
  assert(
    JSON.stringify(threads.threads.map((thread) => thread.local_counter)) ===
      JSON.stringify([2001, 2002]),
    "thread fixture counters changed",
  );
  assert(
    threads.threads.every((thread) => thread.at_observation === true),
    "thread fixture missed observation point",
  );

  const crossArches = summary.crossBuilds.map((build) => build.arch);
  assert(
    JSON.stringify(crossArches) === JSON.stringify(["arm64", "amd64"]),
    "cross builds did not cover arm64 and amd64",
  );
  assert(
    summary.crossBuilds.every((build) => build.bytes > 0),
    "cross build output was empty",
  );
}

function requireFixture(events, fixture) {
  const event = events.find((item) => item.fixture === fixture);
  if (!event) {
    throw new Error(`missing fixture marker: ${fixture}`);
  }
  return event;
}

function runCommand(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: opts.env || process.env,
    maxBuffer: 20 * 1024 * 1024,
  });
  assertCommandStarted(result, opts.label || command);
  assertCommandPassed(result, opts.label || command);
  return result;
}

function assertCommandStarted(result, label) {
  if (result.error) {
    throw new Error(`${label} failed to start: ${result.error.message}`);
  }
}

function assertCommandPassed(result, label) {
  if (result.status !== 0) {
    throw new Error(
      `${label} failed with exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function ensureCommand(command) {
  const result = spawnSync(command, ["version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${command} is required to build the controlled corpus for both guest architectures`,
    );
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function printSummary(summary, temporary) {
  console.log(
    `controlled-binary-corpus: native ${summary.native.arch} ran ${summary.native.events.length} fixtures`,
  );
  for (const build of summary.crossBuilds) {
    console.log(
      `controlled-binary-corpus: built ${build.arch} (${build.triple}) ${build.bytes} bytes`,
    );
  }
  if (temporary) {
    console.log(
      "controlled-binary-corpus: temporary artifacts removed; pass --keep to inspect them",
    );
  }
}

function usage(message) {
  console.error(`controlled-binary-corpus: ${message}`);
  printUsage();
  process.exit(2);
}

function printUsage() {
  console.error(
    "usage: node scripts/controlled-binary-corpus.mjs [verify] [--out-dir path] [--json] [--keep]",
  );
}

main();
