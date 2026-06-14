# Goal: Product-focused snapshot, restore, and move

## North star

Keep Machinen centered on supported product surfaces: boot a Linux VM, snapshot
it, restore it, fork it, and move explicitly supported state between compatible
hosts without overstating unsupported portability.

## Current product map

| Area                            | Product support                             | Notes                                                                                                      |
| ------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Whole-VM vmstate snapshots      | Supported                                   | Same guest architecture only. Bundles include CPU, RAM, device state, and rootdisk state.                  |
| Cross-HVF/KVM arm64 restore     | Supported when restore invariants match     | PAuth, topology, guest memory layout, and rootdisk identity must be safe.                                  |
| amd64 Linux/KVM vmstate         | Supported path                              | Same guest architecture only.                                                                              |
| Cross-ISA whole-VM restore      | Unsupported                                 | A vmstate bundle contains ISA-specific machine state and must not be replayed as another ISA.              |
| `machinen move` descriptors     | Narrow supported subsets                    | Each accepted route must reconstruct target-native state and refuse unsupported state before target start. |
| Nested virtualization snapshots | Unsupported for provider-level L1 snapshots | Nested-enabled outer VMs refuse snapshot/fork until EL2 state capture is audited.                          |

## Product rules

1. Document only product-supported behavior in `docs/`.
2. Refuse unsupported state explicitly instead of presenting partial migration as success.
3. Keep same-ISA vmstate restore separate from cross-ISA target-native movement.
4. Do not claim cross-ISA VM restore, source-ISA emulation, sidecar replay, or metadata-only success as product support.
5. Keep examples runnable through the public CLI/runtime APIs.

## Next work

- Keep the quickstart, handoff, networking, mounts, move, and snapshot docs aligned with the current CLI.
- Keep support boundaries concise and user-facing.
- Expand move subsets only when they use public product commands and clear refusal behavior.
