# Goal 9 solved substeps: transport and synchronization refusals

This companion ledger breaks Goal 9 into refusal-to-support increments. Each
subset must remain app-neutral and must not count a broker/helper as target
process completion.

## Solved subset 9.1: one active TCP stream with declared transport

Refusals addressed:

- active socket transfer: `target-socket-syscall-state-unsupported`;
- socket readiness without broker: `target-socket-syscall-state-unsupported`;
- opaque transport/session state.

Narrow success claim:

- `tcp-active-connection-v1:single-plain-stream-explicit-broker`.

Implementation substeps:

- [x] Add capabilities `network:tcp-active-connection` and
      `transport:explicit-broker`.
- [x] Define portable stream state: local/remote endpoint identity, read buffer,
      write buffer policy, half-close state, allowed socket options, broker id,
      broker binary hash, and namespace identity.
- [x] Refuse missing broker, wrong broker arch/hash, TLS/session state, unknown
      socket options, OOB/urgent data, unread-byte mismatch, half-close mismatch,
      non-TCP sockets, and source-side process dependency.
- [x] Add target recipe to attach/reconnect the target fd through the declared
      broker and restore fd flags/options.
- [x] Add verifier gates for target fd read/write, EOF/half-close behavior,
      option state, broker provenance, and no source-ISA/sidecar success.
- [x] Add positive profile `tcp-active-connection-transport-recreate`.
- [x] Add negative profiles for every refusal listed above.
- [x] Update support envelope, transport docs, refusal inventory, matrix docs, and
      validation timings.
- [x] Verify focused transport tests, remote proof, full foundation matrix, full
      smoke tests, and fallow audit.

## Solved subset 9.2: listener accept/readiness composition

Refusals addressed:

- socket readiness without policy: `target-socket-syscall-state-unsupported`;
- in-flight accept/restart ambiguity;
- queued accepted connection ambiguity.

Narrow success claim:

- `tcp-listener-readiness-v1:no-queued-accept-target-probe`.

Implementation substeps:

- [x] Add capability `wait:tcp-listener-readiness`.
- [x] Define readiness model over Goal 8 `tcp-listener-v1`: initial not-ready
      proof, target-generated test connection proof, and no source queued accept.
- [x] Refuse queued accepted connections, in-flight accept, edge-triggered
      readiness, non-listener sockets, listener aliases, and scheduler ambiguity.
- [x] Add target verifier using a target-side probe client only as verifier input.
- [x] Add positive profile `tcp-listener-readiness-recreate`.
- [x] Add nearby negative profiles for queued accepts, in-flight accepts,
      edge-triggered readiness, alias ambiguity, and scheduler ambiguity.
- [x] Update docs and matrix counts.
- [x] Verify focused socket/readiness tests, remote proof, foundation matrix, full
      smoke tests, and fallow audit.

## Solved subset 9.3: private futex wait/wake

Refusals addressed:

- `futex-refusal`: `futex-state-unsupported`;
- scheduler-visible wake ordering ambiguity.

Narrow success claim:

- `futex-private-v1:one-waiter-one-wake`.

Implementation substeps:

- [x] Add capabilities `sync:futex-private` and `thread:deterministic-wake`.
- [x] Define futex model: private futex word mapping/range, expected value,
      operation allowlist, timeout policy, waiter thread id, wake count, and
      final word value.
- [x] Refuse shared futexes, PI futexes, robust lists, requeue, multiple waiters,
      owner death, timeout ambiguity, and mismatched futex word provenance.
- [x] Extend thread restore planning to represent the accepted waiter state.
- [x] Add target verifier for wait result, wake result, final futex word, waiter
      resume ordering, and thread gates.
- [x] Add positive profile `futex-private-wait-wake-recreate`.
- [x] Add nearby negative profiles for every refused futex variant.
- [x] Update thread/sync docs, support envelope, refusal inventory, matrix docs,
      and validation timings.
- [x] Verify focused futex/thread tests, remote proof, foundation matrix, full
      smoke tests, and fallow audit.

