# Product claim registry

Goal 46 adds a product-status registry for every profile in
`scripts/portable-machine-proof-profiles.json`. The registry is the product-facing
answer to: "is this cross-architecture state implemented, refused, deprecated, or
only a proof fixture?"

The registry deliberately does **not** turn proof-only fixtures into product
support. See [Cross-ISA support levels](./cross-isa-support-levels.md) for the
current taxonomy.

## Current active support posture

Active positive cross-ISA support now graduates only through Level 5-style
`machinen move` translators that own the PID dependency graph. Until such a row
is implemented and registered, the product registry reports:

- `implemented-product-support`: no Level 1 through Level 4 rows;
- `deprecated-legacy-support`: former Level 1 and Level 4 product rows;
- `stable-product-refusal`: known unsafe or unsupported states with retained
  refusal codes;
- `proof-only-fixture`: retained proofs that are not product support.

Deprecated rows have `migrationCompleted=false`, `proofOnly=true`, and
`supportLevel=deprecated-cross-isa-level`. Their product refusal code is also
`deprecated-cross-isa-level`.

## Deprecated legacy rows

These rows used to be advertised as product support under the old Level 1/4
ladder. Old Level 0 discovery is also deprecated as a support level. These rows
are now retained only as legacy evidence and must be replaced by a
`machinen move` PID graph translator before support can be reintroduced:

- `node-app-http-server-recreate` — old `level-1-semantic-restart`
- `python-cross-arch-runtime-policy` — old `level-1-semantic-restart`
- `go-cross-arch-runtime-policy` — old `level-1-semantic-restart`
- `ping-level4-socket-reconstruction-v1` — old `level-4-kernel-resource-reconstruction`
- `eventfd-counter-v1-nonsemaphore-no-waiters` — old `level-4-kernel-resource-reconstruction`
- `pipe-pair-v1-empty-no-waiters` — old `level-4-kernel-resource-reconstruction`
- `timerfd-relative-oneshot-v1-monotonic` — old `level-4-kernel-resource-reconstruction`
- `tcp-listener-v1-loopback-empty-accept-queue` — old `level-4-kernel-resource-reconstruction`

The selected Node Memory IR rows remain semantic IR materialization evidence, not
raw process/V8 continuation. They do not claim raw V8 heap restore, same-PID
continuation, raw CPU state replay, or arbitrary process restore. See
`node-memory-ir-compatibility.md` for the scoped supported/refused row table.

Historical Node/runtime profile, live-app, PostgreSQL logical, and resource-only
proof suites remain proof-only, deprecated, or archived until captured source
process state is routed through the public product surface and advertised by this
registry as implemented support.

Every proof/refusal profile is surfaced as `stable-product-refusal` with its
existing refusal code where one exists, and always with `migrationCompleted=false`.
This includes ping sockets, raw ICMP, ICMPv6, TCP, BPF, epoll, futexes, timers,
namespaces, signals, native resources, runtime boundaries, and stateful-service
unsafe neighbors.

## CLI discovery

```sh
machinen support --json
machinen support --family network-ping-socket --json
machinen support --status deprecated-legacy-support --json
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
