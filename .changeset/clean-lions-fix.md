---
"@machinen/native-arm64-linux": patch
"@machinen/native-arm64-darwin": patch
---

Fix virtio-fs live mounts on Linux/KVM.

Linux arm64 now reads host file metadata with the right `stat` layout, so `--mount-live` no longer crashes the VMM during `GETATTR`. Appends through a live mount now honor the guest's write offset instead of duplicating bytes on Linux hosts.
