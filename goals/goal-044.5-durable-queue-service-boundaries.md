# Goal 44.5: Durable queue service boundaries

Parent: [Goal 44](./goal-044.md).

## Objective

Prove at least one durable queue service clean restore subset and define stable
refusals for in-flight delivery and consumer/session ambiguity.

## Candidate services

Prefer a service available from local Debian packages or audited local assets:

- NATS JetStream if feasible;
- RabbitMQ if package/runtime cost is acceptable;
- a smaller durable queue fixture if it can faithfully represent queue
  persistence and ack boundaries.

## Requirements

- [ ] Add audited queue fixtures with configuration, seed messages, workload, and
      verifier.
- [ ] Prove a clean durable queue restore subset: - durable messages persisted; - no in-flight unacked delivery at snapshot; - consumers disconnected or quiesced; - target verifier confirms queue contents and ack state.
- [ ] Record provenance: - service version; - architecture; - config digest; - workload digest; - persistence manifest; - verifier output digest.
- [ ] Add stable refusals for: - in-flight delivery; - unacked message ambiguity; - active consumer session; - ephemeral queue/subscription state; - cluster/replication state; - plugin/native extension state; - host-mounted data directory ambiguity.
- [ ] Reject source-ISA emulation, source text replay, sidecar runtime success,
      app hooks, and metadata-only continuation.

## Validation

- [ ] Durable queue clean restore smoke.
- [ ] Durable queue unsafe-neighbor refusal matrix.
- [ ] Durable queue proof matrix preset.
- [ ] Relevant static checks from Goal 44.

## Completion criteria

Complete when at least one durable queue has a verified clean restore subset and
stable refusals for in-flight or ambiguous queue states.
