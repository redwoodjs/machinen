# `.vmstate` portability policy

See also: [`vmstate-specification.md`](./vmstate-specification.md) for the
binary format and section-level saved state.

`.vmstate` is a whole-VM snapshot: RAM, vCPU state, interrupt/device
state, and virtio transport state. It is **not** just a process image.
Restoring it safely requires the restore side to recreate the same VM
contract before the first vCPU run.

Current policy:

- New vmstate bundles record restore invariants in `meta.json`:
  source backend (`hvf`/`kvm`), topology hash, guest RAM ceiling
  (the memory layout, not current host usage), guest PAuth state, and
  the exact root block image identity.
- The first vmstate checkpoint in a VM chain carries a full sparse RAM
  section and copies the exact root block image into the bundle as
  `rootdisk.img`. Later checkpoints carry RAM/rootdisk delta sections
  plus full non-diffable device/vCPU state. Restore walks parent
  pointers, materializes a flat vmstate/rootdisk pair in a temp bundle,
  then boots through the normal vmstate restore path so the restored
  guest never mutates checkpoint bundles in place.
- Cross-HVF/KVM restore is refused when guest PAuth is active or
  unknown. The default DTB includes `arm64.nopauth` so newly booted
  guests are portable by default; older active-PAuth snapshots must be
  recreated.
- Restore refuses old vmstate bundles that predate these invariants
  instead of booting into guest panics or disk-backed corruption.
- The VMM still validates the `.vmstate` topology hash before applying
  state.

CRIU remains a Linux process-tree restore mechanism. It does not solve
HVF↔KVM CPU feature mismatches and is not a replacement for the vmstate
portability contract above.
