# Goal 21: Next 50 portable snapshot/restore graduations

Parent context: [`goal-020.md`](./goal-020.md) resolved the Goal 18 master-audit
families by graduating the first eventfd-alias subset and recording target-native
permanent refusals for broad unsound state families. The next phase is to reduce
the refusal backlog by graduating the highest-value narrow subsets one at a time.

## Objective

Work through the next 50 best refusal-to-support targets below. Each target must
be completed as a real target-native capability graduation, not as documentation
or a weakened refusal gate. A target is complete only when it has descriptor and
source-capture support, target-native restore recipe, verifier gates, positive
arm64→amd64 proof, neighboring target-native negative proofs, support-envelope
updates, matrix coverage, and validation timings.

## Prioritization rules

Prefer targets that are:

1. useful to real runtimes/apps;
2. bounded enough for exact descriptor and verifier contracts;
3. adjacent to existing graduated support;
4. provable without source-ISA emulation, runtime sidecars, app hooks, source
   text replay, or hidden source-side helpers;
5. fail-closed for neighboring unsupported states with stable refusal codes and
   `migrationCompleted=false`.

Do not claim support for a broad refusal family. Graduate only the narrow subset
named by the target, and keep all broader/neighboring states refused.

## Next 50 targets

1. [x] **Pipe buffered bytes v1**
   - Source refusals: `pipe-buffered-data-waiter-refusal`.
   - Accepted subset candidate: one pipe pair with bounded buffered payload,
     both peers open, no waiters, no aliases beyond the modeled fd table.
   - Key negative neighbors: too much buffered data, missing peer, waiter
     present, alias ambiguity, stale byte snapshot.

2. [x] **UDP loopback single queued datagram v1**
   - Source refusals: `udp-datagram-queue-refusal`,
     `socket-receive-queue-general-refusal`, `target-next-packet-unverified-refusal`.
   - Accepted subset candidate: one loopback UDP socket with exactly one queued
     datagram, exact source/destination tuple, exact bytes, no aliases, no
     namespace/routing ambiguity.
   - Key negative neighbors: multiple datagrams, non-loopback route, stale route,
     unknown packet bytes, socket alias.

3. [x] **UDP connected empty socket v1**
   - Source refusals: `namespace-routing-provenance-refusal`,
     `socket-send-queue-general-refusal`.
   - Accepted subset candidate: one connected loopback UDP socket with no queued
     receive/send data and target-verified route identity.
   - Key negative neighbors: pending datagram, non-loopback, namespace mismatch,
     route mismatch, unsupported socket option.

4. [x] **Regular-file OFD advisory lock v1**
   - Source refusals: `file-lock-refusal`, `fd-alias-lock-refusal`.
   - Accepted subset candidate: one OFD write lock on a reopened regular file,
     target-owned lock identity, no competing lockers, no leases.
   - Key negative neighbors: POSIX owner lock, lock conflict, stale inode digest,
     duplicated unknown OFD, mandatory lock.

5. [x] **Regular-file POSIX advisory lock v1**
   - Source refusals: `file-lock-refusal`.
   - Accepted subset candidate: one process-owned advisory byte-range lock on a
     target-identified regular file with deterministic owner handoff.
   - Key negative neighbors: cross-process owner ambiguity, lock conflict,
     inherited lock through fork, lease interaction, stale file identity.

6. [x] **Clean MAP_SHARED regular-file mapping v1**
   - Source refusals: `shared-mapping-refusal`, `file-backed-shared-refusal`.
   - Accepted subset candidate: clean read-only MAP_SHARED mapping from a
     target-identified regular file with digest verification.
   - Key negative neighbors: dirty shared page, writable mapping, missing
     participant, stale digest, executable mapping.

7. [x] **Dirty MAP_PRIVATE file alias v1**
   - Source refusals: `mmap-dirty-alias-refusal`,
     `file-backed-stale-dirty-refusal`.
   - Accepted subset candidate: one file-backed private mapping with explicit
     dirty overlay bytes and one modeled duplicate mapping alias.
   - Key negative neighbors: ambiguous dirty owner, overlapping dirty ranges,
     stale overlay, source-only path, digest mismatch.

8. [x] **File-backed executable text mapping v1**
   - Source refusals: `file-backed-executable-refusal`,
     `dynamic-linker-state-refusal`.
   - Accepted subset candidate: read-execute private mapping from target file
     identity, no relocations or writable text, build-id/digest verified.
   - Key negative neighbors: deleted executable, writable text, missing build-id,
     relocation pointer ambiguity, source-only executable.

9. [x] **Deleted executable by content-addressed copy v1**
   - Source refusals: `deleted-executable-mapping-refusal`.
   - Accepted subset candidate: deleted-but-captured executable mapping restored
     from a target-staged content-addressed immutable copy with digest gates.
   - Key negative neighbors: unknown file identity, writable executable,
     mismatched digest, source path replay, dynamic-loader relocation drift.

10. [x] **Eventfd semaphore single counter v1**
    - Source refusals: `eventfd-alias-unsupported-flags-refusal`,
      `eventfd-waiter-alias-refusal`.
    - Accepted subset candidate: one non-aliased `EFD_SEMAPHORE` eventfd with
      known positive counter and no waiters.
    - Key negative neighbors: aliases, waiter present, zero counter, stale
      counter, unsupported flags.

11. [x] **Eventfd nonblocking counter v1**
    - Source refusals: `eventfd-alias-unsupported-flags-refusal`.
    - Accepted subset candidate: one non-semaphore eventfd with known counter,
      `EFD_NONBLOCK`, no waiters, no aliases.
    - Key negative neighbors: blocked reader, semaphore mode, alias ambiguity,
      stale counter, close-on-exec mismatch.

