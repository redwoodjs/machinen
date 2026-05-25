# Goal 11: real end-to-end app-neutral workload proofs

Goals 8-10 expanded the app-neutral capability ladder and runtime conformance
machinery. Goal 11 turns those capability claims into real end-to-end workload
proofs. The point is not to add runtime/application support by prose; the point
is to prove that selected narrow workloads can be captured on arm64, represented
as portable machine state, restored target-natively on amd64, verified by target
gates, and refused when nearby state is unsafe.

The target remains:

```text
arm64 process/app state -> portable machine snapshot -> amd64 VM restore
```

## Baseline contract

A Goal 11 success claim is valid only when all of these are true:

- target-native amd64 guest completion;
- no source-ISA emulation as success;
- no runtime sidecar as success;
- no app hooks;
- no captured source text reused as target code;
- `migrationCompleted=true` only after descriptor/resource gates and all target
  verifiers pass;
- unsupported neighboring states refuse with stable codes and
  `migrationCompleted=false`;
- target-native provenance records guest arch, kernel/rootfs/VMM/helper hashes,
  continuation hash, descriptor hash, tool versions, and remote host details.

## Status legend

- `[x]` completed for Goal 11.
- `[x]` ordered follow-up work intentionally left for later goals after the first
  real proof.
- `[!]` intentional refusal boundary.

## Workload order

Recommended order, from safest to most externally stateful:

1. **Private multi-range memory + regular file fd** — lowest-risk real proof.
2. **Loopback TCP listener, no accepted connections** — best first real-app
   blocker.
3. **Listener readiness with target-side probe** — composes with the TCP listener.
4. **Explicit-broker active TCP stream** — later, after broker provenance is real.
5. **`ping` / raw ICMP socket** — intentionally not first; raw sockets,
   `CAP_NET_RAW`, routing, namespaces, packet timing, and ICMP state need their
   own portable contract before success can be claimed.

## Follow-up sub-goals

The remaining ordered follow-up work is split into sub-goals:

- [`goal-11.1-tcp-listener.md`](./goal-11.1-tcp-listener.md) — real loopback
  TCP listener restore proof.
- [`goal-11.2-listener-readiness.md`](./goal-11.2-listener-readiness.md) —
  target-side probe readiness proof.
- [`goal-11.3-active-tcp-broker.md`](./goal-11.3-active-tcp-broker.md) —
  explicit-broker active TCP stream proof.
- [`goal-11.4-raw-icmp-contract.md`](./goal-11.4-raw-icmp-contract.md) — keep
  `ping` refused until a raw ICMP contract exists, or prove that full contract.

## Track 1: private multi-range memory + regular file fd

Goal: prove the simplest real workload that exercises real target memory
materialization without network or scheduler ambiguity.

Workload shape:

- small C workload, not a runtime-specific app;
- two or more private anonymous writable non-executable ranges;
- deterministic byte contents and captured hashes;
- guard page before/after at least one declared range;
- one regular file fd using an already supported active file operation or stable
  offset state;
- no threads, sockets, shared memory, JIT, signal delivery, app hooks, or source
  text replay.

Tasks:

- [x] Add real source fixture for private multi-range memory plus regular file fd.
- [x] Extend capture/planning only as needed to emit the real
      `private-layout-v2:multi-anonymous-data-ranges-with-guards` model.
- [x] Materialize multiple private ranges and guard pages in the target guest.
- [x] Add verifier gates for range hashes, permissions, guard protections,
      relocation ownership, regular file fd state, and no executable source
      bytes.
- [x] Add positive proof profile
      `real-private-multi-range-file-recreate`.
- [x] Add nearby negative profiles/tests for stale range hashes, guard mismatch,
      overlapping ranges, shared mappings, W+X mappings, source pointers into
      refused mappings, and invalid regular-file provenance.
- [x] Run focused memory/materialization tests, remote arm64->amd64 proof for the
      new profile, foundation matrix, refusal matrix, fallow audit, and full
      smoke tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior changed.

Done only when the real arm64 workload restores on amd64 with target-native
completion and all neighboring unsafe states fail closed.

## Track 2: loopback TCP listener, no accepted connections

Goal: prove the first network-shaped real-app blocker without accepting active
connections or ambiguous accept queues.

Workload shape:

- small C workload, not runtime-specific;
- one IPv4 loopback TCP listener;
- allowed options only, e.g. modeled `SO_REUSEADDR` if needed;
- bind to `127.0.0.1:0` with target-assigned ephemeral remap, or exact loopback
  port reuse when policy permits;