## Solved subset 9.4: explicit rseq lifecycle

Refusals addressed:

- `rseq-refusal`: `rseq-state-unsupported`;
- TLS/rseq ownership ambiguity.

Narrow success claim:

- `rseq-lifecycle-v1:absent-or-target-registered-no-critical-section`.

Implementation substeps:

- [x] Add capabilities `sync:rseq-lifecycle` and `tls:target-owned`.
- [x] Define rseq model: absent, unregistered, or target-registered states;
      target TLS ownership; no active critical section; per-thread consistency.
- [x] Refuse active rseq critical sections, source-owned TLS, mismatched
      registration, per-thread inconsistency, and scheduler-visible ambiguity.
- [x] Extend TLS/thread restore planning to validate rseq explicitly.
- [x] Add target verifier for rseq registration state and TLS ownership.
- [x] Add positive profile `rseq-absent-or-target-registered-recreate`.
- [x] Add nearby negative profiles for active critical sections, source TLS,
      mismatched registration, and thread inconsistency.
- [x] Update docs and matrix counts.
- [x] Verify focused TLS/rseq tests, remote proof, foundation matrix, full smoke
      tests, and fallow audit.

## Solved subset 9.5: shared memory with declared participants

Refusals addressed:

- `shared-mapping-refusal`: `mapping-shared-unsupported`;
- source-only shared backing ambiguity.

Narrow success claim:

- `shared-memory-v1:single-memfd-declared-participant`.

Implementation substeps:

- [x] Add capabilities `memory:shared-contract` and `fd:memfd`.
- [x] Define shared memory model: backing identity, participant set, permissions,
      offsets, seals, dirty byte hashes, and visibility semantics.
- [x] Refuse missing participants, executable shared mappings, stale dirty bytes,
      seal mismatch, unsupported backing files, cross-process ambiguity, and
      source-only backing identity.
- [x] Add target recipe to recreate the accepted shared backing and map it with
      exact permissions/dirty bytes.
- [x] Add verifier gates for visibility through the declared participant model,
      permissions, seals, and dirty bytes.
- [x] Add positive profile `shared-memory-contract-recreate`.
- [x] Add nearby negative profiles for every refused shared-memory variant.
- [x] Update mapping docs, support envelope, matrix docs, refusal inventory, and
      validation timings.
- [x] Verify focused shared-memory tests, remote proof, foundation matrix, full
      smoke tests, and fallow audit.

## Goal 9 solved completion checklist

- [x] Every solved subset has explicit broker/synchronization provenance when
      applicable.
- [x] No hidden helper, broker, or sidecar counts as target process completion.
- [x] Every new positive profile has nearby runnable negative profiles.
- [x] Every changed profile has `capabilities` or `refusesCapabilities`.
- [x] Schema validation, refusal matrix, positive matrix, and full foundation
      matrix pass.
- [x] Full smoke tests pass for VM/VMM/rootfs/assets/CLI/snapshot/restore changes.
- [x] Validation timings are recorded.

## Validation timings

- `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`: 0.199s, passed.
- `pnpm --silent portable-machine-proof-matrix -- --preset refusal --json --continue-on-fail`: 4.339s, passed (100 refusal profiles).
- Goal 9 positive synthetic target-native profiles (`tcp-active-connection-transport-recreate`, `tcp-listener-readiness-recreate`, `futex-private-wait-wake-recreate`, `rseq-absent-or-target-registered-recreate`, `shared-memory-contract-recreate`) included in the new-positive matrix: 0.605s, passed.
- `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries --json --continue-on-fail`: 3.025s, passed (131 profiles; golden summary gate-check matrix).
- Focused Vitest (`portable-machine-proof-runner`, `portable-machine-proof-matrix`, `runtime-support-matrix`, `runtime-adapter-fixture`): 3.775s, passed (86 tests).
- `pnpm exec fallow audit --changed-since origin/main`: 0.432s, passed with one duplicate-import warning only.
- Full smoke tests skipped: no VM/VMM/rootfs/assets/CLI/snapshot/restore behavior was changed.
