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

1. **Pipe buffered bytes v1**
   - Source refusals: `pipe-buffered-data-waiter-refusal`.
   - Accepted subset candidate: one pipe pair with bounded buffered payload,
     both peers open, no waiters, no aliases beyond the modeled fd table.
   - Key negative neighbors: too much buffered data, missing peer, waiter
     present, alias ambiguity, stale byte snapshot.

2. **UDP loopback single queued datagram v1**
   - Source refusals: `udp-datagram-queue-refusal`,
     `socket-receive-queue-general-refusal`, `target-next-packet-unverified-refusal`.
   - Accepted subset candidate: one loopback UDP socket with exactly one queued
     datagram, exact source/destination tuple, exact bytes, no aliases, no
     namespace/routing ambiguity.
   - Key negative neighbors: multiple datagrams, non-loopback route, stale route,
     unknown packet bytes, socket alias.

3. **UDP connected empty socket v1**
   - Source refusals: `namespace-routing-provenance-refusal`,
     `socket-send-queue-general-refusal`.
   - Accepted subset candidate: one connected loopback UDP socket with no queued
     receive/send data and target-verified route identity.
   - Key negative neighbors: pending datagram, non-loopback, namespace mismatch,
     route mismatch, unsupported socket option.

4. **Regular-file OFD advisory lock v1**
   - Source refusals: `file-lock-refusal`, `fd-alias-lock-refusal`.
   - Accepted subset candidate: one OFD write lock on a reopened regular file,
     target-owned lock identity, no competing lockers, no leases.
   - Key negative neighbors: POSIX owner lock, lock conflict, stale inode digest,
     duplicated unknown OFD, mandatory lock.

5. **Regular-file POSIX advisory lock v1**
   - Source refusals: `file-lock-refusal`.
   - Accepted subset candidate: one process-owned advisory byte-range lock on a
     target-identified regular file with deterministic owner handoff.
   - Key negative neighbors: cross-process owner ambiguity, lock conflict,
     inherited lock through fork, lease interaction, stale file identity.

6. **Clean MAP_SHARED regular-file mapping v1**
   - Source refusals: `shared-mapping-refusal`, `file-backed-shared-refusal`.
   - Accepted subset candidate: clean read-only MAP_SHARED mapping from a
     target-identified regular file with digest verification.
   - Key negative neighbors: dirty shared page, writable mapping, missing
     participant, stale digest, executable mapping.

7. **Dirty MAP_PRIVATE file alias v1**
   - Source refusals: `mmap-dirty-alias-refusal`,
     `file-backed-stale-dirty-refusal`.
   - Accepted subset candidate: one file-backed private mapping with explicit
     dirty overlay bytes and one modeled duplicate mapping alias.
   - Key negative neighbors: ambiguous dirty owner, overlapping dirty ranges,
     stale overlay, source-only path, digest mismatch.

8. **File-backed executable text mapping v1**
   - Source refusals: `file-backed-executable-refusal`,
     `dynamic-linker-state-refusal`.
   - Accepted subset candidate: read-execute private mapping from target file
     identity, no relocations or writable text, build-id/digest verified.
   - Key negative neighbors: deleted executable, writable text, missing build-id,
     relocation pointer ambiguity, source-only executable.

9. **Deleted executable by content-addressed copy v1**
   - Source refusals: `deleted-executable-mapping-refusal`.
   - Accepted subset candidate: deleted-but-captured executable mapping restored
     from a target-staged content-addressed immutable copy with digest gates.
   - Key negative neighbors: unknown file identity, writable executable,
     mismatched digest, source path replay, dynamic-loader relocation drift.

10. **Eventfd semaphore single counter v1**
    - Source refusals: `eventfd-alias-unsupported-flags-refusal`,
      `eventfd-waiter-alias-refusal`.
    - Accepted subset candidate: one non-aliased `EFD_SEMAPHORE` eventfd with
      known positive counter and no waiters.
    - Key negative neighbors: aliases, waiter present, zero counter, stale
      counter, unsupported flags.

11. **Eventfd nonblocking counter v1**
    - Source refusals: `eventfd-alias-unsupported-flags-refusal`.
    - Accepted subset candidate: one non-semaphore eventfd with known counter,
      `EFD_NONBLOCK`, no waiters, no aliases.
    - Key negative neighbors: blocked reader, semaphore mode, alias ambiguity,
      stale counter, close-on-exec mismatch.

12. **Eventfd three-fd alias v1**
    - Source refusals: `eventfd-alias-multiple-alias-refusal`.
    - Accepted subset candidate: exactly three fds sharing one eventfd open-file
      description, known counter, no waiters, identical supported flags.
    - Key negative neighbors: four or more aliases, mixed flags, stale counter,
      cross-process alias, hidden helper.

