#!/usr/bin/env bash
# Thin wrapper around the locally-built machinen CLI: forwards all
# arguments to packages/cli/dist/cli.js and pins MACHINEN_ASSETS_DIR
# at this checkout's release-assets/. Behaves exactly like the
# published `machinen` binary, just sourced from the local tree.
#
# Run `pnpm build` first to (re)build the runtime, CLI, VMM, and base
# assets. `pnpm build` is hash-stamped, so repeated invocations are a
# no-op when nothing has changed.
#
# Usage:
#   pnpm dev <any cli args>
# Examples:
#   pnpm dev boot --name dev -- /bin/sh -i
#   pnpm dev ls
#   pnpm dev exec --name dev -- uname -a

set -euo pipefail

# Resolve symlinks so this works whether invoked directly
# (`scripts/dev.sh ...`) or via a symlink in $PATH (e.g.
# `/opt/homebrew/bin/machinen -> .../scripts/dev.sh`). Without this
# `$0` is the symlink path and `$(dirname "$0")/..` resolves to the
# wrong tree.
SOURCE="${BASH_SOURCE[0]}"
while [ -L "$SOURCE" ]; do
  DIR=$(cd -P "$(dirname "$SOURCE")" && pwd)
  SOURCE=$(readlink "$SOURCE")
  case "$SOURCE" in
    /*) ;;
    *) SOURCE="$DIR/$SOURCE" ;;
  esac
done
ROOT=$(cd -P "$(dirname "$SOURCE")/.." && pwd)

exec env MACHINEN_ASSETS_DIR="$ROOT/release-assets" \
  node "$ROOT/packages/cli/dist/cli.js" "$@"
