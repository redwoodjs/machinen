# Runtime adapter protocol

Issue #432 defines the contract for JavaScript-like runtimes in the portable cross-ISA snapshot path.

The contract is a **semantic sidecar**, not a raw heap dump. A runtime adapter writes `runtime-adapter.json` beside the portable bundle documents. The document tells Machinen how the runtime exposed roots, object graph identity, module/build identity, resource recipes, and explicit refusals.

## Entry points

An adapter declares two entry points:

- `capture`: run in or beside the source runtime and emit semantic state.
- `restore`: run in the target runtime and rebuild semantic state from the sidecar.

Each entry point names a command, arguments, environment, and transport. The initial transports are:

- `sidecar-json`: adapter reads/writes bundle sidecar files.
- `stdio-json`: adapter exchanges JSON over stdio.

## What adapters report

`runtime-adapter.json` contains:

- adapter identity and supported features
- target identity and source/target architectures
- runtime and engine versions
- serializer compatibility evidence
- module/build identity hashes
- argv/env/cwd process metadata
- semantic roots and object graph nodes
- identity assertions for shared references
- native resources with recipes or refusals
- the mapping from runtime sidecar data into portable bundle files

The exported TypeScript type is `RuntimeAdapterDocument`. The exported schema is `runtimeAdapterSchemas.document`.

## Graph model

Roots point at values. Values can be primitives, byte payloads, arrays, or object references. Object nodes have stable ids and can represent objects, arrays, maps, sets, dates, regexp values, errors, ArrayBuffers/TypedArrays, or opaque runtime-owned values.

Shared identity is encoded by references to the same object id. Cycles are valid because refs target ids, not raw addresses.

## Resources and refusals

Resources use the same discipline as the portable bundle: capture what can be replayed, otherwise refuse with a stable code and a useful message. The initial adapter vocabulary includes:

- `runtime-adapter-missing`
- `runtime-heap-unsupported`
- `fd-kind-unsupported`
- `resource-unsupported`
- `object-unsupported`
- `target-build-mismatch`
- architecture and feature refusal codes

A live-process restore that is not supported must include a refusal. This keeps Node/Bun/pi/Claude-Code-style targets honest: semantic state may restore, while raw live heap/process restore can still refuse clearly.

## Bundle mapping

The runtime sidecar is mapped into the existing portable bundle:

- `manifest.features` advertises `runtime-adapter` and runtime-specific features.
- opaque entries in `objects.json` identify runtime roots, object graph, metadata, and resources.
- `resources.json` records argv/env/cwd and native handle recipes/refusals.
- `runtime-adapter.json` carries the full runtime-specific graph and policy data.

## Why not raw heap snapshots?

Raw V8/Bun heap bytes are runtime-version-bound and include implementation details such as internal object layouts, GC metadata, embedder pointers, native handles, async queues, and host resources. They are useful evidence for debugging, but they are not a portable restore format.

The portable contract is semantic: roots, graph nodes, references, resource recipes, and stable refusal diagnostics.
