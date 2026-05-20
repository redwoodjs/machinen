#!/usr/bin/env node
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert,
  cleanupWorkspace,
  createWorkspace,
  emitResult,
  parseVerifyArgs,
  runCommand,
} from "./proof-script-utils.mjs";

const MARKER = "MACHINEN_CONTROLLED_BINARY ";
const FIXTURES = ["global", "heap", "stack", "continuation", "resource", "threads", "dwarf"];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(REPO_ROOT, "packages/microvm/assets/controlled-binary-corpus.c");
const CROSS_TARGETS = [
  { arch: "arm64", triple: "aarch64-linux-musl", output: "machinen-controlled-corpus-linux-arm64" },
  { arch: "amd64", triple: "x86_64-linux-musl", output: "machinen-controlled-corpus-linux-amd64" },
];
const USAGE =
  "usage: node scripts/controlled-binary-corpus.mjs [verify] [--out-dir path] [--json] [--keep]";

function main() {
  const args = parseVerifyArgs(process.argv.slice(2), USAGE);
  const workspace = createWorkspace(args, "machinen-controlled-corpus-");

  try {
    emitResult(verifyCorpus(workspace.outDir), args, workspace, printSummary);
  } finally {
    cleanupWorkspace(workspace, args);
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

  const continuation = requireFixture(events, "continuation");
  assert(
    continuation.continuation === "controlled_continuation_point",
    "continuation fixture id changed",
  );
  assert(continuation.seed === 1000, "continuation fixture seed changed");
  assert(continuation.live_local === 5242, "continuation fixture live local changed");
  assert(continuation.resume_delta === 77, "continuation fixture resume delta changed");

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

  const dwarf = requireFixture(events, "dwarf");
  assert(dwarf.global.label === "dwarf-global-layout-v2", "dwarf global label changed");
  assert(dwarf.global.counter === 7000, "dwarf global counter changed");
  assert(dwarf.global.flags === 0x5a5a, "dwarf global flags changed");
  assert(dwarf.global.generation === 7, "dwarf global generation changed");
  assert(dwarf.heap.node_count === 3, "dwarf heap node count changed");
  assert(
    JSON.stringify(dwarf.heap.values) === JSON.stringify([111, 222, 333]),
    "dwarf heap values changed",
  );
  assert(
    JSON.stringify(dwarf.heap.tags) === JSON.stringify([101, 102, 103]),
    "dwarf heap tags changed",
  );
  assert(
    JSON.stringify(dwarf.heap.colors) === JSON.stringify([3, 5, 7]),
    "dwarf heap colors changed",
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

function ensureCommand(command) {
  runCommand(command, ["version"], {
    label: `${command} is required to build the controlled corpus for both guest architectures`,
  });
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

main();
