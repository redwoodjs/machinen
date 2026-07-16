---
"@machinen/runtime": patch
"@machinen/native-arm64-darwin": patch
"@machinen/native-arm64-linux": patch
"@machinen/native-x64-linux": patch
---

Move final writable live-mount sync into the guest lifecycle owner so fresh and restored workloads keep their original argv, terminal, stdin, signals, and exit behavior. Graceful kill and stop requests now wait for guest cleanup, with forced VMM termination retained only as a timed fallback. Ship the compiled supervisor and restore worker on every boot for older cached and custom images.
