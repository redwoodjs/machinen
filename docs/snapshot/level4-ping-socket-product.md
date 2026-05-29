# Level 4 ping socket product route

Goal 010 graduated the accepted Goal 003 ping slice from proof-only evidence to a narrow product-supported Level 4 descriptor route. Goal 011 then made the primary product surface the portable machine snapshot path (`machinen snapshot` / `machinen restore`).

Supported profile:

- `ping-level4-socket-reconstruction-v1`
- `productSupport=supported`
- `implementationLevel=level-4-kernel-resource-reconstruction`

Descriptor helper surfaces:

```sh
machinen capture ping-socket --out ./ping.portable \
  --source-arch arm64 --target-arch amd64 \
  --socket-kind ping-dgram-icmp \
  --source-verifier-output ./source.verify \
  --echo-id 7 --echo-seq 1

machinen restore ./ping.portable \
  --target-arch amd64 \
  --target-verifier-output ./target.verify

machinen support --profile ping-level4-socket-reconstruction-v1 --json
```

The capture descriptor accepts only the narrow safe boundary: loopback route,
target loopback namespace, preserved echo identifier/sequence, empty receive
queue, no in-flight packets, no active `recvmsg`, and a valid target
credential/capability mapping.

The unsafe neighboring states remain stable refusals with
`migrationCompleted=false`; they are not broadened into product support.

For the current product claim, use the portable machine route in
[`level4-ping-machine-workload.md`](./level4-ping-machine-workload.md).

Checked summary: `docs/snapshot/checked-summaries/level4-graduation/goal-010.json`.
