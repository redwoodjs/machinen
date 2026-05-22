---
"@machinen/runtime": minor
"@machinen/cli": minor
"@machinen/microvm": minor
"@machinen/native-x64-linux": minor
---

Ship amd64 Linux/KVM guest support.

The release now publishes the `@machinen/native-x64-linux` host package and amd64 base assets (`bzImage-x86_64`, `rootfs-debian-amd64.tar.gz`, and the prebaked rootfs image). On amd64 Linux hosts, the CLI/runtime select amd64 guest assets by default and same-architecture amd64 snapshot/restore uses the vmstate path.
