# Goal 49.3: Python clean-service adapter

Parent: [`goal-049.md`](./goal-049.md)
Depends on: [`goal-049.1-clean-service-contract.md`](./goal-049.1-clean-service-contract.md)

This subgoal adds the first non-Node runtime implementation of the generic
clean-service contract. It should start with a clean Python HTTP/service subset,
not arbitrary CPython process continuation.

## Objective

Implement product cross-architecture snapshot/restore for a clean Python service
through the existing commands:

```sh
machinen snapshot <python-vm> <bundle-dir>
machinen restore <bundle-dir>
```

No `--runtime python`, `--portable`, proof fixture, checked summary, app hook, or
side-channel capture command may be required.

## Supported Python subset

The first accepted subset should be conservative:

- [ ] one primary Python service process;
- [ ] app/service root is process cwd or safely inferred project root;
- [ ] argv can be reconstructed target-natively;
- [ ] env is empty, allowlisted, or safely captured;
- [ ] service exposes an HTTP endpoint or command verifier;
- [ ] package/provenance is captured from one of:
      `requirements.txt`, lockfile, `pyproject.toml`, `uv.lock`, `poetry.lock`,
      or a documented minimal no-dependency mode;
- [ ] pure-Python source/config files are captured with digests;
- [ ] target Python version/ABI policy is satisfied;
- [ ] target verifier passes before `migrationCompleted=true`.

## Python states that must not be claimed

Do not claim support for:

- arbitrary CPython frame/stack continuation;
- arbitrary thread continuation;
- C-extension private state;
- native wheels with unverified ABI/provenance;
- active TLS sessions or accepted socket state;
- signal handler execution state;
- file watcher or async event-loop private state outside the accepted subset;
- dirty database/WAL or persistent state unless separately modeled.

## Snapshot inspection requirements

`machinen snapshot` must discover and record:

- [ ] Python executable path and version;
- [ ] process argv/cwd/env allowlist;
- [ ] project root and captured files;
- [ ] package manager/provenance files and digests;
- [ ] virtualenv/venv identity if present;
- [ ] imported native extension indicators where practical (`.so`, `.pyd`,
      platform-specific wheels, loaded extension mappings);
- [ ] child processes and threads;
- [ ] listening sockets and active accepted connections;
- [ ] verifier endpoint/command and expected digest;
- [ ] host mount overlap or dirty-state ambiguity.

## Restore requirements

`machinen restore` must:

- [ ] auto-detect the shared clean-service manifest;
- [ ] select the Python adapter from runtime requirements;
- [ ] boot a target-native VM;
- [ ] install/select target-native Python according to manifest policy;
- [ ] materialize captured app/config/package-provenance files;
- [ ] install pure-Python dependencies only if the manifest policy explicitly
      allows it and provenance is verified;
- [ ] refuse native wheels/C extensions unless explicitly modeled;
- [ ] reconstruct argv/cwd/env;
- [ ] start the service target-natively;
- [ ] verify behavior before success.

## Required Python refusals

Stable refusal codes must cover:

- [ ] active accepted TCP session;
- [ ] TLS session state;
- [ ] missing/failing verifier;
- [ ] unsupported child process;
- [ ] unsupported Python threads;
- [ ] C-extension/native wheel state;
- [ ] CPython frame/interpreter continuation state;
- [ ] async event-loop private state outside the accepted subset;
- [ ] package/provenance drift;
- [ ] venv or Python ABI mismatch;
- [ ] host-mounted dirty-state ambiguity;
- [ ] dirty database/WAL state;
- [ ] descriptor/artifact tamper;
- [ ] target architecture mismatch;
- [ ] target Python unavailable.

Every refusal must report `migrationCompleted=false`.

## Validation environment

Use this machine as the arm64 side and Proxmox `root@192.168.0.8` as the amd64
side. Do not use `friend@100.126.46.90`.

## Required smokes

- [ ] `arm64 -> amd64` Python clean-service product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] `amd64 -> arm64` Python clean-service product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] C-extension/native wheel refusal smoke;
- [ ] active TCP refusal smoke;
- [ ] thread/child-process refusal smoke;
- [ ] package/provenance mismatch refusal smoke;
- [ ] descriptor tamper restore refusal;
- [ ] verifier mismatch restore refusal;
- [ ] target architecture mismatch restore refusal.

## Completion criteria

Complete when a clean Python service can be snapshotted and restored both ways
across `arm64 <-> amd64` through the existing product verbs, target-native
verification gates success, and required unsafe Python neighbors refuse with
stable product codes.
