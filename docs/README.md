# machinen guides

Start here:

- [Quickstart](./quickstart.md) — bake → boot → handoff in three steps

Then dive deeper:

- [Try Command Code in an isolated VM](./guides/command-code-vm.md) — Node 24, npm, live workspace, and host-mounted Command Code state
- [Run pi in a VM](./guides/pi.md) — run a terminal coding agent in an isolated workspace
- [Create a VM](./guides/create-a-vm.md) — the three ways to get a workload running
- [Hand off a running VM](./guides/handoff.md) — snapshot → transfer → restore
- [Snapshot, restore, and fork](./guides/snapshot-restore-fork.md) — clone a running process, including vmstate timer, entropy, and socket contracts
- [Mount files into a VM](./guides/mount-files.md) — `--mount`, `--mount-live`, `vm.writeFile`
- [Memory in machinen](./guides/memory.md) — ceiling vs host footprint, grow-on-touch, and reclaim
- [CPU resources in machinen](./guides/cpu.md) — vCPU count, quota, fairness, and cgroup enforcement
- [Networking](./guides/networking.md) — port forwards and outbound traffic via gvproxy
- [Nested virtualization](./guides/nested-virtualization.md) — opt-in `/dev/kvm` inside a VM
- [Run Firecracker inside machinen](./guides/firecracker.md) — boot an aarch64 L2 microVM with nested KVM

Product docs:

- [Runtime Zig core migration boundary](./architecture/runtime-zig-core-migration.md) — native helper boundary, guardrail, and package payload
- [Snapshot, restore, and move](./snapshot/README.md) — current product surfaces
- [vmstate specification](./snapshot/vmstate-specification.md) — whole-VM snapshot file format and saved state
- [vmstate portability policy](./snapshot/vmstate-portability.md) — restore invariants and cross-HVF/KVM policy
