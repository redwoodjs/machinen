# Nested virtualization

Nested virtualization lets a workload inside a machinen VM start VMs of
its own. In arm64 terms, machinen exposes EL2 to the guest. On Linux
that gives the guest a usable `/dev/kvm` when the guest kernel supports
KVM.

It is opt-in:

```ts
await boot({
  image,
  cmd: ["bash"],
  nested: true,
});
```

From the CLI:

```bash
npx machinen boot --nested -- bash
```

If the host cannot support nested virtualization, boot fails with
`BOOT_NESTED_VIRT_UNSUPPORTED` instead of starting a guest that later
fails in a confusing way.

## Support matrix

| Host                                               | Status         |
| -------------------------------------------------- | -------------- |
| Linux arm64 bare metal with KVM nested EL2 support | Supported path |
| macOS 15+ on M3/M4-class Apple Silicon             | Supported path |
| M1/M2 Macs                                         | Not supported  |
| macOS before 15                                    | Not supported  |
| x86_64 hosts                                       | Not supported  |
| Cloud VMs that hide EL2 from the guest             | Not supported  |

The runtime does a quick host check first. The VMM then does the real
backend check: Linux requires `KVM_CAP_ARM_EL2`, and macOS requires
Hypervisor.framework EL2 support.

For a concrete nested workload, see [Run Firecracker inside machinen](./firecracker.md).

## Snapshot and fork status

There are two different snapshot cases:

1. **Inside the nested guest:** machinen running in the L1 guest can
   snapshot and fork the L2 VMs it creates. This is the tenant workflow.
2. **Outside the nested guest:** the provider tries to snapshot the L1
   VM that was booted with `nested: true`.

The second case is intentionally blocked for now. Capturing an L1 VM
that can own EL2 requires an EL2-aware vmstate audit, especially if an
L2 VM is running. Until that is complete, machinen refuses
provider-level snapshots of nested-enabled VMs rather than writing a
bundle that might restore incorrectly.

## Hosted mini-cloud shape

The intended deployment shape is:

```txt
L0: provider bare-metal arm64 host
  └─ L1: tenant machinen VM, booted with nested: true
       └─ L2: tenant-created machinen VMs
```

The provider controls the L1 boundary. The tenant gets `/dev/kvm` only
inside that VM and can create smaller sandboxes without direct access
to the host hypervisor.
