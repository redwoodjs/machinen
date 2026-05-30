#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
pnpm exec tsx proof/176/smoke.ts