13. **Eventfd blocked reader v1**
    - Source refusals: `eventfd-waiter-alias-refusal`,
      `eventfd-alias-waiter-race-refusal`.
    - Accepted subset candidate: one target-spawned waiter blocked in `read` on
      an eventfd with zero counter and deterministic wake verifier.
    - Key negative neighbors: multiple waiters, nonzero counter race, semaphore
      waiter, alias waiter, scheduler ambiguity.

14. **Timerfd expired-count v1**
    - Source refusals: `timer-delivery-order-refusal`.
    - Accepted subset candidate: one timerfd with known expired count and no
      armed future delivery, restored so a target read returns the exact count.
    - Key negative neighbors: unknown overrun count, periodic timer, pending
      signal ordering, stale clock base, non-monotonic clock.

15. **Timerfd periodic no-overrun v1**
    - Source refusals: `timer-delivery-order-refusal`.
    - Accepted subset candidate: one relative periodic timerfd with target-owned
      start time, no elapsed overrun at restore, exact interval verifier.
    - Key negative neighbors: elapsed ticks, absolute time, realtime clock step,
      signal interaction, multiple timers.

16. **Signalfd queued standard signal v1**
    - Source refusals: `signalfd-read-refusal`, `pending-signal-refusal`.
    - Accepted subset candidate: one queued standard blocked signal observable
      through one signalfd with exact mask and `signalfd_siginfo` verifier.
    - Key negative neighbors: realtime signal queue, multiple pending signals,
      unblocked delivery, alt-stack handler, pid/uid mismatch.

17. **Pending blocked signal queue v1**
    - Source refusals: `pending-signal-refusal`.
    - Accepted subset candidate: one blocked pending standard signal for one
      thread, no handler frame active, exact siginfo provenance.
    - Key negative neighbors: unblocked signal, multiple pending signals,
      realtime ordering, handler already active, cross-thread delivery.

18. **Signal alt-stack inactive v1**
    - Source refusals: `alt-stack-refusal`.
    - Accepted subset candidate: configured but inactive signal alt-stack with
      target-owned memory range and no pending/active signal.
    - Key negative neighbors: active alt-stack frame, stale pointer, guard-page
      mismatch, pending signal, source-owned memory.

19. **Active signal frame deterministic return v1**
    - Source refusals: `active-signal-frame-refusal`,
      `signal-handler-pc-stack-refusal`.
    - Accepted subset candidate: one target-native signal frame with verified
      handler PC, stack bytes, blocked mask, and deterministic `sigreturn` path.
    - Key negative neighbors: nested frames, source PC, alt-stack ambiguity,
      pending signal ordering, modified ucontext.

20. **PPOLL signal-mask-change wait v1**
    - Source refusals: `readiness-signal-mask-refusal`,
      `eintr-signal-mask-change-refusal`.
    - Accepted subset candidate: active `ppoll` with deterministic target mask,
      no ready fds, no pending signal, exact restored final mask.
    - Key negative neighbors: pending signal, ready fd race, changing sigset
      pointer, timeout ambiguity, scheduler ordering.

21. **Restartable nanosleep remaining-time v1**
    - Source refusals: `restart-remaining-time-refusal`,
      `eintr-remaining-time-refusal`.
    - Accepted subset candidate: interrupted relative nanosleep with exact
      target-owned remaining time and deterministic `EINTR` continuation.
    - Key negative neighbors: absolute clock, signal handler restart, stale
      remaining time, timer delivery ordering, unsupported syscall.

22. **Restart-block futex wait timeout v1**
    - Source refusals: `eintr-restart-block-refusal`, `restart-state-refusal`.
    - Accepted subset candidate: one restart-block futex wait with target-owned
      futex word and exact timeout state.
    - Key negative neighbors: shared futex, PI futex, requeue, owner death,
      signal-mask-changing restart.

23. **Private futex timeout v1**
    - Source refusals: `futex-timeout-ambiguity-refusal`.
    - Accepted subset candidate: one private futex waiter with target-owned
      relative timeout, deterministic timeout/wake verifier.
    - Key negative neighbors: absolute timeout, multiple waiters, owner death,
      shared futex, stale futex word.

24. **Private futex multiple waiters v1**
    - Source refusals: `futex-multiple-waiters-refusal`.
    - Accepted subset candidate: two controlled target-spawned waiters on one
      private futex word with deterministic wake order verifier.
    - Key negative neighbors: more than two waiters, scheduler ambiguity,
      requeue, PI futex, shared futex.

25. **Shared futex intra-process v1**
    - Source refusals: `futex-shared-refusal`.
    - Accepted subset candidate: one shared mapping futex used only by threads in
      the restored process, no external process participants.
    - Key negative neighbors: external participant, robust list, PI futex,
      requeue, stale shared backing.

