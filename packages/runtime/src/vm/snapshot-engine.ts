// Snapshot engine selection.
//
// machinen has two snapshot/restore/fork backends:
//
//   - "vmstate" — the default. Whole-VM snapshot at the VMM layer
//                (vCPU + RAM + GIC + virtio device state) in a
//                hypervisor-agnostic wire format. The only path that
//                can move a live guest across VMMs (HVF<->KVM).
//                Bundle layout: `<dir>/state.vmstate`.
//   - "criu"   — checkpoints the guest *process tree* from inside the
//                guest via CRIU. Same-host, Linux-process-level.
//                Bundle layout: `<dir>/img/core-*.img`.
//
// The engine is selected by the `MACHINEN_SNAPSHOT_ENGINE` env var so
// the CLI `snapshot` / `restore` / `fork` commands are unchanged — set
// it to `criu` to drive the process-tree backend instead.
// `restore` additionally auto-detects the engine from the bundle's
// contents, so a bundle always restores under the engine that wrote
// it regardless of the env var.

export type SnapshotEngine = "criu" | "vmstate";

/** Basename of the whole-VM state file inside a vmstate bundle. */
export const VMSTATE_FILE = "state.vmstate";

/**
 * Resolve the snapshot engine from `MACHINEN_SNAPSHOT_ENGINE`.
 * Unset / empty / "vmstate" → "vmstate"; "criu" → "criu". Any other
 * value is a configuration error and throws — silently falling back
 * to the default would hide a typo'd opt-in.
 */
export function resolveSnapshotEngine(): SnapshotEngine {
  const raw = process.env.MACHINEN_SNAPSHOT_ENGINE;
  if (raw === undefined || raw === "") {
    return "vmstate";
  }
  const v = raw.trim().toLowerCase();
  if (v === "criu" || v === "vmstate") {
    return v;
  }
  throw new Error(
    `MACHINEN_SNAPSHOT_ENGINE must be "criu" or "vmstate" (got ${JSON.stringify(raw)})`,
  );
}
