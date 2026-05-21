# Native real utility final jump

Issue #504 connects the modeled real-utility gates to a target-native final
jump. This is still a narrow proof. It uses real-utility-shaped safety outputs,
materialized target bytes, and a target-native amd64 trampoline.

## Required gates

The proof requires:

- outside-syscall thread state;
- mapped target module/RVA;
- source `.eh_frame` frame discovery;
- target amd64 unwind matching;
- target module bytes materialized from an explicit target root;
- no resource, mapping, or target-code refusals.

If any gate is missing, the continuation planner refuses before resume. When all
modeled gates pass, the proof jumps into target-native amd64 bytes only.

## Non-claims

This does not claim arbitrary utility migration. It does not resume a whole
system `/bin/sleep` or shell with libc state. It proves the final jump can be
fed by the real-utility safety gates without using:

- source arm64 text as target code;
- source-ISA emulation;
- Node/Bun sidecars;
- application hooks.

## Proof

`pnpm native-real-utility-final-jump --json` materializes target code bytes from
an explicit target root, validates the modeled gates, writes a native process
image bundle, and jumps into target-native amd64 code through the resume
trampoline.

It emits:

```text
real-utility-shaped-continuation-jumped-target-native-amd64-code
```
