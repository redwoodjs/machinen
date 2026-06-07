#!/usr/bin/env node
import { readFileSync } from "node:fs";

export const supportedShapes = {
  "002-string-transform-cli":
    "declared safe-point string transform with target-native final jump and no live kernel resources",
  "003-array-sum-cli":
    "declared safe-point fixed array sum with target-native final jump and no live kernel resources",
  "004-linked-list-cli":
    "declared safe-point linked list with in-region next pointers and no live kernel resources",
  "005-regular-file-reader":
    "declared safe-point regular file descriptor descriptor with target reopen/seek and no non-file fd",
  "006-append-only-logger":
    "declared safe-point append-only regular file descriptor with pending user buffer and no duplicate-write state",
  "007-argv-env-printer":
    "declared safe-point argv/env string descriptor with target-native pointer reconstruction",
  "008-malloc-object-graph":
    "declared safe-point malloc object graph with declared inter-object pointers",
  "009-recursive-factorial-safepoint":
    "declared safe-point recursive factorial frame descriptor subset",
  "011-two-file-copy-cli":
    "declared safe-point two-file copy with regular file source and target descriptors",
  "012-seek-overwrite-cli": "declared safe-point seek and overwrite regular file descriptor",
  "013-line-reader-cli": "declared safe-point line reader with regular file offset descriptor",
  "014-directory-listing-cli": "declared safe-point directory listing with path cursor descriptor",
  "015-stat-checker-cli": "declared safe-point stat checker with path and size guard",
  "016-stdio-echo-cli": "declared safe-point stdio echo descriptor with no live terminal state",
  "017-fixed-ring-buffer-cli": "declared safe-point fixed ring buffer with head and tail indexes",
  "018-queue-cli": "declared safe-point queue with head and tail pointers",
  "019-binary-tree-traversal-cli":
    "declared safe-point binary tree traversal with declared child pointers",
  "020-hash-table-fixed-buckets-cli":
    "declared safe-point fixed-bucket hash table with declared bucket pointers",
  "021-graph-with-shared-node-cli": "declared safe-point graph with shared node alias preservation",
  "022-cycle-list-cli": "declared safe-point cyclic list with bounded traversal descriptor",
  "023-struct-with-nested-pointers-cli": "declared safe-point struct with nested in-region pointer",
  "024-global-variable-counter-cli": "declared safe-point writable global counter descriptor",
  "025-static-buffer-cli": "declared safe-point static buffer descriptor",
  "026-multiple-stack-frames-cli": "declared safe-point multiple stack-frame descriptor subset",
  "027-callee-saved-register-cli": "declared safe-point callee-saved register descriptor subset",
  "028-float-simd-scalar-cli": "declared safe-point floating-point scalar descriptor subset",
  "029-errno-libc-result-boundary-cli":
    "declared safe-point target-native libc errno boundary descriptor",
  "030-malloc-free-boundary-cli": "declared safe-point malloc/free ownership boundary descriptor",
};

const entryByShape = {
  "002-string-transform-cli": "continue_string",
  "003-array-sum-cli": "continue_array",
  "004-linked-list-cli": "continue_list",
  "005-regular-file-reader": "continue_file_reader",
  "006-append-only-logger": "continue_append_logger",
  "007-argv-env-printer": "continue_argv_env",
  "008-malloc-object-graph": "continue_graph",
  "009-recursive-factorial-safepoint": "continue_factorial",
  "011-two-file-copy-cli": "continue_two_file_copy",
  "012-seek-overwrite-cli": "continue_seek_overwrite",
  "013-line-reader-cli": "continue_line_reader",
  "014-directory-listing-cli": "continue_directory_listing",
  "015-stat-checker-cli": "continue_stat_checker",
  "016-stdio-echo-cli": "continue_stdio_echo",
  "017-fixed-ring-buffer-cli": "continue_ring_buffer",
  "018-queue-cli": "continue_queue",
  "019-binary-tree-traversal-cli": "continue_tree",
  "020-hash-table-fixed-buckets-cli": "continue_hash_table",
  "021-graph-with-shared-node-cli": "continue_shared_node",
  "022-cycle-list-cli": "continue_cycle_list",
  "023-struct-with-nested-pointers-cli": "continue_nested_pointers",
  "024-global-variable-counter-cli": "continue_global_counter",
  "025-static-buffer-cli": "continue_static_buffer",
  "026-multiple-stack-frames-cli": "continue_multiple_frames",
  "027-callee-saved-register-cli": "continue_callee_saved_register",
  "028-float-simd-scalar-cli": "continue_float_scalar",
  "029-errno-libc-result-boundary-cli": "continue_errno_boundary",
  "030-malloc-free-boundary-cli": "continue_malloc_free_boundary",
};
const allowedArchitectures = new Set(["arm64", "amd64"]);