26. **Robust futex list empty v1**
    - Source refusals: `futex-robust-list-refusal`.
    - Accepted subset candidate: target-owned robust-list registration with an
      empty list and no owner-death state.
    - Key negative neighbors: non-empty robust list, owner death pending, source
      TLS pointer, shared futex, malformed list.

27. **Rseq registered idle v1**
    - Source refusals: `rseq-source-tls-refusal`,
      `rseq-mismatched-registration-refusal`.
    - Accepted subset candidate: one thread with target-owned rseq registration,
      not in a critical section, matching cpu-id verifier.
    - Key negative neighbors: active critical section, source TLS pointer,
      mismatched signature, thread inconsistency, scheduler ambiguity.

28. **Rseq active critical section abort v1**
    - Source refusals: `rseq-active-critical-section-refusal`.
    - Accepted subset candidate: active rseq section restored by target-native
      abort-to-fallback path with exact register/memory verifier.
    - Key negative neighbors: unknown abort handler, source text, scheduler
      race, TLS mismatch, modified critical-section memory.

29. **Memfd seal set v1**
    - Source refusals: `shared-memory-seal-mismatch-refusal`.
    - Accepted subset candidate: one memfd shared-memory contract with exact
      seal set, size, digest, and no external participants.
    - Key negative neighbors: seal mismatch, writable executable, stale dirty
      overlay, missing participant, source-only backing.

30. **Shared memory two-thread participant v1**
    - Source refusals: `shared-memory-missing-participant-refusal`,
      `shared-memory-cross-process-ambiguity-refusal`.
    - Accepted subset candidate: one shared mapping with exactly two restored
      threads as participants and deterministic byte verifier.
    - Key negative neighbors: external process, missing thread, executable
      mapping, stale dirty overlay, unsupported backing.

31. **Shared memory dirty overlay v1**
    - Source refusals: `shared-memory-stale-dirty-refusal`.
    - Accepted subset candidate: one shared mapping with explicit dirty overlay
      bytes and all participants restored in the same process.
    - Key negative neighbors: stale overlay, missing participant, unsupported
      backing, executable mapping, seal mismatch.

32. **Socket readiness empty TCP listener v1**
    - Source refusals: `socket-readiness-refusal`,
      `tcp-listener-readiness-queued-refusal`.
    - Accepted subset candidate: listener readiness verifier for no queued
      accepts and deterministic `poll`/`epoll` not-ready state.
    - Key negative neighbors: queued accept, in-flight accept, edge-triggered
      watch, alias, scheduler race.

33. **TCP listener single queued accept v1**
    - Source refusals: `tcp-accept-queue-refusal`,
      `tcp-listener-readiness-queued-refusal`.
    - Accepted subset candidate: one loopback listener with exactly one queued
      connection reconstructed through target-owned client/server endpoints.
    - Key negative neighbors: multiple queued accepts, non-loopback peer,
      in-flight accept, socket option mismatch, listener alias.

34. **Active accept syscall v1**
    - Source refusals: `tcp-inflight-accept-refusal`,
      `tcp-listener-readiness-inflight-accept-refusal`.
    - Accepted subset candidate: one thread blocked in `accept4` on a supported
      loopback listener with deterministic target wake/probe.
    - Key negative neighbors: queued connection race, multiple waiters,
      nonblocking accept, signal interruption, listener alias.

35. **TCP broker half-close v1**
    - Source refusals: `tcp-active-half-close-mismatch-refusal`.
    - Accepted subset candidate: explicit transport broker contract extended to
      one known half-close state with verifier on read/write shutdown sides.
    - Key negative neighbors: both sides closed, unread byte mismatch, TLS
      session, OOB data, missing broker.

36. **TCP broker unread byte window v1**
    - Source refusals: `tcp-active-unread-byte-mismatch-refusal`.
    - Accepted subset candidate: brokered active TCP stream with bounded unread
      byte window and exact byte verifier.
    - Key negative neighbors: mismatched bytes, OOB data, TLS, non-TCP, wrong
      broker arch.

37. **Raw ICMP known unread reply v1**
    - Source refusals: `raw-icmp-unread-queue-refusal`.
    - Accepted subset candidate: one raw ICMP loopback socket with one known
      unread echo reply, exact bytes/id/sequence, no in-flight packets.
    - Key negative neighbors: multiple replies, id mismatch, non-loopback,
      stale route, ancillary data ambiguity.

38. **Raw ICMP known in-flight echo v1**
    - Source refusals: `raw-icmp-inflight-packet-refusal`.
    - Accepted subset candidate: one known in-flight loopback echo with exact
      packet bytes and target next-packet verifier.
    - Key negative neighbors: lost packet, multiple in-flight packets, route
      mismatch, wrong namespace, hidden sidecar.

