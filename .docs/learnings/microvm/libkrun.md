# libkrun — a VMM you can link against

A Rust library that gives you a "boot a Linux microVM, run this
payload" API in about 10 function calls. Maintained by Red Hat
(github.com/containers/libkrun). Sits one layer **above** HVF or
KVM — it uses them, doesn't replace them.

## Where it fits in the stack

```
┌─────────────────────────────────────────────┐
│ Your product (machinen, krunvm, smolvm)     │  product layer
├─────────────────────────────────────────────┤
│ VMM: libkrun, Firecracker, cloud-hypervisor │  virtual-machine monitor
│       (or our own Zig VMM)                  │
├─────────────────────────────────────────────┤
│ HVF (macOS)           KVM (Linux)           │  CPU virtualization API
├─────────────────────────────────────────────┤
│ Apple Silicon / Intel CPU hardware          │
└─────────────────────────────────────────────┘
```

- **HVF / KVM** = low-level. "Run this machine code as a guest."
  Doesn't know what Linux is.
- **VMM** (libkrun, our Zig VMM, Firecracker, etc.) = knows
  how to boot Linux, talk virtio, deliver interrupts, handle
  I/O. Calls HVF or KVM to actually run the guest.
- **Product layer** = how users interact. CLI, library, web UI.

libkrun specifically bundles a VMM + a minimal Linux kernel
(`libkrunfw`, a sibling project) + basic virtio devices + an
in-guest init (`krun-init`). Link against it from your Rust/C
program, call `krun_create_ctx()`, `krun_set_root()`,
`krun_set_exec()`, `krun_start_enter()`. That's enough to boot
a Linux microVM and run a command inside it.

## What libkrun does for you, out of the box

- Picks HVF on macOS or KVM on Linux automatically.
- Ships a pre-built stripped kernel (`libkrunfw`) so you don't
  build your own.
- Boots that kernel, sets up memory, virtual CPUs, initial
  register state.
- Provides virtio-console (serial I/O), virtio-block (disk),
  virtio-net (network), virtio-vsock (host↔guest socket).
- Has an opinionated "run an OCI filesystem as rootfs" pathway
  via `krun-init`.
- Handles the `com.apple.security.hypervisor` entitlement
  issue on macOS (it builds signed with the entitlement).

Think of it as "a complete microVM you can call from your own
code, without writing any virtualization plumbing."

## Compared to our Zig VMM (packages/microvm)

We're building, in Zig, **a smaller thing that occupies the
same layer as libkrun.** Not competing with libkrun in features
(it's years ahead); competing in scope and control.

| Axis                    | libkrun                        | packages/microvm (our Zig VMM)                |
| ----------------------- | ------------------------------ | --------------------------------------------- |
| Language                | Rust + some C                  | Zig                                           |
| CPU backends            | HVF + KVM                      | HVF + KVM (same)                              |
| Guest kernel            | Bundled (libkrunfw fork)       | Stock Debian cloud kernel (for now)           |
| Virtio devices          | console, block, net, vsock, fs | Will implement as needed (net #43, vsock #44) |
| OCI rootfs              | First-class via krun-init      | Not a concern — machinen handles rootfs       |
| Lines of code           | Tens of thousands              | Aiming for low thousands                      |
| CRIU integration        | Not currently                  | First-class design goal (Tier 1 hot-move)     |
| Our understanding of it | None of us wrote it            | We wrote every line                           |

The reason to write our own isn't "libkrun is bad." It's that
machinen needs a specific substrate (CRIU-first, TS-library-
integrated, no entitlement dance from Red Hat's signing, our
own legal/strategic lineage) and gets an order-of-magnitude
understanding gain by building it. See also `#42-45` for the
tracking issues.

## Compared to HVF directly

HVF is the raw CPU API. Using HVF without a VMM is like using
`mmap` + inline assembly — you can do it, but you'll end up
rebuilding half of libkrun by the end of the week.

A VMM is what turns "the CPU can run guest instructions" into
"a Linux microVM boots, runs Node, talks to the host." Our
Zig VMM is that middle layer. HVF is below it.

## Related things in the same layer

- **Firecracker** (AWS, Rust). Linux-only (KVM). Aggressive
  minimalism, no macOS support, not a library — a binary you
  spawn and talk to via REST API. Used by AWS Lambda.
- **cloud-hypervisor** (Intel-led, Rust). Closer cousin to
  libkrun: supports both HVF and KVM, can be used as a library
  or binary. More feature-rich, larger. Our pragmatic-path v1
  substrate before the Zig VMM is ready (see
  `projects/machinen/substrate-v1-plan.md` in the notes repo).
- **QEMU microvm machine type**. QEMU has a "microvm" target
  that skips BIOS and PCI for fast boot, roughly in the same
  spirit. Massive codebase though.
- **crosvm** (Google, Rust). ChromeOS VMM. Supports HVF. Good
  reference for virtio implementations.

## Why Peter ran a fork of libkrun for smol-machines

Because it's the fastest way to ship a sub-1s-boot microVM
tool on macOS + Linux. He forked libkrun to strip what he
didn't need and patch what he did. That's smol-machines' tech.

Machinen is _not_ reusing that — different product, clean
separation, and the Zig VMM is specifically the "build my own"
track (see `.docs/learnings/microvm/` as it grows, and issues
#42 through #45).
