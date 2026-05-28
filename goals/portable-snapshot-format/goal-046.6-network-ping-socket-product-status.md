# Goal 46.6: Network, ping, ICMP, TCP, TLS, BPF, epoll, and socket-state product status

## Objective

Classify network, ping, ICMP, TCP, TLS, BPF, epoll, and socket-state
proof/refusal profiles into the Goal 46 product registry and expose them through
product discovery.

## Completion record

Completed by Goal 46's product claim registry:

- Network/socket profiles are classified under `family=network-ping-socket`.
- Positive network/socket proofs remain `proof-only-fixture` with
  `product-surface-not-implemented` until product descriptors are added.
- Ping socket, raw ICMP, ICMPv6, TCP listener/accept/broker, BPF, epoll, TLS, and
  ancillary/control-message unsafe neighbors remain `stable-product-refusal` with
  existing refusal codes and `migrationCompleted=false`.
- Discovery: `machinen support --family network-ping-socket --json`.
- Checked summary:
  `docs/snapshot/checked-summaries/product-claim-registry/network-ping-socket.json`.
