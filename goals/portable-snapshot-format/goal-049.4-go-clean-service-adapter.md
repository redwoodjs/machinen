# Goal 49.4: Go clean-service adapter

Parent: [`goal-049.md`](./goal-049.md)
Depends on: [`goal-049.1-clean-service-contract.md`](./goal-049.1-clean-service-contract.md)

This subgoal adds a Go implementation of the generic clean-service contract. It
must not claim arbitrary goroutine or Go runtime scheduler continuation.

## Objective

Implement product cross-architecture snapshot/restore for a clean Go service
through the existing commands:

```sh
machinen snapshot <go-vm> <bundle-dir>
machinen restore <bundle-dir>
```

No `--runtime go`, `--portable`, proof fixture, checked summary, app hook, or
side-channel capture command may be required.

## Supported Go subset

The first accepted subset should be conservative:

- [ ] one primary Go service process;
- [ ] service root / deployment root is captured or executable provenance is
      captured with a target rebuild/reinstall policy;
- [ ] argv/env/cwd can be reconstructed target-natively;
- [ ] service exposes an HTTP endpoint or command verifier;
- [ ] executable build info is available (`go version -m`, build ID, module
      versions, or documented equivalent provenance);
- [ ] no cgo/native private state unless explicitly modeled;
- [ ] no active accepted TCP/TLS session must survive;
- [ ] no arbitrary goroutine scheduler state is claimed;
- [ ] target Go/runtime/build policy is satisfied;
- [ ] target verifier passes before `migrationCompleted=true`.

## Go states that must not be claimed

Do not claim support for:

- arbitrary goroutine stacks or scheduler continuation;
- runnable queues, parked goroutines, select races, or channel waiters;
- netpoll waiters or active socket queues;
- cgo/native extension private state;
- timer/signal races;
- active TLS sessions;
- dirty database/WAL or persistent state unless separately modeled.

## Snapshot inspection requirements

`machinen snapshot` must discover and record:

- [ ] Go executable path, build ID, module/build metadata, and architecture;
- [ ] process argv/cwd/env allowlist;
- [ ] service root / config files / module provenance files where available;
- [ ] cgo/native dependency indicators where practical;
- [ ] child processes and threads when relevant to refusal policy;
- [ ] listening sockets and active accepted connections;
- [ ] verifier endpoint/command and expected digest;
- [ ] host mount overlap or dirty-state ambiguity.

## Restore requirements

`machinen restore` must:

- [ ] auto-detect the shared clean-service manifest;
- [ ] select the Go adapter from runtime requirements;
- [ ] boot a target-native VM;
- [ ] install/select target-native Go or use a captured target-native artifact
      according to manifest policy;
- [ ] rebuild/reinstall only from verified source/module provenance when that
      policy is explicitly accepted;
- [ ] refuse missing build provenance rather than silently replaying source text;
- [ ] reconstruct argv/cwd/env;
- [ ] start the service target-natively;
- [ ] verify behavior before success.

## Required Go refusals

Stable refusal codes must cover:

- [ ] active accepted TCP session;
- [ ] TLS session state;
- [ ] missing/failing verifier;
- [ ] unsupported child process;
- [ ] goroutine scheduler/private runtime state;
- [ ] channel waiters, select races, or netpoll waiters;
- [ ] cgo/native state;
- [ ] timer/signal races;
- [ ] package/module/build provenance drift;
- [ ] source/target Go/runtime/build mismatch outside policy;
- [ ] host-mounted dirty-state ambiguity;
- [ ] dirty database/WAL state;
- [ ] descriptor/artifact tamper;
- [ ] target architecture mismatch;
- [ ] target Go/runtime unavailable.

Every refusal must report `migrationCompleted=false`.

## Validation environment

Use this machine as the arm64 side and Proxmox `root@192.168.0.8` as the amd64
side. Do not use `friend@100.126.46.90`.

## Required smokes

- [ ] `arm64 -> amd64` Go clean-service product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] `amd64 -> arm64` Go clean-service product smoke using exactly
      `machinen snapshot <vm> <bundle>` and `machinen restore <bundle>`;
- [ ] cgo/native-state refusal smoke;
- [ ] active TCP refusal smoke;
- [ ] goroutine/channel/netpoll unsafe-state refusal smoke where practical;
- [ ] build/provenance mismatch refusal smoke;
- [ ] descriptor tamper restore refusal;
- [ ] verifier mismatch restore refusal;
- [ ] target architecture mismatch restore refusal.

## Completion criteria

Complete when a clean Go service can be snapshotted and restored both ways across
`arm64 <-> amd64` through the existing product verbs, target-native verification
gates success, and required unsafe Go neighbors refuse with stable product codes.
