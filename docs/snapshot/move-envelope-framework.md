# Move envelope framework

`machinen move` supports explicit envelopes. An envelope is a narrow contract for one command shape or service shape. It is not a generic process restore feature.

## Product boundary

Every supported envelope must keep these boundaries:

- Same Machinen Debian base assumption.
- Target-native continuation: the target runs its own Debian binary, or a proof-provisioned target-native binary inside the proof VM.
- No source-ISA emulation success.
- No arbitrary VM, process, ELF, runtime, heap, or application restore claim.
- No metadata-only success. A support row needs visible target evidence.
- Fail closed before target launch when the captured state is outside the envelope.

## Envelope families

### Deterministic one-shot file tools

Examples: `head`, `tail -n`, `sed` narrow scripts, `awk` field projection, `cut`, `paste`, `uniq`, `comm`, `join`, checksum tools, `base64`.

Required descriptor state:

- Exact argv shape.
- Input paths.
- File identities, usually `{ size, sha256 }`.
- Output policy and comparison policy when relevant.

Common refusal boundaries:

- Stdin, pipes, or unsupported arity.
- Unsupported flags or arbitrary scripts.
- Changed target input identity.
- Symlink or non-regular-file input unless explicitly modeled.

### Deterministic archive/compression tools

Examples: `gzip -c`, `gunzip -c`, `xz -c`, `zstd -c`, narrow `tar -xf`, narrow `zip -r`.

Required descriptor state:

- Input/archive identity.
- Atomic output policy when writing output.
- Safe archive member policy for extract/create rows.
- Stable metadata policy: sorted order, fixed mtimes, numeric owners, and gzip `-n` style metadata control when fixtures create compressed inputs.

Common refusal boundaries:

- Partial output continuation without an atomic policy.
- Unsafe archive members, absolute paths, `..`, symlinks, hardlinks, or overwrite ambiguity.
- Changed target input identity.

### Filesystem mutation envelopes

Examples: `mkdir`, `mkdir -p`, deterministic `touch -t`, `chmod`, `chown`, hardlink, symlink, `rm`, `rmdir`, `install`.

Required descriptor state:

- Pre-mutation identity for the target path or parent path.
- Explicit mutation policy.
- Expected postcondition.
- Same-base uid/gid mapping when ownership changes.

Common refusal boundaries:

- Symlink races.
- Existing destination when absent destination is required.
- Changed parent or source identity.
- Recursive destructive operations unless separately modeled.

### Directory and query envelopes

Examples: `ls`, `ls -l`, `du -sb`, `stat`, `readlink`, `realpath`, recursive `grep`, bounded `find`, `tree`.

Required descriptor state:

- Stable root or path identity.
- Locale/comparison policy.
- Symlink policy.
- Tree or chain digest when the command observes more than one path.

Common refusal boundaries:

- Locale-sensitive names when ordering is not modeled.
- Symlink traversal unless explicitly modeled.
- Changed target tree, path chain, or file identity.
- Missing proof-provisioned target-native binary.

### Static file servers

Examples: Python HTTP directory server, nginx static config, Caddy file server, Ruby `httpd`, PHP static-only server.

Required descriptor state:

- Port and bind policy.
- Static serving root identity.
- Exact argv/config contract.
- Idle listener evidence.
- Target-native binary/package identity when needed.

Common refusal boundaries:

- Active client or request.
- Dynamic config, scripts, proxying, CGI/FastCGI, auth hooks, or custom app code.
- Port conflict on target.
- Missing target binary.
- Changed serving root identity.

### Idle empty services

Example: Redis with empty dataset and no persistence.

Required descriptor state:

- Exact argv/config contract.
- Empty dataset evidence.
- No active external clients.
- Persistence disabled.

Common refusal boundaries:

- Active client.
- Non-empty dataset.
- Persistence enabled.
- Port conflict.
- Missing target binary.

### Read-only daemons

Example: rsync daemon with read-only no-auth module.

Required descriptor state:

- Exact config contract.
- Read-only root identity.
- Idle listener evidence.
- No active clients.

Common refusal boundaries:

- Write-enabled module.
- Auth/secrets hooks.
- Active client.
- Port conflict.
- Missing target binary.

### Single-file responders

Examples: BusyBox `nc` listener, `socat` file responder.

Required descriptor state:

- Exact argv contract.
- Port and idle listener evidence.
- File identity when a file is served.

Common refusal boundaries:

- Active client.
- Unsupported argv shape.
- Changed file identity.
- Port conflict.
- Missing target binary.

### Refusal-only complex systems

Examples: PostgreSQL/postgres-like database processes until a precise, target-native reconstruction envelope exists.

Required evidence:

- Save/load refusal before target launch.
- Refused state classes such as sockets, open files, threads, shared memory, WAL, locks, or active clients.
- No target pid.

## Shared preflight helper policy

New envelopes should use shared helper snippets for common checks instead of hand-rolling shell each time:

- File identity: regular non-symlink file with `{ size, sha256 }`.
- Tree identity: symlink-free tree digest, file count, directory count, total bytes.
- Parent identity: existing non-symlink directory plus sorted immediate-entry digest.
- Symlink refusal: fail before target launch unless symlinks are part of the envelope.
- Listener/port checks: active connection check and listening-port conflict check using `/proc/net/tcp*`.
- Binary/package identity: target binary must exist and match the accepted target-native policy.

## Standard refusal templates

Each envelope should pick refusal templates from its family and record them in tests or matrix rows:

- `unsupported-shape`: capture omits the envelope state and load has no valid loader.
- `changed-file-identity`: target preflight refuses before launch.
- `changed-tree-identity`: target preflight refuses before launch.
- `symlink-race`: capture or target preflight refuses before launch.
- `missing-binary`: target validation/loader refuses with no target pid.
- `active-client`: capture refuses or omits state.
- `port-conflict`: target loader refuses with no target pid.
- `refusal-only-process`: save/load refuse and `loaderStarted=false` or no target pid.

## Proof-only provisioning policy

Proof-only tools must stay out of base assets. The preferred future path is a cached disposable proof overlay per tool family. Until overlays are proven safe, the fallback is:

- use chunk plans with `skipProvision` for rows that do not need broad guest tooling;
- provision row-local target-native Debian packages only inside proof VMs;
- use `apt-get install --reinstall --no-install-recommends` when a proof image may have package metadata but stripped binaries;
- record provisioning timing separately from proof timing;
- never cite a proof-only package as a base image requirement.

## Matrix and remote validation policy

The matrix runner should prefer chunk plans over ad hoc long runs. A chunk plan names the expected proof rows and can retain JSON/timings per chunk. Coverage verification must compare the expected proof names against retained JSON files and fail if any expected proof is missing or not `passed`.

Infrastructure retries are allowed only for classified infrastructure failures such as `EXEC_AGENT_TIMEOUT`, `EXEC_AGENT_UNAVAILABLE`, `EPIPE`, or VMM/gvproxy transport errors. Semantic failures, assertion failures, changed identity refusals, and missing expected target evidence must not be retried away.

Remote amd64 validation should be one scripted command that syncs the tree, selects the Linux VMM and Linux gvproxy, cleans stale remote temporary state, runs the chunk plan, verifies coverage, and emits the evidence summary.
