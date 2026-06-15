---
"@machinen/runtime": patch
"@machinen/microvm": patch
"@machinen/native-x64-linux": patch
---

Fix x64 Linux VMs booting with a fifth live mount by keeping virtio-fs IRQs valid under `noapic`.

Surface early guest kernel panics in boot errors by including a bounded VMM stderr tail and panic/oops classification.

Build the vmstate entropy reseed helper for the selected guest target so amd64 base assets do not receive an arm64 helper.
