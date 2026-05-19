#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const MARKER = "MACHINEN_PORTABLE_PROOF ";
const EXPECTED_LIST = [1, 2, 3];
const EXPECTED_ROOT_NAMES = [
  "machinen_portable_app_state",
  "machinen_portable_nodes",
  "machinen_portable_heap_bytes",
];
const EXPECTED_HEAP_BYTES = [
  0x4d, 0x61, 0x63, 0x68, 0x69, 0x6e, 0x65, 0x6e, 0x2d, 0x70, 0x72, 0x6f, 0x6f, 0x66, 0x21, 0x00,
];
const VALID_PHASES = ["checkpoint", "restore", "continue"];
const EXPECTED_THREAD_CONTINUATIONS = [
  "machinen_portable_checkpoint",
  "machinen_portable_worker_continue",
];
const VALID_ARCHES = ["arm64", "amd64"];
const EXPECTED_SYMBOLS = {
  checkpoint_symbol: "machinen_checkpoint",
  checkpoint_continuation: "machinen_portable_checkpoint",
  restore_symbol: "machinen_restore_main",
  restore_continuation: "machinen_portable_restore_entry",
  state_symbol: "machinen_portable_app_state",
};

const ARG_PARSERS = [
  {
    match: (arg) => arg === "-",
    consume: (state, index, arg) => {
      state.positional.push(arg);
      return index;
    },
  },
  {
    match: (arg) => arg.startsWith("--expect-arch="),
    consume: (state, index, arg) => {
      state.opts.expectArch = arg.slice("--expect-arch=".length);
      return index;
    },
  },
  {
    match: (arg) => arg.startsWith("--bundle-dir="),
    consume: (state, index, arg) => {
      state.opts.bundleDir = arg.slice("--bundle-dir=".length);
      return index;
    },
  },
  {
    match: (arg) => FLAG_HANDLERS.has(arg),
    consume: (state, index, arg) => FLAG_HANDLERS.get(arg)(state, index),
  },
  {
    match: (arg) => arg.startsWith("-"),
    consume: (_state, _index, arg) => usage(`unknown flag: ${arg}`),
  },
  {
    match: () => true,
    consume: (state, index, arg) => {
      state.positional.push(arg);
      return index;
    },
  },
];

const FLAG_HANDLERS = new Map([
  [
    "--require-restore",
    (state, index) => {
      state.opts.requireRestore = true;
      return index;
    },
  ],
  [
    "--require-continue",
    (state, index) => {
      state.opts.requireContinue = true;
      return index;
    },
  ],
  [
    "--require-threads",
    (state, index) => {
      state.opts.requireThreads = true;
      return index;
    },
  ],
  ["--expect-arch", (state, index) => readOptionValue(state, index, "expectArch", "--expect-arch")],
  ["--bundle-dir", (state, index) => readOptionValue(state, index, "bundleDir", "--bundle-dir")],
  [
    "--help",
    () => {
      printUsage();
      process.exit(0);
    },
  ],
  [
    "-h",
    () => {
      printUsage();
      process.exit(0);
    },
  ],
]);

function readOptionValue(state, index, key, flag) {
  const value = state.argv[index + 1];
  if (!value) {
    usage(`${flag} requires a value`);
  }
  state.opts[key] = value;
  return index + 1;
}

export function parsePortableProofEvents(text) {
  const events = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(MARKER);
    if (idx === -1) {
      continue;
    }
    const payload = line.slice(idx + MARKER.length);
    try {
      events.push(JSON.parse(payload));
    } catch (err) {
      throw new Error(`invalid portable proof marker JSON on line ${i + 1}: ${err.message}`);
    }
  }
  return events;
}

export function validatePortableProofEvents(events, opts = {}) {
  const errors = [];
  const phases = collectPhases(events);

  validateRequiredPhases(errors, phases, opts);
  validateEventList(errors, events, opts.expectArch);
  validateCrossPhaseState(errors, phases);
  validateThreadProof(errors, events, opts);

  return errors;
}

