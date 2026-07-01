---
"@machinen/native-arm64-darwin": patch
"@machinen/native-arm64-linux": patch
"@machinen/native-x64-linux": patch
---

Ship the runtime's native host tools with the platform packages: `machinen-runtime-helper`, `machinen-pdeathsig`, `machinen-pty`, and `machinen-winsize`. The release build now stages Darwin tools from macOS and Linux tools from Linux so published packages contain the right binaries for each host.
