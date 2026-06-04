# 024 — memory closure context

Portability smoke for selected V8 closure context state. The row finds a `closure -> context -> count` cell and decodes a raw V8 context Smi slot, then materializes a target-native counter initialized from the decoded value.

Not claimed: arbitrary Node process restore, raw V8 heap restore, same PID continuation.
