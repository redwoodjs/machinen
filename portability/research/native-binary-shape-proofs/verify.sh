#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
ARM64_HOST=${TRACK_A_ARM64_HOST:-friend@100.126.46.90}
AMD64_HOST=${TRACK_A_AMD64_HOST:-root@192.168.0.8}
RUN_ID=${TRACK_A_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}
LOCAL_WORK=${TRACK_A_LOCAL_WORK:-/tmp/machinen-native-shape-proofs-$RUN_ID}
ARM64_WORK=${TRACK_A_ARM64_WORK:-/tmp/machinen-native-shape-proofs-$RUN_ID}
AMD64_WORK=${TRACK_A_AMD64_WORK:-/tmp/machinen-native-shape-proofs-$RUN_ID}

DEFAULT_SHAPES=(
  002-string-transform-cli
  003-array-sum-cli
  004-linked-list-cli
  005-regular-file-reader
  006-append-only-logger
  007-argv-env-printer
  008-malloc-object-graph
  009-recursive-factorial-safepoint
  011-two-file-copy-cli
  012-seek-overwrite-cli
  013-line-reader-cli
  014-directory-listing-cli
  015-stat-checker-cli
  016-stdio-echo-cli
  017-fixed-ring-buffer-cli
  018-queue-cli
  019-binary-tree-traversal-cli
  020-hash-table-fixed-buckets-cli
  021-graph-with-shared-node-cli
  022-cycle-list-cli
  023-struct-with-nested-pointers-cli
  024-global-variable-counter-cli
  025-static-buffer-cli
  026-multiple-stack-frames-cli
  027-callee-saved-register-cli
  028-float-simd-scalar-cli
  029-errno-libc-result-boundary-cli
  030-malloc-free-boundary-cli
  031-csv-record-parser-cli
  032-json-token-parser-cli
  033-checksum-running-sum-cli
  034-rle-decoder-cli
  035-chunked-decoder-cli
  036-fixed-arena-allocator-cli
  037-bitmap-scanner-cli
  038-bitset-counter-cli
  039-priority-queue-fixed-heap-cli
  040-deque-cli
  041-trie-lookup-cli
  042-tokenizer-state-machine-cli
  043-config-reload-cli
  044-temp-file-rename-cli
  045-file-truncate-cli
  046-sparse-file-seek-cli
  047-commit-marker-file-cli
  048-lockfile-cli
  049-monotonic-counter-file-cli
  050-deterministic-prng-cli
  051-less-readonly-pager-cli
  052-less-search-forward-cli
  053-less-page-backward-cli
  054-less-percent-position-cli
  055-less-mark-jump-cli
  056-less-goto-line-cli
  057-less-horizontal-scroll-cli
  058-less-tail-snapshot-cli
  059-grep-line-boundary-cli
  060-wc-line-count-cli
  061-tail-readonly-cli
  062-less-screen-render-cli
  063-less-wrap-long-line-cli
  064-less-no-wrap-long-line-cli
  065-less-tab-expand-cli
  066-less-case-insensitive-search-cli
  067-less-highlight-match-cli
  068-less-status-prompt-cli
  069-less-multiple-file-index-cli
  070-less-quit-state-cli
  071-less-help-screen-cli
)
if (($# > 0)); then
  SHAPES=("$@")
  PRESERVE_RETAINED=1
else
  SHAPES=("${DEFAULT_SHAPES[@]}")
  PRESERVE_RETAINED=0
fi
mkdir -p "$LOCAL_WORK" "$RETAINED_DIR"

cleanup() {
  rm -rf "$LOCAL_WORK"
  ssh -o BatchMode=yes "$ARM64_HOST" "rm -rf '$ARM64_WORK'" >/dev/null 2>&1 || true
  ssh -o BatchMode=yes "$AMD64_HOST" "rm -rf '$AMD64_WORK'" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_ssh() {
  local host=$1
  shift
  ssh -o BatchMode=yes "$host" "$@"
}

copy_to_host() {
  local source=$1
  local host=$2
  local target=$3
  scp -q "$source" "$host:$target"
}

copy_from_host() {
  local host=$1
  local source=$2
  local target=$3
  scp -q "$host:$source" "$target"
}

require_host() {
  local host=$1
  local expected=$2
  local actual
  actual=$(run_ssh "$host" "uname -m")
  case "$expected:$actual" in
    arm64:aarch64|arm64:arm64|amd64:x86_64|amd64:amd64) ;;
    *)
      echo "expected $host to be $expected, got $actual" >&2
      exit 2
      ;;
  esac
}

compile_fixture() {
  local host=$1
  local arch=$2
  local work=$3
  run_ssh "$host" "mkdir -p '$work'"
  copy_to_host "$SCRIPT_DIR/fixture.c" "$host" "$work/fixture.c"
  run_ssh "$host" "cc -std=gnu11 -Wall -Wextra -Werror -O2 -DTRACK_A_ARCH=\\\"$arch\\\" '$work/fixture.c' -o '$work/shape-proof'"
}

expected_output() {
  case "$1" in
    002-string-transform-cli) echo "string:hello!" ;;
    003-array-sum-cli) echo "array:10" ;;
    004-linked-list-cli) echo "list:6" ;;
    005-regular-file-reader) echo "file:cross" ;;
    006-append-only-logger) echo "append:second" ;;
    007-argv-env-printer) echo "argv=demo env=ok" ;;
    008-malloc-object-graph) echo "graph:15" ;;
    009-recursive-factorial-safepoint) echo "factorial:120" ;;
    011-two-file-copy-cli) echo "copy:copy" ;;
    012-seek-overwrite-cli) echo "overwrite:3:XY" ;;
    013-line-reader-cli) echo "line:second" ;;
    014-directory-listing-cli) echo "dir:2" ;;
    015-stat-checker-cli) echo "stat:5" ;;
    016-stdio-echo-cli) echo "stdio:echo" ;;
    017-fixed-ring-buffer-cli) echo "ring:9" ;;
    018-queue-cli) echo "queue:7" ;;
    019-binary-tree-traversal-cli) echo "tree:6" ;;
    020-hash-table-fixed-buckets-cli) echo "hash:30" ;;
    021-graph-with-shared-node-cli) echo "shared:9:1" ;;
    022-cycle-list-cli) echo "cycle:6" ;;
    023-struct-with-nested-pointers-cli) echo "nested:child" ;;
    024-global-variable-counter-cli) echo "global:42" ;;
    025-static-buffer-cli) echo "static:buf!" ;;
    026-multiple-stack-frames-cli) echo "frames:6" ;;
    027-callee-saved-register-cli) echo "callee:42" ;;
    028-float-simd-scalar-cli) echo "float:42.0" ;;
    029-errno-libc-result-boundary-cli) echo "errno:1" ;;
    030-malloc-free-boundary-cli) echo "mallocfree:6" ;;
    031-csv-record-parser-cli) echo "csv:3" ;;
    032-json-token-parser-cli) echo "json:ok" ;;
    033-checksum-running-sum-cli) echo "checksum:42" ;;
    034-rle-decoder-cli) echo "rle:aaabb" ;;
    035-chunked-decoder-cli) echo "chunk:test" ;;
    036-fixed-arena-allocator-cli) echo "arena:24" ;;
    037-bitmap-scanner-cli) echo "bitmap:4" ;;
    038-bitset-counter-cli) echo "bitset:5" ;;
    039-priority-queue-fixed-heap-cli) echo "pqueue:1" ;;
    040-deque-cli) echo "deque:7" ;;
    041-trie-lookup-cli) echo "trie:value" ;;
    042-tokenizer-state-machine-cli) echo "token:abc" ;;
    043-config-reload-cli) echo "config:42" ;;
    044-temp-file-rename-cli) echo "rename:final" ;;
    045-file-truncate-cli) echo "truncate:2" ;;
    046-sparse-file-seek-cli) echo "sparse:1024" ;;
    047-commit-marker-file-cli) echo "commit:committed" ;;
    048-lockfile-cli) echo "lock:created" ;;
    049-monotonic-counter-file-cli) echo "filecounter:42" ;;
    050-deterministic-prng-cli) echo "prng:" ;;
    051-less-readonly-pager-cli) echo "less:line2|line3" ;;
    052-less-search-forward-cli) echo "less-search:needle line" ;;
    053-less-page-backward-cli) echo "less-back:line2" ;;
    054-less-percent-position-cli) echo "less-percent:50" ;;
    055-less-mark-jump-cli) echo "less-mark:mark" ;;
    056-less-goto-line-cli) echo "less-goto:line3" ;;
    057-less-horizontal-scroll-cli) echo "less-hscroll:cdef" ;;
    058-less-tail-snapshot-cli) echo "less-tail:last" ;;
    059-grep-line-boundary-cli) echo "grep:2" ;;
    060-wc-line-count-cli) echo "wc:3" ;;
    061-tail-readonly-cli) echo "tail:three" ;;
    062-less-screen-render-cli) echo "less-screen:line2|line3" ;;
    063-less-wrap-long-line-cli) echo "less-wrap:abcde|fghij" ;;
    064-less-no-wrap-long-line-cli) echo "less-nowrap:abcde" ;;
    065-less-tab-expand-cli) echo "less-tab:a   b" ;;
    066-less-case-insensitive-search-cli) echo "less-isearch:1" ;;
    067-less-highlight-match-cli) echo "less-highlight:[needle]" ;;
    068-less-status-prompt-cli) echo "less-status:file 50%" ;;
    069-less-multiple-file-index-cli) echo "less-file:file2" ;;
    070-less-quit-state-cli) echo "less-quit:0" ;;
    071-less-help-screen-cli) echo "less-help:q quit" ;;
    *) exit 2 ;;
  esac
}

