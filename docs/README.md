# machinen guides

Start here:

- [Quickstart](./quickstart.md) — bake → boot → handoff in three steps

Then dive deeper:

- [Create a VM](./guides/create-a-vm.md) — the three ways to get a workload running
- [Hand off a running VM](./guides/handoff.md) — snapshot → transfer → restore
- [Snapshot, restore, and fork](./guides/snapshot-restore-fork.md) — clone a
  running process, including vmstate timer, entropy, and socket contracts
- [Mount files into a VM](./guides/mount-files.md) — `--mount`, `--mount-live`, `vm.writeFile`
- [Networking](./guides/networking.md) — port forwards and outbound traffic via gvproxy
- [Nested virtualization](./guides/nested-virtualization.md) — opt-in `/dev/kvm` inside a VM
- [Run Firecracker inside machinen](./guides/firecracker.md) — boot an aarch64 L2 microVM with nested KVM

Snapshot internals:

- [vmstate specification](./snapshot/vmstate-specification.md) — whole-VM snapshot file format and saved state
- [vmstate portability policy](./snapshot/vmstate-portability.md) — restore invariants and cross-HVF/KVM policy
- [portable machine snapshot boundary](./snapshot/portable-machine-snapshot.md) — why raw cross-ISA vmstate replay refuses and what the target-ISA restore path requires