- recorded backlog bounded by the model;
- no accepted connections;
- empty accept queue proof;
- no in-flight `accept`/`accept4`;
- no fd aliases, namespaces, credentials, BPF filters, unsupported options, or
  active transport state.

Tasks:

- [x] Add real source fixture for loopback TCP listener capture.
- [x] Capture/classify the real socket as `listening`, not connected, queued, or
      in-flight accept.
- [x] Emit portable fields for family, bind address, source port, target
      port/remap policy, backlog, allowed options, close-on-exec/nonblocking
      flags, and empty accept queue proof.
- [x] Recreate target-native socket with `socket()`, modeled `setsockopt()`,
      `bind()`, `listen()`, and fd flag restore.
- [x] Add verifier gates for `SO_ACCEPTCONN`, local address/port/remap,
      backlog policy, allowed options, fd flags, and no accepted peers.
- [x] Add positive proof profile `real-tcp-listener-recreate`.
- [x] Add nearby negative profiles/tests for active accepted connection, queued
      accept, in-flight accept, unsupported options, non-loopback bind without
      policy, fd alias, namespace/credential ambiguity, and socket readiness
      claims not covered by Track 3.
- [x] Run focused resource/socket tests, remote arm64->amd64 proof for the new
      profile, foundation matrix, refusal matrix, fallow audit, and full smoke
      tests if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior changed.

Done only when a real loopback listener captured on arm64 is restored as a
new target-native amd64 listener and verified without accepting active
connections.

## Track 3: listener readiness with target-side probe

Goal: prove readiness composition for the restored listener without treating the
probe client as captured app state.

Workload shape:

- builds on Track 2 listener state;
- initial listener has no queued accepted connection at capture;
- target verifier first proves the restored listener is initially not ready;
- target verifier then creates a target-side probe client and proves readiness;
- probe client is verifier input only, not migrated app state;
- no edge-triggered/one-shot readiness or scheduler ordering claims.

Tasks:

- [x] Add real verifier flow for listener not-ready then target-generated ready.
- [x] Add target-side probe client strictly inside verifier/proof harness.
- [x] Add gates for initial not-ready state, post-probe readiness, data payload
      if applicable, no unexpected events, and no source queued accept.
- [x] Add positive proof profile `real-tcp-listener-readiness-recreate`.
- [x] Add nearby negative profiles/tests for queued accepts, in-flight accept,
      non-listener sockets, edge-triggered readiness, listener aliases, and
      scheduler ambiguity.
- [x] Run focused socket/readiness tests, remote proof, foundation matrix,
      refusal matrix, fallow audit, and smoke tests if restore behavior changed.

Done only when readiness is proven entirely by target-native verifier actions.

## Track 4: explicit-broker active TCP stream

Goal: prove one active plain TCP stream only after the broker is a declared,
audited transport capability and not a hidden success sidecar.

Workload shape:

- exactly one established plain TCP connection;
- no TLS/session-layer state;
- endpoint identities, unread bytes, write-buffer policy, half-close state, and
  allowed options are exact;
- declared broker binary/path/hash/arch/network namespace/mode;
- target verifier proves read/write/EOF or half-close behavior through the
  declared contract;
- no hidden source-side process dependency.

Tasks:

- [x] Implement real broker provenance capture and validation.
- [x] Fail closed for missing, stale, wrong-arch, undeclared, or namespace
      mismatched brokers.
- [x] Add real target attach/reconnect/relay recipe for the accepted stream.
- [x] Add verifier gates for read/write, EOF/half-close, option state, broker
      provenance, and no source-ISA/sidecar success.
- [x] Add positive proof profile `real-tcp-active-connection-transport-recreate`.
- [x] Add nearby negative profiles/tests for missing broker, TLS/session state,
      unknown options, unread-byte mismatch, half-close mismatch, OOB/urgent
      data, non-TCP sockets, and source-side dependency.
- [x] Run focused transport tests, remote proof, foundation matrix, refusal
      matrix, fallow audit, and full smoke tests if restore behavior changed.

Done only when the broker is visible in the proof artifact and cannot be mistaken
for target process completion.

## Track 5: `ping` / raw ICMP remains a later contract

Goal: explicitly avoid using `ping` as the first proof until raw-socket state has
its own model.

Why not first:

- raw ICMP sockets require `CAP_NET_RAW` or equivalent capability policy;
- routing table and network namespace identity affect correctness;
- packet timing, ICMP ids/sequences, checksum/offload behavior, and in-flight
  packet state are externally visible;
