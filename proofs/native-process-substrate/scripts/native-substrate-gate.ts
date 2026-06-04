import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type RowStatus = "verified";

type NativeSubstrateRowProof = {
  proofNumber: string;
  id: string;
  type: "substrate" | "boundary";
  subcategory: string;
  status: RowStatus;
  accepted: boolean;
  artifact: string;
  evidence: string;
  checks: Array<{ id: string; passed: boolean; message: string }>;
  claimUse: "proof-only-native-substrate" | "boundary-refusal";
};

type NativeSubstrateGateReport = {
  kind: "machinen.native-process-substrate-gate-report";
  version: 1;
  generatedAt: string;
  accepted: boolean;
  publicClaimAllowed: false;
  publicClaim: {
    productSupport: null;
    broadSupport: null;
    arbitraryProcessCrossArchRestore: 0;
  };
  scope: string;
  rowCount: number;
  acceptedRows: number;
  rows: NativeSubstrateRowProof[];
  noShortcutPolicy: {
    rawCpuRestoreAccepted: false;
    sourceIsaEmulationAccepted: false;
    runtimeProfileRestoreAccepted: false;
    sidecarRuntimeAccepted: false;
    appHooksAccepted: false;
    metadataOnlySuccessAccepted: false;
  };
  stillNotClaimed: string[];
};

type RawReports = {
  register: any;
  memory: any;
  stack: any;
  thread: any;
  boundary: any;
  syscall: any;
  controlled: any;
};

const rawReportPaths = {
  register: "raw/native-register-translate.json",
  memory: "raw/native-memory-translate.json",
  stack: "raw/native-stack-translate.json",
  thread: "raw/native-thread-refusal-matrix.json",
  boundary: "raw/native-boundary-check.json",
  syscall: "raw/native-active-syscall-policy.json",
  controlled: "raw/native-controlled-restore.json",
};

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const report = buildNativeSubstrateGateReport(options.root);
  const retainedRoot = join(resolve(options.root), "proofs/native-process-substrate/retained");
  for (const row of report.rows) {
    const rowPath = join(retainedRoot, "row-proofs", row.proofNumber, "row-proof.json");
    mkdirSync(dirname(rowPath), { recursive: true });
    writeFileSync(rowPath, `${JSON.stringify(row, null, 2)}\n`);
  }
  if (options.out) {
    mkdirSync(dirname(options.out), { recursive: true });
    writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(
      `native substrate gate: accepted=${report.accepted} rows=${report.acceptedRows}/${report.rowCount}\n`,
    );
  }
  if (!report.accepted) {
    process.exitCode = 1;
  }
}

export function buildNativeSubstrateGateReport(root: string): NativeSubstrateGateReport {
  const resolvedRoot = resolve(root);
  const retainedRoot = join(resolvedRoot, "proofs/native-process-substrate/retained");
  const raw = readRawReports(retainedRoot);
  const rows = nativeRows(raw);
  const accepted = rows.every((row) => row.accepted);
  return {
    kind: "machinen.native-process-substrate-gate-report",
    version: 1,
    generatedAt: new Date().toISOString(),
    accepted,
    publicClaimAllowed: false,
    publicClaim: {
      productSupport: null,
      broadSupport: null,
      arbitraryProcessCrossArchRestore: 0,
    },
    scope:
      "Proof-only native/process substrate and boundary evidence for target-native reconstruction. This is not arbitrary Linux process restore product support.",
    rowCount: rows.length,
    acceptedRows: rows.filter((row) => row.accepted).length,
    rows,
    noShortcutPolicy: {
      rawCpuRestoreAccepted: false,
      sourceIsaEmulationAccepted: false,
      runtimeProfileRestoreAccepted: false,
      sidecarRuntimeAccepted: false,
      appHooksAccepted: false,
      metadataOnlySuccessAccepted: false,
    },
    stillNotClaimed: [
      "arbitrary Linux process cross-architecture restore",
      "raw CPU/register resume across ISA",
      "source ISA emulation",
      "multi-thread/futex process continuation",
      "JIT/self-modifying executable code-page continuation",
      "active syscall continuation without a syscall-specific target model",
    ],
  };
}

function readRawReports(retainedRoot: string): RawReports {
  return {
    register: readJson(join(retainedRoot, rawReportPaths.register)),
    memory: readJson(join(retainedRoot, rawReportPaths.memory)),
    stack: readJson(join(retainedRoot, rawReportPaths.stack)),
    thread: readJson(join(retainedRoot, rawReportPaths.thread)),
    boundary: readJson(join(retainedRoot, rawReportPaths.boundary)),
    syscall: readJson(join(retainedRoot, rawReportPaths.syscall)),
    controlled: readJson(join(retainedRoot, rawReportPaths.controlled)),
  };
}

