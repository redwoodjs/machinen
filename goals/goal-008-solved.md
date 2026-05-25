# Goal 8 solved substeps: graduating real-app refusals

This companion ledger turns Goal 8 from a broad roadmap into concrete refusal
resolution steps. Each item starts from a current fail-closed profile/family,
graduates one narrow app-neutral subset, and keeps unsafe neighbors refused.

## Solved subset 8.1: listening TCP socket recreation

Refusals addressed:

- `socket-transfer-refusal`: `target-socket-syscall-state-unsupported`;
- `socket-readiness-refusal`: `target-socket-syscall-state-unsupported`;
- `fd-alias-socket-refusal`: `target-socket-syscall-state-unsupported`.

Narrow success claim:

- `tcp-listener-v1:loopback-no-accepted-connections`.

Implementation substeps:

- [x] Add `fd:tcp-listener` capability and refusal capability names for active
      accepted connections, queued accepts, unsupported socket options, namespace
      ambiguity, and socket aliases.
- [x] Extend native resource capture to classify TCP sockets as `listening`,
      `connected`, `accepted-queued`, `in-accept`, or `unsupported`.
- [x] Add portable descriptor fields: address family, loopback bind address,
      source port, target port/remap policy, backlog, allowed socket options,
      close-on-exec flag, nonblocking flag, and proof of empty accept queue.
- [x] Fail descriptor planning with exact codes when the socket is connected,
      has accepted peers, has queued accepts, is in-flight `accept`, uses
      unsupported options, is non-loopback without policy, or has aliases.
- [x] Add target-native recipe: `socket()`, allowed `setsockopt()`, `bind()`
      with exact or remapped port, `listen()`, fd flag restore, and verifier
      setup.
- [x] Add target verifier gates: `SO_ACCEPTCONN`, local address/port, allowed
      options, fd flags, target port remap record, and no accepted peer state.
- [x] Add positive profile `tcp-listener-recreate` with `capabilities` including
      `fd:tcp-listener`.
- [x] Add runnable negative profiles:
      `tcp-active-connection-refusal`, `tcp-accept-queue-refusal`,
      `tcp-inflight-accept-refusal`, `tcp-nonloopback-policy-refusal`,
      `tcp-unsupported-option-refusal`, `tcp-listener-alias-refusal`.
- [x] Update support envelope, resource docs, refusal inventory, profile docs,
      and matrix expected counts.
- [x] Verify with focused resource/socket tests, remote profile proof,
      `--preset foundation-full`, full smoke tests, and fallow audit.

Done when a loopback listener with no accepted connections restores natively on
amd64 and all active/ambiguous socket states still fail closed.

## Solved subset 8.2: multiple private anonymous ranges

Refusals addressed:

- `private-layout-refusal`: `mapping-permission-unsupported`;
- `private-source-pointer-refusal`: `mapping-provenance-ambiguous`;
- `stale-private-range-refusal`: `mapping-captured-range-unsupported`;
- `wx-private-mapping-refusal`: `mapping-executable-unsupported`.

Narrow success claim:

- `private-layout-v2:multi-anonymous-data-ranges-with-guards`.

Implementation substeps:

- [x] Add capability `memory:private-rw-multi-range` and guard-page capability
      `memory:guard-page`.
- [x] Extend portable memory model with range id, source span, target span,
      permissions, captured hash, guard-before/after, and relocation table.
- [x] Refuse overlapping ranges, shared ranges, W+X ranges, stale hashes,
      partial captures, unsupported permissions, and pointers into refused
      mappings.
- [x] Extend target memory materialization to map/write/protect multiple private
      ranges and apply guard protections.
- [x] Add verifier gates for contents hash, permissions, guard protection,
      relocation target ownership, and no executable source bytes.
- [x] Add positive profile `private-multi-range-recreate`.
- [x] Add negative profiles:
      `private-overlap-refusal`, `private-guard-mismatch-refusal`,
      `private-multi-stale-range-refusal`, `private-multi-source-pointer-refusal`,
      `private-multi-wx-refusal`, `private-out-of-bounds-relocation-refusal`.
- [x] Update docs and matrix counts.
- [x] Verify with focused memory/materialization tests, remote proof,
      foundation matrix, full smoke tests, and fallow audit.

Done when multiple target-owned private data ranges and guards are restored and
verified without accepting executable/shared/stale memory.

## Solved subset 8.3: acyclic epoll graph

Refusals addressed:

- `epoll-wait-refusal`: `target-epoll-syscall-state-unsupported`;
- `fd-alias-epoll-cycle-refusal`: `target-epoll-syscall-state-unsupported`;
- readiness refusals for unsupported masks, stale fds, and ambiguous ready lists.

Narrow success claim:

- `epoll-graph-v1:acyclic-level-triggered-eventfd-and-pipe`.

Implementation substeps:

- [x] Add capabilities `fd:epoll-graph`, `wait:epoll-acyclic`, and
      `wait:readiness-level-triggered`.
- [x] Extend descriptor graph model with epoll fd id, watched fd refs, event
      masks, data payload, expected readiness, and cycle check result.
- [x] Refuse epoll-to-epoll cycles, edge-triggered, one-shot, unsupported masks,
      stale watched fds, socket readiness without policy, duplicate ambiguous
      watches, and unknown ready-list state.
- [x] Add target recipe: recreate accepted watched fds, create epoll fd, install
      interest list, run target readiness probe, and collect events.
- [x] Add verifier gates for interest list, returned events, data payload,
      expected ready/not-ready state, and no unexpected bits.
