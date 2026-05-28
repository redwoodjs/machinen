# Goal 49.5: Ping / network diagnostic clean-service adapter

Parent: [`goal-049.md`](./goal-049.md)
Related: [`goal-048.md`](./goal-048.md)

Ping and socket state are not services in the same sense as Node/Python/Go HTTP
apps, but they are a useful test of whether the shared contract can represent a
small target-native resource reconstruction with strict refusal boundaries. This
subgoal is optional for Goal 49 completion unless explicitly selected.

## Objective

Evaluate and, if safe, implement a bounded ping/network diagnostic product subset
through the existing commands:

```sh
machinen snapshot <ping-vm> <bundle-dir>
machinen restore <bundle-dir>
```

No `--runtime`, `--portable`, proof fixture, checked summary, or side-channel
capture command may be required.

## Supported subset candidate

The first acceptable ping subset must be very narrow. A candidate accepted subset
is:

- [ ] one diagnostic process with explicit command provenance;
- [ ] socket kind is known and supported (ping socket or raw ICMP, not both unless
      both are modeled);
- [ ] credentials and ping group/capability requirements are captured;
- [ ] route/namespace are simple and target-verifiable;
- [ ] no more than one modeled in-flight echo request, or no in-flight packet if
      that is the safer initial subset;
- [ ] no unread packet ambiguity;
- [ ] no unsupported ancillary/control-message state;
- [ ] target-native diagnostic command or socket reconstruction is verified;
- [ ] target verifier passes before `migrationCompleted=true`.

If this cannot be proven safely, the product path must remain an explicit refusal
while proof fixtures remain proof-only.

## States that must not be claimed

Do not claim support for:

- arbitrary unread packet queues;
- multiple in-flight packets;
- unknown ancillary/control messages;
- ICMPv6 where route/filter semantics are not modeled;
- unsupported BPF/filter state;
- non-loopback routing without provenance;
- credential/capability drift;
- namespace mismatch;
- active ppoll/readiness ambiguity;
- hidden helper/broker processes unless explicitly modeled.

## Snapshot inspection requirements

`machinen snapshot` must discover and record:

- [ ] diagnostic process argv/cwd/env allowlist;
- [ ] socket kind, protocol, local/remote endpoint where applicable;
- [ ] credentials/capabilities/ping-group requirements;
- [ ] namespace and route evidence needed for target verification;
- [ ] queued/unread packet evidence;
- [ ] in-flight packet evidence;
- [ ] ancillary/control-message and BPF/filter state where available;
- [ ] verifier definition and expected digest/output.

## Restore requirements

`machinen restore` must:

- [ ] auto-detect the shared clean-service/resource manifest;
- [ ] select the ping/network diagnostic adapter;
- [ ] boot a target-native VM;
- [ ] recreate only the accepted diagnostic state;
- [ ] verify target-native behavior before success;
- [ ] refuse if target credentials/capabilities/routing cannot be made to match
      the accepted policy.

## Required ping/network refusals

Stable refusal codes must cover:

- [ ] multiple unread replies;
- [ ] unknown queued bytes;
- [ ] multiple in-flight packets;
- [ ] stale route;
- [ ] credential mismatch;
- [ ] wrong namespace;
- [ ] ancillary/control-message ambiguity;
- [ ] unsupported ICMPv6 route/filter state;
- [ ] raw-socket capability mismatch;
- [ ] unsupported BPF/filter state;
- [ ] active ppoll/readiness ambiguity;
- [ ] hidden helper/broker ambiguity;
- [ ] missing/failing target verifier;
- [ ] descriptor/artifact tamper;
- [ ] target architecture mismatch.

Every refusal must report `migrationCompleted=false`.

## Validation environment

Use this machine as the arm64 side and Proxmox `root@192.168.0.8` as the amd64
side. Do not use `friend@100.126.46.90`.

## Required smokes if implemented

- [ ] `arm64 -> amd64` ping diagnostic product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] `amd64 -> arm64` ping diagnostic product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] unread/multiple-packet refusal smoke;
- [ ] route/credential/namespace refusal smoke;
- [ ] BPF/filter or ancillary-data refusal smoke;
- [ ] descriptor tamper restore refusal;
- [ ] verifier mismatch restore refusal;
- [ ] target architecture mismatch restore refusal.

## Completion criteria

Complete only if a bounded ping/network diagnostic subset passes bidirectional
product snapshot/restore with target-native verification and all required unsafe
neighbors refuse with stable product codes. Otherwise, leave ping as proof-only or
explicitly refused in `machinen support` and in the product claim registry.