run_direction() {
  local shape=$1
  local source_host=$2
  local source_arch=$3
  local source_work=$4
  local target_host=$5
  local target_arch=$6
  local target_work=$7
  local name="$shape-$source_arch-to-$target_arch"

  echo "proof: $name"
  run_ssh "$source_host" "'$source_work/shape-proof' capture '$shape' '$source_arch' '$target_arch' '$source_work/$name.ir.json'" >"$LOCAL_WORK/capture-$name.log"
  copy_from_host "$source_host" "$source_work/$name.ir.json" "$LOCAL_WORK/$name.ir.json"
  copy_to_host "$LOCAL_WORK/$name.ir.json" "$target_host" "$target_work/$name.ir.json"
  run_ssh "$target_host" "'$target_work/shape-proof' restore '$shape' '$target_work/$name.ir.json' '$target_work'" >"$LOCAL_WORK/restore-$name.log"
  grep -Fq "$(expected_output "$shape")" "$LOCAL_WORK/restore-$name.log"
  grep -Fq "SHAPE_RESTORE_OK shape=$shape target=$target_arch" "$LOCAL_WORK/restore-$name.log"
}

require_host "$ARM64_HOST" arm64
require_host "$AMD64_HOST" amd64
compile_fixture "$ARM64_HOST" arm64 "$ARM64_WORK"
compile_fixture "$AMD64_HOST" amd64 "$AMD64_WORK"

