# VMM choice for machinen v1

Short version: **cloud-hypervisor** for v1, **not libkrun**, with
a parallel **Zig-from-scratch** track for learning + eventual
second-generation substrate.

## Decision

| Option                  | Role                    | Timeline             |
| ----------------------- | ----------------------- | -------------------- |
| **cloud-hypervisor**    | v1 substrate            | ship now             |
| **Zig VMM** (`packages/microvm`) | parallel track, own it | months, becomes v2 |
| **libkrun**             | not used                | —                    |

## Why cloud-hypervisor for v1

- **REST-over-unix-socket API.** Talks straight to it from
  Node (`undici` does HTTP-over-unix-socket natively). No FFI,
  no native bindings, no Rust in the machinen build.
- **HVF + KVM first-class.** Works on Apple Silicon and Linux
  out of the box.
- **Spawn as a binary.** Ship it as a platform-specific
  optional npm dep (esbuild's model).
- **Feature-complete.** Virtio, snapshot/restore, vsock, memory
  ballooning — all there, actively maintained.
- **No optics entanglement.** Intel-led, not the project
  smol-machines forks. Clean story: "machinen uses
  cloud-hypervisor." No one asks follow-ups.

## Why not libkrun (even though it'd be quick)

- **Embed-only, no REST API.** Would force FFI from TS.
  cloud-hypervisor solves this better.
- **Optics.** Machinen going out of its way to not reuse
  smol-machines tech, but building on the upstream project
  smol-machines forks still invites the conflation. Not worth
  it for zero technical advantage over cloud-hypervisor.
- **No learning upside.** If we want to understand VMMs, that
  happens in the Zig track, not by linking libkrun.
- **Bundled kernel.** libkrun ships `libkrunfw`. For v1 we
  want Debian cloud kernel (already spike-validated for CRIU).
  cloud-hypervisor lets us pick; libkrun doesn't.

## Why not Zig-from-scratch for v1

- **Months of work** to match cloud-hypervisor feature parity
  (virtio-net, virtio-vsock, virtio-block, boot protocol, exit
  handling, snapshot/restore).
- Machinen users don't care which VMM is under the hood; they
  care about `m.fork()` working in their TS code. Shipping the
  TS API fast is more valuable than owning the substrate on
  day one.
- **Zig track still happens in parallel** — see `packages/microvm`
  and issues #42–45. It catches up and swaps in as v2.

## When to revisit

Swap cloud-hypervisor for the Zig VMM when **all three** are
true:

1. Zig VMM passes the same spike-test suite as
   cloud-hypervisor (CRIU roundtrip, fork with per-sibling
   input, native addons survive, cross-CPU lock refused).
2. Zig VMM cold-start is measurably better (lower RSS,
   faster boot) — or at least not worse.
3. Owning the stack matters for a specific shipped feature
   that cloud-hypervisor can't support.

Drop cloud-hypervisor for libkrun: never, unless there's a
very specific feature in libkrun we need (unlikely).

## Non-decisions this doc doesn't make

- **Guest kernel.** Debian cloud kernel for now; custom trim
  is a separate question.
- **In-guest init / daemon.** Separate design. See
  `projects/machinen/substrate-v1-plan.md` in the notes repo.
- **macOS code signing / entitlement.** cloud-hypervisor
  handles its own signing. When the Zig VMM catches up we
  deal with that then.
