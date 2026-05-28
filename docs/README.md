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
- [opposite-ISA VM execution proof](./snapshot/opposite-isa-vm-execution.md) — host/guest route matrix, acceleration labels, and guest-side verifier contract
- [stateful database portable restore](./snapshot/stateful-database-portable-restore.md) — PostgreSQL logical and SQLite journal/WAL Level 2 restore contracts
- [guest checkpoint substrate proof](./snapshot/guest-checkpoint-substrate.md) — same-guest checkpoint checks, C restore proof, and JVM refusal boundary
- [portable snapshot plus guest checkpoint composition](./snapshot/portable-snapshot-guest-checkpoint-composition.md) — Machinen vmstate restore composed with guest checkpoint artifacts
- [C and Java runtime confidence profiles](./snapshot/runtime-confidence-profiles.md) — classified C/JVM support, proof-only, and refusal matrix
- [advanced Linux facility probes](./snapshot/advanced-linux-facility-probes.md) — seccomp, eBPF, namespace, cgroup, and capability proof/refusal rows
- [nested virtualization stretch proof](./snapshot/nested-virtualization-stretch-proof.md) — Firecracker L2 demo classification with snapshot/fork refusal
- [architecture-portable snapshot checked gauntlet](./snapshot/architecture-portable-snapshot-gauntlet.md) — aggregated Goals 002-008 proof ledger
- [portable machine support envelope](./snapshot/support-envelope.md) — current app-neutral supported and refused capability families
- [portable machine proof profiles](./snapshot/portable-machine-proof-profiles.md) — positive and negative proof profiles for target-native completion and fail-closed refusals
- [portable proof matrices](./snapshot/proof-matrices.md) — one-command matrix presets and JSON summary shape
- [runtime-neutral adapter boundary](./snapshot/runtime-adapter-boundary.md) — shared adapter contract for future runtime-specific tracks
- [fail-closed refusal inventory](./snapshot/native-fail-closed-refusal-inventory.md) — refusal codes, owner docs, and test coverage for unsupported native state