for shape in "${SHAPES[@]}"; do
  run_direction "$shape" "$ARM64_HOST" arm64 "$ARM64_WORK" "$AMD64_HOST" amd64 "$AMD64_WORK"
  run_direction "$shape" "$AMD64_HOST" amd64 "$AMD64_WORK" "$ARM64_HOST" arm64 "$ARM64_WORK"
done

if [[ "$PRESERVE_RETAINED" -eq 0 ]]; then
  rm -f "$RETAINED_DIR"/*
fi
for artifact in "$LOCAL_WORK"/*.ir.json "$LOCAL_WORK"/*.log; do
  cp "$artifact" "$RETAINED_DIR/$(basename "$artifact")"
done

arm64_uname=$(run_ssh "$ARM64_HOST" "uname -a")
amd64_uname=$(run_ssh "$AMD64_HOST" "uname -a")
python3 - "$RETAINED_DIR/report.json" "$RUN_ID" "$ARM64_HOST" "$AMD64_HOST" "$arm64_uname" "$amd64_uname" "${SHAPES[@]}" <<'PY'
import json
import sys
path, run_id, arm64_host, amd64_host, arm64_uname, amd64_uname, *shapes = sys.argv[1:]
report = {
  "kind": "machinen.research.native-binary-shape-proofs.report",
  "version": 1,
  "runId": run_id,
  "arm64Host": arm64_host,
  "amd64Host": amd64_host,
  "arm64Uname": arm64_uname,
  "amd64Uname": amd64_uname,
  "sharedResearchHost": "192.168.0.8",
  "shapes": [
    {
      "id": shape,
      "directions": {
        "arm64-to-amd64": {
          "sourceCapture": f"retained/{shape}-arm64-to-amd64.ir.json",
          "targetRestoreLog": f"retained/restore-{shape}-arm64-to-amd64.log"
        },
        "amd64-to-arm64": {
          "sourceCapture": f"retained/{shape}-amd64-to-arm64.ir.json",
          "targetRestoreLog": f"retained/restore-{shape}-amd64-to-arm64.log"
        }
      }
    }
    for shape in shapes
  ],
  "claimGuard": {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False
  },
  "status": "passed"
}
with open(path, "w", encoding="utf-8") as handle:
  json.dump(report, handle, indent=2)
  handle.write("\n")
PY
python3 -m json.tool "$RETAINED_DIR/report.json" >/dev/null

echo "Native binary shape proofs passed"
echo "Retained report: $RETAINED_DIR/report.json"
