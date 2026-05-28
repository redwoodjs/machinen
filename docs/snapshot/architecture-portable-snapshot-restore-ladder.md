# Architecture-portable snapshot restore ladder

Machinen's north star is a restore that feels like the workload kept going. That
is not a promise that raw VM memory or arbitrary Linux process state can move
between CPU architectures. A restore is allowed to succeed only when every
user-visible state item is preserved, recreated, drained, dropped as irrelevant,
logically restored, or refused with a stable code.

## Support levels

`machinen support --json` reports a `supportLevel` for each known workload shape.
The levels are:

| Level | Support level value                       | Meaning                                                                                             |
| ----- | ----------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 0     | `level-0-fail-closed-discovery`           | Machinen identifies unsupported state and refuses it before success.                                |
| 1     | `level-1-semantic-restart`                | Machinen restarts an equivalent target-native workload from captured artifacts and verifier policy. |
| 2     | `level-2-semantic-continuation`           | Machinen carries selected logical user-visible state through an explicit descriptor.                |
| 3     | `level-3-runtime-aware-continuation`      | A runtime adapter captures state at safe points, with version and ABI policy.                       |
| 4     | `level-4-kernel-resource-reconstruction`  | Kernel resources have descriptor/recreate/replay semantics.                                         |
| 5     | `level-5-cross-arch-process-continuation` | Live process execution state is translated across ISAs without source-ISA emulation.                |

`productStatus` still says whether that profile is available through a product
surface, refused, or only a proof fixture. `supportLevel` says where the profile
sits on the architecture-portable snapshot ladder.

Example discovery:

```sh
machinen support --level level-2-semantic-continuation --json
machinen support --profile ping-sequence-counter-semantic-continuation-v1 --json
```

## State decision vocabulary

Manifest and discovery entries use this vocabulary:

- `preserved` — carried forward with equivalent observable behavior.
- `recreated` — rebuilt target-natively with equivalent observable behavior.
- `drained` — completed or made empty before capture.
- `dropped-irrelevant` — proven outside the continuation boundary.
- `logically-restored` — restored through an explicit logical descriptor.
- `refused` — not safe or not modeled.

No successful profile may silently ignore state.

## Implemented Level 2 profile: semantic ping continuation

`ping-sequence-counter-semantic-continuation-v1` is the first Level 2 profile. It
is intentionally narrow. It models ping as logical user-visible state, not as a
kernel-exact socket restore.

Continues:

- destination string;
- ping identifier;
- next sequence number;
- sent, received, and lost counters;
- target-native verifier result after restore.

Defined policy:

- the target starts at the recorded `nextSequence` boundary;
- packets already counted before capture stay counted;
- accepted captures require an empty receive queue;
- new target replies advance counters only after the target verifier observes
  replies;
- source-ISA emulation, source text replay, sidecar success, and metadata-only
  shortcuts are not accepted.

Refuses:

- unread receive queues with `semantic-ping-unread-receive-queue-unsupported`;
- active `recvmsg` with `semantic-ping-active-recvmsg-unsupported`;
- raw socket kernel state with `semantic-ping-raw-socket-state-unsupported`;
- same-architecture requests, which should use vmstate restore;
- target verifier failure.

What this does **not** prove:

- it does not preserve `/bin/ping` process memory;
- it does not recreate raw ICMP socket options, routes, credentials, packet
  queues, or active syscalls;
- it does not prove a live VM ICMP handoff over a real network;
- it does not claim Level 4 kernel-resource reconstruction or Level 5 process
  continuation.

## Validation

Use the focused smoke for this profile:

```sh
pnpm build
pnpm run smoke-semantic-ping-continuation
```

The smoke writes accepted and refused examples under a temporary directory. It
also proves support discovery can select the profile by
`--level level-2-semantic-continuation` and by profile name.
