# Goal 007: Advanced Linux facility probes

## Motivation

Advanced Linux facilities are high-signal probes for whether Machinen's kernel
state model is robust. They are not required for first product support, but they
should be proven or refused clearly so the roadmap does not hide hard kernel
boundaries.

## Objective

Create proof-or-refusal probes for:

- seccomp;
- eBPF;
- namespaces;
- cgroups;
- capabilities.

Each facility must be classified as preserved, recreated, proven irrelevant, or
refused.

## Seccomp proof

- [x] Run a process with a minimal allow/deny seccomp filter.
- [x] Prove expected syscall is blocked before the supported boundary.
- [x] Prove expected syscall is blocked after restore/recreate when supported.
- [x] Refuse if filter state cannot be preserved or recreated.

## eBPF proof

- [x] Load a minimal permitted BPF program/profile where host and guest policy
      allow it.
- [x] Verify behavior.
- [x] Record required capabilities and kernel config.
- [x] Refuse unavailable, privileged, pinned, or unsafe BPF state clearly.

## Namespace/cgroup/capability proof

- [x] Record namespace identity and whether it is preserved/recreated/refused.
- [x] Record cgroup membership and whether it is preserved/recreated/refused.
- [x] Record effective/permitted capabilities and target policy.
- [x] Refuse mismatches that would change workload permissions or isolation.

## Machine-readable output

Each row must include:

- `kind: machinen.architecture-portable-snapshot.advanced-linux-facility-probe`
- `facility: seccomp | ebpf | namespace | cgroup | capability`
- `stateModel`
- `sourceArch`
- `targetArch`
- `kernelVersion`
- `requiredCapabilities`
- `verifierOutput`
- `classification: product-supported | proof-only-feasibility | stretch-demo | refused`
- `migrationCompleted`
- refusal code/remediation when refused

## Refusal requirements

Refuse with stable wording for:

- unavailable kernel features;
- insufficient privileges;
- unsafe BPF state;
- namespace/cgroup mismatch;
- capability mismatch;
- verifier ambiguity.

## Tests and smokes

- [x] Seccomp proof/refusal smoke.
- [x] eBPF proof/refusal smoke where policy allows.
- [x] Namespace/cgroup/capability classifier tests.
- [x] Summary matrix tests.

## Documentation

- [x] Explain which facilities are product-supported vs proof-only.
- [x] Explain required host/guest capabilities.
- [x] Explain remediation or why the facility remains refused.

## Validation

Run and record timing for:

- [x] advanced Linux facility probe matrix;
- [x] relevant unit tests;
- [x] `pnpm run format:check`;
- [x] `pnpm run lint`;
- [x] `pnpm run typecheck`;
- [x] `pnpm exec fallow audit --changed-since origin/main`.
