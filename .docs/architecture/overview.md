# Machinen Architecture

Machinen migrates running Docker devcontainers between a local Mac and remote
cloud servers using CRIU (Checkpoint/Restore In Userspace).

## Flow

```
┌─────────────┐     freeze      ┌────────────┐    restore     ┌─────────────┐
│  Local Mac  │ ──────────────► │  Registry  │ ─────────────► │   Hetzner   │
│  (OrbStack) │                 │  (ghcr.io) │                │   (cax11)   │
│             │ ◄────────────── │            │ ◄───────────── │             │
│  devcontainer│    restore      │ checkpoint │    freeze      │ devcontainer│
└─────────────┘                 │   image    │                └─────────────┘
                                └────────────┘
```

### `machinen up`

1. Starts a local devcontainer via the devcontainer CLI
2. Watches for macOS sleep/wake events
3. On sleep: checkpoint → push → provision server → restore on remote
4. On wake: checkpoint on remote → pull → restore locally → destroy server
5. Background sync every 5 minutes for faster handoff

### `machinen freeze <container>`

1. CRIU checkpoints the running container (captures full process state)
2. Extracts checkpoint files from Docker's internal storage
3. Builds a Docker image containing the checkpoint data + metadata
4. Pushes to ghcr.io

### `machinen restore <container>`

1. Provisions a cloud server (or reuses existing)
2. Pulls the checkpoint image
3. Extracts workspace files and sets up regular bind mounts on the remote
4. Patches the checkpoint to strip OrbStack-specific mounts (`crit`)
5. Copies checkpoint data into Docker's checkpoint directory
6. Restores the container from the patched checkpoint

## Modules

| Module                  | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `machinen.mjs`          | CLI entrypoint, command routing, arg parsing                |
| `cloud.mjs`             | State management, SSH, provisioning, remote freeze/restore  |
| `docker.mjs`            | Local Docker operations, checkpoint/restore, image building |
| `providers/hetzner.mjs` | hcloud CLI wrapper (pluggable provider interface)           |
| `registry.mjs`          | ghcr.io authentication via `gh` CLI                         |
| `preflight.mjs`         | Prerequisite checks, CRIU availability                      |
| `power.mjs`             | macOS sleep/wake detection                                  |
| `sync.mjs`              | Background checkpoint sync                                  |
