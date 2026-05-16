---
"@machinen/microvm": patch
"@machinen/native-arm64-darwin": patch
---

Fix HVF boots on macOS 26 Tahoe by handling trapped wait instructions and system-register accesses, including M4 debug registers that Apple's current SDK does not expose.
