#!/usr/bin/env tsx
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const proofDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(proofDir, "../..");
const work =
  process.env.WORK_DIR ??
  mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "machinen-node-proper-level5-materializer."));
const resultPath = join(work, "native-materializer-result.json");
const materializerPath = join(work, "native-materializer");

interface NativeMaterializerResult {
  kind: string;
  targetNativeMaterializerStarted: boolean;
  controlledJsLoaderUsed: boolean;
  accepted: boolean;
  refusal?: { code?: string };
  selectedStateCounterDescriptorUsed: boolean;
  appExportImportUsed: boolean;
  sourceIsaEmulationUsed: boolean;
  sidecarOutputUsed: boolean;
  metadataOnlySuccess: boolean;
}

function parseJson<T>(body: string): T {
  return JSON.parse(body) as T;
}

function compileNativeMaterializer(): void {
  execFileSync(
    "zig",
    [
      "build-exe",
      join(proofDir, "native-materializer.zig"),
      "-O",
      "ReleaseFast",
      `-femit-bin=${materializerPath}`,
    ],
    { cwd: root, stdio: "inherit" },
  );
}

function runNativeMaterializerScaffold(): NativeMaterializerResult {
  execFileSync(materializerPath, [resultPath], { cwd: root, stdio: "inherit" });
  return parseJson<NativeMaterializerResult>(readFileSync(resultPath, "utf8"));
}

function validateScaffold(result: NativeMaterializerResult): void {
  if (result.kind !== "machinen.node-proper-level5-native-materializer-scaffold") {
    throw new Error(`unexpected materializer result kind: ${result.kind}`);
  }
  if (!result.targetNativeMaterializerStarted) {
    throw new Error("native materializer scaffold did not start");
  }
  if (result.controlledJsLoaderUsed) {
    throw new Error("Proof 029 scaffold must not use a controlled JS target loader");
  }
  if (result.accepted) {
    throw new Error(
      "Proof 029 scaffold must fail closed until native materialization is implemented",
    );
  }
  if (result.refusal?.code !== "node-proper-level5-native-materializer-not-implemented") {
    throw new Error("Proof 029 scaffold emitted the wrong refusal code");
  }
  for (const key of [
    "selectedStateCounterDescriptorUsed",
    "appExportImportUsed",
    "sourceIsaEmulationUsed",
    "sidecarOutputUsed",
    "metadataOnlySuccess",
  ] as const) {
    if (result[key]) {
      throw new Error(`forbidden proof shortcut detected: ${key}`);
    }
  }
}

compileNativeMaterializer();
const result = runNativeMaterializerScaffold();
validateScaffold(result);
console.log(JSON.stringify({ scaffolded: true, result }));
console.log(`node proper Level 5 native materializer scaffold passed: ${work}`);
