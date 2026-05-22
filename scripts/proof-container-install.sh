#!/usr/bin/env bash
# Install proof-container dependencies with reusable Corepack and pnpm caches.
set -euo pipefail

cache_root="${MACHINEN_PROOF_CACHE_ROOT:-/tmp/machinen-proof-cache}"
corepack_home="${COREPACK_HOME:-/corepack}"
pnpm_store="${MACHINEN_PNPM_STORE_DIR:-/pnpm-store}"

ensure_writable_dir() {
  local desired="$1"
  local fallback="$2"
  if mkdir -p "$desired" 2>/dev/null && [ -w "$desired" ]; then
    printf '%s\n' "$desired"
  else
    mkdir -p "$fallback"
    printf '%s\n' "$fallback"
  fi
}

corepack_home="$(ensure_writable_dir "$corepack_home" "$cache_root/corepack")"
pnpm_store="$(ensure_writable_dir "$pnpm_store" "$cache_root/pnpm-store")"

export COREPACK_HOME="$corepack_home"

printf 'proof-install: COREPACK_HOME=%s\n' "$COREPACK_HOME"
printf 'proof-install: pnpm store=%s\n' "$pnpm_store"

corepack enable >/dev/null 2>&1
pnpm config set store-dir "$pnpm_store" >/dev/null

if [ "${MACHINEN_PNPM_FETCH:-1}" != "0" ]; then
  pnpm fetch --frozen-lockfile
fi

pnpm install --frozen-lockfile --ignore-scripts --prefer-offline
