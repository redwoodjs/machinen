// Inject a task-grouped table of contents into packages/runtime/API.md.
//
// typedoc's default grouping is by TypeScript kind (Classes,
// Interfaces, Type Aliases, Variables, Functions). For a public
// reference that's mechanical, not navigable. This post-processor
// keeps the per-kind bodies typedoc emits and prepends a hand-curated
// TOC that buckets symbols by "what is the reader trying to do?".
//
// The mapping below is the single source of truth for those buckets.
// When you add a new public export to packages/runtime/src/index.ts,
// add the symbol here too (or it lands in "Other"). Run is:
//
//   pnpm build:docs   (typedoc → this script)
//
// The script validates that every symbol it references is a real H3
// in the generated API.md and that no H3 is left uncategorised, so
// drift between source exports and the TOC fails the build instead
// of silently producing broken anchors.

import { readFileSync, writeFileSync } from "node:fs";

// Optional path arg so the api-md-drift test can point at a tmpdir
// copy without clobbering the committed file. Defaults to the path
// `pnpm run build:docs` uses.
const API_PATH = process.argv[2] ?? "packages/runtime/API.md";

// Categories ordered top-to-bottom in the rendered TOC. Each value is
// the list of H3 headers (i.e. symbol names) typedoc emits for that
// category. Plain function/type names map 1:1 to typedoc's H3 text.
const TOC = {
  "Boot a VM": [
    "boot",
    "BootOptions",
    "attach",
    "AttachOptions",
    "bootPty",
    "PtyBootOptions",
    "PtyVmHandle",
    "VmHandle",
    "ImageConfig",
    "autoSizeMemoryMib",
    "resolveVmmBinary",
    "warmImageConfigCache",
    "measureFirstByte",
  ],
  "Run code in a VM": [
    "VsockExec",
    "VsockExecOptions",
    "VsockExecResult",
    "VsockExecPtyHandle",
    "VsockExecPtyOptions",
    "VsockExecPtyResult",
  ],
  "Snapshot, restore, fork": [
    "restore",
    "RestoreOptions",
    "ForkOptions",
    "SnapshotOptions",
    "SnapshotResult",
    "SnapshotFileIdentity",
    "SnapshotMeta",
    "VmstateBackend",
    "VmstateSnapshotMeta",
    "SnapshotEngine",
    "bootSnapshotPath",
    "writeBootSnapshot",
    "detachedLogRoot",
  ],
  "Native process images": [
    "NativeProcessImageValidationError",
    "NativeProcessImageRefusal",
    "NativeProcessImageRefusals",
    "NativeProcessImageManifest",
    "NativeMemoryMapping",
    "NativeProcessImageMappings",
    "NativeArm64Registers",
    "NativeAmd64Registers",
    "NativeThreadState",
    "NativeProcessImageThreads",
    "NativeProcessResource",
    "NativeProcessImageResources",
    "NativeCodeLocationMapping",
    "NativeThreadTranslation",
    "NativeMemoryRelocation",
    "NativeProcessImageTranslation",
    "NativeProcessImageDocuments",
    "NativeProcessImageDocumentInput",
    "NativeProcessImageArchitecture",
    "NativeProcessImageRefusalCode",
    "NativeMemoryMappingKind",
    "NativeRegisterState",
    "NativeProcessResourceKind",
    "NativeProcessImageJsonSchema",
    "NATIVE_PROCESS_IMAGE_FORMAT_VERSION",
    "NATIVE_PROCESS_IMAGE_FILES",
    "nativeProcessImageArchitectures",
    "nativeProcessImageRefusalCodes",
    "nativeProcessImageSchemas",
    "isNativeProcessImageBundle",
    "validateNativeProcessImageBundle",
    "validateNativeProcessImageDocuments",
    "assertNativeProcessImageDocuments",
    "NativeRegisterTranslationRequest",
    "NativeContinuationTarget",
    "NativeRegisterTranslationResult",
    "translateNativeRegisterState",
    "NativeActiveSyscallClass",
    "NativeSleepTimerSyscallPolicy",
    "NativeActiveSyscallPolicyOptions",
    "NativeSleepTimerDuration",
    "NativeModeledSleepTimerRemainingTime",
    "NativeModeledSleepTimerState",
    "NativeSleepTimerModelResult",
    "NativeActiveSyscallContinuation",
    "NativeActiveSyscallClassification",
    "NativeActiveSyscallClassificationResult",
    "modelNativeSleepTimerState",
    "classifyNativeThreadSyscall",
    "classifyNativeActiveSyscalls",
    "NativeCodeModule",
    "NativeCodeSymbol",
    "NativeCodeMapRequest",
    "NativeCodeMapResult",
    "buildNativeCodeMap",
    "NativeRealUtilityExecutableRange",
    "NativeRealUtilitySourceModule",
    "NativeRealUtilityTargetModule",
    "NativeRealUtilityModuleExpectation",
    "NativeRealUtilityTargetContinuationKind",
    "NativeRealUtilityTargetSemanticContinuation",
    "NativeRealUtilityContinuationStrategy",
    "NativeRealUtilitySemanticContinuationSelection",
    "NativeRealUtilitySyntheticContinuationSelection",
    "NativeRealUtilityDeferredActiveSyscallLanding",
    "NativeRealUtilityResolvedLocation",
    "NativeRealUtilityCodeLocationRequest",
    "NativeRealUtilityCodeLocationResult",
    "inventoryNativeSourceCodeModules",
    "resolveNativeRealUtilityCodeLocations",
    "NativeRealUtilityContinuationBoundary",
    "NativeRealUtilityContinuationRequest",
    "NativeRealUtilityContinuationPlan",
    "planNativeRealUtilityContinuationAttempt",
    "NativeActualRealUtilityContinuationBoundary",
    "NativeActualRealUtilityContinuationRequest",
    "NativeActualRealUtilityContinuationPlan",
    "planNativeActualRealUtilityContinuationAttempt",
    "NativeActualTargetModuleInventoryRequest",
    "NativeActualTargetModuleInventoryResult",
    "inventoryNativeActualTargetModules",
    "NativeTargetModuleByteMaterializationRequest",
    "NativeTargetModuleByteMaterialization",
    "NativeTargetModuleByteMaterializationResult",
    "materializeNativeTargetModuleBytes",
    "NativeSyntheticSleepSyscallContinuationRequest",
    "NativeSyntheticSleepSyscallContinuation",
    "NativeSyntheticSleepSyscallContinuationResult",
    "NATIVE_SYNTHETIC_SLEEP_SYSCALL_BUILD_ID",
    "NATIVE_SYNTHETIC_SLEEP_SYSCALL_LOGICAL_NAME",
    "NATIVE_SYNTHETIC_SLEEP_SYSCALL_PATH",
    "NATIVE_SYNTHETIC_SLEEP_SYSCALL_BASE",
    "buildNativeSyntheticSleepSyscallContinuation",
    "NativeTargetLandingModuleProvenance",
    "NativeTargetLandingSectionProvenance",
    "NativeTargetLandingSymbolProvenance",
    "NativeTargetLandingFdeProvenance",
    "NativeTargetLandingDisassemblyProvenance",
    "NativeTargetLandingInstructionBoundary",
    "NativeTargetLandingInstructionBoundaryState",
    "NativeTargetResumeLandingProvenance",
    "NativeTargetResumeLandingInspectionRequest",
    "inspectNativeTargetResumeLanding",
    "nativeTargetResumeLandingRefusals",
    "NativeTargetUnwindRegister",
    "NativeTargetCalleeSavedPolicy",
    "NativeTargetCalleeSavedSlot",
    "NativeTargetUnwindFrameRule",
    "NativeTargetEhFrameTextParseRequest",
    "NativeTargetEhFrameTextParseResult",
    "NativeTargetUnwindMatchRequest",
    "NativeTargetUnwindFrameMatch",
    "NativeTargetUnwindMatchResult",
    "parseNativeTargetEhFrameText",
    "matchNativeTargetUnwindFrame",
    "NativeTargetFrameStateRegister",
    "NativeTargetFrameStateValueSource",
    "NativeSyntheticTargetCallerFrameStatePolicy",
    "NativeTargetFrameRegisterValue",
    "NativeTargetFrameStateRequirement",
    "NativeTargetFrameStateMaterialization",
    "NativeTargetFrameStateMaterializationRequest",
    "NativeTargetFrameStateMaterializationResult",
    "planNativeTargetFrameStateMaterialization",
    "NativeSyntheticTargetCallerFramePolicy",
    "NativeSyntheticTargetCallerFrameSlot",
    "NativeSyntheticTargetCallerFrame",
    "NativeSyntheticTargetCallerFramePlanRequest",
    "NativeSyntheticTargetCallerFramePlanResult",
    "planNativeSyntheticTargetCallerFrame",
    "NativeTargetResumeExecutionAttempt",
    "NativeTargetResumeExecutionAttemptStatus",
    "NativeTargetResumeFaultBoundary",
    "NativeTargetResumeFaultClassification",
    "NativeTargetResumeFaultClassificationOptions",
    "NativeTargetResumeFaultClassificationResult",
    "NativeTargetResumeFaultRegisters",
    "NativeTargetResumeExecutionMode",
    "NativeTargetResumeExecutor",
    "NativeTargetResumeExecutionPlan",
    "NativeTargetResumeExecutionPlanRequest",
    "NativeTargetResumeExecutionPlanResult",
    "classifyNativeTargetResumeExecutionAttempt",
    "planNativeTargetResumeExecution",
    "NativeStackFrame",
    "NativeStackSlot",
    "NativeStackTranslationRequest",
    "NativeStackTranslationResult",
    "translateNativeStack",
    "NativeUnwindFrameRule",
    "NativeUnwindStackWord",
    "NativeEhFrameTextParseRequest",
    "NativeEhFrameTextParseResult",
    "NativeUnwindFrameDiscoveryRequest",
    "NativeDiscoveredUnwindFrame",
    "NativeUnwindFrameDiscoveryResult",
    "NativeUnwindMetadataKind",
    "NativeUnwindRegister",
    "discoverNativeUnwindFrames",
    "nativeUnwindReturnAddressSlot",
    "parseNativeEhFrameText",
    "NativeMemoryWord",
    "NativeMemoryTranslationRequest",
    "NativeMemoryTranslationResult",
    "translateNativeMemory",
    "NativeDebugMemoryField",
    "NativeDebugMemoryObject",
    "NativeDebugAddressTranslation",
    "NativeDebugMemoryPointerClassificationRequest",
    "NativeDebugMemoryPointerClassificationResult",
    "NativeDebugMemoryMetadataSource",
    "NativeDebugMemoryFieldClassification",
    "classifyNativeDebugMemoryPointers",
    "NativeMappingMaterializationAction",
    "NativeMappingMaterializationStep",
    "NativeMappingMaterializationRequest",
    "NativeMappingMaterializationResult",
    "planNativeMappingMaterialization",
    "NativeInheritedStdioPolicy",
    "NativeResourceTranslationRequest",
    "NativeResourceTranslationResult",
    "translateNativeResources",
  ],
  "Provision base images": [
    "provision",
    "ProvisionOptions",
    "ProvisionResult",
    "resolveBaseDtb",
    "resolveBaseKernel",
    "resolveBaseRootfs",
    "ensureRootfsImage",
    "EnsureRootfsImageOptions",
    "markRootfsImageClean",
    "rootfsImgCacheDir",
    "resolveMke2fs",
  ],
  "Mount files": [
    "VsockFiles",
    "VsockFilesOptions",
    "WriteFileOptions",
    "buildWriteFileCmd",
    "buildWriteFileCmds",
    "ensureMountDiskImage",
    "ensureMountDiskUpper",
    "markMountDiskImageClean",
    "mountdiskImgCacheDir",
    "resolveMksquashfs",
    "EnsureMountDiskImageOptions",
    "EnsureMountDiskImageResult",
    "EnsureMountDiskUpperOptions",
    "EnsureMountDiskUpperResult",
  ],
  "Share secrets": ["VsockSecrets", "VsockSecretsOptions"],
  "Terminal control": ["VsockWinsize", "VsockWinsizeOptions"],
  "Manage running VMs": [
    "list",
    "registryRoot",
    "RegistryEntry",
    "runGc",
    "GcResult",
    "RunGcOptions",
    "validatePid",
    "PidStatus",
  ],
  "Multiplex sandboxes": [
    "Sandboxes",
    "Supervisor",
    "SandboxEntry",
    "OnOutputListener",
    "SupervisorOptions",
  ],
  "Memory introspection": [
    "MemoryStats",
    "checkForkBackpressure",
    "CheckForkBackpressureOptions",
    "DEFAULT_FREE_MEMORY_THRESHOLD",
    "readHostFreeBytes",
    "readHostTotalBytes",
    "readHostRssBytes",
    "readHostRssBytesMulti",
    "RssTarget",
    "readBalloonStats",
    "BalloonCounters",
    "STATS_FILE_SIZE",
  ],
  Logging: ["ChunkLogEvent", "LogEvent", "OnLog", "PhaseLogEvent"],
  "Initramfs (advanced)": [
    "mkinitramfsBundle",
    "mkinitramfsTinyBundle",
    "mkinitramfsRootfs",
    "mkinitramfsWorkspace",
    "mkinitramfsMinimal",
    "mkinitramfsCli",
    "PackBundleOptions",
    "PackTinyBundleOptions",
    "PackRootfsOptions",
    "PackMinimalOptions",
    "PackWorkspaceOptions",
  ],
  Errors: [
    "MachinenError",
    "BootError",
    "ExecError",
    "SnapshotError",
    "ProvisionError",
    "RegistryError",
    "FilesError",
    "MountError",
    "SecretsError",
    "WinsizeError",
    "SandboxError",
    "CacheError",
    "GvproxyError",
    "MkinitramfsError",
    "ParseError",
    "ErrorCode",
    "MachinenErrorOptions",
    "isMachinenError",
    "formatMachinenError",
  ],
  Internal: ["_internal"],
};

