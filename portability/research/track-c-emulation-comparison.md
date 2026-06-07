# Track C: Emulation comparison

Researchers may use `192.168.0.8` as the shared research host for this track when they need a common machine for cross-architecture comparison runs, verification, or retained evidence.

## Worktree

Create and use a dedicated git worktree for this track before starting implementation or retained-evidence work:

```sh
git worktree add ../machinen-track-c-emulation-comparison -b research/track-c-emulation-comparison
```

A parallel baseline may run source-ISA code under emulation. That is useful for comparison, but must be labeled as source-ISA emulation and kept separate from target-native continuation claims.

## Claim boundary

Emulation comparison results must not be described as target-native continuation. Reports for this track must clearly state when source-ISA execution was used and must keep those results separate from Track A and Track B claims.
