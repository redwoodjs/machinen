# Run Firecracker inside machinen

Machinen can expose nested KVM to an arm64 Linux guest. That lets the guest run
Firecracker when the outer VM is booted with `nested: true` or `machinen boot
--nested`.

## Requirements

- arm64 only. Firecracker on arm64 runs arm64 guests.
- A nested-capable host:
  - macOS 15+ on M3/M4-class Apple Silicon, or
  - Linux/arm64 KVM with `KVM_CAP_ARM_EL2`.
- An aarch64 Firecracker binary.
- An arm64 kernel and rootfs or initramfs for the Firecracker guest.

Check nested KVM first:

```sh
machinen boot --nested -- test -c /dev/kvm
```

If the host cannot expose EL2, machinen fails before boot with
`BOOT_NESTED_VIRT_UNSUPPORTED`.

## Example

The repo includes a tiny validated example:

```sh
pnpm install
pnpm build
node --conditions=source --import tsx examples/firecracker-nested/run.ts
```

It downloads the Firecracker aarch64 release, builds a tiny aarch64 `/init`, and
boots an L2 microVM inside machinen. A successful run prints:

```txt
hello from firecracker L2 on aarch64
firecracker-nested-ok
```

The example intentionally uses no Firecracker network device and passes
`--no-seccomp`. That keeps the first nested boot small and focused on proving
that `/dev/kvm` works inside the machinen guest.

## Snapshot behavior

Do not snapshot or fork the outer machinen VM while it has nested virtualization
enabled. Machinen blocks provider-level snapshots and forks for nested-enabled
outer VMs until EL2 state capture is fully audited.

You can still use Firecracker's own snapshot tools inside the guest for the L2
VMs it creates.
