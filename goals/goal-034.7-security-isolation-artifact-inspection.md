# Goal 34.7: Security and isolation artifact inspection

Parent: [Goal 34](./goal-034.md).

## Objective

Strengthen anti-shortcut proof from summary booleans to artifact inspection. The
support claim must prove no source-ISA emulation, sidecars, source text replay,
or app hooks were used to fake success.

## Requirements

- [x] Inspect source capture artifacts for source ISA emulation markers.
- [x] Inspect target restore artifacts for sidecar runtimes.
- [x] Inspect target bundles to ensure source text is not reused as target code.
- [x] Inspect app runtime configuration for hooks or loader shims.
- [x] Verify target binaries/artifacts are target-native amd64 where required.
- [x] Add failure fixtures that attempt each forbidden shortcut.
- [x] Refuse each shortcut with a stable code.

## Validation

- [x] Security/isolation artifact inspection tests.
- [x] Negative shortcut fixtures for emulation, sidecar, source replay, and app
      hooks.
- [x] Checked summaries showing refusal or artifact-inspection pass.
- [x] Relevant static checks from Goal 34.

## Completion criteria

Complete when artifact inspection, not only summary fields, proves shortcut paths
are absent or refused.

## Completion note

Completed as part of umbrella Goal 34. See
[Goal 34 completion validation record](./goal-034.md#completion-validation-record)
for implementation and validation evidence.
