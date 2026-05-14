#!/usr/bin/env bash
# Docker reference number for the FUSE-over-vsock mount-server bench
# (#329). Same tarball, same host, extracted into a fresh volume on
# arm64v8/debian:12 — what we want machinen + live-mount to converge
# toward.
#
# Usage:
#   docker-baseline.sh <tarball.tar.gz>
#
# Stdout: one line of JSON: {"wallMs": N, "scratchPath": "/tmp/…"}.
# The wrapping bench/mount.ts merges this into the run JSON.

set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <tarball.tar.xz>" >&2
  exit 2
fi

TARBALL=$1
if [ ! -f "$TARBALL" ]; then
  echo "tarball not found: $TARBALL" >&2
  exit 2
fi

SCRATCH=$(mktemp -d -t machinen-bench-docker.XXXXXX)
TARBALL_DIR=$(cd "$(dirname "$TARBALL")" && pwd)
TARBALL_NAME=$(basename "$TARBALL")

# `time -p` is portable; we read the real-time line. We're not using
# `date` deltas — the wall is what `time` gives us, in seconds with
# millisecond precision on darwin.
START=$(python3 -c 'import time; print(int(time.time()*1000))')
docker run --rm \
  -v "$SCRATCH":/dst \
  -v "$TARBALL_DIR":/in:ro \
  --platform linux/arm64 \
  arm64v8/debian:12 \
  sh -c "cd /dst && tar -xzf /in/$TARBALL_NAME" \
  >/dev/null
END=$(python3 -c 'import time; print(int(time.time()*1000))')

WALL=$((END - START))
printf '{"wallMs":%d,"scratchPath":"%s"}\n' "$WALL" "$SCRATCH"

# Caller is responsible for cleaning $scratchPath.
