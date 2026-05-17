#!/usr/bin/env bash
# Download gvproxy (containers/gvisor-tap-vsock) into a destination dir.
#
# Used by both:
#   - .github/workflows/release.yml (stages into
#     packages/native-<arch>-<os>/vmm/bin/ so the published npm package
#     carries it)
#   - scripts/smoke-tests.sh + dev bootstrap (stages next to the
#     locally-built VMM so `resolveGvproxyBinary()`'s sibling lookup
#     finds it during dev)
#
# Single source of truth for the pinned version and download URLs so
# prod and dev stay lockstep — bump here and both paths pick it up.
#
# Usage:
#   scripts/install-gvproxy.sh --dest <dir> [--os darwin|linux] [--arch arm64|amd64]
#
# Defaults: --os/--arch from uname. If the binary already exists and is
# executable in --dest, this is a no-op.

set -euo pipefail

GVPROXY_VERSION="v0.8.6"

dest=""
os=""
arch=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dest) dest="$2"; shift 2 ;;
    --os)   os="$2"; shift 2 ;;
    --arch) arch="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "install-gvproxy: unknown arg: $1" >&2; exit 2 ;;
  esac
done

if [[ -z "$dest" ]]; then
  echo "install-gvproxy: --dest <dir> is required" >&2
  exit 2
fi

if [[ -z "$os" ]]; then
  case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux)  os="linux" ;;
    *)      echo "install-gvproxy: unsupported OS: $(uname -s)" >&2; exit 1 ;;
  esac
fi
if [[ -z "$arch" ]]; then
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
    x86_64|amd64) arch="amd64" ;;
    *) echo "install-gvproxy: unsupported arch: $(uname -m)" >&2; exit 1 ;;
  esac
fi
case "$arch" in
  arm64|aarch64) arch="arm64" ;;
  amd64|x86_64|x64) arch="amd64" ;;
  *) echo "install-gvproxy: unsupported --arch: $arch" >&2; exit 1 ;;
esac

# The upstream releases use "gvproxy-darwin" (universal binary) and
# "gvproxy-linux-<arch>". Keep this mapping aligned with whatever
# release.yml consumes.
case "$os" in
  darwin) asset="gvproxy-darwin" ;;
  linux)  asset="gvproxy-linux-${arch}" ;;
  *)      echo "install-gvproxy: unsupported --os: $os" >&2; exit 1 ;;
esac

mkdir -p "$dest"
out="${dest%/}/gvproxy"

if [[ -x "$out" ]]; then
  echo "install-gvproxy: already present at $out"
  exit 0
fi

url="https://github.com/containers/gvisor-tap-vsock/releases/download/${GVPROXY_VERSION}/${asset}"
echo "install-gvproxy: downloading ${GVPROXY_VERSION} (${asset}) -> $out"
curl -fsSL "$url" -o "$out"
chmod +x "$out"
