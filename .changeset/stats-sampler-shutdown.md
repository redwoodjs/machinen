---
"@machinen/runtime": patch
"@machinen/microvm": patch
"@machinen/native-arm64-darwin": patch
---

Stop the Darwin VMM stats sampler before teardown so VM shutdown no longer crashes after image commands or Ctrl-C.
