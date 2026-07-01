---
"@machinen/runtime": patch
"@machinen/cli": patch
"@machinen/microvm": patch
"@machinen/mount-server": patch
---

Move more boot, provision, restore, live-mount, and vmstate planning into the Zig runtime helper/VMM boundary. This keeps TypeScript focused on orchestration, improves live-mount batching and metadata handling, and fixes the first KVM vmstate checkpoint dirty-bitmap path.
