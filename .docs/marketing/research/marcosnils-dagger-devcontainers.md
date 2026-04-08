# Marcos Nils (Dagger) on Devcontainers for Agents

**Source:** https://x.com/marcosnils/status/2041272472054415486
**Date:** April 6, 2026

> Devcontainers are not workflow aware and are not thought for the CI use case.
> We're solving this @dagger_io
> Your agents need a sandboxing solution that can run concurrently and should
> be fast. This means de-duping and caching aware.

## What he's saying

Marcos is making three distinct claims:

1. **Devcontainers aren't workflow-aware** — they define an environment but have no
   concept of build steps, task graphs, or pipeline orchestration. A devcontainer.json
   says "here's a container with Node 22" but not "run lint, then test, then deploy."

2. **Devcontainers aren't built for CI** — they were designed for interactive
   development (VS Code remote containers). Using them as CI sandboxes is a
   retrofit, not a first-class path.

3. **Agent sandboxes need concurrency + caching** — if you're running many agents in
   parallel, each in its own sandbox, you need deduplication (don't rebuild the same
   layers/deps N times) and caching (reuse artifacts across runs).

Dagger's pitch: a pipeline engine (built on BuildKit) that gives you containerized
steps with a DAG runtime, content-addressed caching, and layer deduplication baked in.

## The conflation: sandbox vs. orchestrator

Marcos is blending two distinct layers into one argument:

1. **The sandbox** — an isolated execution environment. Serverless in nature: spin
   it up, run in it, tear it down. The sandbox doesn't know about other sandboxes,
   pipelines, or build graphs. It's the unit of compute.

2. **The orchestrator** — the layer above that decides _how many_ sandboxes to run,
   _what order_ to run them in, what to cache, and how to deduplicate work across
   them. Workflow awareness, concurrency, DAG execution, content-addressed caching —
   these are orchestration concerns.

Dagger is an orchestrator that happens to use containers as its execution unit.
Marcos is pitching it as a "sandboxing solution," but the value is really in the
orchestration: the BuildKit DAG, the content-addressed cache, the pipeline graph.
The container itself is commodity.

His critique of devcontainers ("not workflow aware, not for CI") is accurate but
misdirected — it's like saying "a VM isn't workflow aware." Of course not. That's
not its job. The workflow sits above it.

## Where machinen sits

Machinen is the sandbox. Specifically, it's a sandbox with a unique capability
that commodity containers don't have: **CRIU checkpoint/restore gives you
freezable, resumable, migrateable execution state.**

This is a fundamentally different primitive than what Dagger offers:

- Dagger can cache _build layers_. Machinen can freeze a _running process_ — open
  file descriptors, memory state, terminal sessions — and resume it elsewhere.
- Dagger executes stateless pipeline steps. Machinen preserves stateful sessions
  across machine boundaries.
- Dagger's unit of work is a build step. Machinen's unit of work is a live
  environment.

The things Marcos wants (concurrency, dedup, caching, workflow graphs) are real
needs, but they belong in the orchestrator that _calls_ machinen, not in machinen
itself. An orchestrator could spin up N machinen sandboxes in parallel, snapshot
them at decision points, fork execution paths, and roll back — capabilities that
a pure pipeline engine like Dagger can't offer because it has no concept of live
process state.

## The opportunity

The agent era needs sandboxes that are:

- **Fast to create** — machinen's DiND architecture handles this
- **Checkpointable** — CRIU gives this; Dagger doesn't have it at all
- **Forkable** — checkpoint + restore-as-new-container = fork. An agent can
  explore multiple paths from the same state without replaying from scratch
- **Migratable** — move running work between machines (local to cloud, cloud to
  cloud) without losing state

These are sandbox-level primitives. The orchestrator above decides _when_ to fork,
_how many_ to run, and _what_ to cache. That's not machinen's job — but machinen
gives the orchestrator primitives that no other sandbox provides.

What's missing isn't workflow awareness or caching. It's **a clean programmatic
interface** for an orchestrator to drive machinen: create, freeze, restore, fork,
destroy. The sandbox needs to be serverless — callable as a primitive, not just
interactive via `machinen up`.
