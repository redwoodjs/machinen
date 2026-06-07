# Cross-ISA support levels

Machinen uses **levels** to describe how much state crosses from one ISA to another, for example `amd64 -> arm64` or `arm64 -> amd64`.

The level is a claim boundary. A higher number does not mean every workload works. It means the descriptor, materializer, verifier, and refusal coverage are allowed to talk about deeper state.

## Common rules for every cross-ISA level

A row only counts as cross-ISA support when all of these are true:

- the target runs target-native code;
- the descriptor is architecture-neutral enough for the claimed state class;
- target-side verification checks the resumed/recreated behavior;
- unsupported nearby states fail closed with an explicit refusal;
- the product claim registry advertises the row as implemented product support, or the row is clearly marked proof-only.

These are **not** cross-ISA support levels:

- same-ISA VM snapshot/fork/restore;
- raw VM/vCPU/device replay across ISAs;
- source-ISA emulation;
- app-exported state pretending to be captured process state;
- source-text replay;
- sidecar output replay;
- metadata-only success;
- raw heap/stack/register restore without retained proof and refusal coverage.

## Level table

| Level | Registry value                            | What crosses ISA                                                                                                                                    | Product status today                                                                                                                          | Examples                                                                                                                      |
| ----- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 0     | `level-0-fail-closed-discovery`           | Observations, classifications, and refusals only. No migration is claimed.                                                                          | Supported as a refusal/discovery posture, not as restore.                                                                                     | `machinen move scan`; unsupported PID/resource reports; Node event-loop resource map discovery.                               |
| 1     | `level-1-semantic-restart`                | Durable/app-level intent. The target starts clean target-native processes from known configuration, not captured live execution.                    | Implemented for narrow clean-service rows in the product registry.                                                                            | Clean Node/Python/Go HTTP roots.                                                                                              |
| 2     | `level-2-semantic-continuation`           | Workload semantic counters/state that are independent of raw process and kernel object identity.                                                    | Historical/proof-only unless the product registry says otherwise. Ping's old Level 2 route is retired as product support in favor of Level 4. | Ping sequence-counter semantic continuation proof.                                                                            |
| 3     | `level-3-runtime-aware-continuation`      | Runtime-owned safe-point state, such as interpreter/app adapter state, but not arbitrary raw runtime heaps/stacks.                                  | Research/adapter direction; not broad product support.                                                                                        | Node/PostgreSQL/Redis idle adapter ladders; explicit runtime safe-point adapters.                                             |
| 4     | `level-4-kernel-resource-reconstruction`  | Target-native reconstruction of selected Linux resources from descriptors. It still does not preserve raw process memory or kernel object identity. | Implemented for narrow rows in the product registry.                                                                                          | Ping socket, eventfd counter, empty pipe pair, relative one-shot timerfd, loopback TCP listener with empty accept queue.      |
| 5     | `level-5-cross-arch-process-continuation` | Captured source process/runtime/native state plus dependency graph, reconstructed target-natively at proven safe-point shapes.                      | Goal/direction only for broad process support. Current Node Level 5 artifacts are proof-only unless the registry says otherwise.              | Future `machinen move` translators that own a PID dependency graph, translate proven state classes, and refuse unproven ones. |

## Where `machinen move` fits

`machinen move` is the universal PID translator entrypoint, not a universal success claim.

Current shape:

```sh
machinen move scan
machinen move save <pid> <out>
machinen move save <pid> <out> --issue
machinen move load <descriptor>
```

- `scan` is Level 0 discovery: it classifies visible PIDs and reports accepted/refused/inaccessible rows.
- `save` writes a descriptor only for proven safe-point shapes; otherwise it refuses with `descriptor: null`.
- `save --issue` turns a refusal into a redacted GitHub issue report for `redwoodjs/machinen` by default.
- `load` currently validates the descriptor contract and guardrails. A descriptor is not a claim of raw process restore.

As `move` grows, each accepted translator should be labeled by the deepest level it actually proves. For example, a PID graph containing only an empty, modeled kernel resource may graduate as Level 4. A future full process/runtime/native translator would need Level 5 evidence.

## How to choose the level for a new row

Ask these questions in order:

1. **Does anything move?** If the row only observes and refuses, it is Level 0.
2. **Is the target just starting clean from durable intent?** If yes, it is Level 1.
3. **Is the state semantic workload state, not kernel/process identity?** If yes, it may be Level 2.
4. **Does a runtime adapter own the safe point?** If yes, it may be Level 3, but it must refuse unsupported runtime state.
5. **Are Linux kernel resources reconstructed target-natively?** If yes, it may be Level 4, limited to the modeled resources.
6. **Is captured source process/runtime/native state reconstructed target-natively with dependency-graph closure?** If yes, and unsafe neighbors are refused, it may be Level 5.

If a row uses source-ISA emulation, raw VM replay, app-exported state, or metadata-only success, it is outside this ladder.

## Graduation requirements

A row can move from proof-only to product support only when it has:

- a public product surface (`machinen snapshot`/`restore`, `machinen move`, or another documented command);
- an architecture-neutral descriptor with claim guards;
- retained `amd64 -> arm64` and `arm64 -> amd64` evidence, unless the row explicitly scopes one direction;
- target-native verifier output;
- refusal tests for unsafe neighbors;
- product claim registry coverage;
- no overclaim about arbitrary process restore, raw memory/register restore, kernel socket identity, or source-ISA execution.

## Current boundary

The strongest honest claim today is narrow, descriptor-driven, target-native reconstruction for proven rows. Machinen does not currently claim arbitrary Linux process restore, arbitrary Node/V8 heap restore, raw cross-ISA VM replay, same-PID continuation, or source-ISA emulation as product support.
