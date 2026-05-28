#!/usr/bin/env sh
set -eu

bundle_dir=${1:-}
if [ -z "$bundle_dir" ]; then
  echo "usage: architecture-portable-controlled-continuation-target-loader.sh bundle-dir" >&2
  exit 2
fi
if [ ! -f "$bundle_dir/target.env" ]; then
  echo "target-loader-refusal=bundle-invalid missing target.env" >&2
  exit 10
fi
# shellcheck disable=SC1090
. "$bundle_dir/target.env"

machine=$(uname -m)
case "$machine" in
  x86_64|amd64) actual_arch=amd64 ;;
  aarch64|arm64) actual_arch=arm64 ;;
  *) actual_arch=unknown ;;
esac

if [ "$actual_arch" != "$TARGET_ARCH" ]; then
  echo "target-loader-refusal=target-arch-mismatch actual=$actual_arch expected=$TARGET_ARCH" >&2
  exit 11
fi
if [ "${SOURCE_ISA_EMULATION_USED:-1}" != 0 ] || [ "${SIDECAR_RUNTIME_USED:-1}" != 0 ] || \
   [ "${METADATA_ONLY_CONTINUATION:-1}" != 0 ] || [ "${RAW_CHECKPOINT_IMAGE_REPLAY_USED:-1}" != 0 ]; then
  echo "target-loader-refusal=forbidden-shortcut" >&2
  exit 12
fi
binary="$bundle_dir/$TARGET_BINARY_REL"
if [ ! -x "$binary" ]; then
  echo "target-loader-refusal=bundle-invalid missing target binary" >&2
  exit 13
fi
actual_digest=$(sha256sum "$binary" | awk '{print $1}')
if [ "$actual_digest" != "$TARGET_BINARY_SHA256" ]; then
  echo "target-loader-refusal=target-artifact-digest-mismatch actual=$actual_digest expected=$TARGET_BINARY_SHA256" >&2
  exit 14
fi
if ! output=$("$binary" "$CAPTURED_COUNTER" "$CONTINUATION_LABEL" "$SOURCE_ARCH" "$TARGET_ARCH" 2>&1); then
  printf '%s\n' "$output" >&2
  echo "target-loader-refusal=target-verifier-failed process-exit" >&2
  exit 15
fi
printf '%s\n' "$output"
printf 'loader-target-arch=%s\n' "$actual_arch"
printf 'targetArtifactDigest=%s\n' "$actual_digest"
printf 'sourceIsaEmulationUsed=false\nsidecarRuntimeUsed=false\nmetadataOnlyContinuation=false\nrawCheckpointImageReplayUsed=false\n'
if ! printf '%s\n' "$output" | grep -q 'target-native-continuation-ok'; then
  echo "target-loader-refusal=target-verifier-failed missing marker" >&2
  exit 15
fi
if ! printf '%s\n' "$output" | grep -q "restoredCounter=$NEXT_COUNTER"; then
  echo "target-loader-refusal=target-verifier-failed wrong counter" >&2
  exit 16
fi
