# Cross-ISA support levels

Machinen now treats the old Level 1 through Level 4 ladder as deprecated. The active cross-ISA product taxonomy is intentionally small:

- **Level 0**: fail-closed discovery/refusal.
- **Level 5**: move-owned PID graph translation and target-native reconstruction.

Everything that used to sit in Levels 1 through 4 is retained only as legacy proof/context unless it is rebuilt as a `machinen move` translator with PID dependency-graph ownership and fail-closed refusal coverage.

## Active levels

| Level | Registry value                            | What crosses ISA                                                                                                               | Product status today                                                                                                             | Examples                                                                                                  |
| ----- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| 0     | `level-0-fail-closed-discovery`           | Observations, classifications, and refusals only. No migration is claimed.                                                     | Active as the default for unsupported, deprecated, and proof-only rows.                                                          | `machinen move scan`; refused `machinen move save`; unsupported PID/resource reports.                     |
| 5     | `level-5-cross-arch-process-continuation` | Captured source process/runtime/native state plus dependency graph, reconstructed target-natively at proven safe-point shapes. | The only positive cross-ISA product level we should graduate toward. Current broad process support is still not product support. | Future `machinen move` translators that translate proven state classes and refuse unproven state classes. |

## Deprecated legacy levels

These labels should not be used for new product support. In the product claim registry, former product rows that depended on them are now `deprecated-legacy-support`, `migrationCompleted=false`, and `supportLevel=level-0-fail-closed-discovery`.

| Deprecated level | Old registry value                       | Why it is deprecated                                                                                                                          | Former examples                                                                                                                 |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 1                | `level-1-semantic-restart`               | Clean restart from durable/app intent is useful, but it is not PID translation and it blurred the cross-ISA move claim.                       | Clean Node/Python/Go HTTP roots.                                                                                                |
| 2                | `level-2-semantic-continuation`          | Semantic counters/state are too app-specific unless owned by a real PID graph translator.                                                     | Ping sequence-counter semantic continuation proof.                                                                              |
| 3                | `level-3-runtime-aware-continuation`     | Runtime safe-point adapters are still useful implementation techniques, but they are not a standalone product level.                          | Node/PostgreSQL/Redis idle adapter ladders; explicit runtime safe-point adapters.                                               |
| 4                | `level-4-kernel-resource-reconstruction` | Resource reconstruction is necessary inside `move`, but a resource-only level overclaimed product meaning when no full PID translator exists. | Ping socket, eventfd counter, empty pipe pair, relative one-shot timerfd, loopback TCP listener with empty accept queue proofs. |

## Non-negotiable rules

A row only counts as positive cross-ISA support when all of these are true:

- the target runs target-native code;
- the descriptor is architecture-neutral for the claimed state class;
- the translator owns the relevant PID dependency graph;
- target-side verification checks the resumed/reconstructed behavior;
- unsupported nearby states fail closed with explicit refusal codes;
- the product claim registry advertises the row as implemented product support.

These are not cross-ISA support:

- same-ISA VM snapshot/fork/restore;
- raw VM/vCPU/device replay across ISAs;
- source-ISA emulation;
- app-exported state pretending to be captured process state;
- source-text replay;
- sidecar output replay;
- metadata-only success;
- resource-only reconstruction without a proven process/PID translator;
- raw heap/stack/register restore without retained proof and refusal coverage.

## Where `machinen move` fits

`machinen move` is the universal PID translator entrypoint, not a universal success claim.

```sh
machinen move scan
machinen move save <pid> <out>
machinen move save <pid> <out> --issue
machinen move load <descriptor>
```

- `scan` is Level 0 discovery.
- `save` writes a descriptor only for proven safe-point shapes; otherwise it refuses with `descriptor: null`.
- `save --issue` turns a refusal into a redacted GitHub issue report for `redwoodjs/machinen` by default.
- `load` validates descriptor guardrails today. A descriptor is not a claim of raw process restore.

As `move` grows, accepted translators should graduate directly to Level 5 only when they own the PID graph, translate the proven state classes, and refuse everything outside the retained evidence boundary.

## Graduation requirements

A row can move from proof-only/deprecated to product support only when it has:

- a `machinen move` surface, or another documented product command that owns equivalent PID graph capture and load semantics;
- an architecture-neutral descriptor with claim guards;
- retained `amd64 -> arm64` and `arm64 -> amd64` evidence, unless the row explicitly scopes one direction;
- target-native verifier output;
- refusal tests for unsafe neighbors;
- product claim registry coverage as implemented support;
- no overclaim about arbitrary process restore, raw memory/register restore, kernel socket identity, or source-ISA execution.

## Current boundary

The strongest honest claim today is fail-closed PID discovery plus narrow proof evidence. Machinen does not currently claim arbitrary Linux process restore, arbitrary Node/V8 heap restore, raw cross-ISA VM replay, same-PID continuation, source-ISA emulation, or legacy Level 1 through Level 4 support as active product support.
