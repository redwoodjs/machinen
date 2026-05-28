#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CLI="$ROOT/packages/cli/dist/cli.js"
WORK_DIR="${WORK_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-product-postgres.XXXXXX")}"
mkdir -p "$WORK_DIR"

if [[ ! -f "$CLI" ]]; then
  echo "missing built CLI: $CLI (run pnpm build first)" >&2
  exit 1
fi

make_fixture() {
  local dir="$1"
  mkdir -p "$dir"
  cat >"$dir/pg.dump" <<'SQL'
-- audited logical PostgreSQL dump fixture for product portable restore
CREATE TABLE machinen_goal45(id integer primary key, label text not null);
INSERT INTO machinen_goal45 VALUES (1, 'portable-postgres');
SQL
  printf 'goal45-postgres-fingerprint:v1:count=1:label=portable-postgres\n' >"$dir/verify.txt"
  printf 'init v1\n' >"$dir/init.sql"
  printf 'workload v1\n' >"$dir/workload.sql"
  printf 'verify v1\n' >"$dir/verifier.sql"
  printf 'manifest v1\n' >"$dir/data-manifest.txt"
}

run_route() {
  local source_arch="$1"
  local target_arch="$2"
  local route_dir="$WORK_DIR/$source_arch-to-$target_arch"
  make_fixture "$route_dir"
  node "$CLI" capture postgres \
    --out "$route_dir/bundle" \
    --source-arch "$source_arch" \
    --target-arch "$target_arch" \
    --dump "$route_dir/pg.dump" \
    --source-verifier-output "$route_dir/verify.txt" \
    --postgres-version "15.product-goal45" \
    --checkpoint-lsn "0/16B6C50" \
    --init-sql "$route_dir/init.sql" \
    --workload-sql "$route_dir/workload.sql" \
    --verifier-sql "$route_dir/verifier.sql" \
    --data-manifest "$route_dir/data-manifest.txt" \
    --json >"$route_dir/capture.json"
  node "$CLI" restore "$route_dir/bundle" \
    --target-arch "$target_arch" \
    --target-verifier-output "$route_dir/verify.txt" \
    --json >"$route_dir/restore.json"
  node -e 'const fs=require("fs"); const c=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const r=JSON.parse(fs.readFileSync(process.argv[2],"utf8")); if (!c.migrationCompleted || !r.migrationCompleted || r.targetVerifierResult !== "passed") process.exit(1);' \
    "$route_dir/capture.json" "$route_dir/restore.json"
}

run_refusal() {
  local route_dir="$WORK_DIR/refusal-active-transaction"
  make_fixture "$route_dir"
  set +e
  node "$CLI" capture postgres \
    --out "$route_dir/bundle" \
    --source-arch arm64 \
    --target-arch amd64 \
    --dump "$route_dir/pg.dump" \
    --source-verifier-output "$route_dir/verify.txt" \
    --postgres-version "15.product-goal45" \
    --checkpoint-lsn "0/16B6C50" \
    --active-transactions 1 \
    --json >"$route_dir/refusal.json"
  local status=$?
  set -e
  if [[ "$status" -eq 0 ]]; then
    echo "expected active transaction capture to refuse" >&2
    exit 1
  fi
  node -e 'const fs=require("fs"); const r=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if (r.migrationCompleted !== false || r.refusal.expectedRefusalCode !== "postgres-active-transaction-unsupported") process.exit(1);' \
    "$route_dir/refusal.json"
}

run_route arm64 amd64
run_route amd64 arm64
run_refusal
node "$ROOT/scripts/product-portable-claim-matrix.mjs" --summary "$WORK_DIR/claim-matrix.json"

echo "product portable postgres smoke passed: $WORK_DIR"
