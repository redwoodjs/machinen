// Snapshot engine selection.
//
// machinen has two snapshot/restore/fork backends:
//
//   - "vmstate" — the default. Whole-VM snapshot at the VMM layer
//                (vCPU + RAM + GIC + virtio device state) in a
//                hypervisor-agnostic wire format. The only path that
//                can move a live guest across VMMs (HVF<->KVM) when
//                invariants match. Bundle layout:
//                `<dir>/state.vmstate` + `<dir>/rootdisk.img` for a
//                base checkpoint; later checkpoints carry RAM/rootdisk
//                delta sections and parent pointers in meta.json.
//   - "criu"   — checkpoints the guest *process tree* from inside the
//                guest via CRIU. Same-host, Linux-process-level.
//                Bundle layout: `<dir>/img/core-*.img`.
//   - "portable" — experimental semantic process snapshot format for
//                  future cross-ISA restore. It is intentionally separate
//                  from `.vmstate` and CRIU; selecting it currently fails
//                  with an explicit unsupported-workload error.
//
// The engine is selected by the `MACHINEN_SNAPSHOT_ENGINE` env var so
// the CLI `snapshot` / `restore` / `fork` commands are unchanged — set
// it to `criu` to drive the process-tree backend, or `portable` to try
// the experimental portable engine. `restore` auto-detects vmstate and
// CRIU bundles; portable bundles are routed only when explicitly selected
// so exact-machine restore and semantic process restore stay distinct.

export type SnapshotEngine = "criu" | "vmstate" | "portable";

/** Basename of the whole-VM state file inside a vmstate bundle. */
export const VMSTATE_FILE = "state.vmstate";

/** Exact root block device bytes paired with a vmstate bundle. */
export const VMSTATE_ROOTDISK_FILE = "rootdisk.img";

/**
 * Resolve the snapshot engine from `MACHINEN_SNAPSHOT_ENGINE`.
 * Unset / empty / "vmstate" → "vmstate"; "criu" → "criu";
 * "portable" → the experimental semantic engine. Any other value is a
 * configuration error and throws — silently falling back to the default
 * would hide a typo'd opt-in.
 */
export function resolveSnapshotEngine(): SnapshotEngine {
  const raw = process.env.MACHINEN_SNAPSHOT_ENGINE;
  if (raw === undefined || raw === "") {
    return "vmstate";
  }
  const v = raw.trim().toLowerCase();
  if (v === "criu" || v === "vmstate" || v === "portable") {
    return v;
  }
  throw new Error(
    `MACHINEN_SNAPSHOT_ENGINE must be "criu", "vmstate", or "portable" (got ${JSON.stringify(raw)})`,
  );
}