- [x] Add positive profile `epoll-graph-recreate`.
- [x] Add negative profiles:
      `epoll-cycle-refusal`, `epoll-edge-trigger-refusal`,
      `epoll-oneshot-refusal`, `epoll-stale-watch-refusal`,
      `epoll-socket-readiness-refusal`, `epoll-ready-list-ambiguous-refusal`.
- [x] Update docs and matrix counts.
- [x] Verify with focused epoll/readiness tests, remote proof, foundation matrix,
      full smoke tests, and fallow audit.

Done when a small acyclic epoll graph over accepted descriptors restores and
verifies target readiness while cycles/edge/ambiguous ready state refuse.

## Solved subset 8.4: file-backed private mapping

Refusals addressed:

- missing executable/file provenance: `mapping-provenance-ambiguous`;
- shared mapping refusal: `mapping-shared-unsupported`;
- executable mapping refusal: `mapping-executable-unsupported`;
- stale private range refusal: `mapping-captured-range-unsupported`.

Narrow success claim:

- `file-backed-private-mapping-v1:nonexec-private-dirty-overlay`.

Implementation substeps:

- [x] Add capability `memory:file-backed-private`.
- [x] Define portable fields: target file path, digest/build id, offset, length,
      permissions, private dirty page hashes, and source-to-target identity.
- [x] Refuse missing provenance, digest mismatch, executable mappings, shared
      mappings, unsupported permissions, stale dirty pages, and source-only paths.
- [x] Add target recipe: verify target file identity, map file privately, apply
      dirty overlay bytes, restore permissions, and record provenance.
- [x] Add verifier gates for file identity, mapped bytes, private dirty bytes,
      permissions, and no source executable byte reuse.
- [x] Add positive profile `file-backed-private-mapping-recreate`.
- [x] Add negative profiles:
      `file-backed-missing-provenance-refusal`,
      `file-backed-digest-mismatch-refusal`,
      `file-backed-executable-refusal`, `file-backed-shared-refusal`,
      `file-backed-stale-dirty-refusal`, `file-backed-source-only-refusal`.
- [x] Update docs and matrix counts.
- [x] Verify with focused mapping tests, remote proof, foundation matrix, full
      smoke tests, and fallow audit.

Done when non-executable private file mappings restore from target-native file
identity plus private dirty bytes and all ambiguous/executable/shared variants
refuse.

## Solved subset 8.5: deterministic `EINTR`

Refusals addressed:

- `restart-state-refusal`: `syscall-restart-unsupported`;
- `restart-remaining-time-refusal`: `syscall-restart-unsupported`;
- `signal-mask-restart-refusal`: `signal-state-unsupported`;
- pending/active signal refusals.

Narrow success claim:

- `active-syscall-eintr-v1:ppoll-timeout-no-signal-delivery`.

Implementation substeps:

- [x] Add capabilities `syscall:active-eintr` and `signal:no-pending-delivery`.
- [x] Define portable fields: syscall name, arguments, interrupted result,
      errno, remaining-time policy, blocked mask, and proof of no pending signal
      delivery or active frame.
- [x] Refuse restart blocks, pending signals, active signal frames, alt-stacks,
      unsupported syscalls, non-deterministic remaining time, and signal-mask
      changing waits.
- [x] Add target recipe that completes the accepted syscall path with exact
      `-EINTR`/errno semantics and final signal mask.
- [x] Add verifier gates for return value, errno, remaining-time update, signal
      mask, and absence of pending delivery.
- [x] Add positive profile `active-syscall-eintr-recreate`.
- [x] Add negative profiles:
      `eintr-restart-block-refusal`, `eintr-pending-signal-refusal`,
      `eintr-active-signal-frame-refusal`, `eintr-alt-stack-refusal`,
      `eintr-unsupported-syscall-refusal`, `eintr-remaining-time-refusal`,
      `eintr-signal-mask-change-refusal`.
- [x] Update docs and matrix counts.
- [x] Verify with focused signal/active-syscall tests, remote proof, foundation
      matrix, full smoke tests, and fallow audit.

Done when one deterministic interrupted syscall outcome is target-native and all
restart/signal ambiguity remains refused.

## Goal 8 solved completion checklist

- [x] Every solved subset above has a positive profile and nearby runnable
      negative profiles.
- [x] Every changed profile has `capabilities` or `refusesCapabilities`.
- [x] `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`
      passes.
- [x] `pnpm --silent portable-machine-proof-matrix -- --preset refusal --json`
      passes.
- [x] Remote positive and full foundation matrices pass with updated counts.
- [x] Full smoke tests pass for VM/VMM/rootfs/assets/CLI/snapshot/restore changes.
- [x] Validation timings are recorded.

## Validation timings

- `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`: 0.199s, passed.
- `pnpm --silent portable-machine-proof-matrix -- --preset refusal --json --continue-on-fail`: 4.339s, passed (100 refusal profiles).
- New Goal 8/9 positive synthetic target-native profile matrix (`tcp-listener-recreate`, `private-multi-range-recreate`, `epoll-graph-recreate`, `file-backed-private-mapping-recreate`, `active-syscall-eintr-recreate`, `tcp-active-connection-transport-recreate`, `tcp-listener-readiness-recreate`, `futex-private-wait-wake-recreate`, `rseq-absent-or-target-registered-recreate`, `shared-memory-contract-recreate`): 0.605s, passed.
- `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries --json --continue-on-fail`: 3.025s, passed (131 profiles; golden summary gate-check matrix).
- Focused Vitest (`portable-machine-proof-runner`, `portable-machine-proof-matrix`, `runtime-support-matrix`, `runtime-adapter-fixture`): 3.775s, passed (86 tests).
- Full smoke tests skipped: no VM/VMM/rootfs/assets/CLI/snapshot/restore behavior was changed.
