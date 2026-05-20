import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runCommand } from "./proof-script-utils.mjs";

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTROLLED_SOURCE = join(
  REPO_ROOT,
  "packages/microvm/assets/controlled-binary-corpus.c",
);
export const CAPTURE_SOURCE = join(REPO_ROOT, "packages/microvm/assets/raw-process-capture.c");

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

export function hostArch() {
  if (process.arch === "arm64") {
    return "arm64";
  }
  if (process.arch === "x64") {
    return "amd64";
  }
  return process.arch;
}
