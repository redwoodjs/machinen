#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKDIR="$(mktemp -d "${TMPDIR:-/tmp}/machinen-nested-virt.XXXXXX")"
JSON=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --work-dir) WORKDIR="$2"; mkdir -p "$WORKDIR"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/nested-virtualization-stretch-proof.sh [--json] [--work-dir path]" >&2; exit 2 ;;
  esac
done
SUMMARY="$WORKDIR/summary.json"
STDOUT="$WORKDIR/stdout.json"

cd "$ROOT"
pnpm run nested-virtualization-stretch-proof >"$STDOUT"
node - "$STDOUT" "$SUMMARY" <<'NODE'
const { readFileSync, writeFileSync } = require('node:fs');
const input = readFileSync(process.argv[2], 'utf8');
const marker = '{\n  "kind": "machinen.architecture-portable-snapshot.nested-virtualization-stretch-proof-summary"';
const start = input.lastIndexOf(marker);
if (start < 0) throw new Error('missing JSON summary');
const summary = JSON.parse(input.slice(start));
writeFileSync(process.argv[3], JSON.stringify(summary, null, 2));
if (!summary.pass) throw new Error(`summary failed: ${summary.failures.join('; ')}`);
if (summary.rowCount !== 1) throw new Error(`expected 1 row, saw ${summary.rowCount}`);
const row = summary.rows[0];
if (row.kind !== 'machinen.architecture-portable-snapshot.nested-virtualization-stretch-proof') throw new Error('wrong row kind');
if (!['stretch-demo', 'refused', 'skipped'].includes(row.classification)) throw new Error('bad classification');
if (row.scope.productSupportClaimed) throw new Error('nested stretch row claimed product support');
if (row.snapshotForkRefusalCode !== 'BOOT_VMSTATE_UNSUPPORTED') throw new Error('missing snapshot/fork refusal code');
if (row.classification === 'stretch-demo') {
  if (row.l1GuestArch !== 'aarch64' || row.l2GuestArch !== 'aarch64') throw new Error('expected aarch64 L1/L2 stretch proof');
  if (!row.accelerated || row.emulated) throw new Error('stretch proof acceleration labels are wrong');
  if (!row.nestedVerifierOutput.includes('firecracker-nested-ok')) throw new Error('missing L2 verifier marker');
} else if (!row.refusalCode || !row.remediation) {
  throw new Error('non-stretch row missing refusal/remediation');
}
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$SUMMARY"
else
  echo "nested-virtualization-stretch-proof: classification=$(node -e "const s=require(process.argv[1]); console.log(s.rows[0].classification)" "$SUMMARY") work=$WORKDIR"
fi
