#!/usr/bin/env bash
# Produce the release assets that ship alongside every tag:
#
#   Image-arm64                    ← custom arm64 kernel built from
#                                    upstream kernel.org source with
#                                    virtio_*, ext4, vsock, fuse, and
#                                    CRIU's sock_diag families compiled
#                                    in (CONFIG_*=y, no modules). See
#                                    scripts/build-kernel-arm64.sh and
#                                    issue #119.
#   virt-arm64.dtb                 ← compiled device tree
#   rootfs-debian-arm64.tar.gz     ← debian minbase + /init + /exec-agent
#   rootfs-debian-arm64.img.gz     ← prebaked ext4 image of the same
#                                    rootfs; lets cold boots skip
#                                    tar -xf + mke2fs (#223). Sparse
#                                    inside the gzip — wire size is
#                                    close to the tarball.
#
# For amd64 guests (`MACHINEN_GUEST_ARCH=amd64`), the same flow emits
# `bzImage-x86_64`, `rootfs-debian-amd64.tar.gz`, and
# `rootfs-debian-amd64.img.gz` instead. amd64 does not use a dtb.
#
#   *.sha256                       ← integrity sidecars
#
# We no longer ship modules-arm64.tar.gz — the boot-path drivers are
# built into the kernel, so the tiny cpio (#119) doesn't need /lib/modules
# or any finit_module(2) pass at boot.
#
# Inputs (relative to repo root):
#   packages/microvm/assets/virt.dts
#   packages/microvm/assets/init.zig
#   packages/microvm/assets/exec-agent.zig
#   packages/microvm/assets/machinen-netup.c
#   packages/microvm/assets/lo-up.zig         ← CRIU plumbing (loopback ioctl)
#   packages/microvm/assets/no-iou.zig        ← CRIU plumbing (block io_uring)
#   packages/microvm/assets/poweroff.zig      ← clean shutdown → PSCI SYSTEM_OFF
#
# Also baked into the rootfs (downloaded at build time, not sourced):
#   fnm @ /usr/local/bin/fnm  ← Node version manager. Hits the public
#                                node-dist mirror by default; callers
#                                can redirect via FNM_NODE_DIST_MIRROR
#                                in `boot({ env })`.
#
# Requirements:
#   - docker (with arm64 emulation; GH runners have this by default via
#     docker/setup-qemu-action)
#   - dtc  (device-tree-compiler; apt: device-tree-compiler, brew: dtc)
#   - zig  (0.14+; the release workflow installs it)
#   - curl, unzip  (for downloading and unpacking fnm)
#
# Optional: if MACHINEN_REMOTE_BUILDER is set (e.g. friend@dgx-01), the
# kernel build runs natively on that arm64 host instead of locally —
# turns a multi-hour qemu-arm64 emulated kernel build on darwin into
# a ~3 min native compile. The script rsyncs the kernel build script
# over, runs it remotely, and pulls the resulting Image-arm64 back.
#
# Outputs to ./release-assets/ at the repo root.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")/.." && pwd)
ASSETS="${ROOT}/packages/microvm/assets"
OUT="${ROOT}/release-assets"
GUEST_ARCH="${MACHINEN_GUEST_ARCH:-}"
if [ -z "$GUEST_ARCH" ]; then
  case "$(uname -m)" in
    x86_64|amd64) GUEST_ARCH="amd64" ;;
    *) GUEST_ARCH="arm64" ;;
  esac
fi
case "$GUEST_ARCH" in
  arm64)
    KERNEL_ASSET="Image-arm64"
    DTB_ASSET="virt-arm64.dtb"
    ROOTFS_TAR="rootfs-debian-arm64.tar.gz"
    ROOTFS_IMG="rootfs-debian-arm64.img.gz"
    ZIG_GUEST_TARGET="aarch64-linux-musl"
    DOCKER_PLATFORM="linux/arm64"
    DEBIAN_ARCH="arm64"
    FNM_ASSET="fnm-arm64.zip"
    FNM_SHA256="69feda9455931c26c84be9f95f5e6f69e8b64686e68069fab7cfc34756cd2944"
    ;;
  amd64)
    KERNEL_ASSET="bzImage-x86_64"
    DTB_ASSET=""
    ROOTFS_TAR="rootfs-debian-amd64.tar.gz"
    ROOTFS_IMG="rootfs-debian-amd64.img.gz"
    ZIG_GUEST_TARGET="x86_64-linux-musl"
    DOCKER_PLATFORM="linux/amd64"
    DEBIAN_ARCH="amd64"
    FNM_ASSET="fnm-linux.zip"
    FNM_SHA256="b69e5c9a05c1e17e4a7de9a17df14ba430d049f2591af791a6f850a170296069"
    ;;
  *)
    echo "MACHINEN_GUEST_ARCH must be arm64 or amd64 (got $GUEST_ARCH)" >&2
    exit 1
    ;;
