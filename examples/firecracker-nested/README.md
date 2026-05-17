# firecracker-nested

Run Firecracker inside a machinen VM with nested virtualization enabled.

This example boots an outer machinen VM with `nested: true`, live-mounts a
small Firecracker workspace into it, and starts an aarch64 Firecracker L2
microVM. The L2 guest uses the machinen arm64 kernel plus a tiny initramfs that
prints `firecracker-nested-ok` and powers off.

## Requirements

- An arm64 host that supports machinen nested virtualization:
  - macOS 15+ on M3/M4-class Apple Silicon, or
  - Linux/arm64 KVM with `KVM_CAP_ARM_EL2`
- `zig` on the host, used to build the tiny aarch64 L2 `/init`
- Network access to download the Firecracker aarch64 release tarball

## Run

From the repo root, after the usual dev setup has built the runtime and local assets:

```sh
pnpm install
pnpm build
node --conditions=source --import tsx examples/firecracker-nested/run.ts
```

The example is intentionally not a pnpm workspace package, so it can be copied
or run by hand without adding another package to the monorepo.

You should see the L2 guest print:

```txt
hello from firecracker L2 on aarch64
firecracker-nested-ok
```

The example uses `--no-seccomp` and no network device to keep the first boot
small and focused on nested KVM. Provider-level machinen snapshots/forks of the
outer VM are disabled while nested EL2 state capture is still being audited.
