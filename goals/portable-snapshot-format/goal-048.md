# Goal 48: Broaden product `machinen snapshot` / `machinen restore` beyond Node

Parent context: Goal 47 proved the first real product cross-architecture workflow
through the existing verbs:

```sh
machinen snapshot <name|pid> <bundle-dir>
machinen restore <bundle-dir>
```

Goal 48 expands that product surface to additional explicitly modeled portable
subsets. The goal is not to claim arbitrary process, socket, runtime, CPU, RAM,
device, or VM-memory portability. Every new success path must be target-native,
verified, and paired with stable fail-closed refusals for unsafe neighboring
states.

## Objective

Graduate selected non-Node proof/fixture families into real product support via
`machinen snapshot` and `machinen restore`, with no runtime-specific workflow
flags and no side-channel `capture` command required.

The first expansion targets are:

1. **Ping / network diagnostic state** — portable product support for a bounded,
   explicitly verified ping/ICMP subset, plus stable refusals for unread packets,
   multiple in-flight packets, route/credential/namespace drift, ancillary data,
   ICMPv6 ambiguity, raw-socket capability mismatch, and unsupported BPF/filter
   state.
2. **Go services** — clean/quiesced target-native Go service reconstruction for
   explicitly modeled subsets, plus refusals for arbitrary goroutine scheduler
   state, cgo/native state, netpoll waiters, channel waiters, active TLS/socket
   state, timers/races, and build/runtime identity drift.
3. **Python services** — clean/quiesced target-native Python service
   reconstruction for explicitly modeled subsets, plus refusals for C-extension
   native state, active interpreter frames that cannot be materialized, signal
   handlers, thread state, sockets/TLS, package/provenance drift, venv ABI drift,
   and dirty persistent state.

Ruby/JVM and additional stateful services may be included only if they meet the
same product contract; proof-only fixtures must remain proof-only until then.

## Product-surface requirements

- [ ] The supported workflow must remain exactly:

  ```sh
  machinen snapshot <name|pid> <bundle-dir>
  machinen restore <bundle-dir>
  ```

- [ ] Do not add `machinen capture` as the product path for these families.
- [ ] Do not require `--portable`, `--runtime`, `--language`, `--profile`, or
      equivalent runtime-specific flags for normal product snapshot/restore.
- [ ] `machinen snapshot` must inspect the running VM, discover every modeled
      component in the selected subsets, capture known-safe portable state, and
      refuse required unknown/unsafe state.
- [ ] `machinen restore` must auto-detect bundle contents and target
      architecture, restore every required supported component target-natively,
      and verify before reporting `migrationCompleted=true`.
- [ ] Same-architecture vmstate/CRIU behavior must not regress.
- [ ] `machinen support` must advertise only subsets that have real no-runtime-
      flag `snapshot` / `restore` product smokes.

## Bundle / descriptor requirements

For every graduated family, the normal snapshot bundle must include a portable
component manifest that records:

- snapshot engine and source architecture;
- target route policy;
- detected runtime/resource/service components;
- captured components and integrity digests;
- refused components and stable refusal codes;
- provenance needed to reconstruct target-natively;
- verifier inputs and expected outputs/digests;
- `migrationCompleted=false` semantics for every refusal;
- proof that success did not rely on source-ISA emulation, source text replay,
  app hooks, sidecar runtime success, or metadata-only continuation.

## Ping / network diagnostic subset requirements

- [ ] Define the smallest safe product ping subset, including exact socket type,
      credentials, namespace, route, packet, timer, and verifier constraints.
- [ ] Implement source VM inspection for the supported ping subset.
- [ ] Implement target-native reconstruction/verifier.
- [ ] Refuse at least: multiple unread replies, unknown queued bytes, multiple
      in-flight packets, stale route, credential mismatch, wrong namespace,
      ancillary/control-message ambiguity, ICMPv6 ambiguity where unsupported,
      raw-socket capability mismatch, unsupported BPF/filter state, active ppoll
      ambiguity, and missing target verifier.
- [ ] Add `arm64 -> amd64` and `amd64 -> arm64` product smokes using only
      `machinen snapshot` and `machinen restore`.

## Go subset requirements

- [ ] Define the smallest safe Go service subset. Start with clean/quiesced
      target-native service reconstruction; do not claim arbitrary goroutine heap
      or scheduler continuation.
- [ ] Inspect running VMs for Go service identity, executable/build provenance,
      cwd/config state, listening service verifier, runtime version/build info,
      and modeled external resources.
- [ ] Restore target-natively and verify behavior before success.
- [ ] Refuse at least: arbitrary goroutine scheduler state, runnable queues,
      channel waiters, netpoll waiters, cgo/native extension state, active TLS or
      unverified socket queues, timer/signal races, dirty persistent state,
      missing build/provenance, and target runtime/build mismatch.
- [ ] Add bidirectional product smokes with exact `snapshot` / `restore` verbs.

## Python subset requirements

- [ ] Define the smallest safe Python service subset. Start with clean/quiesced
      target-native service reconstruction; do not claim arbitrary CPython frame
      or C-extension state.
- [ ] Inspect running VMs for Python process identity, venv/package provenance,
      cwd/config state, listening service verifier, Python/ABI version, and
      modeled external resources.
- [ ] Restore target-natively and verify behavior before success.
- [ ] Refuse at least: native C-extension opaque state, active interpreter frame
      continuation, threads, signal handlers, active TLS/socket queues, dirty
      persistent state, venv/package ABI drift, missing lock/provenance, and
      target runtime mismatch.
- [ ] Add bidirectional product smokes with exact `snapshot` / `restore` verbs.

## Required tests and validation

For every newly implemented subset, add tests that fail if the only successful
path is a proof fixture, checked summary, `machinen support`, `machinen capture`,
`--portable`, or a runtime-specific flag.

Run and record timing for:

- [ ] `arm64 -> amd64` product smoke for each implemented family using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] `amd64 -> arm64` product smoke for each implemented family using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] unsafe-neighbor refusal smokes for ping, Go, and Python through
      `machinen snapshot` or `machinen restore`;
- [ ] descriptor tamper / target-architecture mismatch / verifier mismatch
      restore refusals for each family;
- [ ] product support registry matrix proving every implemented support entry has
      a no-runtime-flag `snapshot` / `restore` smoke;
- [ ] relevant proof matrices and checked-summary comparisons for ping, Go,
      Python, and any other graduated families;
- [ ] full runtime support matrix;
- [ ] full refusal matrix;
- [ ] full foundation matrix;
- [ ] `pnpm run format:check`;
- [ ] `pnpm run lint`;
- [ ] `pnpm run build:docs`;
- [ ] `pnpm run typecheck`;
- [ ] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`;
- [ ] `pnpm exec fallow audit --changed-since origin/main`;
- [ ] `git diff --check`;
- [ ] `pnpm smoke-tests` on an arm64 machine, or
      `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests` when local
      arm64 is unavailable.

## Completion criteria

Complete only when ping, Go, and Python each have at least one real product
cross-architecture subset that uses the existing snapshot/restore commands,
passes bidirectional target-native verification, and refuses all required nearby
unsafe states with stable codes and `migrationCompleted=false`. Any family not
implemented must remain explicitly refused or proof-only in `machinen support`;
no registry/docs claim may imply product support without the matching no-flag
product smoke.
