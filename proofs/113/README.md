# Proof 113 — File descriptor/resource descriptor expansion

## TL;DR

Expand the resource descriptor set to cover listeners, timers, stdio, readonly files, and pipes.

## Track objective

Broad Node support needs more than one resource type. This proof records accepted descriptor families and refuses unsafe or unknown resources.

## Translated continuation north star

Captured kernel handles are evidence. Target resources are rebuilt natively and source handles are never copied.

## Tasks

- [x] Add five resource descriptor families.
- [x] Verify safe state for each descriptor.
- [x] Refuse unknown resource kinds.
- [x] Refuse source-handle copying.
- [x] Keep product support out of scope.
