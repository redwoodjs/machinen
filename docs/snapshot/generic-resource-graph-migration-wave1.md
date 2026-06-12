# Generic resource graph migration wave 1

This is the candidate decision note for the next migration contract in `.pi/goals/generic-resource-graph-migration-wave1.json`.

The wave is **not** a claim that arbitrary processes or arbitrary binaries can move. It is a consolidation step: selected simple bespoke envelopes may become generic-primary or generic-equivalent only when their observed resource graph is fully understood, target evidence is equivalent, and bespoke fallback/refusal evidence remains available.

## Candidate decisions

| Existing proof name     | Wave-1 mode                              | Decision                                                                                                                          | Generic evidence to reuse or prove                                                                                                                                              | Fallback policy                                                                                                                                     |
| ----------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python-http`           | generic-equivalent-with-bespoke-fallback | Generic-equivalent first; generic-primary only after matching target HTTP evidence and refusal rows pass.                         | `generic-static-http-daemon` proves target-native Python static HTTP shape with cwd/data-dir identity, idle loopback listener, target port preflight, and HTTP target evidence. | Keep bespoke `python-http` loader higher priority until an explicit migration path is selected.                                                     |
| `python-http-directory` | generic-equivalent-with-bespoke-fallback | Generic-equivalent first; generic-primary only after directory identity and HTTP evidence are proven for the exact shape.         | `generic-static-http-daemon` proves cwd/data-dir identity plus target HTTP response from target data dir.                                                                       | Keep bespoke directory HTTP loader higher priority during migration.                                                                                |
| `nc-listener`           | generic-equivalent-with-bespoke-fallback | Generic-equivalent candidate for idle loopback listener/no-active-client shapes.                                                  | `generic-interpreted-server` proves idle loopback TCP listener with target TCP response.                                                                                        | Keep bespoke nc loader for nc-specific argv/binary behavior until generic row explicitly covers it.                                                 |
| `reader-cat`            | generic-equivalent-with-bespoke-fallback | Generic-equivalent candidate for readonly regular-file identity and deterministic target output when stdio is trivial or modeled. | `generic-file-backed-worker` proves readonly file identity and target log output after generic preflight.                                                                       | Keep reader-cat bespoke loader for offset/stdio-sensitive behavior until generic file offset and stdio policies graduate.                           |
| `grep`                  | generic-equivalent-with-bespoke-fallback | Generic-equivalent candidate for readonly-file CLI output when stdin/pipe state is absent or explicitly modeled.                  | `generic-readonly-file-cli` proves readonly file identity and target output after generic preflight.                                                                            | Keep grep bespoke loader for pattern/offset behavior and any stdin/pipe shape until generic proof exists.                                           |
| `tail`                  | bespoke-fallback-only                    | Not generic-primary in wave 1 because generic writable-log proof does not preserve tail offset/follow continuation semantics.     | `generic-writable-log-daemon` proves write-validated data-dir/log-adjacent daemon behavior, but it does **not** prove tail offset/follow continuation.                          | Keep tail bespoke loader higher priority. Generic migration must refuse or defer tail offset semantics until file offset/follow contract is proven. |

## Wave 2 candidate inventory

Wave 2 starts from the wave 1 generic-equivalence evidence and switches priority only after actual generic-primary support and refusal rows pass for each candidate.

| Existing proof name     | Wave-2 inventory state                   | Target mode             | Retained evidence / evidence still required                                                                                                                                                                                                                                              | Fallback policy                                                                                             |
| ----------------------- | ---------------------------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `python-http-directory` | generic-primary                          | generic-primary         | Local matrix artifact `/tmp/machinen-move-matrix-86005-1781266518` proves the exact directory HTTP descriptor uses `target-native-generic-resource-graph-reexec-loader`, returns the target directory response, and refuses active clients, data-dir identity drift, and port conflicts. | Bespoke directory HTTP loader remains available for wrappers and shapes outside the exact generic contract. |
| `nc-listener`           | generic-primary                          | generic-primary         | Local matrix artifact `/tmp/machinen-move-matrix-86005-1781266518` proves the exact idle nc listener descriptor uses `target-native-generic-resource-graph-reexec-loader`, preserves received-data log evidence, and refuses active-client state.                                        | Bespoke nc loader remains available for flags/shapes outside the exact generic contract.                    |
| `reader-cat`            | generic-equivalent-with-bespoke-fallback | retain-bespoke-fallback | Actual cat offset/stdout/pipe equivalence rows plus stale file, nontrivial stdio, deleted fd, writable fd, and pipe refusal rows remain required.                                                                                                                                        | Keep reader-cat bespoke loader higher priority until cat-specific semantics are proven generically.         |
| `grep`                  | generic-equivalent-with-bespoke-fallback | retain-bespoke-fallback | Actual grep pattern/offset/stdout/pipe equivalence rows plus input drift, unsupported option, nontrivial stdio, and pipe refusal rows remain required.                                                                                                                                   | Keep grep bespoke loader higher priority until grep-specific semantics are proven generically.              |

This inventory is a scoped support record, not a broad process support claim. `generic-primary` means only the listed observed resource graph gets generic priority; out-of-contract shapes keep bespoke fallback or fail closed.

## Product and PR wording

Use this language when describing wave 1 in a PR, release note, or status update:

> This is a selected generic resource-class migration wave. It compares a small set of existing bespoke `machinen move` proof rows with generic resource graph rows and records whether each row is generic-equivalent, generic-primary, bespoke-fallback-only, or not migrated. It does not claim arbitrary process movement, any-binary movement, arbitrary shell pipeline movement, source-ISA emulation, or memory/register teleportation.

The default product behavior remains conservative:

- wave 2 refusal/evidence baselines for append-only fd candidates, Unix socket subtypes, and anon-inode subtypes are forward-looking safety work, not migration support;
- app-specific/bespoke envelopes keep higher priority by default;
- generic equivalence means the retained generic row has equivalent target evidence for the selected resource shape, not that every program using that binary is supported;
- generic-primary is allowed only for descriptors where no bespoke envelope claims the process or where an explicit future migration path selects it;
- `tail` remains bespoke-fallback-only until file offset/follow and inotify semantics are explicitly modeled;
- unsupported resources and stale target identities fail closed before target launch or with `targetPid=null`.

## Required refusal boundaries

Every migrated candidate must keep exact refusal evidence for:

- active TCP clients or requests;
- unsupported sockets, pipes, PTYs, anon inodes, and devices;
- changed executable identity;
- changed cwd, file, or data-dir identity;
- target port conflict;
- failed health probe;
- nontrivial stdio or hidden shell pipeline state.

A generic save with unsupported resources must fail closed before target launch. A target-side generic preflight or health failure must return a refused loader with `targetPid=null`.

## Required target evidence

A candidate can move from generic-equivalent to generic-primary only when retained matrix proof shows:

- accepted save and load;
- `genericResourceGraphState.refusalClasses=[]`;
- target-native generic loader strategy;
- no active bespoke `*State` capture unless the row is explicitly testing fallback priority;
- visible target output equivalent to the bespoke row;
- retained refusal rows for unsafe variants.