function collectPhases(events) {
  return {
    checkpoint: firstPhase(events, "checkpoint"),
    restore: firstPhase(events, "restore"),
    continues: events.filter((event) => event.phase === "continue"),
  };
}

function validateRequiredPhases(errors, phases, opts) {
  pushIf(errors, !phases.checkpoint, "missing checkpoint marker");
  pushIf(errors, opts.requireRestore && !phases.restore, "missing restore marker");
  pushIf(errors, opts.requireContinue && phases.continues.length === 0, "missing continue marker");
}

function validateEventList(errors, events, expectArch) {
  for (const [i, event] of events.entries()) {
    validateEventShape(errors, event, i, expectArch);
  }
}

function validateCrossPhaseState(errors, phases) {
  validateExpectedPhaseState(errors, "checkpoint", phases.checkpoint);
  validateExpectedPhaseState(errors, "restore", phases.restore);
  validateRestoreMatchesCheckpoint(errors, phases.checkpoint, phases.restore);
  validateForwardProgress(errors, phases.continues);
}

function validateExpectedPhaseState(errors, phase, event) {
  if (event) {
    validateSnapshotState(errors, phase, event, 1000);
  }
}

function validateRestoreMatchesCheckpoint(errors, checkpoint, restore) {
  pushIf(
    errors,
    Boolean(checkpoint) && Boolean(restore) && !sameList(checkpoint.list, restore.list),
    "restore list does not match checkpoint list",
  );
}

function validateForwardProgress(errors, continues) {
  pushIf(
    errors,
    continues.length > 0 && !continues.some((event) => Number(event.counter) > 1000),
    "continue markers never increment counter beyond 1000",
  );
}

function validateThreadProof(errors, events, opts) {
  if (!opts.requireThreads) {
    return;
  }
  const threaded = events.find(
    (event) => event.thread_count === EXPECTED_THREAD_CONTINUATIONS.length,
  );
  if (!threaded) {
    errors.push("missing two-thread proof marker");
    return;
  }
  pushIf(
    errors,
    !sameList(threaded.thread_continuations, EXPECTED_THREAD_CONTINUATIONS),
    `thread continuations expected ${JSON.stringify(EXPECTED_THREAD_CONTINUATIONS)}, got ${JSON.stringify(threaded.thread_continuations)}`,
  );
}

function firstPhase(events, phase) {
  return events.find((event) => event.phase === phase);
}

function validateEventShape(errors, event, i, expectArch) {
  const prefix = `event[${i}]`;
  validateBasicEventFields(errors, prefix, event, expectArch);
  validateCheckpointAbiFields(errors, prefix, event);
  validateProofSymbols(errors, prefix, event);
}

function validateBasicEventFields(errors, prefix, event, expectArch) {
  pushIf(errors, event.schema_version !== 1, `${prefix}.schema_version must be 1`);
  pushIf(
    errors,
    !VALID_PHASES.includes(event.phase),
    `${prefix}.phase is unknown: ${JSON.stringify(event.phase)}`,
  );
  pushIf(errors, !VALID_ARCHES.includes(event.arch), `${prefix}.arch must be arm64 or amd64`);
  pushIf(
    errors,
    Boolean(expectArch) && event.arch !== expectArch,
    `${prefix}.arch expected ${expectArch}, got ${event.arch}`,
  );
  pushIf(errors, !Number.isInteger(event.counter), `${prefix}.counter must be an integer`);
  pushIf(
    errors,
    !sameList(event.list, EXPECTED_LIST),
    `${prefix}.list expected [1,2,3], got ${JSON.stringify(event.list)}`,
  );
}

