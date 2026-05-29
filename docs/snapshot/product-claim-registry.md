# Product claim registry

Goal 46 adds a product-status registry for every profile in
`scripts/portable-machine-proof-profiles.json`. The registry is the product-facing
answer to: "is this cross-architecture state implemented, refused, or only a
proof fixture?"

The registry deliberately does **not** turn proof-only fixtures into product
support. As of Goal 49, implemented clean-service product support means the
no-extra-flag `machinen snapshot <vm> <bundle>` / `machinen restore <bundle>`
workflow is wired for that profile. Goal 011 retires the earlier ping-specific
Level 2 semantic-continuation claim as product support and makes ping's product
route a portable machine Level 4 socket descriptor through `machinen snapshot`
and `machinen restore`. Goal 015 adds eventfd as the second Level 4 portable
restore adapter/resource. Goal 016 adds pipes as the third Level 4 portable
restore adapter/resource. Goal 017 adds timerfd as the fourth Level 4 portable
restore adapter/resource. Goal 018 adds TCP listener-only sockets as the fifth
Level 4 portable restore adapter/resource. Goal 022 is explicitly only a
selected-state harness proof and is not listed as product support. The implemented
subsets are:

- `node-app-http-server-recreate` — `node-http-clean-root-v1` — `level-1-semantic-restart`
- `python-cross-arch-runtime-policy` — `python-http-clean-root-v1` — `level-1-semantic-restart`
- `go-cross-arch-runtime-policy` — `go-http-clean-root-v1` — `level-1-semantic-restart`
- `ping-level4-socket-reconstruction-v1` — `ping-level4-socket-reconstruction-v1` — `level-4-kernel-resource-reconstruction`
- `eventfd-counter-v1-nonsemaphore-no-waiters` — `eventfd-counter-v1-nonsemaphore-no-waiters` — `level-4-kernel-resource-reconstruction`
- `pipe-pair-v1-empty-no-waiters` — `pipe-pair-v1-empty-no-waiters` — `level-4-kernel-resource-reconstruction`
- `timerfd-relative-oneshot-v1-monotonic` — `timerfd-relative-oneshot-v1-monotonic` — `level-4-kernel-resource-reconstruction`
- `tcp-listener-v1-loopback-empty-accept-queue` — `tcp-listener-v1-loopback-empty-accept-queue` — `level-4-kernel-resource-reconstruction`

There is currently no Level 5 product support entry. Historical Node/runtime
profile and live-app proof suites remain proof-only or archived until a captured
source process state implementation is routed through the public product surface
and advertised by this registry.

The earlier PostgreSQL logical proof/capture route is not advertised here as
implemented snapshot/restore product support until it is routed through the same
verbs. Other positive proof profiles are surfaced as `proof-only-fixture` with
the product refusal code `product-surface-not-implemented` until a product
capture/snapshot descriptor, restore contract, integrity contract, and target-native verifier are
implemented.

Every proof/refusal profile is surfaced as `stable-product-refusal` with its
existing refusal code where one exists, and always with `migrationCompleted=false`.
This includes ping sockets, raw ICMP, ICMPv6, TCP, BPF, epoll, futexes, timers,
namespaces, signals, native resources, runtime boundaries, and stateful-service
unsafe neighbors.

## CLI discovery

```sh
machinen support --json
machinen support --family network-ping-socket --json
machinen support --profile ping-socket-known-unread-reply-v3-multiple-replies-refusal --json
machinen support --status proof-only-fixture --json
```

Text output prints a short summary and a sample. `--json` returns every matching
entry with:

- `productStatus`;
- `family`;
- `runtime` / `resourceFamily` when known;
- `architectureRoutes`;
- `refusalCode` and `productRefusalCode`;
- `migrationCompleted`;
- `proofOnly`;
- `supportLevel` and `supportLevelName`;
- `observableStateDecisions` using preserved/recreated/drained/dropped/logically-restored/refused vocabulary;
- `graduationRequirements`.

## Families

The registry classifies profiles into these product families:

- `postgresql`;
- `nodejs`;
- `go`;
- `python-ruby-jvm`;
- `stateful-services`;
- `foundation-native`;
- `native-linux-resource`;
- `network-ping-socket`;
- `unknown` for remaining profiles that still have a status but no stable family
  label.

`unknown` is still product-classified; it is not support. Entries there are
proof-only fixtures or stable refusals until a future taxonomy migration assigns a
more precise family.

## Validation

Use:

```sh
pnpm run product-claim-registry-matrix
pnpm run smoke-product-support-discovery
pnpm run smoke-semantic-ping-continuation # verifies the retired helper is not product support
```

Checked summaries are stored under
`docs/snapshot/checked-summaries/product-claim-registry/` for the global registry
and each Goal 46 family.
