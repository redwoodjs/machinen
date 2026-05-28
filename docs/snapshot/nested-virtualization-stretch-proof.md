# Nested virtualization stretch proof

Nested virtualization is a demo path, not a portable snapshot requirement. This
proof records whether Machinen can expose `/dev/kvm` to an L1 guest and, where
available, run the existing Firecracker nested guide to boot an L2 guest.

## Row shape

```json
{
  "kind": "machinen.cross-arch-criu.nested-virtualization-stretch-proof",
  "classification": "stretch-demo",
  "l0HostArch": "arm64",
  "l1GuestArch": "aarch64",
  "l2GuestArch": "aarch64",
  "providerMode": "darwin-hvf -> guest-kvm -> firecracker-kvm",
  "accelerated": true,
  "emulated": false,
  "nestedVerifierOutput": "l1-arch=aarch64; ...; firecracker-nested-ok",
  "snapshotForkRefusalCode": "BOOT_VMSTATE_UNSUPPORTED"
}
```

Rows always set `productSupportClaimed=false`,
`portableSnapshotRequirement=false`, and `providerSnapshotForkSafe=false`.

## Host/provider prerequisites

The stretch proof requires the same prerequisites as the Firecracker nested
guide:

- arm64 host;
- macOS 15+ on M3/M4-class Apple Silicon, or Linux/arm64 KVM with nested EL2;
- Machinen arm64 kernel/rootfs assets;
- an aarch64 Firecracker release and a small arm64 initramfs fixture.

If the host cannot expose nested virtualization, the row is `skipped` with
`nested-virtualization-unavailable`. If the provider claims support but the L2
smoke fails, the row is `refused` with `nested-smoke-failed`.

## Current checked proof

On the checked host (`arm64`, macOS 15.7.4, Apple M4 Pro), the smoke ran the
existing `examples/firecracker-nested/run.ts` guide. The L1 guest reported
`l1-arch=aarch64` and `l1-acceleration=kvm`; Firecracker then booted an L2 guest
that printed:

```txt
hello from firecracker L2 on aarch64
firecracker-nested-ok
```

That is classified as `stretch-demo` only. It proves nested KVM can work on this
host/provider route; it does not make nested virtualization product-supported.

## Snapshot/fork safety

Provider-level `vm.snapshot()` and `vm.fork()` remain refused while the L1 VM has
nested virtualization enabled. The refusal code is `BOOT_VMSTATE_UNSUPPORTED`.
Machinen does not yet safely capture EL2, nested KVM, or L2 device state in the
outer provider snapshot. Snapshot or fork VMs created inside the nested guest
instead.

## Running

```sh
pnpm run smoke-nested-virtualization-stretch-proof
```