function validateCheckpointAbiFields(errors, prefix, event) {
  pushIf(errors, event.checkpoint_abi_version !== 1, `${prefix}.checkpoint_abi_version must be 1`);
  pushIf(
    errors,
    event.checkpoint_result !== 0,
    `${prefix}.checkpoint_result expected 0, got ${JSON.stringify(event.checkpoint_result)}`,
  );
  pushIf(
    errors,
    event.root_count !== EXPECTED_ROOT_NAMES.length,
    `${prefix}.root_count expected ${EXPECTED_ROOT_NAMES.length}, got ${JSON.stringify(event.root_count)}`,
  );
  pushIf(
    errors,
    !sameList(event.root_names, EXPECTED_ROOT_NAMES),
    `${prefix}.root_names expected ${JSON.stringify(EXPECTED_ROOT_NAMES)}, got ${JSON.stringify(event.root_names)}`,
  );
  validateAllocationFields(errors, prefix, event);
  validateSafePoint(errors, prefix, event.safe_point);
}

function validateAllocationFields(errors, prefix, event) {
  pushIf(errors, event.allocation_count !== 1, `${prefix}.allocation_count must be 1`);
  pushIf(
    errors,
    !sameList(event.heap_bytes, EXPECTED_HEAP_BYTES),
    `${prefix}.heap_bytes expected ${JSON.stringify(EXPECTED_HEAP_BYTES)}, got ${JSON.stringify(event.heap_bytes)}`,
  );
}

function validateSafePoint(errors, prefix, safePoint) {
  pushIf(
    errors,
    !safePoint || safePoint.outside_signal_handler !== true,
    `${prefix}.safe_point.outside_signal_handler must be true`,
  );
  pushIf(
    errors,
    !safePoint || safePoint.outside_syscall !== true,
    `${prefix}.safe_point.outside_syscall must be true`,
  );
}

function validateProofSymbols(errors, prefix, event) {
  for (const [field, expected] of Object.entries(EXPECTED_SYMBOLS)) {
    pushIf(
      errors,
      event[field] !== expected,
      `${prefix}.${field} expected ${expected}, got ${JSON.stringify(event[field])}`,
    );
  }
}

function validateSnapshotState(errors, phase, event, expectedCounter) {
  pushIf(
    errors,
    event.counter !== expectedCounter,
    `${phase}.counter expected ${expectedCounter}, got ${event.counter}`,
  );
  pushIf(
    errors,
    !sameList(event.list, EXPECTED_LIST),
    `${phase}.list expected [1,2,3], got ${JSON.stringify(event.list)}`,
  );
}

function validatePortableProofBundle(dir) {
  const errors = [];
  const bundle = readPortableBundleDocuments(errors, dir);
  validateOptionalBundleObjects(errors, bundle.objects, bundle.memory);
  validateOptionalBundleRelocations(errors, bundle.relocations);
  validateOptionalBundleResources(errors, bundle.resources);
  validateOptionalBundleThreads(errors, bundle.threads);
  return errors;
}

function readPortableBundleDocuments(errors, dir) {
  return {
    objects: readBundleJson(errors, dir, "objects.json"),
    relocations: readBundleJson(errors, dir, "relocations.json"),
    resources: readBundleJson(errors, dir, "resources.json"),
    threads: readOptionalBundleJson(errors, dir, "threads.json"),
    memory: readBundleFile(errors, dir, "memory.bin"),
  };
}

function validateOptionalBundleObjects(errors, objects, memory) {
  if (objects && memory) {
    validateBundleObjects(errors, objects, memory);
  }
}

function validateOptionalBundleRelocations(errors, relocations) {
  if (relocations) {
    validateBundleRelocations(errors, relocations);
  }
}

function validateOptionalBundleResources(errors, resources) {
  if (resources) {
    validateBundleResources(errors, resources);
  }
}

function readBundleJson(errors, dir, name) {
  try {
    return JSON.parse(readFileSync(join(dir, name), "utf8"));
  } catch (err) {
    errors.push(`${name} is not readable JSON: ${err.message}`);
    return undefined;
  }
}

function readOptionalBundleJson(errors, dir, name) {
  if (!existsSync(join(dir, name))) {
    return undefined;
  }
  return readBundleJson(errors, dir, name);
}

