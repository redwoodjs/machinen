# test fixtures for the microvm package

Large binaries (kernel, device tree, rootfs) aren't checked in. Build
them from the repo root:

```bash
./scripts/build-base-assets.sh
```

That writes `Image-arm64`, `virt-arm64.dtb`, and
`rootfs-debian-arm64.tar.gz` into `release-assets/`. `try.sh` and
`smoke.sh` stage those into this directory on first run.
