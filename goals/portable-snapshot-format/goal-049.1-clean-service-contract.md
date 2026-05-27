# Goal 49.1: Shared clean-service contract and bundle schema

Parent: [`goal-049.md`](./goal-049.md)

This subgoal creates the shared product contract used by every clean-service
adapter. It should reuse the exact Goal 47 product posture: existing verbs only,
automatic VM inspection, target-native restore, verifier-before-success, and
stable fail-closed refusals.

## Objective

Define and implement the shared clean-service manifest, planner, restore router,
refusal vocabulary, and support-registry graduation rules used by Node, Python,
Go, and any future clean-service adapters.

## Contract model

A clean-service bundle must distinguish these concepts explicitly:

- **VM snapshot engine** — the normal snapshot engine used for same-architecture
  restore compatibility (`vmstate`, CRIU, or future engine names).
- **Portable service manifest** — semantic state that can be restored
  target-natively across architectures.
- **Detected components** — processes, listeners, service roots, runtime
  identity, package/build state, mounts, sockets, and verifier evidence found in
  the source VM.
- **Captured components** — detected components accepted by the contract and
  written into portable artifacts with digests.
- **Refused components** — detected components that are required for correctness
  but unsafe or unknown.
- **Verifier contract** — target-side behavior that must pass before
  `migrationCompleted=true`.

## Manifest requirements

The bundle must contain a shared manifest, either in `meta.json.portable` or a
separate versioned file referenced from `meta.json`, with at least:

- [ ] `kind`, `formatVersion`, and schema/version compatibility policy;
- [ ] `sourceArchitecture` and supported target route policy;
- [ ] source VM identity/provenance available from the registry/VM handle;
- [ ] snapshot engine and whether same-architecture fallback exists;
- [ ] service components array, with stable component IDs;
- [ ] process identity: pid, argv, cwd, selected env, uid/gid when relevant;
- [ ] runtime identity: runtime kind, version, ABI/build info when available;
- [ ] service root/artifact descriptors with SHA-256 digests and byte counts;
- [ ] listener descriptors: protocol, bind address class, port, and rebind policy;
- [ ] verifier descriptor: kind, command or HTTP endpoint, expected digest/output,
      timeout, and failure semantics;
- [ ] refused components with stable codes, messages, and remediation text;
- [ ] security assertions showing success did not use source ISA emulation,
      source text replay as restore, sidecars, app hooks, or metadata-only
      continuation.

## Snapshot planner requirements

- [ ] Implement a shared planner that accepts adapter inspection results and
      decides whether to capture, partially capture, or refuse.
- [ ] The planner must be fail-closed: if a required component is unknown, it is
      refused rather than ignored.
- [ ] Multiple components in one VM must be represented. If any required
      component is unsupported, the product snapshot must refuse or mark the
      migration incomplete; it must not silently snapshot only the easy service.
- [ ] The planner must preserve same-architecture snapshot compatibility when a
      normal vmstate/CRIU bundle is present.
- [ ] The planner must write stable machine-readable refusal summaries on
      snapshot failures where practical.

## Restore router requirements

- [ ] `machinen restore <bundle>` auto-detects the shared clean-service manifest.
- [ ] Cross-architecture restore routes to the clean-service target-native path.
- [ ] Same-architecture restore continues to prefer existing vmstate/CRIU behavior
      unless the bundle explicitly requires portable restore.
- [ ] Restore verifies descriptor digests before booting target work.
- [ ] Restore refuses route/target/runtime mismatch with stable product codes.
- [ ] Restore writes a machine-readable summary with `migrationCompleted`, target
      state, target architecture, verifier result, refusal code, elapsed time,
      and security assertions.

## Stable generic refusal codes

Define stable generic refusal codes, with adapter-specific codes allowed to map
onto these families:

- [ ] `clean-service-active-tcp-session-unsupported`;
- [ ] `clean-service-tls-session-unsupported`;
- [ ] `clean-service-child-process-tree-unsupported`;
- [ ] `clean-service-verifier-missing`;
- [ ] `clean-service-verifier-mismatch`;
- [ ] `clean-service-artifact-digest-mismatch`;
- [ ] `clean-service-target-architecture-mismatch`;
- [ ] `clean-service-runtime-unavailable`;
- [ ] `clean-service-runtime-identity-mismatch`;
- [ ] `clean-service-host-mounted-state-ambiguous`;
- [ ] `clean-service-dirty-persistent-state-unsupported`;
- [ ] `clean-service-native-extension-state-unsupported`;
- [ ] `clean-service-runtime-private-state-unsupported`;
- [ ] `clean-service-package-provenance-mismatch`;
- [ ] `clean-service-required-component-unsupported`.

Every refusal must keep `migrationCompleted=false`.

## Tests

- [ ] Unit tests for manifest schema parsing and forward/backward compatibility.
- [ ] Unit tests for planner accept/refuse decisions.
- [ ] Restore-router tests proving `machinen restore <bundle>` auto-detects the
      shared manifest without `--runtime` or `--portable`.
- [ ] Tamper tests for manifest and artifact digest mismatch.
- [ ] Tests that fail if product support can be claimed without a matching
      no-runtime-flag product smoke.

## Documentation

- [ ] Document the generic clean-service contract in `docs/snapshot/`.
- [ ] Document accepted vs refused state in young-user-facing product language.
- [ ] Document how to read the component report in `meta.json` / manifest.
- [ ] Document how users remediate refusals: drain connections, stop inspectors,
      remove native extension ambiguity, checkpoint databases, or provide a
      verifier.

## Validation environment

Use the parent Goal 49 validation topology: this machine is the arm64 side and
Proxmox `root@192.168.0.8` is the amd64 side. Do not use
`friend@100.126.46.90`.

## Validation

Run the validation required by the parent goal, plus targeted tests for this
contract before any adapter is marked implemented.
