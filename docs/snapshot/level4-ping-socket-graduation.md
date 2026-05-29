# Goal 003 ping Level 4 socket graduation

Goal 003 is the first execution slice from the Level 4/5 graduation ladder. It
turns the ping Level 4 matrix row into a checked proof/refusal summary without
claiming new product support.

The checked summary is written to:

```txt
docs/snapshot/checked-summaries/level4-graduation/goal-003.json
```

Regenerate it with:

```sh
pnpm run level4-ping-socket-graduation
```

## Product boundary

Historical Goal 003 proof-mode boundary:

| Row                                       | Product support     | Implementation level            | Meaning                                                                                                |
| ----------------------------------------- | ------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ping-level2-semantic-product-boundary`   | `supported`         | `level-2-semantic-continuation` | At Goal 003 time, logical ping sequence/counter continuation was the only supported ping product path. |
| `ping-level4-socket-reconstruction-proof` | `not-yet-supported` | `not-implemented`               | At Goal 003 time, raw/datagram ICMP socket reconstruction was proof evidence only.                     |

`migrationCompleted=true` on the Level 4 proof row means the proof verifier and
resource planner completed. It did not mean Level 4 ping socket snapshots were
product-supported at Goal 003 time.

Current state: Goal 011 retires the Level 2 ping product claim and makes
`ping-level4-socket-reconstruction-v1` the supported portable machine Level 4
ping route through `machinen snapshot` / `machinen restore`.

## Accepted proof descriptor

The accepted Level 4 proof descriptor is deliberately narrow:

- raw ICMP and datagram ping socket descriptors only;
- IPv4 ICMP loopback destination;
- explicit identifier and next sequence;
- explicit route and network namespace policy;
- explicit credential policy using ping group range or `CAP_NET_RAW`;
- empty receive queue;
- no in-flight packets;
- no active `recvmsg` or partial transfer;
- target-native synthetic socket resources from `planNativeTargetFdTable`.

The checked proof row produces these target resource kinds:

- `synthetic-ping-socket`;
- `synthetic-raw-icmp`.

## Refusals

Unsafe neighbors remain fail-closed refusals:

| Refusal row                                          | Refused state                         |
| ---------------------------------------------------- | ------------------------------------- |
| `ping-level4-unread-receive-queue-refusal`           | unread receive queue                  |
| `ping-level4-in-flight-packets-refusal`              | in-flight packets                     |
| `ping-level4-active-recvmsg-refusal`                 | active `recvmsg` / partial transfer   |
| `ping-level4-ambiguous-route-namespace-refusal`      | ambiguous route or namespace          |
| `ping-level4-missing-credential-capability-refusal`  | missing credential/capability mapping |
| `ping-level4-unsupported-raw-socket-options-refusal` | unsupported raw socket options        |
| `ping-level4-verifier-mismatch-refusal`              | target verifier mismatch              |

Every refusal row keeps `productSupport=unsupported`,
`implementationLevel=level-0-fail-closed-discovery`, and
`migrationCompleted=false`.

## Graduation gate

Satisfied by Goal 011 for the narrow portable machine workload: the descriptor
is routed through public `machinen snapshot` / `machinen restore` verbs, target
recreation is verified, and unsafe neighbors remain checked refusals.
