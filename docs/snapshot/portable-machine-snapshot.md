# Portable machine snapshot boundary

Issue #584 defines the first cross-ISA machine-level restore boundary.

A raw `.vmstate` bundle is a whole-VM image: guest RAM, vCPU registers,
interrupt state, timers, virtio state, and the source kernel execution point.
That state is ISA-specific. An arm64 `.vmstate` is not an amd64 VM state file,
and replaying it on amd64 would require source-ISA emulation. That is not a
native-transparent success path.

## Success path

The portable cross-ISA machine path is different:

1. capture source machine context and the selected source process;
2. validate a `machinen.portable-machine-snapshot` manifest;
3. boot or preload a target-ISA VM;
4. run a target-guest restore loader;
5. materialize only explicitly modeled process memory/resources;
6. jump to target-native bytes generated or proven for the target ISA.

The initial manifest records this boundary with:

- `source.vmstate.rawRestore = "refused"`;
- refusal code `cross-isa-vmstate-restore-unsupported`;
- `source.kernelState = "not-translated"`;
- `source.deviceState = "not-translated"`;
- `target.mode = "target-isa-vm-process-restore"`;
- `target.execution = "target-native"`;
- `payload.resourceModel = "explicit-recipes-only"`.

This means the machine snapshot may carry source machine facts, but the success
path cannot replay source vCPU/kernel/device state. Unsafe or ambiguous state
must fail before target execution.

## Bundle layout

The first bundle shape is intentionally small:

```text
portable-machine.json
native-process/
  native-process.json
  native-mappings.json
  native-threads.json
  native-resources.json
  native-translation.json
  native-memory.bin
```

`portable-machine.json` is validated with
`validatePortableMachineSnapshotBundle()`. The embedded native process image is
validated with the existing native-process-image validator, and its
`capture.sourceArch` / `target.arch` must match the portable machine manifest.
Paths are bundle-relative and may not escape the bundle root.

A local wrapper can create this bundle from an existing native process image:

```bash
pnpm portable-machine-snapshot -- --native-process-bundle /path/to/native-process --out-dir /tmp/portable-machine --json
```

This is still a bundle/contract proof. The target VM synthetic continuation step
is documented in
[Target VM synthetic continuation proof](./native-target-vm-synthetic-continuation.md),
and its in-guest descriptor loader is documented in
[Target guest restore loader](./target-guest-restore-loader.md); full memory
materialization and e2e restore are follow-up issues.

## Raw vmstate refusal

`restore()` now distinguishes raw cross-ISA `.vmstate` attempts with
`BOOT_VMSTATE_CROSS_ISA_UNSUPPORTED`. The embedded portable-machine refusal code
is `cross-isa-vmstate-restore-unsupported`.

The refusal is intentional: whole-VM `.vmstate` remains same-ISA only. Cross-ISA
restore must go through the portable machine snapshot ladder.

## Non-claims

This boundary does not yet implement the target VM restore loader, target memory
materialization, or end-to-end VM-level restore. Those are tracked in follow-up
issues #585 through #589.