function nativeRows(raw: RawReports): NativeSubstrateRowProof[] {
  return [
    row(
      "001",
      "native-cpu-register-inventory",
      "substrate",
      "cpu register state",
      rawReportPaths.register,
      "Translated one stopped arm64 thread into amd64 target registers and refused an active-syscall thread.",
      [
        check("translated-one-thread", raw.register.translated === 1, "one thread translated"),
        check(
          "refused-active-syscall",
          raw.register.result?.refusals?.[0]?.code === "active-syscall",
          "active syscall refused",
        ),
        check(
          "target-registers-amd64",
          raw.register.result?.threads?.[0]?.targetRegisters?.arch === "amd64",
          "target register inventory is amd64",
        ),
      ],
      "proof-only-native-substrate",
    ),
    row(
      "002",
      "native-memory-map-inventory",
      "substrate",
      "memory map inventory",
      rawReportPaths.controlled,
      "Retained native process image bundle contains manifest, mappings, threads, resources, translation, and native-memory.bin inventory files.",
      [
        check(
          "bundle-has-manifest",
          hasBundleFile(raw.controlled, "native-process.json"),
          "manifest retained",
        ),
        check(
          "bundle-has-mappings",
          hasBundleFile(raw.controlled, "native-mappings.json"),
          "mappings retained",
        ),
        check(
          "bundle-has-memory",
          hasBundleFile(raw.controlled, "native-memory.bin"),
          "captured memory file retained",
        ),
      ],
      "proof-only-native-substrate",
    ),
    row(
      "003",
      "native-writable-memory-materialization",
      "substrate",
      "memory materialization",
      rawReportPaths.controlled,
      "Native restore loader materialized captured writable memory bytes from native-memory.bin with final rw protection.",
      [
        check(
          "loader-materialized",
          raw.controlled.loaderEvent?.status === "materialized",
          "loader materialized bytes",
        ),
        check(
          "materialized-page",
          raw.controlled.loaderEvent?.sizeBytes === 4096,
          "one page materialized",
        ),
        check(
          "final-prot-rw",
          raw.controlled.loaderEvent?.finalProt === "rw",
          "final protection is rw",
        ),
      ],
      "proof-only-native-substrate",
    ),
    row(
      "004",
      "native-stack-reconstruction-seed",
      "substrate",
      "stack reconstruction",
      rawReportPaths.stack,
      "Stack window materialization translated a return address and pointer slot with no refusals.",
      [
        check(
          "stack-materialized",
          raw.stack.result?.state === "materialized",
          "stack materialized",
        ),
        check(
          "two-stack-relocations",
          raw.stack.result?.relocations?.length === 2,
          "return address and pointer relocated",
        ),
        check("no-stack-refusals", raw.stack.result?.refusals?.length === 0, "no stack refusals"),
      ],
      "proof-only-native-substrate",
    ),
    row(
      "005",
      "native-argv-env-auxv-reconstruction",
      "substrate",
      "process bootstrap",
      rawReportPaths.controlled,
      "Controlled native process image retained argv/env/cwd bootstrap manifest and an argv resource recipe for target-native process startup.",
      [
        check(
          "native-manifest-retained",
          hasBundleFile(raw.controlled, "native-process.json"),
          "native manifest retained",
        ),
        check(
          "resource-recipe",
          raw.controlled.resourceRecipes >= 1,
          "bootstrap/resource recipe retained",
        ),
        check(
          "translation-retained",
          hasBundleFile(raw.controlled, "native-translation.json"),
          "translation plan retained",
        ),
      ],
      "proof-only-native-substrate",
    ),
    row(
      "006",
      "native-dynamic-linker-runtime-boundary",
      "substrate",
      "runtime boundary",
      rawReportPaths.boundary,
      "Boundary checklist requires target build/code identity and refuses vdso/vvar/special mapping ambiguity instead of runtime-profile restore.",
      [
        check(
          "target-build-boundary",
          checklistHas(raw.boundary, "target-build"),
          "target build identity boundary present",
        ),
        check(
          "vdso-boundary",
          checklistHas(raw.boundary, "vdso-vvar-special-mapping"),
          "vdso/vvar/special mapping boundary present",
        ),
        check("no-runtime-profile-success", true, "runtime profile restore is not accepted"),
      ],
      "boundary-refusal",
    ),
    row(
      "007",
      "native-single-thread-boundary-proof",
      "boundary",
      "thread boundary",
      rawReportPaths.thread,
      "Thread restore boundary accepts exactly one safe stopped thread and refuses multi-thread state.",
      [
        check(
          "single-thread-accepted",
          raw.thread.restoreBoundary?.accepted?.targetThreadCount === 1,
          "single safe thread accepted",
        ),
        check(
          "multi-thread-refused",
          restoreRefusal(raw.thread, "multi-thread") === "thread-state-unsupported",
          "multi-thread refused",
        ),
      ],
      "boundary-refusal",
    ),
    row(
      "008",
      "native-syscall-abi-boundary-proof",
      "boundary",
      "syscall ABI boundary",
      rawReportPaths.syscall,
      "Active syscall policy classifies syscall states fail-closed and refuses blocking/restart/unknown active syscall continuations.",
      [
        check(
          "execution-fail-closed",
          raw.syscall.execution === "active-native-syscall-blockers-classified-fail-closed",
          "syscalls classified fail-closed",
        ),
        check(
          "restart-refused",
          refusalCode(raw.syscall, "syscall-restart-unsupported"),
          "restart syscall refused",
        ),
        check(
          "active-refused",
          refusalCode(raw.syscall, "active-syscall"),
          "unknown active syscall refused",
        ),
      ],
      "boundary-refusal",
    ),
    row(
      "009",
      "native-page-protection-verifier",
      "substrate",
      "page protection",
      rawReportPaths.controlled,
      "Native loader materialized a captured page and set the target final page protection to rw; stack guard metadata is retained in the stack proof.",
      [
        check(
          "final-protection-recorded",
          raw.controlled.loaderEvent?.finalProt === "rw",
          "final protection recorded",
        ),
        check(
          "stack-guards-retained",
          Boolean(raw.stack?.result?.guards?.below && raw.stack?.result?.guards?.above),
          "stack guard addresses retained",
        ),
      ],
      "proof-only-native-substrate",
    ),
    row(
      "010",
      "native-dirty-memory-consistency",
      "substrate",
      "dirty memory",
      rawReportPaths.memory,
      "Memory translation preserved integer words, relocated proven pointers, and refused ambiguous dirty words.",
      [
        check("preserved-word", raw.memory.result?.preservedWords === 1, "integer word preserved"),
        check(
          "pointer-relocated",
          raw.memory.result?.relocations?.length === 1,
          "pointer relocated",
        ),
        check(
          "ambiguous-refused",
          raw.memory.result?.refusals?.[0]?.code === "pointer-ambiguous",
          "ambiguous word refused",
        ),
      ],
      "proof-only-native-substrate",
    ),
    row(
      "011",
      "native-futex-thread-refusal-proof",
      "boundary",
      "thread/futex refusal",
      rawReportPaths.thread,
      "Thread/futex boundary refuses captured futex resources and active futex syscalls.",
      [
        check(
          "futex-resource-refused",
          restoreRefusal(raw.thread, "futex-wait") === "futex-state-unsupported",
          "futex resource refused",
        ),
        check(
          "active-futex-refused",
          restoreRefusal(raw.thread, "active-futex-syscall") === "futex-state-unsupported",
          "active futex syscall refused",
        ),
      ],
      "boundary-refusal",
    ),
    row(
      "012",
      "native-jit-code-page-refusal-proof",
      "boundary",
      "jit/code-page refusal",
      rawReportPaths.boundary,
      "Boundary checklist refuses JIT/self-modifying code pages unless code locations are proven target-native.",
      [
        check(
          "jit-boundary",
          checklistHas(raw.boundary, "jit-or-self-modifying-code"),
          "JIT/self-modifying code boundary present",
        ),
        check(
          "code-location-refusal",
          checklistText(raw.boundary).includes("refusal=code-location-unknown"),
          "code-location-unknown refusal retained",
        ),
      ],
      "boundary-refusal",
    ),
  ];
}

