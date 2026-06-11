# Generic resource graph migration wave 1

This is the candidate decision note for the next migration contract in `.pi/goals/generic-resource-graph-migration-wave1.json`.

The wave is **not** a claim that arbitrary processes or arbitrary binaries can move. It is a consolidation step: selected simple bespoke envelopes may become generic-primary or generic-equivalent only when their observed resource graph is fully understood, target evidence is equivalent, and bespoke fallback/refusal evidence remains available.

## Candidate decisions

| Existing proof name     | Decision                                                                                                                  | Generic evidence to reuse or prove                                                                                                                                              | Fallback policy                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `python-http`           | Generic-equivalent first; generic-primary only after matching target HTTP evidence and refusal rows pass.                 | `generic-static-http-daemon` proves target-native Python static HTTP shape with cwd/data-dir identity, idle loopback listener, target port preflight, and HTTP target evidence. | Keep bespoke `python-http` loader higher priority until migration rows pass.                                                                        |
| `python-http-directory` | Generic-equivalent first; generic-primary only after directory identity and HTTP evidence are proven for the exact shape. | `generic-static-http-daemon` proves cwd/data-dir identity plus target HTTP response from target data dir.                                                                       | Keep bespoke directory HTTP loader higher priority during migration.                                                                                |
| `nc-listener`           | Generic-equivalent candidate for idle loopback listener/no-active-client shapes.                                          | `generic-interpreted-server` proves idle loopback TCP listener with target TCP response.                                                                                        | Keep bespoke nc loader for nc-specific argv/binary behavior until generic row explicitly covers it.                                                 |
| `reader-cat`            | Generic-equivalent candidate for readonly regular-file identity and deterministic target output.                          | `generic-file-backed-worker` proves readonly file identity and target log output after generic preflight.                                                                       | Keep reader-cat bespoke loader for offset/stdio-sensitive behavior until generic file offset and stdio policies graduate.                           |
| `grep`                  | Generic-equivalent candidate for readonly-file CLI output when stdin/pipe state is absent or explicitly modeled.          | `generic-readonly-file-cli` proves readonly file identity and target output after generic preflight.                                                                            | Keep grep bespoke loader for pattern/offset behavior and any stdin/pipe shape until generic proof exists.                                           |
| `tail`                  | Not generic-primary in wave 1 unless offset/follow semantics are preserved exactly; otherwise bespoke fallback only.      | `generic-writable-log-daemon` proves write-validated data-dir/log-adjacent daemon behavior, but it does **not** prove tail offset/follow continuation.                          | Keep tail bespoke loader higher priority. Generic migration must refuse or defer tail offset semantics until file offset/follow contract is proven. |

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
