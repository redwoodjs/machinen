# Goal 41: Stable refusal hardening for hard runtime states

Parent context: Goal 40 established fail-closed boundaries for active
socket/TLS state, opaque native extension state, and arbitrary Go scheduler
state. Goal 41 turns those stable refusals into a durable, user-facing refusal
contract with regression coverage.

## Objective

Harden every Goal 40 stable refusal so users and future implementation work can
rely on the same refusal code, migration outcome, and explanation until a
specific positive proof graduates that state.

This goal is not about making the refused states work. It is about making the
refusals stable, precise, documented, and hard to regress.

## Phased subgoals

Complete these linked subgoals before marking Goal 41 complete:

- [x] [Goal 41.1: Active network/TLS refusal contract](./goal-041.1-active-network-tls-refusal-contract.md)
      — harden refusal behavior for active socket queues, bytes in flight,
      peer state, WebSocket frame ambiguity, and TLS session keys.
- [x] [Goal 41.2: Native extension refusal contract](./goal-041.2-native-extension-refusal-contract.md)
      — harden refusal behavior for cgo, JNI, Ruby native gems, and Python C
      extensions when explicit external-state contracts are absent or invalid.
- [x] [Goal 41.3: Go scheduler refusal contract](./goal-041.3-go-scheduler-refusal-contract.md)
      — harden refusal behavior for arbitrary goroutine scheduler queues,
      parked goroutines, channel/select waiters, netpoll waiters, runtime-private
      frames, and cgo goroutines.
- [x] [Goal 41.4: Refusal UX, docs, and upgrade path](./goal-041.4-refusal-ux-docs-upgrade-path.md)
      — publish user-facing explanations, remediation guidance, and proof
      requirements for graduating any refusal into support.

## Umbrella completion criteria

- [x] Each stable refusal has a canonical code, short user-facing message,
      detailed explanation, remediation guidance, and graduation requirements.
- [x] Every refusal summary keeps `migrationCompleted=false` and never reports a
      successful target restore.
- [x] Refusals explicitly reject source-ISA emulation, source text replay,
      sidecar runtime success, app hooks, and metadata-only shortcuts.
- [x] Matrix tests fail if a refusal code, migration outcome, descriptor gate, or
      target state changes unintentionally.
- [x] Runtime manifests, proof profiles, checked summaries, docs, and user-facing
      support guidance are updated.
- [x] Existing Goal 40 positive boundary profiles continue to pass.
- [x] Existing Node, refusal, foundation, runtime-support, non-Node, and Goal 40
      matrices continue to pass.

## Required final validation

Run and record timing for:

- [x] active network/TLS refusal matrix;
- [x] native extension refusal matrix;
- [x] Go scheduler refusal matrix;
- [x] Goal 40 hard-state matrix;
- [x] full runtime support matrix;
- [x] full refusal matrix;
- [x] full foundation matrix;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run build:docs`;
- [x] `pnpm run typecheck`;
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [x] `pnpm exec fallow audit --changed-since origin/main`;
- [x] `git diff --check`.
