import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./proof-script-utils.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTROLLED_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/controlled-binary-corpus.c",
);
export const CAPTURE_SOURCE = join(REPO_ROOT, "packages/microvm/assets/raw-process-capture.c");
export const CONTROLLED_MARKER = "MACHINEN_CONTROLLED_BINARY ";

export function ensureSourcesExist(sources) {
  for (const source of sources) {
    if (!existsSync(source)) {
      throw new Error(`missing source: ${source}`);
    }
  }
}

export function compileControlledTarget(binDir) {
  const executable = join(binDir, "machinen-controlled-corpus");
  runCommand("cc", controlledCompileArgs(executable), { label: "controlled corpus build" });
  return executable;
}

export function controlledCompileArgs(executable) {
  return [
    "-std=c11",
    "-O0",
    "-g",
    "-Wall",
    "-Wextra",
    "-Werror",
    "-fno-pie",
    "-no-pie",
    "-pthread",
    CONTROLLED_SOURCE,
    "-o",
    executable,
  ];
}

export function compileRawCapturer(binDir) {
  const executable = join(binDir, "machinen-raw-process-capture");
  runCommand(
    "cc",
    ["-std=c11", "-O0", "-g", "-Wall", "-Wextra", "-Werror", CAPTURE_SOURCE, "-o", executable],
    { label: "raw capturer build" },
  );
  return executable;
}

export function readSymbols(target, wantedSymbols) {
  const result = runCommand("nm", ["-S", "--defined-only", target], { label: "symbol scan" });
  const symbols = parseNm(result.stdout);
  for (const name of wantedSymbols) {
    if (!symbols.has(name)) {
      throw new Error(`missing target symbol: ${name}`);
    }
  }
  return symbols;
}

function parseNm(stdout) {
  const symbols = new Map();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]+)\s+([0-9a-fA-F]+)\s+\S\s+(\S+)$/.exec(line.trim());
    if (match) {
      symbols.set(match[3], { address: `0x${match[1]}`, sizeBytes: Number.parseInt(match[2], 16) });
    }
  }
  return symbols;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadRawCapture(captureDir) {
  return {
    manifest: readJson(join(captureDir, "manifest.json")),
    symbols: readJson(join(captureDir, "symbols.json")),
    memory: readJson(join(captureDir, "memory.json")),
    memoryBin: readFileSync(join(captureDir, "memory.bin")),
    targetLog: readFileSync(join(captureDir, "target.log"), "utf8"),
  };
}

export function memoryChunkByName(capture, name) {
  const chunk = capture.memory.chunks.find((candidate) => candidate.name === name);
  if (!chunk) {
    throw new Error(`missing memory chunk: ${name}`);
  }
  return chunk;
}

export function memoryChunkBytes(capture, chunk) {
  return capture.memoryBin.subarray(chunk.fileOffset, chunk.fileOffset + chunk.sizeBytes);
}

export function buildPortableBundleMemory(capture) {
  const chunks = capture.memory.chunks.map((source) => ({ ...source }));
  const buffers = [];
  let offset = 0;
  for (const chunk of chunks) {
    const bytes = memoryChunkBytes(capture, chunk);
    chunk.bundleOffset = offset;
    buffers.push(bytes);
    offset += bytes.length;
  }
  return { chunks, bytes: Buffer.concat(buffers) };
}

export function controlledPortableManifest(options) {
  return {
    formatVersion: 1,
    sourceGuestArch: hostArch(),
    allowedTargetGuestArchs: ["arm64", "amd64"],
    program: {
      name: "controlled-binary-corpus",
      executable: options.target,
      identity: "com.redwoodjs.machinen.controlled-binary-corpus",
    },
    sourceBuild: { buildId: options.buildId, version: options.version },
    targetBuild: { version: options.version },
    checkpointAbi: {
      version: 1,
      checkpointFunction: { name: "machinen_checkpoint" },
      rootsType: "machinen_checkpoint_roots",
      restoreBundleType: "machinen_restore_bundle",
      safePoint: { outsideSignalHandlers: true, outsideSyscalls: true },
    },
    checkpointContinuation: { name: options.checkpointContinuation },
    restoreEntrypoint: { name: options.restoreEntrypoint },
    process: {
      argv: options.capture.manifest.target.argv,
      env: { MACHINEN_CONTROLLED_ENV: "1" },
      cwd: process.cwd(),
    },
    features: options.features,
    unsupported: unsupportedVocabulary(),
  };
}

export function writePortableBundleFiles(options) {
  mkdirSync(options.bundleDir, { recursive: true });
  mkdirSync(join(options.bundleDir, "logs"), { recursive: true });
  writeFileSync(join(options.bundleDir, "memory.bin"), options.memory.bytes);
  writeFileSync(join(options.bundleDir, "manifest.json"), jsonDocument(options.manifest));
  writeFileSync(join(options.bundleDir, "objects.json"), jsonDocument(options.objects));
  writeFileSync(join(options.bundleDir, "relocations.json"), jsonDocument(options.relocations));
  writeFileSync(
    join(options.bundleDir, "resources.json"),
    jsonDocument(controlledResources(options.capture)),
  );
  for (const document of options.extraDocuments || []) {
    writeFileSync(join(options.bundleDir, document.name), jsonDocument(document.value));
  }
  writeFileSync(join(options.bundleDir, "controlled-state.txt"), options.controlledStateText);
  copyFileSync(
    join(options.captureDir, "target.log"),
    join(options.bundleDir, "logs/source-target.log"),
  );
}

export function controlledResources(capture) {
  return {
    formatVersion: 1,
    resources: [
      { id: "argv", kind: "argv", state: "captured", argv: capture.manifest.target.argv },
      { id: "env", kind: "env", state: "captured", env: { MACHINEN_CONTROLLED_ENV: "1" } },
      { id: "cwd", kind: "cwd", state: "captured", path: process.cwd() },
    ],
    unsupported: unsupportedVocabulary(),
  };
}

export function parseControlledMarker(stdout, expectedFixture) {
  const line = stdout.split(/\r?\n/).find((candidate) => candidate.startsWith(CONTROLLED_MARKER));
  if (!line) {
    throw new Error("missing controlled binary marker");
  }
  const event = JSON.parse(line.slice(CONTROLLED_MARKER.length));
  if (expectedFixture && event.fixture !== expectedFixture) {
    throw new Error(`unexpected controlled fixture marker: ${event.fixture}`);
  }
  return event;
}

export function bundleFileStats(bundleDir, names) {
  return names.map((name) => ({ name, bytes: statSync(join(bundleDir, name)).size }));
}

export function unsupportedVocabulary() {
  return { vocabularyVersion: 1, refusals: [] };
}

export function jsonDocument(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function hostArch() {
  if (process.arch === "arm64") {
    return "arm64";
  }
  if (process.arch === "x64") {
    return "amd64";
  }
  return process.arch;
}