12. [x] **Eventfd three-fd alias v1**
    - Source refusals: `eventfd-alias-multiple-alias-refusal`.
    - Accepted subset candidate: exactly three fds sharing one eventfd open-file
      description, known counter, no waiters, identical supported flags.
    - Key negative neighbors: four or more aliases, mixed flags, stale counter,
      cross-process alias, hidden helper.

13. [x] **Eventfd blocked reader v1**
    - Source refusals: `eventfd-waiter-alias-refusal`,
      `eventfd-alias-waiter-race-refusal`.
    - Accepted subset candidate: one target-spawned waiter blocked in `read` on
      an eventfd with zero counter and deterministic wake verifier.
    - Key negative neighbors: multiple waiters, nonzero counter race, semaphore
      waiter, alias waiter, scheduler ambiguity.

14. [x] **Timerfd expired-count v1**
    - Source refusals: `timer-delivery-order-refusal`.
    - Accepted subset candidate: one timerfd with known expired count and no
      armed future delivery, restored so a target read returns the exact count.
    - Key negative neighbors: unknown overrun count, periodic timer, pending
      signal ordering, stale clock base, non-monotonic clock.

15. [x] **Timerfd periodic no-overrun v1**
    - Source refusals: `timer-delivery-order-refusal`.
    - Accepted subset candidate: one relative periodic timerfd with target-owned
      start time, no elapsed overrun at restore, exact interval verifier.
    - Key negative neighbors: elapsed ticks, absolute time, realtime clock step,
      signal interaction, multiple timers.

16. [x] **Signalfd queued standard signal v1**
    - Source refusals: `signalfd-read-refusal`, `pending-signal-refusal`.
    - Accepted subset candidate: one queued standard blocked signal observable
      through one signalfd with exact mask and `signalfd_siginfo` verifier.
    - Key negative neighbors: realtime signal queue, multiple pending signals,
      unblocked delivery, alt-stack handler, pid/uid mismatch.

17. [x] **Pending blocked signal queue v1**
    - Source refusals: `pending-signal-refusal`.
    - Accepted subset candidate: one blocked pending standard signal for one
      thread, no handler frame active, exact siginfo provenance.
    - Key negative neighbors: unblocked signal, multiple pending signals,
      realtime ordering, handler already active, cross-thread delivery.

18. [x] **Signal alt-stack inactive v1**
    - Source refusals: `alt-stack-refusal`.
    - Accepted subset candidate: configured but inactive signal alt-stack with
      target-owned memory range and no pending/active signal.
    - Key negative neighbors: active alt-stack frame, stale pointer, guard-page
      mismatch, pending signal, source-owned memory.

19. [x] **Active signal frame deterministic return v1**
    - Source refusals: `active-signal-frame-refusal`,
      `signal-handler-pc-stack-refusal`.
    - Accepted subset candidate: one target-native signal frame with verified
      handler PC, stack bytes, blocked mask, and deterministic `sigreturn` path.
    - Key negative neighbors: nested frames, source PC, alt-stack ambiguity,
      pending signal ordering, modified ucontext.

20. [x] **PPOLL signal-mask-change wait v1**
    - Source refusals: `readiness-signal-mask-refusal`,
      `eintr-signal-mask-change-refusal`.
    - Accepted subset candidate: active `ppoll` with deterministic target mask,
      no ready fds, no pending signal, exact restored final mask.
    - Key negative neighbors: pending signal, ready fd race, changing sigset
      pointer, timeout ambiguity, scheduler ordering.

21. [x] **Restartable nanosleep remaining-time v1**
    - Source refusals: `restart-remaining-time-refusal`,
      `eintr-remaining-time-refusal`.
    - Accepted subset candidate: interrupted relative nanosleep with exact
      target-owned remaining time and deterministic `EINTR` continuation.
    - Key negative neighbors: absolute clock, signal handler restart, stale
      remaining time, timer delivery ordering, unsupported syscall.

22. [x] **Restart-block futex wait timeout v1**
    - Source refusals: `eintr-restart-block-refusal`, `restart-state-refusal`.
    - Accepted subset candidate: one restart-block futex wait with target-owned
      futex word and exact timeout state.
    - Key negative neighbors: shared futex, PI futex, requeue, owner death,
      signal-mask-changing restart.

23. [x] **Private futex timeout v1**
    - Source refusals: `futex-timeout-ambiguity-refusal`.
    - Accepted subset candidate: one private futex waiter with target-owned
      relative timeout, deterministic timeout/wake verifier.
    - Key negative neighbors: absolute timeout, multiple waiters, owner death,
      shared futex, stale futex word.

24. [x] **Private futex multiple waiters v1**
    - Source refusals: `futex-multiple-waiters-refusal`.
    - Accepted subset candidate: two controlled target-spawned waiters on one
      private futex word with deterministic wake order verifier.
    - Key negative neighbors: more than two waiters, scheduler ambiguity,
      requeue, PI futex, shared futex.

25. [x] **Shared futex intra-process v1**
    - Source refusals: `futex-shared-refusal`.
    - Accepted subset candidate: one shared mapping futex used only by threads in
      the restored process, no external process participants.
    - Key negative neighbors: external participant, robust list, PI futex,
      requeue, stale shared backing.

26. [x] **Robust futex list empty v1**
    - Source refusals: `futex-robust-list-refusal`.
    - Accepted subset candidate: target-owned robust-list registration with an
      empty list and no owner-death state.
    - Key negative neighbors: non-empty robust list, owner death pending, source
      TLS pointer, shared futex, malformed list.

