# Node and Bun runtime state probes

Issue #421 applies the controlled-binary lessons to tiny JavaScript runtimes.

The proof does not try to copy a Node or Bun heap. Instead, it builds a small object graph with shared references, a `Map`, scalar roots, and known native handles. It records the graph as semantic state, restores that graph in the target runtime, and records what each runtime still needs from an adapter or sidecar.

## Workloads

The shared workload is `packages/microvm/assets/runtime-state-workload.mjs`.

It creates deterministic state:

- scalar roots: label, counter, and values
- object identity: `left.shared === right.shared`
- container references: `list[2]` and `map.get("shared")` point to the same shared object
- native handles: stdio and timer/runtime queues are recorded as refusals

The verifier runs Node unconditionally. It runs Bun when `bun` is available. If Bun is missing, the result is a stable refusal:

```json
{
  "code": "runtime-adapter-missing",
  "message": "bun executable is not available; install the runtime or provide a runtime adapter sidecar"
}
```

## Serializer evidence

The Node probe checks these APIs:

- `node:v8.serialize` preserves this tiny graph's object identity and `Map` shape, and the verifier writes `node-v8-state.bin` as evidence.
- `structuredClone` preserves identity inside one process, but it is not a persistent format by itself.
- JSON preserves values, but it loses object identity and `Map` shape without a sidecar graph encoding.
- V8 heap snapshots are inspection tools in this proof, not a restore contract.

Bun uses the same semantic graph format when available. The current proof treats Bun native handles and runtime heap internals as adapter work unless a Bun-specific runtime adapter is installed.

## Bundle shape

The portable bundle uses an empty `memory.bin`. The important file is `runtime-state.json`, which contains semantic roots, graph objects, reference edges, identity assertions, serializer evidence, and native-handle refusals.

The restore path rebuilds the graph from `runtime-state.json`. This is the same direction needed for Claude Code and pi-style targets: runtime adapters should expose semantic roots and explicit native-handle refusal rules instead of treating raw JS heap bytes as portable state.

## Verify

Run:

```sh
pnpm runtime-state-probe
```

Cross-ISA proof can be done by generating the Node bundle on arm64 and running the workload restore mode on amd64:

```sh
node packages/microvm/assets/runtime-state-workload.mjs restore --bundle <bundle> --runtime node
```
