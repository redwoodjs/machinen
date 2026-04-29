FROM ghcr.io/actions/actions-runner:latest

# build-base-assets needs:
#   build-essential — gcc, make, libc-dev (kernel build, zig cc)
#   bc, bison, flex, libssl-dev, libelf-dev, cpio, xz-utils — kernel build
#   device-tree-compiler — virt.dts → virt-arm64.dtb
#
# tests.yml's pretest hook runs `pnpm -r build` which compiles
# packages/microvm with `zig build`; build-essential covers any C
# fallbacks zig invokes for libc.
#
# These are preinstalled on GitHub's hosted ubuntu-latest VM but absent
# from the slim runner container we use locally; without them, kernel
# builds fail with `make: command not found` and rootfs builds fail at
# zig compile time.
RUN sudo apt-get update \
 && sudo apt-get install -y --no-install-recommends \
      build-essential \
      bc bison flex libssl-dev libelf-dev cpio xz-utils \
      device-tree-compiler \
 && sudo rm -rf /var/lib/apt/lists/*
