# Proof 108 — V8 map/shape table for supported Node 22 / V8 12 layouts

## TL;DR

Add a small supported V8 shape table for common object, array, string, and closure-context layouts.

## Track objective

Broad support needs explicit shape gates. This proof makes accepted layouts visible and makes unsupported maps refuse with typed errors.

## Translated continuation north star

Shape tables describe how to translate source evidence into graph IR. They are not a promise to copy raw source heap layouts into the target.

## Tasks

- [x] Define supported map/shape rows for Node 22 / V8 12.
- [x] Validate shape identity and fields.
- [x] Refuse unsupported builds, maps, and duplicate fields.
- [x] Keep product support out of scope.