39. **Raw ICMP BPF filter v1**
    - Source refusals: `raw-icmp-bpf-filter-refusal`.
    - Accepted subset candidate: one simple classic BPF filter with byte-for-byte
      target installation and verifier over accepted/rejected echo packets.
    - Key negative neighbors: eBPF program, unsupported instruction, source-only
      helper, filter mismatch, ICMPv6.

40. **Ping socket known unread reply v3**
    - Source refusals: `ping-socket-active-recvmsg-known-unread-reply-refusal`,
      `ping-socket-unread-queue-refusal`.
    - Accepted subset candidate: one Linux ping socket with one known unread
      loopback echo reply, exact bytes/id/sequence, no in-flight echo.
    - Key negative neighbors: multiple replies, ancillary ambiguity, id
      mismatch, non-loopback, wrong credentials.

41. **Ping socket known in-flight echo v3**
    - Source refusals: `ping-socket-active-recvmsg-known-inflight-refusal`,
      `ping-socket-inflight-packet-refusal`.
    - Accepted subset candidate: one known in-flight ping echo with exact packet
      bytes, timer policy, and target next-packet verifier.
    - Key negative neighbors: multiple in-flight, unknown bytes, timer interval,
      stale route, ICMPv6.

42. **Distro ping ppoll transition v3**
    - Source refusals: `ping-socket-active-recvmsg-ppoll-transition-refusal`.
    - Accepted subset candidate: `/usr/bin/ping` transition between `recvmsg`
      and `ppoll` with exact empty queue, timer, and signal-mask verifier.
    - Key negative neighbors: pending reply, timer delivery ambiguity, signal
      mask change, control-message ambiguity, multi-interval sequence.

43. **Ping socket ancillary data v3**
    - Source refusals: `ping-socket-active-recvmsg-ancillary-data-unknown-refusal`.
    - Accepted subset candidate: known timestamp/TTL ancillary data contract for
      one queued loopback ping reply.
    - Key negative neighbors: unknown cmsg, multiple replies, timestamp drift,
      ICMPv6, source-kernel-only metadata.

44. **ICMPv6 ping socket loopback v1**
    - Source refusals: `ping-socket-icmpv6-refusal`,
      `ping-socket-active-recvmsg-icmpv6-refusal`.
    - Accepted subset candidate: one IPv6 loopback ping socket with target
      credential/routing gates and no in-flight/unread packets.
    - Key negative neighbors: non-loopback, route mismatch, extension headers,
      queued packet ambiguity, wrong credentials.

45. **ICMPv6 raw socket loopback v1**
    - Source refusals: `raw-icmpv6-refusal`.
    - Accepted subset candidate: one raw ICMPv6 loopback echo socket with target
      capability/routing gates and empty packet queues.
    - Key negative neighbors: missing capability, non-loopback, route mismatch,
      unread packet, unsupported options.

46. **Epoll oneshot level graph v1**
    - Source refusals: `epoll-oneshot-refusal`.
    - Accepted subset candidate: one `EPOLLONESHOT` watch over an accepted fd,
      not yet fired, with target readiness verifier.
    - Key negative neighbors: already-fired oneshot, edge-triggered, stale
      watch, cycle, ambiguous ready list.

47. **Epoll edge-triggered empty v1**
    - Source refusals: `epoll-edge-trigger-refusal`,
      `readiness-edge-trigger-refusal`.
    - Accepted subset candidate: one edge-triggered watch over an accepted fd
      with verifier proving no pending edge and no ready-list residue.
    - Key negative neighbors: pending edge, ready-list ambiguity, socket watch,
      stale watch, cycle.

48. **Epoll ready-list explicit v1**
    - Source refusals: `epoll-ready-list-ambiguous-refusal`.
    - Accepted subset candidate: one explicit ready-list item for an accepted
      eventfd/pipe fd with exact event mask and consumption verifier.
    - Key negative neighbors: multiple ready items, stale watch, edge-triggered,
      one-shot fired state, scheduler race.

49. **Thread join completed child v1**
    - Source refusals: `thread-join-state-refusal`.
    - Accepted subset candidate: one completed joinable target thread with known
      exit value and deterministic `pthread_join`/futex wake verifier.
    - Key negative neighbors: running child, detached thread, multiple joiners,
      robust futex interaction, source TLS pointer.

50. **Thread TLS dynamic slot v1**
    - Source refusals: `thread-tls-edge-refusal`.
    - Accepted subset candidate: one target-owned TLS dynamic slot with nonpointer
      bytes and verifier across two restored threads.
    - Key negative neighbors: source pointer, DSO TLS relocation, rseq TLS
      conflict, stale thread pointer, cross-thread alias.

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
