#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-advanced-linux.XXXXXX")}"
JSON=0
mkdir -p "$WORK"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --json) JSON=1; shift ;;
    --work-dir) WORK="$2"; mkdir -p "$WORK"; shift 2 ;;
    *) echo "usage: bash scripts/smoke/advanced-linux-facility-probe.sh [--json] [--work-dir path]" >&2; exit 2 ;;
  esac
done

pnpm exec tsx "$ROOT/scripts/advanced-linux-facility-probe.ts" \
  --summary "$WORK/summary.json" \
  --json >"$WORK/stdout.json"

node --input-type=module - "$WORK/summary.json" <<'NODE'
import { readFileSync } from 'node:fs';
const summary = JSON.parse(readFileSync(process.argv[2], 'utf8'));
if (!summary.pass) throw new Error(`advanced Linux probe failed: ${summary.failures.join('; ')}`);
if (summary.rowCount !== 5) throw new Error(`expected 5 rows, got ${summary.rowCount}`);
const seccomp = summary.rows.find((row) => row.facility === 'seccomp');
const ebpf = summary.rows.find((row) => row.facility === 'ebpf');
if (!seccomp || !['proof-only-feasibility', 'refused'].includes(seccomp.classification)) throw new Error('seccomp verifier did not prove or refuse');
if (seccomp.classification === 'proof-only-feasibility' && !seccomp.verifierOutput.includes('EPERM-after=true')) throw new Error('seccomp proof did not show blocked syscall');
if (seccomp.classification === 'refused' && !seccomp.refusalCode) throw new Error('seccomp refusal code was missing');
if (ebpf?.refusalCode !== 'insufficient-privileges') throw new Error('eBPF refusal code was not stable');
NODE

if [[ $JSON -eq 1 ]]; then
  cat "$WORK/summary.json"
else
  node -e "const s=require('$WORK/summary.json'); console.log('advanced-linux-facility-probe: '+s.state+' rows='+s.rowCount+' work=$WORK')"
fi