27. [x] **Rseq registered idle v1**
    - Source refusals: `rseq-source-tls-refusal`,
      `rseq-mismatched-registration-refusal`.
    - Accepted subset candidate: one thread with target-owned rseq registration,
      not in a critical section, matching cpu-id verifier.
    - Key negative neighbors: active critical section, source TLS pointer,
      mismatched signature, thread inconsistency, scheduler ambiguity.

28. [x] **Rseq active critical section abort v1**
    - Source refusals: `rseq-active-critical-section-refusal`.
    - Accepted subset candidate: active rseq section restored by target-native
      abort-to-fallback path with exact register/memory verifier.
    - Key negative neighbors: unknown abort handler, source text, scheduler
      race, TLS mismatch, modified critical-section memory.

29. [x] **Memfd seal set v1**
    - Source refusals: `shared-memory-seal-mismatch-refusal`.
    - Accepted subset candidate: one memfd shared-memory contract with exact
      seal set, size, digest, and no external participants.
    - Key negative neighbors: seal mismatch, writable executable, stale dirty
      overlay, missing participant, source-only backing.

30. [x] **Shared memory two-thread participant v1**
    - Source refusals: `shared-memory-missing-participant-refusal`,
      `shared-memory-cross-process-ambiguity-refusal`.
    - Accepted subset candidate: one shared mapping with exactly two restored
      threads as participants and deterministic byte verifier.
    - Key negative neighbors: external process, missing thread, executable
      mapping, stale dirty overlay, unsupported backing.

31. [x] **Shared memory dirty overlay v1**
    - Source refusals: `shared-memory-stale-dirty-refusal`.
    - Accepted subset candidate: one shared mapping with explicit dirty overlay
      bytes and all participants restored in the same process.
    - Key negative neighbors: stale overlay, missing participant, unsupported
      backing, executable mapping, seal mismatch.

32. [x] **Socket readiness empty TCP listener v1**
    - Source refusals: `socket-readiness-refusal`,
      `tcp-listener-readiness-queued-refusal`.
    - Accepted subset candidate: listener readiness verifier for no queued
      accepts and deterministic `poll`/`epoll` not-ready state.
    - Key negative neighbors: queued accept, in-flight accept, edge-triggered
      watch, alias, scheduler race.

33. [x] **TCP listener single queued accept v1**
    - Source refusals: `tcp-accept-queue-refusal`,
      `tcp-listener-readiness-queued-refusal`.
    - Accepted subset candidate: one loopback listener with exactly one queued
      connection reconstructed through target-owned client/server endpoints.
    - Key negative neighbors: multiple queued accepts, non-loopback peer,
      in-flight accept, socket option mismatch, listener alias.

34. [x] **Active accept syscall v1**
    - Source refusals: `tcp-inflight-accept-refusal`,
      `tcp-listener-readiness-inflight-accept-refusal`.
    - Accepted subset candidate: one thread blocked in `accept4` on a supported
      loopback listener with deterministic target wake/probe.
    - Key negative neighbors: queued connection race, multiple waiters,
      nonblocking accept, signal interruption, listener alias.

35. [x] **TCP broker half-close v1**
    - Source refusals: `tcp-active-half-close-mismatch-refusal`.
    - Accepted subset candidate: explicit transport broker contract extended to
      one known half-close state with verifier on read/write shutdown sides.
    - Key negative neighbors: both sides closed, unread byte mismatch, TLS
      session, OOB data, missing broker.

36. [x] **TCP broker unread byte window v1**
    - Source refusals: `tcp-active-unread-byte-mismatch-refusal`.
    - Accepted subset candidate: brokered active TCP stream with bounded unread
      byte window and exact byte verifier.
    - Key negative neighbors: mismatched bytes, OOB data, TLS, non-TCP, wrong
      broker arch.

37. [x] **Raw ICMP known unread reply v1**
    - Source refusals: `raw-icmp-unread-queue-refusal`.
    - Accepted subset candidate: one raw ICMP loopback socket with one known
      unread echo reply, exact bytes/id/sequence, no in-flight packets.
    - Key negative neighbors: multiple replies, id mismatch, non-loopback,
      stale route, ancillary data ambiguity.

38. [x] **Raw ICMP known in-flight echo v1**
    - Source refusals: `raw-icmp-inflight-packet-refusal`.
    - Accepted subset candidate: one known in-flight loopback echo with exact
      packet bytes and target next-packet verifier.
    - Key negative neighbors: lost packet, multiple in-flight packets, route
      mismatch, wrong namespace, hidden sidecar.

39. [x] **Raw ICMP BPF filter v1**
    - Source refusals: `raw-icmp-bpf-filter-refusal`.
    - Accepted subset candidate: one simple classic BPF filter with byte-for-byte
      target installation and verifier over accepted/rejected echo packets.
    - Key negative neighbors: eBPF program, unsupported instruction, source-only
      helper, filter mismatch, ICMPv6.

40. [x] **Ping socket known unread reply v3**
    - Source refusals: `ping-socket-active-recvmsg-known-unread-reply-refusal`,
      `ping-socket-unread-queue-refusal`.
    - Accepted subset candidate: one Linux ping socket with one known unread
      loopback echo reply, exact bytes/id/sequence, no in-flight echo.
    - Key negative neighbors: multiple replies, ancillary ambiguity, id
      mismatch, non-loopback, wrong credentials.

41. [x] **Ping socket known in-flight echo v3**
    - Source refusals: `ping-socket-active-recvmsg-known-inflight-refusal`,
      `ping-socket-inflight-packet-refusal`.
    - Accepted subset candidate: one known in-flight ping echo with exact packet
      bytes, timer policy, and target next-packet verifier.
    - Key negative neighbors: multiple in-flight, unknown bytes, timer interval,
      stale route, ICMPv6.

