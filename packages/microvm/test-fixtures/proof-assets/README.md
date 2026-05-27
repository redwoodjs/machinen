# Portable-restore proof assets

This directory contains proof/test fixtures used by portable restore scripts and
unit tests. They are intentionally kept out of `packages/microvm/assets/` so they
are not treated as production base-image inputs and are not shipped in every
Machinen guest rootfs.

Examples include native capture targets, continuation fixtures, runtime support
harnesses, and the portable cross-ISA proof workload.
