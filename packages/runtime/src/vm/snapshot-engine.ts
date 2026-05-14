// Snapshot engine selection.
//
// machinen has two snapshot/restore/fork backends:
//
//   - "criu"   — the default. Checkpoints the guest *process tree*
//                from inside the guest via CRIU. Same-host, Linux-
//                process-level. Bundle layout: `<dir>/img/core-*.img`.
//   - "snaplet" — whole-VM snapshot at the VMM layer (vCPU + RAM +
//                GIC + virtio device state) in a hypervisor-agnostic
//                wire format. The only path that can move a live
//                guest across VMMs (HVF<->KVM). Bundle layout:
//                `<dir>/state.snaplet`.
//
// The engine is selected by the `MACHINEN_SNAPSHOT_ENGINE` env var so
// the CLI `snapshot` / `restore` / `fork` commands are unchanged — set
// the var and the same commands drive the snaplet backend instead.
// `restore` additionally auto-detects the engine from the bundle's
// contents, so a bundle always restores under the engine that wrote
// it regardless of the env var.

export type SnapshotEngine = "criu" | "snaplet";

/** Basename of the whole-VM state file inside a snaplet bundle. */
export const SNAPLET_FILE = "state.snaplet";

/**
 * Resolve the snapshot engine from `MACHINEN_SNAPSHOT_ENGINE`.
 * Unset / empty / "criu" → "criu"; "snaplet" → "snaplet". Any other
 * value is a configuration error and throws — silently falling back
 * to criu would hide a typo'd opt-in.
 */
export function resolveSnapshotEngine(): SnapshotEngine {
  const raw = process.env.MACHINEN_SNAPSHOT_ENGINE;
  if (raw === undefined || raw === "") {
    return "criu";
  }
  const v = raw.trim().toLowerCase();
  if (v === "criu" || v === "snaplet") {
    return v;
  }
  throw new Error(
    `MACHINEN_SNAPSHOT_ENGINE must be "criu" or "snaplet" (got ${JSON.stringify(raw)})`,
  );
}