function readBundleFile(errors, dir, name) {
  try {
    return readFileSync(join(dir, name));
  } catch (err) {
    errors.push(`${name} is not readable: ${err.message}`);
    return undefined;
  }
}

function validateBundleObjects(errors, objectsDoc, memory) {
  const objects = Array.isArray(objectsDoc.objects) ? objectsDoc.objects : [];
  const globals = objects.filter((object) => object.kind === "global");
  const heap = objects.find((object) => object.id === "heap-1");
  pushIf(errors, globals.length < 2, "objects.json must capture global roots separately");
  validateHeapBundleObject(errors, heap, memory);
}

function validateOptionalBundleThreads(errors, threads) {
  if (threads) {
    validateBundleThreads(errors, threads);
  }
}

function validateBundleThreads(errors, threadsDoc) {
  const threads = Array.isArray(threadsDoc.threads) ? threadsDoc.threads : [];
  pushIf(errors, threadsDoc.formatVersion !== 1, "threads.json formatVersion must be 1");
  pushIf(errors, threads.length !== 2, "threads.json must record two cooperative threads");
  pushIf(
    errors,
    threadsDoc.barrier?.participants !== 2,
    "threads.json barrier participants must be 2",
  );
  pushIf(errors, threadsDoc.barrier?.state !== "complete", "threads.json barrier must be complete");
  pushIf(
    errors,
    !sameList(
      threads.map((thread) => thread.continuation),
      EXPECTED_THREAD_CONTINUATIONS,
    ),
    "threads.json continuations do not match expected checkpoint continuations",
  );
  pushIf(
    errors,
    !threads.every((thread) => thread.localState?.atBarrier === true),
    "threads.json must record every thread at the checkpoint barrier",
  );
}

function validateBundleResources(errors, resourcesDoc) {
  const resources = Array.isArray(resourcesDoc.resources) ? resourcesDoc.resources : [];
  pushIf(
    errors,
    !resources.some((resource) => resource.kind === "argv"),
    "resources.json missing argv",
  );
  pushIf(
    errors,
    !resources.some((resource) => resource.kind === "env"),
    "resources.json missing env",
  );
  pushIf(
    errors,
    !resources.some((resource) => resource.kind === "cwd"),
    "resources.json missing cwd",
  );
  const file = resources.find((resource) => resource.id === "file-1");
  if (file) {
    validateFileResource(errors, file);
  }
}

function validateFileResource(errors, file) {
  pushIf(errors, file.kind !== "file", "file-1 must be a file resource");
  pushIf(errors, typeof file.path !== "string" || file.path.length === 0, "file-1 path invalid");
  pushIf(errors, file.fd !== 3, "file-1 fd must be 3");
  pushIf(errors, !sameList(file.flags, ["read"]), "file-1 flags must be [read]");
  pushIf(errors, file.offset !== 4, "file-1 offset must be 4");
}

function validateBundleRelocations(errors, relocationsDoc) {
  const relocations = Array.isArray(relocationsDoc.relocations) ? relocationsDoc.relocations : [];
  const pointerRelocations = relocations.filter((relocation) => relocation.kind === "pointer");
  pushIf(errors, pointerRelocations.length !== 3, "relocations.json must record 3 pointer fields");
  for (const relocation of pointerRelocations) {
    validatePointerRelocation(errors, relocation);
  }
}

function validatePointerRelocation(errors, relocation) {
  pushIf(errors, relocation.fromObject === undefined, "pointer relocation missing fromObject");
  pushIf(errors, relocation.toObject === undefined, "pointer relocation missing toObject");
  pushIf(errors, !Number.isInteger(relocation.fromOffset), "pointer relocation offset invalid");
  pushIf(
    errors,
    !isHexAddress(relocation.sourcePointer),
    "pointer relocation source pointer invalid",
  );
}

