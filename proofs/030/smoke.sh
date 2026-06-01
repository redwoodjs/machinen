#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exec pnpm --dir "$ROOT" exec tsx "$ROOT/proofs/030/smoke.ts" "$@"
