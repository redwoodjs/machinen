# Native real utility continuation attempt

Issue #485 tries the first native-transparent continuation path against a tiny real Linux utility instead of a controlled fixture.

## Command

```sh
pnpm native-real-utility
```

On non-Linux hosts the proof skips because it needs `/proc` and `ptrace`. The current proof captures the arm64 source side.

## Utility chosen

The first candidate is the system `sleep` utility:

```text
/bin/sleep 30   or   /usr/bin/sleep 30
```

It is tiny, dynamically linked, long-lived, and has a narrow observable process state. The verifier checks that the selected binary is a dynamically linked ELF by reading its program headers and dynamic section.

## Pipeline

The attempt runs the stricter native pipeline from the previous proofs:

1. external ptrace/procfs process capture;
2. native process-image validation;
3. mapping materialization planning;
4. resource translation/refusal classification;
5. first target-code boundary check.

Issue #494 adds a separate code-location proof for outside-syscall real utilities: [Native real utility code-location mapping](./native-real-utility-code-map.md).

The `sleep` proof intentionally refuses before any target jump unless a matching amd64 target binary/module/RVA map is available. It reports:

```json
{
  "sourceTextReusedAsTargetCode": false,
  "targetBinarySource": "not-provided"
}
```

That is the important safety property for this issue: source arm64 text is never treated as target-native amd64 code.

## Current result

The expected current result is a fail-closed refusal at the first exact boundary. For `sleep 30`, that is usually the thread-state boundary:

- `active-syscall` when the captured thread is blocked in `clock_nanosleep`/`nanosleep` or a restart block;
- an earlier exact resource/mapping boundary only if the host utility exposes one before syscall refusal;
- `code-location-unknown` only after thread, resource, and mapping state are all safe and no matching amd64 target code map is provided.

A passing run emits:

```text
real-arm64-sleep-refused-at-thread-state
```

## Non-claim

This does **not** claim arbitrary native utility migration yet. It proves the real-utility attempt uses the native process-image validation pipeline and stops at a precise known boundary rather than falling back to source-ISA emulation, sidecars, app hooks, or raw source virtual addresses.

See also:

- [Native active-syscall refusal proof](./native-syscall-state-refusal.md)
- [Native real utility code-location mapping](./native-real-utility-code-map.md)
- [Native real utility `.eh_frame` frame discovery](./native-real-utility-eh-frame.md)
- [Native real utility inherited stdio policy](./native-real-utility-stdio-policy.md)
- [Native real utility continuation attempt](./native-real-utility-continuation.md)
