# Git Workflow

Machinen is git-aware but git-hands-off.

## How it works

Machinen reads the current git branch to derive container names: `machinen-<branch>`. This means each branch gets its own container, and multiple containers can coexist for different branches.

## What machinen does NOT do

Machinen does not create, switch, or manage git branches or worktrees. Users manage their own git workflow — whether that's feature branches, worktrees, trunk-based development, or anything else.

## Why

- **Separation of concerns** — Machinen handles container lifecycle (boot, checkpoint, restore, sync). Git workflow is a separate domain.
- **Sync is orthogonal** — The `watch` command captures container state (writable layers and bind mounts) and pushes images to a registry. This works regardless of how the user organizes their git branches.
- **Avoids confusing ownership** — If machinen managed both container images in a registry and git worktrees, it would be unclear what "owns" the state of a given branch. Keeping these separate keeps things simple.
- **Branch-based naming is enough** — Deriving the container name from the branch is the right level of git coupling. It gives you per-branch containers without machinen needing to touch git.
