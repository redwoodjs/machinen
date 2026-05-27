# Goal 37.4: No-network/no-scripts sandbox enforcement

Parent: [Goal 37](./goal-037.md).

## Objective

Prove the third-party ecosystem-equivalent suite cannot fetch packages, run
lifecycle scripts, or execute opaque third-party install behavior.

## Requirements

- [x] Run package proof commands with network disabled or an explicit no-network
      guard.
- [x] Enforce ignore-scripts/no-lifecycle behavior for package resolution.
- [x] Add fixtures that attempt network access or lifecycle script execution and
      verify they are refused before execution.
- [x] Record sandbox environment, package-manager config, and denial evidence in
      proof summaries.
- [x] Ensure the suite never reads user npm config, tokens, or registry auth.
- [x] Add stable refusal codes for network access, lifecycle scripts, opaque
      postinstall artifacts, and registry auth requirements.

## Validation

- [x] No-network enforcement smoke.
- [x] No-scripts/lifecycle refusal tests.
- [x] User config/auth isolation test.
- [x] Sandbox evidence appears in checked summaries.
- [x] Relevant static checks from Goal 37.

## Completion criteria

Complete when the suite proves package ecosystem complexity while remaining
offline, no-scripts, and isolated from user package-manager credentials.

## Completion note

Completed as part of umbrella Goal 37. See
[Goal 37 completion validation record](./goal-037.md#completion-validation-record)
for implementation and validation evidence.