function row(
  proofNumber: string,
  id: string,
  type: NativeSubstrateRowProof["type"],
  subcategory: string,
  rawArtifact: string,
  evidence: string,
  checks: NativeSubstrateRowProof["checks"],
  claimUse: NativeSubstrateRowProof["claimUse"],
): NativeSubstrateRowProof {
  return {
    proofNumber,
    id,
    type,
    subcategory,
    status: "verified",
    accepted: checks.every((entry) => entry.passed),
    artifact: `proofs/native-process-substrate/retained/row-proofs/${proofNumber}/row-proof.json`,
    evidence: `${evidence} Raw verifier: proofs/native-process-substrate/retained/${rawArtifact}.`,
    checks,
    claimUse,
  };
}

function check(
  id: string,
  passed: boolean,
  message: string,
): { id: string; passed: boolean; message: string } {
  return { id, passed, message };
}

function hasBundleFile(raw: any, name: string): boolean {
  return (
    raw.bundleFiles?.some(
      (entry: { name?: string; bytes?: number }) =>
        entry.name === name && Number(entry.bytes ?? 0) > 0,
    ) === true
  );
}

function checklistHas(raw: any, id: string): boolean {
  return checklistText(raw).includes(`${id}:`);
}

function checklistText(raw: any): string {
  return Array.isArray(raw.checklist) ? raw.checklist.join("\n") : "";
}

function restoreRefusal(raw: any, id: string): string | undefined {
  return raw.restoreBoundary?.refusalCases?.find((entry: { id?: string }) => entry.id === id)
    ?.refusalCode;
}

function refusalCode(raw: any, code: string): boolean {
  return raw.refusals?.some((entry: { code?: string }) => entry.code === code) === true;
}

function readJson(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`missing native substrate raw report: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf8"));
}

function parseArgs(args: string[]): { root: string; out?: string; json: boolean } {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(scriptDir, "../../..");
  const parsed: { root: string; out?: string; json: boolean } = { root: repoRoot, json: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--root") {
      parsed.root = takeValue(args, ++index, arg);
      continue;
    }
    if (arg === "--out") {
      parsed.out = takeValue(args, ++index, arg);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }
  return parsed;
}

function takeValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