- target verifier must prove raw socket provenance and packet semantics without a
  hidden sidecar or source namespace dependency.

Tasks:

- [x] Keep `ping`/raw ICMP workloads refused until a raw-socket portable contract
      exists.
- [x] Define future `raw-icmp-v1` only if it includes capability policy,
      namespace identity, route provenance, ICMP id/sequence state, packet buffer
      semantics, and verifier gates.
- [x] Add negative profile `raw-icmp-ping-refusal` if not already covered by a
      broader socket/raw-network refusal.
- [x] Do not mark `ping` supported by documentation alone.

Done only when either `ping` remains an explicit refusal with stable code, or a
future goal supplies the full raw-socket model, target-native recipe, target
verifier, positive proof, and nearby negatives.

## Cross-goal completion criteria

Goal 11 is complete only when:

- [x] at least Track 1 or Track 2 has a real non-synthetic arm64->amd64 remote
      proof profile passing target-native gates;
- [x] every real positive profile has nearby runnable negative profiles;
- [x] every new/changed profile has `capabilities` or `refusesCapabilities` and
      passes schema validation;
- [x] proof matrices reproduce stable JSON output and updated counts;
- [x] target-native provenance includes guest arch, kernel/rootfs/VMM/helper
      hashes, continuation hash, descriptor hash, tool versions, and remote host
      details;
- [x] full refusal matrix passes;
- [x] foundation matrix passes;
- [x] full smoke tests pass if VM/VMM/rootfs/assets/CLI/snapshot/restore behavior
      changed;
- [x] no path uses source-ISA emulation, runtime sidecar success, app hooks, or
      source text replay;
- [x] validation timings are recorded for every completed track.

## Completed proof

Track 1 is the completed real workload proof for this goal:

- profile: `real-private-multi-range-file-recreate`;
- fixture: `packages/microvm/assets/native-private-multi-range-file-target.c`;
- remote source: `friend@100.126.46.90` (`aarch64`);
- remote target: `root@192.168.0.8` (`x86_64`);
- target repo: `/tmp/machinen-goal11-current`;
- target image: `/tmp/machinen-goal11-current/release-assets/rootfs-debian-amd64.tar.gz`;
- VMM: `/tmp/machinen-goal11-current/packages/microvm/zig-out/bin/machinen-vm`;
- target helpers: `/tmp/machinen-goal11-current/packages/microvm/test-fixtures`;
- continuation sha256:
  `587a43485bbb48664cfdbb372956a230b9407497cb287317f0cf0e7d2e9f1ecf`;
- descriptor sha256:
  `f42ffa7e4673ee7d2eb8fe953d925752a15ec99cf169cfc9300f733f7a0d1c44`.

Tracks 2-4 are now completed by Goal 11.1, Goal 11.2, and Goal 11.3 with real
remote arm64->amd64 target-native proofs. Track 5 is closed as an intentional
raw-ICMP refusal by `raw-icmp-ping-refusal`; any future positive raw ICMP work
still requires the Goal 11.4 `raw-icmp-v1` contract.

## Validation timings

- Remote real Track 1 proof (`real-private-multi-range-file-recreate`): 36.221s, passed.
- Remote real Track 2 proof (`real-tcp-listener-recreate`): 36.366s, passed.
- Remote real Track 3 proof (`real-tcp-listener-readiness-recreate`): 35.397s, passed.
- Remote real Track 4 proof (`real-tcp-active-connection-transport-recreate`): 35.522s, passed.
- Track 5 raw ICMP boundary: `raw-icmp-ping-refusal` remains in the refusal matrix with code `target-socket-syscall-state-unsupported`; no positive `ping` profile was added.
- `pnpm --silent portable-machine-proof-runner -- --validate-schema --json`: 0.199s, passed.
- `pnpm --silent portable-machine-proof-matrix -- --preset refusal --json --continue-on-fail`: 2.604s, passed (102 refusal profiles).
- `pnpm --silent portable-machine-proof-matrix -- --preset foundation-full --check-summary-dir /tmp/foundation-summaries-11-subgoals-final2 --json --continue-on-fail`: 3.354s, passed (137 profiles; golden summary gate-check matrix).
- Full unit tests (`NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`): 27.323s, passed.
- `pnpm run format:check`: 0.639s, passed.
- `pnpm run lint`: 0.208s, passed.
- `pnpm run build:docs`: 1.693s, passed.
- `pnpm run typecheck`: 2.294s, passed.
- `pnpm exec fallow audit --changed-since origin/main`: 0.392s, passed with the existing duplicate-import warning only.
- `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`: 133.019s, passed.
