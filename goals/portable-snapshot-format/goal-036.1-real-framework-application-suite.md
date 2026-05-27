# Goal 36.1: Real framework application suite

Parent: [Goal 36](./goal-036.md).

## Objective

Prove portable restore for real framework-shaped Node.js apps, not only minimal
HTTP fixtures.

## Requirements

- [x] Add at least two framework app fixtures: Express/Fastify-style API service
      and one full-stack/server-rendering framework shape such as Next.js,
      Remix, Redwood, or an equivalent app server.
- [x] Include routing, middleware, config/env loading, templating or rendering,
      static assets, dependency graph resolution, and production start commands.
- [x] Capture while the framework server is warm with initialized route tables,
      caches, and open listeners.
- [x] Restore target-natively in both architecture directions for every supported
      framework app.
- [x] Verify post-restore HTTP/API/rendered output, static asset serving, logs,
      and framework health endpoints.
- [x] Refuse unsupported framework state such as custom loader hooks, source text
      replay requirements, dev-server hot reloaders, opaque framework caches, or
      missing target-native dependencies.

## Validation

- [x] Framework app arm64 -> amd64 smoke.
- [x] Framework app amd64 -> arm64 smoke.
- [x] Framework checked summaries and matrix presets.
- [x] Shortcut inspection proving no source-ISA emulation, source text replay,
      sidecar runtime, or app restore hooks.
- [x] Relevant static checks from Goal 36.

## Completion criteria

Complete when real framework apps restore across both architecture directions for
the claimed production subsets and unsafe framework states fail closed.

## Completion note

Completed as part of umbrella Goal 36. See
[Goal 36 completion validation record](./goal-036.md#completion-validation-record)
for implementation and validation evidence.
