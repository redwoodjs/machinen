# Native actual real utility continuation

Issue #508 moves the continuation planner from a shaped real-utility fixture to
an actual captured Linux utility path.

The proof script captures an unmodified arm64 Linux utility (`sleep`) when run
on Linux/arm64. On Linux/amd64 it can consume an arm64 source bundle via
`MACHINEN_ACTUAL_REAL_UTILITY_SOURCE_BUNDLE` and optionally inspect target files
under `MACHINEN_ACTUAL_REAL_UTILITY_TARGET_ROOT`.

## Gate order

The actual captured path preserves the native-transparent gate order:

1. thread state, including active syscall detection;
2. inherited stdio and non-file resource policy;
3. mapping materialization;
4. target code-location mapping, using semantic sleep/timer continuation symbols when the source thread is blocked in a deferred sleep syscall;
5. source `.eh_frame` frame discovery;
6. target amd64 unwind matching;
7. target frame/callee-saved state materialization;
8. target module byte materialization from explicit target inventory/root;
9. synthetic target-caller frame installation;
10. target-native resume execution path.

The new actual-real-utility planner adds a final `target-module-bytes` gate. If
all earlier gates pass but no target bytes were explicitly materialized, it
refuses with `target-module-bytes-missing` instead of pretending captured arm64
text is target code.

## Current result

The default real utility is `sleep`, so default policy still refuses at thread
state when the process is inside `clock_nanosleep`. With the explicit
`MACHINEN_ACTUAL_REAL_UTILITY_SLEEP_SYSCALL_POLICY=defer-target-resume` policy,
the proof records a deferred target timer continuation only after decoding the
relative sleep request timespec from captured syscall state. The continuation
metadata reports modeled `remainingTime` with `requested-duration-upper-bound`
precision. The proof then recreates safe `PROT_NONE` guard/protection mappings
and lets the target-code-location gate consume the deferred sleep metadata.
Without an explicit amd64 target root, the
current proof then refuses precisely with `target-module-missing` for the active
libc frame instead of granting success. The proof now resolves deferred sleep to a synthesized amd64 syscall
continuation instead of entering real target libc. It materializes a tiny native
amd64 `clock_nanosleep` byte sequence with an embedded modeled `timespec`, plans
a synthetic caller frame, and creates a target-native resume execution plan. With
that explicit plan present, the actual planner can reach `ready` without target
libc `.eh_frame`, TLS, GOT, or global state.

On Linux/amd64, the proof runs a bounded target-native trampoline for that ready
plan. The trampoline maps the explicit synthetic amd64 bytes and transfers
control to them on the synthetic target stack. The synthetic continuation issues
the target-native sleep syscall and then exits the target process with status `0`
when the syscall returns successfully. That is the first narrow proof state where
`migrationCompleted` can be `true`.

The summary reports `attemptedResume: true` and, for the modeled synthetic sleep
path, `migrationCompleted: true` only after the target process exits with status
`0`.

That ready-plus-attempt state is intentional but not a migration success claim. It
proves the real capture path has explicit data for every modeled planning gate,
that the execution transfer reaches generated target-native sleep syscall bytes,
and that the narrow `/bin/sleep` target process can complete without raw RVA
equivalence or libc-internal memory state.

## Non-claims

This does not yet resume arbitrary `/bin/sleep` or libc state. It does not use:

- source arm64 text as target code;
- source-ISA emulation;
- Node/Bun sidecars;
- application hooks.

## Proof

```bash
pnpm native-actual-real-utility-continuation --json
```

On non-Linux hosts, or Linux/amd64 without an arm64 source bundle, the proof
skips with a clear reason.
