#!/usr/bin/env tsx
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import {
  PORTABLE_MACHINE_SNAPSHOT_FILES,
  buildPortableMachineSnapshotManifestFromNativeProcessImage,
  validatePortableMachineSnapshotBundle,
} from "../packages/runtime/src/portable-machine-snapshot.ts";
import { validateNativeProcessImageBundle } from "../packages/runtime/src/native-process-image.ts";

const NATIVE_PROCESS_BUNDLE_ENV = "MACHINEN_PORTABLE_MACHINE_NATIVE_PROCESS_BUNDLE";

interface Args {
  nativeProcessBundle?: string;
  outDir?: string;
  json: boolean;
}

function usage(): never {
  console.error(
    "usage: tsx scripts/portable-machine-snapshot.ts verify " +
      "--native-process-bundle path [--out-dir path] [--json]",
  );
  process.exit(2);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    json: argv.includes("--json"),
    nativeProcessBundle: valueAfter(argv, "--native-process-bundle"),
    outDir: valueAfter(argv, "--out-dir"),
  };
  assertNoUnknownArgs(argv, args);
  args.nativeProcessBundle ??= process.env[NATIVE_PROCESS_BUNDLE_ENV];
  return args;
}

function valueAfter(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }
  const value = argv[index + 1] ?? usage();
  return value.startsWith("--") ? usage() : value;
}

function assertNoUnknownArgs(argv: string[], args: Args): void {
  const allowed = new Set([
    "verify",
    "--",
    "--json",
    "--native-process-bundle",
    "--out-dir",
    args.nativeProcessBundle,
    args.outDir,
  ]);
  for (const arg of argv) {
    if (!allowed.has(arg)) {
      usage();
    }
  }
}

function createPortableMachineSnapshot(args: Args) {
  const nativeSource = args.nativeProcessBundle ? resolve(args.nativeProcessBundle) : undefined;
  if (!nativeSource) {
    usage();
  }
  const outDir = resolve(args.outDir ?? mkdtempSync(join(tmpdir(), "machinen-portable-machine-")));
  const nativeDest = join(outDir, PORTABLE_MACHINE_SNAPSHOT_FILES.nativeProcessImage);
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(nativeSource, nativeDest, { recursive: true });

  const nativeProcessImage = validateNativeProcessImageBundle(nativeDest);
  const manifest = buildPortableMachineSnapshotManifestFromNativeProcessImage(nativeProcessImage);
  writeFileSync(
    join(outDir, PORTABLE_MACHINE_SNAPSHOT_FILES.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const bundle = validatePortableMachineSnapshotBundle(outDir);
  return {
    phase: "portable-machine-snapshot-bundle",
    bundleCreated: true,
    portableMachineBundle: outDir,
    nativeProcessBundle: nativeSource,
    processImageValidated: true,
    sourceGuestArch: bundle.manifest.source.guestArch,
    targetGuestArch: bundle.manifest.target.guestArch,
    targetMode: bundle.manifest.target.mode,
    targetExecution: bundle.manifest.target.execution,
    refusalCodes: bundle.manifest.refusals.refusals.map((refusal) => refusal.code),
  };
}

const args = parseArgs(process.argv.slice(2));
const summary = createPortableMachineSnapshot(args);
if (args.json) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log(
    `portable-machine-snapshot: created ${summary.portableMachineBundle} ` +
      `${summary.sourceGuestArch}->${summary.targetGuestArch}`,
  );
}
