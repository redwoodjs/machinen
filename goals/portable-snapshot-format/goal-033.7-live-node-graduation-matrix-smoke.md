# Goal 33.7: Live Node graduation matrix and smoke sign-off

Parent: [Goal 33](./goal-033.md). Depends on Goals 33.1-33.6.

## Objective

Graduate the live Node portable snapshot/restore work into the documented support
envelope with full matrices, checked summaries, docs, and broad smoke validation.

## Requirements

- [x] Audit all Goal 33 phase outputs.
- [x] Confirm every live Node positive has:
  - [x] live source capture artifact;
  - [x] portable bundle artifact;
  - [x] Proxmox amd64 target VM restore summary;
  - [x] checked summary;
  - [x] target output verifier;
  - [x] matrix coverage;
  - [x] `migrationCompleted=true`;
  - [x] forbidden success-path flags false.
- [x] Confirm every unsupported live Node state has:
  - [x] live negative proof;
  - [x] stable refusal code;
  - [x] `migrationCompleted=false`;
  - [x] checked summary;
  - [x] matrix coverage.
- [x] Update the Node runtime manifest with the final live support envelope.
- [x] Update support-envelope docs with exact live Node claims and limits.
- [x] Update proof-matrix docs with live Node presets.
- [x] Update refusal inventory docs with remaining live Node refusals.
- [x] Add or update tests that prevent regressions to metadata-only support.

## Required matrix presets

- [x] `node-live`.
- [x] `node-live-positive`.
- [x] `node-live-refusal`.
- [x] `node-live-apps`.
- [x] `node-live-real-world`.
- [x] Route-specific presets for local arm64 -> Proxmox amd64.
- [x] Route-specific presets for remote-builder arm64 -> Proxmox amd64.

## Final validation

Run and record timing for:

- [x] live Node capture/restore smoke: local arm64 -> Proxmox amd64.
- [x] live Node capture/restore smoke: remote-builder arm64 -> Proxmox amd64.
- [x] `node-live` matrix.
- [x] `node-live-positive` matrix.
- [x] `node-live-refusal` matrix.
- [x] full Node matrix.
- [x] full refusal matrix.
- [x] full foundation matrix.
- [x] `pnpm run format:check`.
- [x] `pnpm run lint`.
- [x] `pnpm run build:docs`.
- [x] `pnpm run typecheck`.
- [x] `NPM_CONFIG_USERCONFIG=/dev/null npx vitest run`.
- [x] `pnpm exec fallow audit --changed-since origin/main`.
- [x] `git diff --check`.
- [x] `MACHINEN_REMOTE_BUILDER=friend@100.126.46.90 pnpm smoke-tests`.

## Completion criteria

Goal 33.7 is complete when the entire live Node support claim is documented,
covered by matrices and checked summaries, guarded against shortcut paths, and
validated with full project checks plus required live and VM smoke tests.

## Completion note

Completed as part of umbrella Goal 33 one-shot execution. See
[Goal 33 completion validation record](./goal-033.md#goal-33-completion-validation-record)
for route-level and final validation evidence.
