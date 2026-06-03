# Portability compatibility data

`portability/` is Machinen's compatibility database. It is intentionally closer to
`caniuse.com` than a binary support statement.

The goal is to prove broad application portability by tracking capabilities,
attempts, verified behavior, and classified blockers. A row does **not** mean
"this exact fixture app is the product." A row means "this application capability
or blocker has evidence."

## Claim boundary

Compatibility data can be loose and exploratory. Public product claims cannot.

- Proof mode: try broadly, retain failures, classify blockers.
- Product mode: claim only rows with retained product/runtime evidence.
- Raw process continuation remains out of scope unless separately proven.

For Node.js this means arbitrary app support is framed as:

> Given an arbitrary Node.js app/process, Machinen can classify it against the
> compatibility table, attempt target-native reconstruction for covered
> capabilities, and report verified support, conditional requirements, or stable
> blockers.

It does **not** mean every running Node process resumes with the same V8 heap,
PID, active request, socket stream, worker heap, or native addon state.

## Files

- `compatibility.schema.json` — JSON Schema for compatibility indexes.
- `<runtime>/index.json` — runtime-specific compatibility table.
- `<runtime>/<NNN-capability>/portability.json` — fixture/capability metadata.
- `<runtime>/retained/*.json` — retained reports from classification and VM runs.

## Core row fields

Each compatibility row should include:

- `id` — stable numbered row id, e.g. `001-plain-http-create-server`.
- `capability` — user-facing feature/capability, not a product claim.
- `category` — broad grouping such as `http`, `framework`, `state`, `blocker`.
- `attemptPolicy` — how aggressively proof mode should try the row:
  - `try-first` — attempt target-native reconstruction and classify the result.
  - `config-required` — attempt only when required config/artifacts are present.
  - `refuse-live-state` — app restart may be possible, but live state transfer is refused.
- `status` — current compatibility status:
  - `verified` — retained VM/product evidence passed.
  - `classified` — row is known and safe to attempt, but not VM-verified yet.
  - `conditional` — needs declared config/artifacts before execution.
  - `failed-classified` — attempted and failed with retained reason.
  - `refused` — stable blocker/refusal boundary.
- `architectures` — per-architecture status and evidence.
- `blockers` — known blockers, each with severity and optional refusal code.
- `workaround` — required user/config action, if any.
- `productClaim` — whether this row currently contributes to product support.
- `evidence` — retained artifacts backing the row.
- `claimGuard` — booleans preventing overclaiming.

## Status interpretation

| Status              | Meaning                                                                              |
| ------------------- | ------------------------------------------------------------------------------------ |
| `verified`          | The capability ran in Machinen-controlled runtime/product proof and verifier passed. |
| `classified`        | The corpus recognizes the capability; proof mode can attempt it.                     |
| `conditional`       | The capability is plausible but needs declared config, artifacts, or dependencies.   |
| `failed-classified` | A retained attempt failed and the failure is classified.                             |
| `refused`           | Known unsupported live/opaque state. This is useful evidence, not a product failure. |

## Architecture interpretation

Architecture cells are independent. A row can be `verified` on `arm64`,
`classified` on `amd64`, and still not be a product claim until the product gate
requires and retains the necessary evidence.

## Product claim interpretation

`productClaim.status` values:

- `claimed` — contributes to a scoped public claim.
- `candidate` — evidence exists, but claim has not been raised.
- `conditional` — can be supported only with required config/artifacts.
- `refusal` — stable refusal boundary.
- `none` — proof/classification only.

All rows must preserve claim guards such as `rawV8HeapRestoreUsed: false` unless
that exact mechanism is separately proven and intentionally claimed.