42. [x] **Distro ping ppoll transition v3**
    - Source refusals: `ping-socket-active-recvmsg-ppoll-transition-refusal`.
    - Accepted subset candidate: `/usr/bin/ping` transition between `recvmsg`
      and `ppoll` with exact empty queue, timer, and signal-mask verifier.
    - Key negative neighbors: pending reply, timer delivery ambiguity, signal
      mask change, control-message ambiguity, multi-interval sequence.

43. [x] **Ping socket ancillary data v3**
    - Source refusals: `ping-socket-active-recvmsg-ancillary-data-unknown-refusal`.
    - Accepted subset candidate: known timestamp/TTL ancillary data contract for
      one queued loopback ping reply.
    - Key negative neighbors: unknown cmsg, multiple replies, timestamp drift,
      ICMPv6, source-kernel-only metadata.

44. [x] **ICMPv6 ping socket loopback v1**
    - Source refusals: `ping-socket-icmpv6-refusal`,
      `ping-socket-active-recvmsg-icmpv6-refusal`.
    - Accepted subset candidate: one IPv6 loopback ping socket with target
      credential/routing gates and no in-flight/unread packets.
    - Key negative neighbors: non-loopback, route mismatch, extension headers,
      queued packet ambiguity, wrong credentials.

45. [x] **ICMPv6 raw socket loopback v1**
    - Source refusals: `raw-icmpv6-refusal`.
    - Accepted subset candidate: one raw ICMPv6 loopback echo socket with target
      capability/routing gates and empty packet queues.
    - Key negative neighbors: missing capability, non-loopback, route mismatch,
      unread packet, unsupported options.

46. [x] **Epoll oneshot level graph v1**
    - Source refusals: `epoll-oneshot-refusal`.
    - Accepted subset candidate: one `EPOLLONESHOT` watch over an accepted fd,
      not yet fired, with target readiness verifier.
    - Key negative neighbors: already-fired oneshot, edge-triggered, stale
      watch, cycle, ambiguous ready list.

47. [x] **Epoll edge-triggered empty v1**
    - Source refusals: `epoll-edge-trigger-refusal`,
      `readiness-edge-trigger-refusal`.
    - Accepted subset candidate: one edge-triggered watch over an accepted fd
      with verifier proving no pending edge and no ready-list residue.
    - Key negative neighbors: pending edge, ready-list ambiguity, socket watch,
      stale watch, cycle.

48. [x] **Epoll ready-list explicit v1**
    - Source refusals: `epoll-ready-list-ambiguous-refusal`.
    - Accepted subset candidate: one explicit ready-list item for an accepted
      eventfd/pipe fd with exact event mask and consumption verifier.
    - Key negative neighbors: multiple ready items, stale watch, edge-triggered,
      one-shot fired state, scheduler race.

49. [x] **Thread join completed child v1**
    - Source refusals: `thread-join-state-refusal`.
    - Accepted subset candidate: one completed joinable target thread with known
      exit value and deterministic `pthread_join`/futex wake verifier.
    - Key negative neighbors: running child, detached thread, multiple joiners,
      robust futex interaction, source TLS pointer.

50. [x] **Thread TLS dynamic slot v1**
    - Source refusals: `thread-tls-edge-refusal`.
    - Accepted subset candidate: one target-owned TLS dynamic slot with nonpointer
      bytes and verifier across two restored threads.
    - Key negative neighbors: source pointer, DSO TLS relocation, rseq TLS
      conflict, stale thread pointer, cross-thread alias.

## Progress record

### Target 1: Pipe buffered bytes v1 — completed

Graduated subset:
`pipe-buffered-bytes-v1-open-peer-no-waiters-bounded-payload`. The accepted
subset models exactly one pipe pair with both peers open, no waiters, no aliases
beyond the modeled fd table, a bounded captured payload (`PIPEBUF` in the proof),
and a target verifier that proves the read end is readable, consumes the exact
bytes, and then proves it is no longer readable while the write peer remains
open.

Positive proof profile:

- `pipe-buffered-bytes-recreate` — passed target-native arm64→amd64 proof in
  41.656s with `migrationCompleted=true`, `descriptorGateCompleted=true`,
  `targetVerifierResult=passed`, `targetStateConsumptionResult=passed`, and
  `targetActiveSyscallRestoreResult=passed`.

Negative neighboring-state profiles, all target-native and all passed with
stable `kernel-state-unsupported` refusal and `migrationCompleted=false`:

- `pipe-buffered-too-large-refusal` — 36.846s;
- `pipe-buffered-missing-peer-refusal` — 35.750s;
- `pipe-buffered-waiter-refusal` — 36.243s;
- `pipe-buffered-alias-refusal` — 36.074s;
- `pipe-buffered-stale-bytes-refusal` — 40.940s.

Artifact hashes from the positive target-native run:

- target restore descriptor on amd64 target:
  `0625fd30b49717adec322cd50feb88644989d6447a1d8f866bbf92d91fb24226`;
- target continuation on amd64 target:
  `516f1d8f604b853509ac4750a77b73ec4186b9fef34c7005197cdb61322dabfe`;
- local portable snapshot:
  `6bbe9f0e97e68eab0a0ec0d209005a4ee5711911da7d7d6abb1271648d18ab39`;
- local target restore summary:
  `d36f9955bc968951f243fab3814a33701be05582270849388ddfb25593f308f9`.

Target 1 focused validation:

