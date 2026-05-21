# Native guard mapping materialization

Issue #514 narrows `mapping-unreadable` for actual real utilities.

## Policy

A mapping may be recreated as a target guard mapping only when it is all of:

- not readable;
- not writable;
- not executable;
- private, not shared;
- not captured in `native-memory.bin`;
- anonymous, stack-like, or file-backed protection-gap shaped.

Those mappings have no current source bytes to preserve. The target may recreate
them as `PROT_NONE` reservations and the planner does not treat them as a resume
blocker.

## Unsafe unreadable mappings

Unreadable mappings that are writable, executable, shared, or otherwise
ambiguous still refuse with `mapping-unreadable`. Refusals include the mapping
id, kind, source range, permission string, path, and permission object so the
next policy can be precise.

## Actual utility effect

With the explicit sleep policy:

```bash
MACHINEN_ACTUAL_REAL_UTILITY_SLEEP_SYSCALL_POLICY=defer-target-resume \
  pnpm native-actual-real-utility-continuation --json
```

the actual `/bin/sleep` proof can move past `thread-state` and safe guard mapping
materialization. The next blocker remains fail-closed; this change does not claim
native resume.
