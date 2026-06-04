# 036 — memory capture classifier

This smoke starts a real Node process inside a Machinen guest, reads
`/proc/<pid>/maps` and `/proc/<pid>/mem`, and classifies seeded Node/V8 memory
categories from source process memory.

It is the Node-specific memory capture/classification substrate for later rows.
It does not restore raw V8 heap bytes, preserve the PID, or continue active
runtime resources.
