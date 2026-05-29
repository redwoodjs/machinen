# Advanced Linux facility probes

Advanced Linux facilities are high-signal kernel-state boundaries. This matrix
proves or refuses seccomp, eBPF, namespaces, cgroups, and capabilities without
turning any of them into product support.

## Row shape

```json
{
  "kind": "machinen.architecture-portable-snapshot.advanced-linux-facility-probe",
  "facility": "seccomp",
  "stateModel": "recreated",
  "classification": "proof-only-feasibility",
  "migrationCompleted": false
}
```

Every row records source/target architecture, kernel version, required
capabilities, verifier output, classification, and refusal details when refused.

## Current classifications

- `seccomp` — `proof-only-feasibility` when the guest accepts the minimal filter,
  otherwise `refused`. The smoke compiles and runs a guest C program that tries
  to install a minimal seccomp filter. On the checked host, the install refused
  with `seccomp: Invalid argument`, so no blocked-syscall support is claimed.
- `ebpf` — `refused`. The smoke records guest BPF policy and refuses with
  `insufficient-privileges` unless a controlled CAP_BPF/CAP_SYS_ADMIN fixture is
  available. Privileged or pinned BPF state is not silently accepted.
- `namespace` — `proof-only-feasibility`, `recreated`. The smoke records namespace
  inode identities from `/proc/self/ns/*`; it does not claim exact namespace inode
  preservation across architectures.
- `cgroup` — `proof-only-feasibility`, `recreated`. The smoke records
  `/proc/self/cgroup`; it does not claim product cgroup restore.
- `capability` — `proof-only-feasibility`, `proven-irrelevant`. The smoke records
  `CapEff`, `CapPrm`, and `NoNewPrivs` so target policy changes are visible.

## Refusals and remediation

Stable refusal codes include:

- `kernel-feature-unavailable` — run on a kernel with the required facility.
- `insufficient-privileges` — provide required guest capabilities, such as
  CAP_BPF/CAP_SYS_ADMIN for eBPF.
- `unsafe-bpf-state-unsupported` — avoid privileged, pinned, or long-lived BPF
  state until it has a cleanup and restore contract.
- `namespace-cgroup-mismatch` — preserve or intentionally recreate isolation
  boundaries before accepting restore.
- `capability-mismatch` — align effective/permitted capabilities or refuse.
- `facility-verifier-ambiguous` — record unambiguous before/after verifier output.

## What this proves

The live smoke proves Machinen can run the seccomp probe and either record a
blocked syscall or fail closed with a stable refusal. On the checked host it
refused seccomp with `facility-verifier-ambiguous`. It also proves Machinen
records namespace, cgroup, and capability state in machine-readable rows, and
fails closed for eBPF when the required privileged fixture is unavailable.

## What this does not prove

This is not product support for advanced kernel-state restore. It does not prove
cross-ISA preservation of seccomp filters, BPF programs/maps, namespace inode
identity, cgroup hierarchy, or Linux capability policy. It does not load a real
BPF program unless a future controlled privileged fixture is added.

## Running

```sh
pnpm run proof-advanced-linux-facility-probe
```