function fail(shape, code, reason) {
  return { shape, decision: "refused", supportStage: "1-refused", refusalCode: code, reason };
}

function isHex(value) {
  return typeof value === "string" && /^0x[0-9a-f]+$/iu.test(value);
}

function guardFalse(ir, key) {
  return ir.claimGuard?.[key] === false;
}

export function classifyNativeShape(shape, ir) {
  if (!supportedShapes[shape]) {
    return fail(shape, "native-shape-unknown-shape", "shape is not in the supported detector set");
  }
  if (ir.kind !== "machinen.research.native-binary-shape-ir") {
    return fail(shape, "native-shape-wrong-ir-kind", "IR kind is not the native binary shape IR");
  }
  if (ir.shape !== shape) {
    return fail(shape, "native-shape-mismatch", "IR shape does not match requested detector shape");
  }
  if (!allowedArchitectures.has(ir.sourceArch) || !allowedArchitectures.has(ir.targetArch)) {
    return fail(
      shape,
      "native-shape-unknown-architecture",
      "source or target architecture is unknown",
    );
  }
  if (ir.sourceArch === ir.targetArch) {
    return fail(
      shape,
      "native-shape-not-cross-architecture",
      "source and target architectures must differ",
    );
  }
  if (ir.safePoint !== "declared_shape_ready") {
    return fail(
      shape,
      "native-shape-missing-safe-point",
      "safe point is not declared for this shape",
    );
  }
  if (
    ir.entrySymbol !== entryByShape[shape] ||
    ir.targetCpuPlan?.pcSymbol !== entryByShape[shape]
  ) {
    return fail(
      shape,
      "native-shape-unsupported-entry-symbol",
      "entry symbol is not the proven target-native continuation",
    );
  }
  if (!isHex(ir.sourceCpu?.pc) || !isHex(ir.sourceCpu?.sp) || !isHex(ir.sourceCpu?.arg0)) {
    return fail(
      shape,
      "native-shape-missing-source-cpu",
      "source pc, sp, and arg0 must be captured",
    );
  }
  if (ir.targetCpuPlan?.argumentRegister !== (ir.targetArch === "amd64" ? "rdi" : "x0")) {
    return fail(
      shape,
      "native-shape-wrong-target-argument-register",
      "target argument register does not match the target ABI",
    );
  }
  if (ir.targetCpuPlan?.stackBytes !== 65536) {
    return fail(
      shape,
      "native-shape-wrong-target-stack-plan",
      "target stack plan does not match retained proof",
    );
  }
  for (const key of [
    "arbitraryProcessRestoreClaimed",
    "rawVmReplayUsed",
    "sourceIsaEmulationUsed",
    "metadataOnlySuccess",
  ]) {
    if (!guardFalse(ir, key)) {
      return fail(shape, "native-shape-claim-guard-not-false", `claim guard ${key} must be false`);
    }
  }
  if (ir.activeSyscall === true || ir.hasThreads === true || ir.hasSocket === true) {
    return fail(
      shape,
      "native-shape-unsupported-live-state",
      "active syscall, thread, or socket state is outside this supported subset",
    );
  }
  if (
    ir.shapeDescriptor?.threads !== 1 ||
    ir.shapeDescriptor?.activeSyscall !== false ||
    ir.shapeDescriptor?.sockets !== 0
  ) {
    return fail(
      shape,
      "native-shape-descriptor-outside-supported-subset",
      "shape descriptor is outside the supported single-thread/no-socket subset",
    );
  }
  return {
    shape,
    decision: "accepted",
    supportStage: "4-supported-subset",
    supportScope: supportedShapes[shape],
    sourceArch: ir.sourceArch,
    targetArch: ir.targetArch,
    facts: {
      entrySymbol: ir.entrySymbol,
      sourcePc: ir.sourceCpu.pc,
      sourceSp: ir.sourceCpu.sp,
      sourceArg0: ir.sourceCpu.arg0,
      targetArgumentRegister: ir.targetCpuPlan.argumentRegister,
      targetStackBytes: ir.targetCpuPlan.stackBytes,
    },
  };
}

function main() {
  const [shape, irPath] = process.argv.slice(2);
  if (!shape || !irPath) {
    console.error("usage: node native-shape-detector.mjs <shape> <continuation-ir.json>");
    process.exit(2);
  }
  const result = classifyNativeShape(shape, JSON.parse(readFileSync(irPath, "utf8")));
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.decision === "accepted" ? 0 : 10);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
