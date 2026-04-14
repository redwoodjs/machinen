#!/usr/bin/env bash
set -e
pnpm build
# Strip leading "--" that pnpm injects before forwarded args
[[ "${1:-}" == "--" ]] && shift
node packages/cli/dist/machinen.js "$@"