function validateHeapBundleObject(errors, heap, memory) {
  if (!heap) {
    errors.push("objects.json missing heap-1 allocation");
    return;
  }
  pushIf(errors, heap.kind !== "heap", "heap-1 must be a heap object");
  pushIf(errors, heap.allocation?.id !== 1, "heap-1 allocation.id must be 1");
  pushIf(
    errors,
    !isHexAddress(heap.allocation?.sourceAddress),
    "heap-1 allocation source address invalid",
  );
  validateHeapMemory(errors, heap.memory, memory);
}

function validateHeapMemory(errors, range, memory) {
  if (!validMemoryRange(range, memory.length)) {
    errors.push("heap-1 memory range is invalid");
    return;
  }
  const actual = Array.from(memory.subarray(range.offset, range.offset + range.sizeBytes));
  pushIf(
    errors,
    !sameList(actual, EXPECTED_HEAP_BYTES),
    `heap-1 bytes expected ${JSON.stringify(EXPECTED_HEAP_BYTES)}, got ${JSON.stringify(actual)}`,
  );
}

const MEMORY_RANGE_CHECKS = [
  (range) => Number.isInteger(range?.offset),
  (range) => Number.isInteger(range?.sizeBytes),
  (range) => range.offset >= 0,
  (range) => range.sizeBytes === EXPECTED_HEAP_BYTES.length,
  (range, memorySize) => range.offset + range.sizeBytes <= memorySize,
];

function validMemoryRange(range, memorySize) {
  return MEMORY_RANGE_CHECKS.every((check) => check(range, memorySize));
}

function isHexAddress(value) {
  return typeof value === "string" && /^0x[0-9a-fA-F]+$/.test(value);
}

function sameList(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === b.length &&
    a.every((value, index) => value === b[index])
  );
}

function pushIf(errors, condition, message) {
  if (condition) {
    errors.push(message);
  }
}

function parseArgs(argv) {
  const state = {
    argv,
    opts: {
      requireRestore: false,
      requireContinue: false,
      requireThreads: false,
      expectArch: undefined,
      bundleDir: undefined,
    },
    positional: [],
  };
  for (let i = 0; i < argv.length; i++) {
    i = consumeArg(state, i);
  }
  validateArgs(state);
  return { ...state.opts, path: state.positional[0] };
}

function consumeArg(state, index) {
  const arg = state.argv[index];
  const parser = ARG_PARSERS.find((candidate) => candidate.match(arg));
  return parser.consume(state, index, arg);
}

function validateArgs(state) {
  if (state.opts.expectArch && !VALID_ARCHES.includes(state.opts.expectArch)) {
    usage(`--expect-arch must be arm64 or amd64 (got ${state.opts.expectArch})`);
  }
  if (state.positional.length !== 1) {
    usage("expected one log file path or '-'");
  }
}

function usage(message) {
  process.stderr.write(`portable-proof-compare: ${message}\n`);
  printUsage();
  process.exit(2);
}

function printUsage() {
  process.stderr.write(
    "usage: node scripts/portable-proof-compare.mjs [--expect-arch arm64|amd64] " +
      "[--bundle-dir dir] [--require-restore] [--require-continue] " +
      "[--require-threads] <log-file|->\n",
  );
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  const events = readEvents(opts);
  const errors = collectValidationErrors(events, opts);
  exitOnErrors(errors);
  writeSuccess(events);
}

function readEvents(opts) {
  const text = opts.path === "-" ? readFileSync(0, "utf8") : readFileSync(opts.path, "utf8");
  return parsePortableProofEvents(text);
}

function collectValidationErrors(events, opts) {
  const errors = validatePortableProofEvents(events, opts);
  if (opts.bundleDir) {
    errors.push(...validatePortableProofBundle(opts.bundleDir));
  }
  return errors;
}

function exitOnErrors(errors) {
  if (errors.length === 0) {
    return;
  }
  for (const error of errors) {
    process.stderr.write(`portable-proof-compare: ${error}\n`);
  }
  process.exit(1);
}

function writeSuccess(events) {
  process.stdout.write(
    JSON.stringify({
      ok: true,
      events: events.length,
      phases: events.map((event) => event.phase),
    }) + "\n",
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
