# Product claim registry

Goal 46 adds a product-status registry for every profile in
`scripts/portable-machine-proof-profiles.json`. The registry is the product-facing
answer to: "is this cross-architecture state implemented, refused, or only a
proof fixture?"

The registry deliberately does **not** turn proof-only fixtures into product
support. As of Goal 49, implemented product support means the no-extra-flag
`machinen snapshot <vm> <bundle>` / `machinen restore <bundle>` workflow is wired
for that profile. The implemented clean-service subsets are:

- `node-app-http-server-recreate` — `node-http-clean-root-v1`
- `python-cross-arch-runtime-policy` — `python-http-clean-root-v1`

The earlier PostgreSQL logical proof/capture route is not advertised here as
implemented snapshot/restore product support until it is routed through the same
verbs. Other positive proof profiles are surfaced as `proof-only-fixture` with
the product refusal code `product-surface-not-implemented` until a product
snapshot/restore descriptor, integrity contract, and target-native verifier are
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
```

Checked summaries are stored under
`docs/snapshot/checked-summaries/product-claim-registry/` for the global registry
and each Goal 46 family.
