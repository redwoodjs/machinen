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

Snapshot docs:

- [Snapshot documentation status](./snapshot/README.md) — product vs proof vs archived snapshot docs
- [Level 5 product roadmap](./snapshot/level5-product-roadmap.md) — proper captured-process Level 5 path and forbidden shortcuts
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
- [native/process-continuation audit](./snapshot/native-process-continuation-audit.md) — reconciles existing native, Node, runtime, and stateful-service proofs with the portable snapshots roadmap
- [portable machine support envelope](./snapshot/support-envelope.md) — current app-neutral supported and refused capability families
- [architecture-portable snapshot restore ladder](./snapshot/architecture-portable-snapshot-restore-ladder.md) — product support levels, state decisions, and semantic ping continuation
- [Level 4/5 graduation matrix](./snapshot/level4-graduation-matrix.md) — checked Goal 002 path from ping Level 4 through Node Level 5 readiness
- [Goal 003 ping Level 4 socket graduation](./snapshot/level4-ping-socket-graduation.md) — proof/refusal slice for raw/datagram ICMP socket reconstruction
- [Goal 010 ping Level 4 socket product route](./snapshot/level4-ping-socket-product.md) — narrow supported descriptor route for ping/raw ICMP socket reconstruction
- [Goal 011/012/013 ping Level 4 portable machine workload](./snapshot/level4-ping-machine-workload.md) — `machinen snapshot` / `machinen restore` support, auto-inspection, and target-VM continuation for a running loopback ping
- [Goal 015 eventfd Level 4 portable restore](./snapshot/level4-eventfd-portable-restore.md) — second portable restore adapter and narrow target-native eventfd counter reconstruction
- [Goal 016 pipe Level 4 portable restore](./snapshot/level4-pipe-portable-restore.md) — third portable restore adapter and narrow target-native empty pipe pair reconstruction
- [Goal 017 timerfd Level 4 portable restore](./snapshot/level4-timerfd-portable-restore.md) — fourth portable restore adapter and narrow target-native relative one-shot timerfd reconstruction
- [Goal 018 TCP listener Level 4 portable restore](./snapshot/level4-tcp-listener-portable-restore.md) — fifth portable restore adapter and narrow target-native loopback listener reconstruction
- [Goal 008 Node event-loop Level 4 resource map](./snapshot/level4-node-event-loop-resource-map.md) — planning map from Node/libuv handles to generic Level 4 descriptors and refusals
- [Goal 009/019 Node Level 5 proof composition](./snapshot/node-level5-proof-composition.md) — selected Node proof path composed from native/process evidence, the Goal 008 Level 4 resource map, and default public restore proof evidence
- [Goal 020 Level 5 runtime adapter substrate](./snapshot/level5-runtime-adapter-substrate.md) — historical proof-only runtime-profile substrate, not the product Level 5 path
- [Goal 021 Node Level 5 HTTP profile](./snapshot/node-level5-http-profile.md) — historical proof-only Node/V8/libuv runtime profile, not product support
- [Goal 022 selected-state cross-arch quickstart harness](./snapshot/node-level5-real-cross-arch-quickstart-fixture.md) — public snapshot/restore harness proof, not Level 5 product support
- [Proper Node Level 5 without runtime profiles](./snapshot/proper-node-level5-without-runtime-profiles.md) — acceptance contract and first real Node Level 5 track
- [portable machine proof profiles](./snapshot/portable-machine-proof-profiles.md) — positive and negative proof profiles for target-native completion and fail-closed refusals
- [portable proof matrices](./snapshot/proof-matrices.md) — one-command matrix presets and JSON summary shape
- [runtime-neutral adapter boundary](./snapshot/runtime-adapter-boundary.md) — shared adapter contract for future runtime-specific tracks
- [fail-closed refusal inventory](./snapshot/native-fail-closed-refusal-inventory.md) — refusal codes, owner docs, and test coverage for unsupported native state
