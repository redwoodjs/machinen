---
"@machinen/runtime": minor
"@machinen/cli": minor
"@machinen/native-arm64-linux": minor
"@machinen/native-arm64-darwin": minor
---

Add opt-in nested virtualization for arm64 hosts.

`boot({ nested: true })` and `machinen boot --nested` now ask the VMM to expose EL2 to the guest. Linux/KVM uses `KVM_CAP_ARM_EL2` and `KVM_ARM_VCPU_HAS_EL2`; macOS uses Hypervisor.framework's EL2 VM config when available. The guest kernel config now builds KVM in so `/dev/kvm` can appear inside nested-capable guests, masks SVE/SME features that HVF cannot virtualize at EL2, and uses a nested-safe poweroff marker when PSCI terminates inside the L1 guest. Provider-level snapshots of nested-enabled VMs are refused until EL2 vmstate capture is fully audited. Docs now include a Firecracker guide, plus an example that boots an aarch64 Firecracker L2 inside machinen.