esac
# Per-tarball materialized ext4 images live here, keyed by sha256 of
# the source rootfs-debian-arm64.tar.gz. A fresh build always produces
# a new sha (mtimes / content shift), so old .img files are unreferenced
# the moment this script finishes — wipe them so users don't pile up
# stale GBs and so the next boot rematerializes against the new rootfs.
ROOTFS_IMG_CACHE="${HOME}/.cache/machinen/rootfs"

mkdir -p "$OUT"
# Preserve any pre-staged kernel/dtb (darwin dev workflow); wipe
# everything else so a stale rootfs.tar.gz can't get picked up.
find "$OUT" -mindepth 1 -maxdepth 1 \
  ! -name "$KERNEL_ASSET" ${DTB_ASSET:+! -name "$DTB_ASSET"} ! -name '*.sha256' \
  -exec rm -f {} +
rm -rf "${ROOTFS_IMG_CACHE:?}"/*.img "${ROOTFS_IMG_CACHE:?}"/*-staging-* \
       "${ROOTFS_IMG_CACHE:?}"/*-prebake-* 2>/dev/null || true

# ------------------------------------------------------------
# 1. Kernel — custom upstream build with built-in drivers (#119/#362)
# ------------------------------------------------------------

if [ -f "$OUT/$KERNEL_ASSET" ]; then
  echo "==> Reusing existing kernel: $OUT/$KERNEL_ASSET ($(stat -f %z "$OUT/$KERNEL_ASSET" 2>/dev/null || stat -c %s "$OUT/$KERNEL_ASSET") bytes)"
else
  echo "==> Building custom $GUEST_ARCH kernel with virtio_* + ext4 + vsock + fuse =y"
  KERNEL_PATCHES_DIR="${ROOT}/packages/microvm/patches/kernel"
  if [ "$GUEST_ARCH" = "arm64" ]; then
    if [ -n "${MACHINEN_REMOTE_BUILDER:-}" ]; then
      REMOTE_WORKDIR="${MACHINEN_REMOTE_WORKDIR:-\$HOME/.cache/machinen/kernel}"
      echo "    via remote builder: $MACHINEN_REMOTE_BUILDER (workdir=$REMOTE_WORKDIR)"
      ssh "$MACHINEN_REMOTE_BUILDER" "mkdir -p $REMOTE_WORKDIR/patches"
      rsync -az "${ROOT}/scripts/build-kernel-arm64.sh" \
        "$MACHINEN_REMOTE_BUILDER:$REMOTE_WORKDIR/build-kernel-arm64.sh"
      if [ -d "$KERNEL_PATCHES_DIR" ]; then
        rsync -az --delete "${KERNEL_PATCHES_DIR}/" \
          "$MACHINEN_REMOTE_BUILDER:$REMOTE_WORKDIR/patches/"
      fi
      ssh "$MACHINEN_REMOTE_BUILDER" \
        "WORKDIR=$REMOTE_WORKDIR PATCHES_DIR=$REMOTE_WORKDIR/patches bash $REMOTE_WORKDIR/build-kernel-arm64.sh"
      rsync -az \
        "$MACHINEN_REMOTE_BUILDER:$REMOTE_WORKDIR/Image-arm64" \
        "$OUT/$KERNEL_ASSET"
    elif { [ "$(uname -m)" = "aarch64" ] || [ "$(uname -m)" = "arm64" ]; } && [ "$(uname -s)" = "Linux" ]; then
      WORKDIR="${MACHINEN_KERNEL_WORKDIR:-${ROOT}/.kernel-build}" \
      OUT="$OUT/$KERNEL_ASSET" \
      PATCHES_DIR="$KERNEL_PATCHES_DIR" \
        bash "${ROOT}/scripts/build-kernel-arm64.sh"
    else
      echo "build-base-assets: cannot build the arm64 kernel here." >&2
      echo "  Set MACHINEN_REMOTE_BUILDER=user@host (an arm64 ssh target)," >&2
      echo "  or run this script on native arm64 Linux." >&2
      exit 1
    fi
  else
    if [ "$(uname -s)" != "Linux" ] || { [ "$(uname -m)" != "x86_64" ] && [ "$(uname -m)" != "amd64" ]; }; then
      echo "build-base-assets: amd64 kernel build needs native x86_64 Linux." >&2
      exit 1
    fi
    WORKDIR="${MACHINEN_KERNEL_WORKDIR:-${ROOT}/.kernel-build-x86_64}" \
    OUT="$OUT/$KERNEL_ASSET" \
    PATCHES_DIR="$KERNEL_PATCHES_DIR" \
      bash "${ROOT}/scripts/build-kernel-x86_64.sh"
  fi
fi

# ------------------------------------------------------------
# 2. Device tree blob (arm64 only)
# ------------------------------------------------------------

if [ -n "$DTB_ASSET" ]; then
  if [ -f "$OUT/$DTB_ASSET" ]; then
    echo "==> Reusing existing dtb: $OUT/$DTB_ASSET"
  else
    echo "==> Compiling virt.dts -> $DTB_ASSET"
    dtc -I dts -O dtb "${ASSETS}/virt.dts" -o "$OUT/$DTB_ASSET"
  fi
fi

# ------------------------------------------------------------
# 3. Guest binaries: /init + /exec-agent + /sbin/machinen-netup
#    (all statically linked against musl)
# ------------------------------------------------------------

echo "==> Building guest binaries (init, exec-agent, winsize-agent, CRIU helpers, poweroff, net-bench-probe, portable proof/loader) for ${ZIG_GUEST_TARGET}"
# STAGE has to live inside ROOT, not /tmp, because the mmdebstrap step
# below runs docker with `-v "$STAGE":/stage:ro`. When build-base-assets
# itself runs inside a container (agent-ci's local runner, dev shell
# in a devcontainer), the -v path is interpreted by the *host* docker
# daemon — anything under /tmp inside the runner container is invisible
# to the host. The repo workspace is bind-mounted in by the outer
# orchestrator, so paths under it round-trip correctly.
STAGE="${ROOT}/.build-stage"
rm -rf "$STAGE"
mkdir -p "$STAGE"
trap 'rm -rf "$STAGE"' EXIT

# init + exec-agent land at /init, /exec-agent (machinen-owned root
# entrypoints). lo-up, no-iou, poweroff are machinen-namespaced helpers
# needed by any CRIU-based snapshot flow; they go under /sbin with the
# machinen- prefix alongside machinen-netup.
# net-bench-probe is the #82 gvproxy throughput/latency probe used by
# the smoke harness.
# winsize-agent is the #177 vsock TIOCSWINSZ daemon for dev-VM tty
# resize forwarding; lives at /sbin/machinen-winsize-agent and is
# launched by vm.ts's bootstrap (no auto-launch in non-dev paths).
# memdirty is the #266 RSS-spike workload helper used by the headline
# lazy-pages smoke test: mmaps N MiB anon, dirties every page, parks.
# (`--mount-live` needs no guest binary since #338 — the in-VMM
# virtio-fs device serves it; /init just `mount -t virtiofs`s it.)
for name in init exec-agent winsize-agent lo-up no-iou poweroff net-bench-probe memdirty; do
  zig build-exe "${ASSETS}/${name}.zig" \
    -target "${ZIG_GUEST_TARGET}" \
    -O ReleaseSmall \
    -lc \
    -femit-bin="${STAGE}/${name}"
  rm -f "${STAGE}/${name}.o"
done

zig cc "${ASSETS}/machinen-netup.c" \
  -target "${ZIG_GUEST_TARGET}" \
  -static \
  -Os \
  -o "${STAGE}/machinen-netup"

zig cc "${ASSETS}/vmstate-reseed.c" \
  -target aarch64-linux-musl \
  -static \
  -Os \
  -o "${STAGE}/vmstate-reseed"

zig cc "${ASSETS}/portable-proof-workload.c" \
  -target "${ZIG_GUEST_TARGET}" \
  -static \
  -pthread \
  -Os \
  -o "${STAGE}/portable-proof-workload"

# Refresh the in-tree /init that mkinitramfs.packTinyBundle() reads via
# defaultInitPath() (packages/runtime/src/mkinitramfs.ts). Without this,
# every user-facing boot() ships the binary that was checked in last,
# regardless of how often you rerun this script — release-assets gets
# the new /init, the tiny initramfs path keeps using the stale one, and
# rootDisk: true boots silently regress. See issue #129.
TEST_FIXTURES="${ROOT}/packages/microvm/test-fixtures"
mkdir -p "${TEST_FIXTURES}"
install -m 0755 "${STAGE}/init"        "${TEST_FIXTURES}/init"
install -m 0755 "${STAGE}/exec-agent"  "${TEST_FIXTURES}/exec-agent"

# Also stage them into release-assets/ so the CI artifact carries them
# across runner boundaries. release.yml's release job copies these back
# into packages/microvm/test-fixtures/ before `changeset publish`, so
# the @machinen/microvm tarball ships them. Without this hop the build
# step writes the binaries on the build runner only; the release runner
# never sees them and publishes an empty test-fixtures/. (issue #309)
install -m 0755 "${STAGE}/init"        "${OUT}/init"
install -m 0755 "${STAGE}/exec-agent"  "${OUT}/exec-agent"

# ------------------------------------------------------------
# 3a. fnm — Node version manager
# ------------------------------------------------------------
# Single static Rust binary from the upstream release. Pinned by
# version + sha256 so rebuilds are reproducible and a compromised
# upstream can't slip a different binary past us. fnm itself comes
# from GitHub at build time; node-dist downloads inside the guest go
# straight to nodejs.org unless the caller redirects via
# FNM_NODE_DIST_MIRROR in `boot({ env })`.

echo "==> Downloading fnm (static ${GUEST_ARCH} binary)"
FNM_VERSION="1.38.1"
FNM_URL="https://github.com/Schniz/fnm/releases/download/v${FNM_VERSION}/${FNM_ASSET}"
curl -fsSL -o "${STAGE}/fnm.zip" "$FNM_URL"
echo "${FNM_SHA256}  ${STAGE}/fnm.zip" | shasum -a 256 -c -
unzip -q -o "${STAGE}/fnm.zip" -d "${STAGE}"
chmod +x "${STAGE}/fnm"

# Stage the shell-script helpers that implement the snapshot contract
# (supervisor, dump, restore). They end up under /sbin/machinen-* inside
# the guest — see the `install -m 0755` block further down.
cp "${ASSETS}/machinen-supervisor.sh"      "${STAGE}/machinen-supervisor.sh"
cp "${ASSETS}/machinen-dump.sh"            "${STAGE}/machinen-dump.sh"
cp "${ASSETS}/machinen-dump-preflight.sh"  "${STAGE}/machinen-dump-preflight.sh"
cp "${ASSETS}/machinen-restore.sh"         "${STAGE}/machinen-restore.sh"
cp "${ASSETS}/portable-restore-loader.sh"  "${STAGE}/portable-restore-loader.sh"
chmod +x "${STAGE}/machinen-supervisor.sh" "${STAGE}/machinen-dump.sh" \
         "${STAGE}/machinen-dump-preflight.sh" "${STAGE}/machinen-restore.sh" \
         "${STAGE}/portable-restore-loader.sh"

# Stage CRIU patches (applied inside the rootfs container against the
# upstream tarball before `make`). See packages/microvm/patches/criu/.
# The directory is optional — most builds run without patches.
if [ -d "${ROOT}/packages/microvm/patches" ]; then
  cp -r "${ROOT}/packages/microvm/patches" "${STAGE}/patches"
fi

# ------------------------------------------------------------
# 4. Rootfs — mmdebstrap minbase + aggressive strip + guest binaries
# ------------------------------------------------------------
#
# Single docker run: build inside the container's own filesystem and
# only write the final tarball to the bind-mounted /out. Reason:
# Docker Desktop on darwin uses virtio-fs for bind mounts, and dpkg
# install touches symlinks (e.g. /usr/share/man/man7/pam.7.gz) that
# trigger I/O errors through virtio-fs under qemu emulation. Building
# on the container's overlay2 sidesteps that entirely.
#
# --privileged: mmdebstrap needs CAP_SYS_ADMIN for `unshare --mount`.
# gpg + debian-archive-keyring: required to verify the Release signature.
# --setup-hook: pre-seeds dpkg path-excludes BEFORE essential package
#   install, so man/doc/info are never unpacked to begin with.

echo "==> Building minimal Debian ${DEBIAN_ARCH} rootfs via mmdebstrap"

docker run --rm -i --privileged --platform "${DOCKER_PLATFORM}" \
  -e DEBIAN_ARCH="${DEBIAN_ARCH}" \
  -e ROOTFS_TAR="${ROOTFS_TAR}" \
  -e ROOTFS_IMG="${ROOTFS_IMG}" \
  -v "${STAGE}":/stage:ro \
  -v "$OUT":/out \
  debian:bookworm-slim bash -s <<'CONTAINER_SCRIPT'
set -euo pipefail

apt-get update -qq > /dev/null
# e2fsprogs is the host-side tool that builds the prebake `.img` from
# the staged rootfs tree (#223). gzip ships with debian:bookworm-slim
# already; listed here for clarity.
apt-get install -y --no-install-recommends \
  mmdebstrap gpg debian-archive-keyring e2fsprogs gzip > /dev/null

mkdir -p /work

cat > /tmp/setup-hook.sh <<'HOOK'
#!/bin/sh
set -e
mkdir -p "$1/etc/dpkg/dpkg.cfg.d" "$1/etc/apt/apt.conf.d"
cat > "$1/etc/dpkg/dpkg.cfg.d/99-machinen" <<EOF
path-exclude /usr/share/doc/*
path-exclude /usr/share/man/*
path-exclude /usr/share/info/*
path-exclude /usr/share/locale/*
path-include /usr/share/locale/en*
EOF
cat > "$1/etc/apt/apt.conf.d/99-machinen" <<EOF
APT::Install-Recommends "false";
APT::Install-Suggests  "false";
EOF
HOOK
chmod +x /tmp/setup-hook.sh

# With virtio_*, ext4, vsock, and fuse compiled into our custom kernel
# (#119), the guest no longer needs /lib/modules or kmod inside the
# rootfs. We still install:
#
#   criu: required by any snapshot flow (`build()` dumps at freeze
#   time, `spawn({ snapshot })` restores at boot time). Pulls ~5MB of
#   libs (libnl, libprotobuf-c, libnftables).  The PID-namespace
#   isolation that solves cross-restore collisions (#215) is wrapped
#   in /sbin/machinen-restore with util-linux's `unshare`, not the
#   upstream criu-ns Python helper — Python is stripped from the
#   rootfs to save ~30 MB.  APT::Install-Recommends "false" is set
#   by the setup hook so criu's optional python3 suggestion is
#   skipped.  The Debian binary is overlaid with an upstream-tag
#   build below — see "CRIU overlay" — but we keep the package
#   installed for its runtime libs and the dpkg manifest.
#
#   e2fsprogs: mkfs.ext4 + blkid. /sbin/machinen-dump formats /dev/vda
#   on first snapshot so CRIU has a filesystem to write images into;
#   /sbin/machinen-restore uses blkid to verify before mounting.
#
#   mount + unshare + nsenter: util-linux's `mount`/`umount` are
#   Essential on Debian, so they ride in with minbase — no extra
#   --include line needed. `unshare` (used by /sbin/machinen-restore
#   to put criu in a fresh PID NS, #215) and `nsenter` (used by
#   /sbin/machinen-dump to dump across the sub-NS boundary) are
#   shipped in the same util-linux package.
#
#   iputils-ping: baked in so users can sanity-check connectivity
#   without an `apt install`. Over gvproxy ICMP works via unprivileged
#   ping sockets (sysctl is enabled in cloud kernels).
mmdebstrap \
  --variant=minbase \
  --architectures="${DEBIAN_ARCH}" \
  --include=criu,e2fsprogs,iputils-ping \
  --setup-hook=/tmp/setup-hook.sh \
  bookworm /work/rootfs

# ----------------------------------------------------------------
# CRIU overlay — replace the Debian 3.17.1 binary with an upstream
# tag that supports SOCK_DGRAM/IPPROTO_ICMP{,V6} ("unprivileged ping"
# sockets, opened by iputils-ping via ping_group_range, #203).
#
# Debian 12's CRIU is 3.17.1, whose can_dump_ipproto rejects
# SOCK_DGRAM/IPPROTO_ICMP — any workload that ran `ping` and held
# the socket open made `vm.snapshot()` fail with
# "Unsupported proto 1 for socket M" deep in sk-inet.c. The fix
# (sk-inet: Add support for checkpoint/restore of ICMP sockets,
# upstream a80c5448 from 2024-12-26) only landed in v4.1+, and the
# next Debian stable to pick it up is at least a year out.
#
# We pin a specific tag so the artifact is reproducible. Bump by
# editing CRIU_TAG (and re-pinning the tarball sha if you want
# stronger integrity than HTTPS). The Debian `criu` package stays
# installed — only the /usr/sbin/criu binary is overlaid, so we
# inherit Debian's runtime libs (libnl-3, libprotobuf-c,
# libnftables) and the dpkg manifest stays consistent.
#
# Build deps install into the container's overlay, not /work/rootfs,
# so nothing extra ships in the final tarball. Build runs under
# linux/arm64 — native on CI's arm64 runner, qemu-emulated on darwin
# (~3-5 min added to base-assets wall time on darwin; ~1 min on CI).
CRIU_TAG="v4.2"
echo "==> Overlaying CRIU $CRIU_TAG (Debian's 3.17.1 lacks ICMP socket support)"
# Build deps install into the container's overlay, not /work/rootfs,
# so nothing extra ships in the final tarball. We only build the
# `criu` target (the binary) — the `all` default also tries to build
# `lib-py` (Python bindings via crit), which needs a python3 we
# strip from the rootfs anyway and which we don't ship to users.
apt-get install -y --no-install-recommends \
  build-essential pkg-config \
  libprotobuf-dev libprotobuf-c-dev protobuf-c-compiler protobuf-compiler \
  libnl-3-dev libnet-dev libcap-dev libnftables-dev uuid-dev \
  curl ca-certificates patch \
  > /dev/null
mkdir -p /tmp/criu-build
curl -fsSL "https://github.com/checkpoint-restore/criu/archive/refs/tags/${CRIU_TAG}.tar.gz" \
  | tar -xzf - -C /tmp/criu-build --strip-components=1
# Apply machinen patches (sorted lexically). Each is a unified diff
# rooted at the criu source tree. See packages/microvm/patches/criu/
# for descriptions.
if [ -d /stage/patches/criu ]; then
  for p in /stage/patches/criu/*.patch; do
    [ -e "$p" ] || break
    echo "==> Applying CRIU patch: $(basename "$p")"
    # patch(1) with a malformed hunk prints an error, applies what
    # it can, and exits 0 — silently shipping a partially patched
    # binary. -F0 disables fuzzy matching and --dry-run lets us
    # validate the whole file before committing changes.
    if ! patch -d /tmp/criu-build -p1 -F0 --dry-run < "$p"; then
      echo "patch dry-run failed for $(basename "$p")" >&2
      exit 1
    fi
    patch -d /tmp/criu-build -p1 -F0 < "$p"
  done
fi
make -C /tmp/criu-build -j"$(nproc)" PIE=1 NO_GNUTLS=1 criu > /tmp/criu-build.log 2>&1 || {
  echo "criu build failed; tail of log:"
  tail -60 /tmp/criu-build.log
  exit 1
}
install -m 0755 /tmp/criu-build/criu/criu /work/rootfs/usr/sbin/criu
# Sanity-check the overlay landed and reports the expected tag.
# `criu --version` prints "Version: 4.2" verbatim — chroot in so the
# binary resolves the runtime libs the rootfs actually ships
# (libnl-3, libprotobuf-c, libnftables — same versions Debian's
# package was linked against, since we kept that package installed).
chroot /work/rootfs /usr/sbin/criu --version | tee /dev/stderr | grep -qE "Version: ${CRIU_TAG#v}" \
  || { echo "criu overlay version mismatch — expected ${CRIU_TAG#v}"; exit 1; }

# Belt-and-braces cleanup for things path-exclude doesn't cover.
# Also drop the second copy of the kernel image and initrd hooks we
# don't use (we boot Image-arm64 from release-assets, not from
# inside the guest's /boot).
#
# Python: criu Depends on python3-protobuf for the `crit` image-debug
# tool. crit is the only python caller; we don't run it. Deleting the
# interpreter + stdlib after install (rather than path-excluding during
# install, which breaks python's own postinst) saves ~30 MB extracted
# / ~10 MB gz. dpkg's database still lists the packages as installed
# (`dpkg -l` shows ii) — only the on-disk files are gone.
rm -rf \
  /work/rootfs/usr/share/man \
  /work/rootfs/usr/share/doc \
  /work/rootfs/usr/share/info \
  /work/rootfs/usr/bin/python3 /work/rootfs/usr/bin/python3.* \
  /work/rootfs/usr/lib/python3 \
  /work/rootfs/usr/lib/python3.* \
  /work/rootfs/usr/share/python3 \
  /work/rootfs/var/cache/apt/archives/*.deb \
  /work/rootfs/var/lib/apt/lists/* \
  /work/rootfs/var/log/* \
  /work/rootfs/boot/* \
  /work/rootfs/etc/kernel
find /work/rootfs/usr/share/locale -mindepth 1 -maxdepth 1 \
  ! -name "en*" -exec rm -rf {} + 2>/dev/null || true

# Strip /dev/* device nodes. Two reasons:
#   1) devtmpfs at boot populates /dev with real nodes anyway.
#   2) Character-device entries in a tar archive can't be extracted as
#      a non-root user (e.g. during `mkinitramfs` on darwin) — mknod
#      requires CAP_MKNOD.
# Keep /dev itself as an empty directory so the kernel has somewhere
# to mount devtmpfs.
rm -rf /work/rootfs/dev
mkdir -m 0755 /work/rootfs/dev

# DNS resolver. gvproxy (containers/gvisor-tap-vsock) runs its own DNS
# forwarder on the gateway IP (192.168.127.1). Without a resolv.conf,
# glibc falls back to 127.0.0.1 which has nothing listening —
# `apt-get update` and any other hostname lookup will fail.
echo "nameserver 192.168.127.1" > /work/rootfs/etc/resolv.conf

# /tmp — mmdebstrap minbase doesn't always include this directory in the
# extracted rootfs (depends on which essential packages happen to ship
# /tmp ownership, and our path-excludes can shave it). Without a 1777
# /tmp the guest is missing a place anyone-can-write things, and CRIU's
# kerndat probes (run on every `criu dump` AND `criu restore` from
# kerndat_has_move_mount_set_group on) try to mkdir
# `/tmp/.criu.move_mount_set_group.XXXXXX` and bail with ENOENT,
# breaking both snapshot and restore. Create it explicitly with the
# usual sticky-write-everyone mode so any caller can rely on it.
install -m 1777 -d /work/rootfs/tmp

install -m 0755 /stage/init       /work/rootfs/init
install -m 0755 /stage/exec-agent /work/rootfs/exec-agent
install -m 0755 -D /stage/machinen-netup    /work/rootfs/sbin/machinen-netup
install -m 0755 -D /stage/vmstate-reseed    /work/rootfs/sbin/machinen-vmstate-reseed
install -m 0755 -D /stage/lo-up             /work/rootfs/sbin/machinen-lo-up
install -m 0755 -D /stage/no-iou            /work/rootfs/sbin/machinen-no-iou
install -m 0755 -D /stage/poweroff          /work/rootfs/sbin/machinen-poweroff
install -m 0755 -D /stage/net-bench-probe   /work/rootfs/sbin/machinen-net-bench-probe
install -m 0755 -D /stage/memdirty          /work/rootfs/sbin/machinen-memdirty
install -m 0755 -D /stage/winsize-agent              /work/rootfs/sbin/machinen-winsize-agent
install -m 0755 -D /stage/portable-proof-workload     /work/rootfs/usr/local/bin/machinen-portable-proof
install -m 0755 -D /stage/portable-restore-loader.sh  /work/rootfs/usr/local/bin/machinen-portable-restore-proof
install -m 0755 -D /stage/fnm                         /work/rootfs/usr/local/bin/fnm
# Shell-script helpers that drive the snapshot/restore contract. Staged
# in by the host-side build step alongside the zig binaries.
install -m 0755 -D /stage/machinen-supervisor.sh     /work/rootfs/sbin/machinen-supervisor
install -m 0755 -D /stage/machinen-dump.sh           /work/rootfs/sbin/machinen-dump
install -m 0755 -D /stage/machinen-dump-preflight.sh /work/rootfs/sbin/machinen-dump-preflight
install -m 0755 -D /stage/machinen-restore.sh        /work/rootfs/sbin/machinen-restore

# Deterministic tar + gzip written as a single file to the bind mount.
tar --sort=name --owner=0 --group=0 --numeric-owner \
  --mtime="2020-01-01 00:00Z" \
  -C /work/rootfs -cf - . |
gzip -n > "/out/${ROOTFS_TAR}"

# ----------------------------------------------------------------
# #223: prebake the ext4 `.img` next to the tarball so cold boots
# can skip tar -xf + mke2fs entirely. Materializes once at release
# time (which already takes minutes for the rest of the bake) so
# every consumer of the published asset bundle inherits a ~1100 ms
# cold-boot win.
#
# The image size mirrors ensureRootfsImage's defaults:
#   max(2 GiB, du -sk(rootfs) * 2.5 KiB rounded up to whole bytes)
# Sparse, so over-provisioning costs nothing on the wire (gzip
# collapses zero-runs) and gives the guest room to apt install on
# top of the base. `rootDiskSizeBytes` callers still sparse-extend
# in place against the unpacked .img, same as cache-hit paths today.
#
# 4-KiB block size matches the kernel's arm64 page size so reads
# are page-cache-aligned; same as the runtime materializer.
TREE_KIB=$(du -sk /work/rootfs | awk '{print $1}')
# printf "%d" on macOS awk clamps at INT32_MAX (2147483647), so a 2 GiB
# default became 2^31-1 — odd, not 512-aligned, and the VMM's
# blk.Backend.initFromFd asserts on the misalignment. %.0f keeps the
# value as a double-rendered integer all the way through.
SIZE_BYTES=$(awk -v k="$TREE_KIB" 'BEGIN { s = int(k * 1024 * 2.5); m = 2 * 1024 * 1024 * 1024; if (s < m) s = m; printf "%.0f\n", s }')
BLOCKS=$(( SIZE_BYTES / 4096 ))
echo "==> Prebaking rootfs ext4 image: ${SIZE_BYTES} bytes (${BLOCKS} x 4 KiB blocks)"
truncate -s "$SIZE_BYTES" /tmp/rootfs.img
mke2fs -d /work/rootfs -t ext4 -F -q -b 4096 /tmp/rootfs.img "$BLOCKS"
gzip -n -c /tmp/rootfs.img > "/out/${ROOTFS_IMG}"
rm -f /tmp/rootfs.img
CONTAINER_SCRIPT

# ------------------------------------------------------------
# 5. Sha256 sidecars
# ------------------------------------------------------------

echo "==> Writing sha256 sidecars"
cd "$OUT"
for f in "$KERNEL_ASSET" ${DTB_ASSET:+"$DTB_ASSET"} "$ROOTFS_TAR" "$ROOTFS_IMG"; do
  shasum -a 256 "$f" > "${f}.sha256"
done

# Input-hash sidecars consumed by scripts/check-asset-freshness.sh.
# Source the checker so the file list lives in one place — drift
# between "what we hash here" and "what the checker hashes" would
# defeat the whole point of the staleness probe.
echo "==> Writing input-hash sidecars"
# shellcheck source=./check-asset-freshness.sh
source "${ROOT}/scripts/check-asset-freshness.sh"
rootfs_input_files | compute_sha > "${OUT}/${ROOTFS_TAR}.inputs-sha256"
kernel_input_files | compute_sha > "${OUT}/${KERNEL_ASSET}.inputs-sha256"

ls -lh "$OUT"

# ------------------------------------------------------------
# 6. Refresh the local cache the runtime falls back to when neither an
#    explicit asset path nor MACHINEN_ASSETS_DIR is set. The version is
#    pinned at "0.0.0" during local dev (see packages/runtime/package.json),
#    so the cache key never rolls and a once-populated tree stays put
#    forever — bare `node packages/cli/dist/cli.js` would otherwise bake
#    stale rootfs layers into provision() outputs even immediately after
#    a fresh rebuild here. Mirrors the filename rewrite the runtime's
#    cliCachedBaseDir() resolution expects (see packages/runtime/src/provision.ts).
# ------------------------------------------------------------
echo "==> Refreshing local cache"
RUNTIME_VERSION=$(node -p "require('${ROOT}/packages/runtime/package.json').version")
CACHE_DIR="${HOME}/.machinen/runtime-v${RUNTIME_VERSION}/bases/debian-${GUEST_ARCH}"
mkdir -p "$CACHE_DIR"
cp "${OUT}/${ROOTFS_TAR}" "${CACHE_DIR}/rootfs.tar.gz"
cp "${OUT}/${ROOTFS_IMG}" "${CACHE_DIR}/rootfs.img.gz"
cp "${OUT}/${KERNEL_ASSET}" "${CACHE_DIR}/Image"
if [ -n "$DTB_ASSET" ]; then
  cp "${OUT}/${DTB_ASSET}" "${CACHE_DIR}/virt.dtb"
else
  rm -f "${CACHE_DIR}/virt.dtb"
fi
echo "    refreshed: $CACHE_DIR"

echo "==> Done."