// GitHub-flavored anchor for a markdown header: lowercase, strip
// non-word chars (keep underscores).
function anchor(symbol) {
  return symbol.toLowerCase().replaceAll(/[^a-z0-9_]/g, "");
}

// Strip typedoc-plugin-markdown decorations to get the canonical
// symbol name: function H3s end with `()`, and the markdown writer
// escapes underscores as `\_` so they don't render as italic.
function normalizeHeader(text) {
  return text.replaceAll("\\", "").replace(/\(\)$/, "");
}

const md = readFileSync(API_PATH, "utf8");

const h3s = new Set();
for (const line of md.split("\n")) {
  const m = /^### (.+)$/.exec(line);
  if (m) {
    h3s.add(normalizeHeader(m[1].trim()));
  }
}

// Two-way validation: TOC entries must be real headers, and every
// real header must be in some TOC bucket (or be reported so we can
// add it).
const tocSymbols = new Set(Object.values(TOC).flat());
const tocMissingHeader = [...tocSymbols].filter((s) => !h3s.has(s));
const headerMissingToc = [...h3s].filter((s) => !tocSymbols.has(s));

if (tocMissingHeader.length > 0) {
  console.error(
    `build-api-toc: TOC references symbols that don't appear as H3 in ${API_PATH}:\n  ${tocMissingHeader.join(
      "\n  ",
    )}`,
  );
  process.exit(1);
}
if (headerMissingToc.length > 0) {
  console.error(
    `build-api-toc: H3 symbols in ${API_PATH} that aren't categorised — add them to TOC in scripts/build-api-toc.mjs:\n  ${headerMissingToc.join(
      "\n  ",
    )}`,
  );
  process.exit(1);
}

// Build the TOC block. Markdown details/summary keeps the section
// scannable but compact; readers expand the bucket they need.
const lines = ["## Contents", ""];
for (const [category, symbols] of Object.entries(TOC)) {
  lines.push(`### ${category}`, "");
  for (const s of symbols) {
    lines.push(`- [\`${s}\`](#${anchor(s)})`);
  }
  lines.push("");
}
const tocBlock = lines.join("\n") + "\n";

// Insert after the H1. typedoc emits `# @machinen/runtime` as the
// first non-empty line; we splice the TOC right after the blank line
// that follows.
const out = md.replace(/^(# @machinen\/runtime\n)/, `$1\n${tocBlock}`);
if (out === md) {
  console.error(
    `build-api-toc: couldn't find the H1 in ${API_PATH} — typedoc output shape changed?`,
  );
  process.exit(1);
}

writeFileSync(API_PATH, out);
console.log(`Injected task-grouped TOC into ${API_PATH}`);