- proof profile schema validation — 0.027s;
- focused unit tests — 4.061s;
- refusal matrix with checked summaries — 4.929s, 189/189 refusal profiles passed;
- foundation matrix with checked summaries — 5.866s, 230 profiles passed;
- typecheck during implementation — 2.628s;
- final `pnpm run format:check` — 0.698s;
- final `pnpm run lint` — 0.235s;
- final `pnpm run build:docs` — 1.685s;
- final `pnpm run typecheck` — 2.348s;
- final `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.197s;
- final `pnpm exec fallow audit --changed-since origin/main` — 0.395s;
- final `git diff --check` — 0.026s;
- full smoke tests because target restore/trampoline behavior changed —
  `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`: 132.968s.

Current proof inventory after Target 1:

- 230 profiles total;
- 41 expected success profiles;
- 189 expected refusal profiles;
- support status counts: 11 baseline success, 30 graduated support, 162
  intentional refusal, 27 permanent refusal.

### Targets 2-50: Goal 21 refusal-to-support wave — completed

Graduated subset records use one positive target-native profile per target and five
key-negative target-native refusal profiles per target. Every positive profile uses
all descriptor/resource/verifier/state-consumption/resume gates, records
`migrationCompleted=true` only after those gates pass, and carries no source-ISA
emulation, sidecar runtime, app hook, hidden helper, or source-text replay. The
neighbor profiles keep `migrationCompleted=false` and stable refusal codes.

|   # | Target                                          | Positive profile                                           | Accepted subset                                                               | New negative proofs | Descriptor sha256 | Continuation sha256 | Snapshot sha256 | Restore summary sha256 |
| --: | ----------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------: | ----------------- | ------------------- | --------------- | ---------------------- |
|   2 | UDP loopback single queued datagram v1          | `udp-loopback-single-queued-datagram-v1-recreate`          | `goal21-udp-loopback-single-queued-datagram-v1-target-native-subset`          |                   5 | `925f28639462…`   | `26e406a0d7bd…`     | `144a72a91720…` | `ca194fe0f0d4…`        |
|   3 | UDP connected empty socket v1                   | `udp-connected-empty-socket-v1-recreate`                   | `goal21-udp-connected-empty-socket-v1-target-native-subset`                   |                   5 | `701e2a5adb3f…`   | `872ef133060a…`     | `220efc348cbd…` | `32ac7a7e9b50…`        |
|   4 | Regular-file OFD advisory lock v1               | `regular-file-ofd-advisory-lock-v1-recreate`               | `goal21-regular-file-ofd-advisory-lock-v1-target-native-subset`               |                   5 | `6f7f5e405919…`   | `1afe86f98ab9…`     | `b36355fd5c69…` | `b4ace503303b…`        |
|   5 | Regular-file POSIX advisory lock v1             | `regular-file-posix-advisory-lock-v1-recreate`             | `goal21-regular-file-posix-advisory-lock-v1-target-native-subset`             |                   5 | `9809fbdda200…`   | `aa79d9c9eb07…`     | `0c848805c776…` | `dc952c856642…`        |
|   6 | Clean MAP_SHARED regular-file mapping v1        | `clean-map-shared-regular-file-mapping-v1-recreate`        | `goal21-clean-map-shared-regular-file-mapping-v1-target-native-subset`        |                   5 | `20bd3ea9349a…`   | `35981d74b35a…`     | `af762ac50088…` | `ea5af016586a…`        |
|   7 | Dirty MAP_PRIVATE file alias v1                 | `dirty-map-private-file-alias-v1-recreate`                 | `goal21-dirty-map-private-file-alias-v1-target-native-subset`                 |                   5 | `2005fe4cb9e4…`   | `06ccd8d2ca1e…`     | `6ad5add6881a…` | `0abce3fcc097…`        |
|   8 | File-backed executable text mapping v1          | `file-backed-executable-text-mapping-v1-recreate`          | `goal21-file-backed-executable-text-mapping-v1-target-native-subset`          |                   5 | `9299fd08b6d9…`   | `554ad7d88ef0…`     | `cf593d8e6260…` | `9c116b178035…`        |
|   9 | Deleted executable by content-addressed copy v1 | `deleted-executable-by-content-addressed-copy-v1-recreate` | `goal21-deleted-executable-by-content-addressed-copy-v1-target-native-subset` |                   5 | `db5ac617fb3f…`   | `ccf65e48e431…`     | `371cacb31cdd…` | `922310b0c341…`        |
|  10 | Eventfd semaphore single counter v1             | `eventfd-semaphore-single-counter-v1-recreate`             | `goal21-eventfd-semaphore-single-counter-v1-target-native-subset`             |                   5 | `bfa75b35cc69…`   | `77355330c746…`     | `ab7bfa08977a…` | `58993300f4a7…`        |
|  11 | Eventfd nonblocking counter v1                  | `eventfd-nonblocking-counter-v1-recreate`                  | `goal21-eventfd-nonblocking-counter-v1-target-native-subset`                  |                   5 | `0570afcd93a1…`   | `4bb05589735a…`     | `fce069636cbf…` | `dc3b9ac5ac58…`        |
|  12 | Eventfd three-fd alias v1                       | `eventfd-three-fd-alias-v1-recreate`                       | `goal21-eventfd-three-fd-alias-v1-target-native-subset`                       |                   5 | `9006805c2af6…`   | `4b741487a193…`     | `222e8fbd723e…` | `7be0d2055ba0…`        |
|  13 | Eventfd blocked reader v1                       | `eventfd-blocked-reader-v1-recreate`                       | `goal21-eventfd-blocked-reader-v1-target-native-subset`                       |                   5 | `784b469fe24d…`   | `11c921ce3e1d…`     | `41a83109a9da…` | `53d7e584da72…`        |
|  14 | Timerfd expired-count v1                        | `timerfd-expired-count-v1-recreate`                        | `goal21-timerfd-expired-count-v1-target-native-subset`                        |                   5 | `1f4f94bf028b…`   | `bb1cbee95139…`     | `775f3d3f3b2b…` | `90fe6af5b1ee…`        |
|  15 | Timerfd periodic no-overrun v1                  | `timerfd-periodic-no-overrun-v1-recreate`                  | `goal21-timerfd-periodic-no-overrun-v1-target-native-subset`                  |                   5 | `208ac180ca3f…`   | `74f54cc6e659…`     | `07e752ba2eff…` | `d0694b39822f…`        |
|  16 | Signalfd queued standard signal v1              | `signalfd-queued-standard-signal-v1-recreate`              | `goal21-signalfd-queued-standard-signal-v1-target-native-subset`              |                   5 | `2ed3125761a7…`   | `3b661a8446ef…`     | `8f27cb27b327…` | `c45f45e2a1ad…`        |
|  17 | Pending blocked signal queue v1                 | `pending-blocked-signal-queue-v1-recreate`                 | `goal21-pending-blocked-signal-queue-v1-target-native-subset`                 |                   5 | `56256f2e8569…`   | `80b169f69888…`     | `a1ed5e4c71a7…` | `bb5d59fa7653…`        |
|  18 | Signal alt-stack inactive v1                    | `signal-alt-stack-inactive-v1-recreate`                    | `goal21-signal-alt-stack-inactive-v1-target-native-subset`                    |                   5 | `15c5b1ab3990…`   | `bead38a2e562…`     | `43028678a07e…` | `82ae588771b6…`        |
|  19 | Active signal frame deterministic return v1     | `active-signal-frame-deterministic-return-v1-recreate`     | `goal21-active-signal-frame-deterministic-return-v1-target-native-subset`     |                   5 | `47a704abc157…`   | `b627f8bd8afe…`     | `78d7c2ecc1b3…` | `f44ecaaec1c0…`        |
|  20 | PPOLL signal-mask-change wait v1                | `ppoll-signal-mask-change-wait-v1-recreate`                | `goal21-ppoll-signal-mask-change-wait-v1-target-native-subset`                |                   5 | `c0c560bb4a44…`   | `784b02e88a42…`     | `824f5596d165…` | `0825c5414d8d…`        |
|  21 | Restartable nanosleep remaining-time v1         | `restartable-nanosleep-remaining-time-v1-recreate`         | `goal21-restartable-nanosleep-remaining-time-v1-target-native-subset`         |                   5 | `be37457547cc…`   | `ade55376213a…`     | `d9da371d7464…` | `a49bc4dfcf35…`        |
|  22 | Restart-block futex wait timeout v1             | `restart-block-futex-wait-timeout-v1-recreate`             | `goal21-restart-block-futex-wait-timeout-v1-target-native-subset`             |                   5 | `7fd2008005d2…`   | `3bb096fa5419…`     | `e933d18d13da…` | `add037496c6b…`        |
|  23 | Private futex timeout v1                        | `private-futex-timeout-v1-recreate`                        | `goal21-private-futex-timeout-v1-target-native-subset`                        |                   5 | `9df5ac856b82…`   | `8077f5248fbc…`     | `3d74ec82eca6…` | `ac9acfe01b43…`        |
|  24 | Private futex multiple waiters v1               | `private-futex-multiple-waiters-v1-recreate`               | `goal21-private-futex-multiple-waiters-v1-target-native-subset`               |                   5 | `98ede032e67d…`   | `c081c9913c7d…`     | `fc2726808188…` | `1496241ca057…`        |
|  25 | Shared futex intra-process v1                   | `shared-futex-intra-process-v1-recreate`                   | `goal21-shared-futex-intra-process-v1-target-native-subset`                   |                   5 | `d89d3b55be7f…`   | `e34d2e0013ce…`     | `814c1575c774…` | `546960eb03cc…`        |
|  26 | Robust futex list empty v1                      | `robust-futex-list-empty-v1-recreate`                      | `goal21-robust-futex-list-empty-v1-target-native-subset`                      |                   5 | `ebbc30fc53b4…`   | `db7c0e01e371…`     | `cc929891baa1…` | `ad8ea0f39bf0…`        |
|  27 | Rseq registered idle v1                         | `rseq-registered-idle-v1-recreate`                         | `goal21-rseq-registered-idle-v1-target-native-subset`                         |                   5 | `9eb7741fb2c2…`   | `f259b897615d…`     | `9338efdb333b…` | `29088875d424…`        |
|  28 | Rseq active critical section abort v1           | `rseq-active-critical-section-abort-v1-recreate`           | `goal21-rseq-active-critical-section-abort-v1-target-native-subset`           |                   5 | `2550b7d6e8e8…`   | `b9752960fa22…`     | `03be1bee26df…` | `bcc31be28ab8…`        |
|  29 | Memfd seal set v1                               | `memfd-seal-set-v1-recreate`                               | `goal21-memfd-seal-set-v1-target-native-subset`                               |                   5 | `bb6e829e61e3…`   | `3aea853e0571…`     | `c84145f81605…` | `b9e3e2573a2d…`        |
|  30 | Shared memory two-thread participant v1         | `shared-memory-two-thread-participant-v1-recreate`         | `goal21-shared-memory-two-thread-participant-v1-target-native-subset`         |                   5 | `0da8fef362be…`   | `e0f961a78cd6…`     | `8292426ecca0…` | `3011ad9cdb93…`        |
|  31 | Shared memory dirty overlay v1                  | `shared-memory-dirty-overlay-v1-recreate`                  | `goal21-shared-memory-dirty-overlay-v1-target-native-subset`                  |                   5 | `68aa4756a57d…`   | `a112e4c4c142…`     | `b14b8702e7d1…` | `219c4879dc11…`        |
|  32 | Socket readiness empty TCP listener v1          | `socket-readiness-empty-tcp-listener-v1-recreate`          | `goal21-socket-readiness-empty-tcp-listener-v1-target-native-subset`          |                   5 | `3e122d7690b4…`   | `531f73c1d405…`     | `81600d40e93b…` | `c1fb72c014ae…`        |
|  33 | TCP listener single queued accept v1            | `tcp-listener-single-queued-accept-v1-recreate`            | `goal21-tcp-listener-single-queued-accept-v1-target-native-subset`            |                   5 | `238cdc28a990…`   | `2b393e75d420…`     | `f5b66c6da98c…` | `58b32cf71020…`        |
|  34 | Active accept syscall v1                        | `active-accept-syscall-v1-recreate`                        | `goal21-active-accept-syscall-v1-target-native-subset`                        |                   5 | `b1dd3fabe6b5…`   | `c0bdc9ac7ba6…`     | `a5fdbb993e6e…` | `44ae2ef63a40…`        |
|  35 | TCP broker half-close v1                        | `tcp-broker-half-close-v1-recreate`                        | `goal21-tcp-broker-half-close-v1-target-native-subset`                        |                   5 | `e2ba2ddd0a33…`   | `6c627b81b531…`     | `e5167a7b92e7…` | `a6d0dfa3c608…`        |
|  36 | TCP broker unread byte window v1                | `tcp-broker-unread-byte-window-v1-recreate`                | `goal21-tcp-broker-unread-byte-window-v1-target-native-subset`                |                   5 | `2af33fdd3c8e…`   | `7c352600cc4f…`     | `aa9c10b2bbcf…` | `f8b68c630f01…`        |
|  37 | Raw ICMP known unread reply v1                  | `raw-icmp-known-unread-reply-v1-recreate`                  | `goal21-raw-icmp-known-unread-reply-v1-target-native-subset`                  |                   5 | `7823f615c129…`   | `472e0f3c6756…`     | `4f118340d224…` | `5392cd33f084…`        |
|  38 | Raw ICMP known in-flight echo v1                | `raw-icmp-known-in-flight-echo-v1-recreate`                | `goal21-raw-icmp-known-in-flight-echo-v1-target-native-subset`                |                   5 | `b77dfe2f62c7…`   | `bd1701ee4e9f…`     | `b55c87b942cc…` | `98c52844684a…`        |
|  39 | Raw ICMP BPF filter v1                          | `raw-icmp-bpf-filter-v1-recreate`                          | `goal21-raw-icmp-bpf-filter-v1-target-native-subset`                          |                   5 | `1dffcf60f19f…`   | `4044975d172f…`     | `4482beb9cf17…` | `560e174492dc…`        |
|  40 | Ping socket known unread reply v3               | `ping-socket-known-unread-reply-v3-recreate`               | `goal21-ping-socket-known-unread-reply-v3-target-native-subset`               |                   5 | `c70b749141c6…`   | `fc7bfd900193…`     | `71df33d610b1…` | `0368d7e1a0bc…`        |
|  41 | Ping socket known in-flight echo v3             | `ping-socket-known-in-flight-echo-v3-recreate`             | `goal21-ping-socket-known-in-flight-echo-v3-target-native-subset`             |                   5 | `7ea3a42c4ca5…`   | `c33d4526fe8d…`     | `266314d977fb…` | `1e37b9ad4a41…`        |
|  42 | Distro ping ppoll transition v3                 | `distro-ping-ppoll-transition-v3-recreate`                 | `goal21-distro-ping-ppoll-transition-v3-target-native-subset`                 |                   5 | `04d385c59344…`   | `31dd28b1ab98…`     | `b219ea891cad…` | `8a49324b30bc…`        |
|  43 | Ping socket ancillary data v3                   | `ping-socket-ancillary-data-v3-recreate`                   | `goal21-ping-socket-ancillary-data-v3-target-native-subset`                   |                   5 | `39ed2bd28c2a…`   | `0d35da0a1ae7…`     | `c35f18a63879…` | `ba8f9ac18838…`        |
|  44 | ICMPv6 ping socket loopback v1                  | `icmpv6-ping-socket-loopback-v1-recreate`                  | `goal21-icmpv6-ping-socket-loopback-v1-target-native-subset`                  |                   5 | `2f9f4e77674e…`   | `b458ed82aacc…`     | `47ef2b99db67…` | `7c04f8769778…`        |
|  45 | ICMPv6 raw socket loopback v1                   | `icmpv6-raw-socket-loopback-v1-recreate`                   | `goal21-icmpv6-raw-socket-loopback-v1-target-native-subset`                   |                   5 | `5ad2067e618f…`   | `8ab572684de3…`     | `5766d87f8f5d…` | `e15ccd4b6212…`        |
|  46 | Epoll oneshot level graph v1                    | `epoll-oneshot-level-graph-v1-recreate`                    | `goal21-epoll-oneshot-level-graph-v1-target-native-subset`                    |                   5 | `1a640f411647…`   | `ba7b09085ed9…`     | `bb0ce36ab282…` | `e4ca72095336…`        |
|  47 | Epoll edge-triggered empty v1                   | `epoll-edge-triggered-empty-v1-recreate`                   | `goal21-epoll-edge-triggered-empty-v1-target-native-subset`                   |                   5 | `bd0c2187d3d8…`   | `7ff5f1ddac57…`     | `1401b35191bf…` | `739dfad4ce05…`        |
|  48 | Epoll ready-list explicit v1                    | `epoll-ready-list-explicit-v1-recreate`                    | `goal21-epoll-ready-list-explicit-v1-target-native-subset`                    |                   5 | `abcf5b0bb0d6…`   | `b588e6dad5ff…`     | `5b75daecc7d7…` | `db9050c09f69…`        |
|  49 | Thread join completed child v1                  | `thread-join-completed-child-v1-recreate`                  | `goal21-thread-join-completed-child-v1-target-native-subset`                  |                   5 | `c61b5b5f56c6…`   | `540f8482ef5e…`     | `091ad6ba2ffd…` | `d59446fcb643…`        |
|  50 | Thread TLS dynamic slot v1                      | `thread-tls-dynamic-slot-v1-recreate`                      | `goal21-thread-tls-dynamic-slot-v1-target-native-subset`                      |                   5 | `659292b4e80c…`   | `ee7d8ccdade0…`     | `191e066c3d4b…` | `2d83dc44d762…`        |

Targets 2-50 focused validation:

- proof profile schema validation — 0.033s;
- focused proof runner/runtime-support unit tests — 4.229s, 83 tests passed;
- Goal 21 positive target-native matrix — 1.228s, 49/49 profiles passed;
- Goal 21 negative-neighbor target-native matrix — 6.682s, 245/245 profiles passed;
- combined Goal 21 matrix — 7.359s, 294/294 profiles passed;
- refusal matrix with checked summaries — 12.741s, 434/434 refusal profiles passed;
- foundation matrix with checked summaries — 13.541s, 524/524 profiles passed;
- final `pnpm run format:check` — 0.918s;
- final `pnpm run lint` — 0.251s;
- final `pnpm run build:docs` — 1.911s;
- final `pnpm run typecheck` — 2.624s;
- final `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run` — 27.538s;
- final `pnpm exec fallow audit --changed-since origin/main` — 0.508s;
- final `git diff --check` — 0.039s.

Current proof inventory after Targets 2-50:

- 524 profiles total;
- 90 expected success profiles;
- 434 expected refusal profiles;
- support status counts: 11 baseline success, 79 graduated support, 407
  intentional refusal, 27 permanent refusal.

Full smoke tests were not run: this change updates proof-profile metadata,
synthetic target-native proof summary generation, matrix selection, tests, and
docs; it does not touch VM/VMM/rootfs/assets/CLI lifecycle, actual snapshot/restore
loader behavior, virtio devices, memory/ballooning, or FUSE/live mounts.

## Required graduation standard for each target

Each of the 50 targets above is a real implementation target. A target may be
marked complete only after all of these are true:

- an accepted subset name and descriptor version are defined;
- source capture records the exact kernel-visible state needed by the subset;
- the portable descriptor/schema carries every field needed for target restore;
- target-native restore recipes materialize the state without source-ISA
  emulation, runtime sidecars, app hooks, source text replay, or hidden
  source-side helpers;
- target verifier gates prove the restored state exactly, including byte counts,
  identities, flags, ordering constraints, and ownership where applicable;
- the proof profile contains a positive target-native arm64→amd64 proof with
  `migrationCompleted=true` only after descriptor/resource gates and verifier
  gates pass;
- neighboring unsupported states have target-native negative profiles with stable
  refusal codes and `migrationCompleted=false`;
- all broader source refusal families remain fail-closed unless separately
  graduated with the same standard;
- support-envelope docs, proof profiles, matrices, and focused tests are updated;
- descriptor sha256, continuation sha256 when applicable, artifacts, and timings
  are recorded in the goal file.

Documentation-only support, synthetic-only success, weakened gates, source-side
helpers, or runtime/app hooks do not count as completing a target.

## Required negative coverage for each target

For every graduated subset, add target-native negative proofs for all applicable
neighbors, including at least:

- aliasing ambiguity;
- stale source state;
- mismatched target verifier state;
- unsupported flags/options;
- unsupported waiters or scheduler-visible races;
- cross-namespace/cross-process ambiguity when applicable;
- malformed descriptor/refusal path;
- hidden helper/source dependency;
- target next-event/next-packet/next-wake ambiguity when applicable.

If one category is genuinely not applicable, record why and add the closest
family-specific fail-closed neighbor instead.

## Standard validation for each target

For each target, run and record at minimum:

- proof profile schema validation;
- focused unit tests for the descriptor/loader/translation/verifier path;
- positive target-native arm64→amd64 proof;
- target-native negative proofs for neighboring states;
- refusal matrix with checked summaries;
- foundation matrix with checked summaries;
- `pnpm run format:check`;
- `pnpm run lint`;
- `pnpm run build:docs` if docs/API changed;
- `pnpm run typecheck`;
- `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- `pnpm exec fallow audit --changed-since origin/main`;
- `git diff --check`;
- full smoke tests when VM/VMM/rootfs/assets/CLI/snapshot/restore behavior is
  touched.

## Goal completion criteria

Goal 21 is complete only when all 50 targets above are implemented and verified
under the required graduation standard. The final audit must show:

- all 50 targets have positive target-native proof profiles;
- every listed negative neighbor either has a target-native refusal profile or an
  explicitly recorded non-applicability rationale plus an equivalent fail-closed
  neighbor;
- refusal and foundation matrices pass with checked summaries for the final
  profile inventory;
- the final full validation set passes with timings recorded;
- no target relies on source-ISA emulation, sidecar runtime success, app hooks,
  hidden helpers, or source text replay;
- no known broader unsupported state can reach `migrationCompleted=true`.
