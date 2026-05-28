# Opposite-ISA VM execution proof

This proof answers one narrow question: can Machinen run a guest whose CPU ISA is
not the host CPU ISA, and can the proof show the output came from inside that
guest?

It is a prerequisite for cross-architecture restore. It is not a restore proof by
itself. It does not preserve process memory, kernel state, sockets, files, or
runtime heaps.

## Machine-readable summary

The smoke writes route summaries with:

```json
{
  "kind": "machinen.cross-arch-criu.opposite-isa-vm-execution",
  "hostArch": "arm64",
  "guestArch": "amd64",
  "providerMode": "darwin-hvf-opposite-isa-unsupported",
  "accelerated": false,
  "emulated": false,
  "kernelVersion": null,
  "rootfsDigest": null,
  "guestUnameMachine": null,
  "guestElfMachine": null,
  "verifierOutput": "",
  "state": "skipped",
  "refusalCode": "opposite-isa-provider-unavailable",
  "remediation": "Run this proof on a host/provider that can boot the requested guest ISA..."
}
```

A completed route must record:

- host architecture;
- guest architecture;
- provider/accelerator mode;
- whether execution was accelerated or emulated;
- guest kernel version;
- rootfs SHA-256 digest;
- `uname -m` observed inside the guest;
- machine type for an ELF binary executed inside the guest;
- verifier output from guest exec, not a host sidecar.

## Route matrix

| Host            | Guest       | Current label                         | Expected state                                                                       |
| --------------- | ----------- | ------------------------------------- | ------------------------------------------------------------------------------------ |
| arm64 macOS     | amd64 Linux | `darwin-hvf-opposite-isa-unsupported` | `skipped` until an explicit emulation/provider mode exists                           |
| arm64 Linux/KVM | amd64 Linux | `linux-kvm-opposite-isa-unsupported`  | `skipped` unless an explicit emulation/provider mode is enabled                      |
| amd64 Linux/KVM | arm64 Linux | `linux-kvm-opposite-isa-unsupported`  | `skipped` unless the provider supports arm64 guests or explicit emulation is enabled |
| amd64 macOS     | arm64 Linux | `darwin-hvf-opposite-isa-unsupported` | `skipped`                                                                            |

Same-ISA routes are intentionally skipped with
`opposite-isa-not-opposite-route`; they do not prove this goal.

## Acceleration and emulation labels

- `accelerated=true` means the route used host virtualization support for the
  guest ISA, such as KVM or HVF for a compatible guest.
- `emulated=true` means the route used an explicit CPU emulation mode. It must be
  labeled as emulation and cannot be described as hardware-assisted execution.
- If neither is true, the route must be `skipped` or `refused`; it is not an
  execution proof.

## Why host-side output is refused

A host command like `uname -m` only proves the host architecture. It says nothing
about whether an opposite-ISA guest booted. The negative fixture in the smoke
uses host-side architecture output and must produce
`opposite-isa-host-sidecar-output`.

A successful route must gather `uname -m`, kernel version, and ELF machine data
through guest exec after boot. The verifier runs `/bin/uname` inside the guest and
checks the executed ELF machine matches the requested guest architecture.

## Running the smoke

```sh
pnpm run smoke-opposite-isa-vm-execution
```

By default the smoke is safe on all hosts. It classifies the current host's
opposite guest route and records `skipped` when the provider cannot boot that ISA.
It also runs a completed guest-exec fixture and a negative host-sidecar fixture.

To attempt a real boot on a provider that supports the route:

```sh
OPPOSITE_ISA_VM_LIVE=1 pnpm run smoke-opposite-isa-vm-execution
```

If assets are missing, the route summary uses `opposite-isa-assets-missing` with
remediation. If boot fails, it uses `opposite-isa-boot-failed`.
