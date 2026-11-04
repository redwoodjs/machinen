#!/usr/bin/env bash
# Build and sign machinen-vz-runner.
#
# The runner needs the virtualization entitlement. Ad-hoc signing is enough
# for local use; distribution needs a Developer ID identity, supplied
# through MACHINEN_VZ_SIGN_IDENTITY.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${here}/bin"
identity="${MACHINEN_VZ_SIGN_IDENTITY:--}"

mkdir -p "${out}"

swiftc \
  -O \
  -target arm64-apple-macos13.0 \
  -framework Virtualization \
  -framework Foundation \
  -o "${out}/machinen-vz-runner" \
  "${here}/Sources/main.swift"

codesign \
  --force \
  --sign "${identity}" \
  --entitlements "${here}/entitlements.plist" \
  --options runtime \
  "${out}/machinen-vz-runner"

codesign --verify --strict "${out}/machinen-vz-runner"
"${out}/machinen-vz-runner" --version
