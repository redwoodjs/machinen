# Arbitrary-process bidirectional target output hardening

Status: `verified`

Scope: `arbitrary-process-bidirectional-target-output-hardening-v1`

This retained proof gate is claim-guarded. It does not claim arbitrary VM restore, arbitrary Linux process restore, source ISA emulation, raw CPU/vCPU replay, or metadata-only success.

## Summary

- Supported rows verified: 6
- Target output artifacts retained: 12
- Bidirectional directions verified: 12
- Public arbitrary process claim: 0

## Rows

- `process-metadata-argv-env-cwd` — arm64-to-amd64, amd64-to-arm64 — `retained/process-metadata-argv-env-cwd-arm64-to-amd64-target-output.json`, `retained/process-metadata-argv-env-cwd-amd64-to-arm64-target-output.json`
- `static-data-heap-memory` — arm64-to-amd64, amd64-to-arm64 — `retained/static-data-heap-memory-arm64-to-amd64-target-output.json`, `retained/static-data-heap-memory-amd64-to-arm64-target-output.json`
- `regular-file-fd-state` — arm64-to-amd64, amd64-to-arm64 — `retained/regular-file-fd-state-arm64-to-amd64-target-output.json`, `retained/regular-file-fd-state-amd64-to-arm64-target-output.json`
- `simple-pipe-fd-state` — arm64-to-amd64, amd64-to-arm64 — `retained/simple-pipe-fd-state-arm64-to-amd64-target-output.json`, `retained/simple-pipe-fd-state-amd64-to-arm64-target-output.json`
- `idle-eventfd-timerfd-state` — arm64-to-amd64, amd64-to-arm64 — `retained/idle-eventfd-timerfd-state-arm64-to-amd64-target-output.json`, `retained/idle-eventfd-timerfd-state-amd64-to-arm64-target-output.json`
- `idle-epoll-tcp-listener-state` — arm64-to-amd64, amd64-to-arm64 — `retained/idle-epoll-tcp-listener-state-arm64-to-amd64-target-output.json`, `retained/idle-epoll-tcp-listener-state-amd64-to-arm64-target-output.json`

## Retained report

- `retained/arbitrary-process-bidirectional-target-output-hardening-report.json`
