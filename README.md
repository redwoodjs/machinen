# machinen

Seamless local-to-cloud devcontainer handoff. Work locally, close your laptop lid, and your container keeps running in the cloud. Open it again and it comes back.

## Quick Start

```bash
pnpm install
```

### Set up a cloud provider

Machinen uses a pluggable cloud provider to provision remote servers. The default provider is **Hetzner** via the `hcloud` CLI.

```bash
# Install the Hetzner CLI
brew install hcloud          # macOS (or see https://github.com/hetznercloud/cli)

# Authenticate
hcloud context create machinen  # paste your API token when prompted
```

### Start a devcontainer with cloud handoff

From inside any repo with a `.devcontainer/` directory:

```bash
node src/machinen.mjs up
```

This:

1. Starts a local devcontainer from your cwd
2. Drops you into a shell inside the container
3. Syncs container state to the registry every 5 minutes
4. Watches for sleep/wake events

When you **close your laptop lid**:

- Container state is frozen and pushed to the registry
- A cloud server is provisioned and the container is restored on it

When you **open your laptop**:

- Remote state is frozen and pulled back
- Restored locally, you pick up where you left off
- Cloud server is destroyed to save cost

### Multiple devcontainers

You can run multiple devcontainers simultaneously. Each gets its own cloud server and independent sleep/wake handoff:

```bash
# Terminal 1
cd ~/projects/api && node ~/machinen/src/machinen.mjs up

# Terminal 2
cd ~/projects/frontend && node ~/machinen/src/machinen.mjs up --file .devcontainer/agent-1/devcontainer.json
```

List all active machines:

```bash
node src/machinen.mjs logs
```

### Freeze and restore any container

Works with any Docker container, not just devcontainers:

```bash
# Start a container locally
docker run -d --name myapp --security-opt seccomp=unconfined ubuntu:24.04 \
  bash -c 'i=0; while true; do echo "Counter: $i"; i=$((i+1)); sleep 2; done'

# Freeze — checkpoint, package as Docker image layer, push to registry
node src/machinen.mjs freeze myapp

# Restore on cloud — pulls image, restores from checkpoint
node src/machinen.mjs restore myapp

# View logs on the remote
node src/machinen.mjs logs myapp

# Tear down
node src/machinen.mjs destroy myapp
```

The counter picks up exactly where it left off.

## How It Works

### Local: Docker-in-Docker (DiND)

Locally, machinen runs devcontainers inside a privileged **Docker-in-Docker container** (`machinen-dind`) rather than directly on the host Docker daemon. This inner daemon has CRIU pre-installed and configured, so checkpoint/restore works out of the box without OrbStack or any host-level setup.

```
Mac host
└── Docker (host daemon)
    └── machinen-dind (privileged, inner dockerd + CRIU)
        └── your devcontainer  ← runs here
```

The `machinen-dind` image is built automatically on first run from `scripts/Dockerfile.dind`. It takes ~3–5 minutes to build (compiles CRIU from source). Subsequent runs reuse the cached image.

The DiND container runs with no memory or CPU limits — all workload containers inside it share the full host resources.

### Sleep/wake handoff

A compiled Swift helper (`src/power-helper.swift`) listens for macOS `NSWorkspace.willSleepNotification` and `didWakeNotification` events. On sleep, it takes a power assertion to delay sleep until the container migration completes.

Background sync checkpoints the container non-destructively every 5 minutes (`Exit: false` — CRIU dumps memory without stopping the process) and pushes to the registry. This means on sleep, only a small delta needs to transfer.

### Docker image layers

Checkpoint data is packaged as a Docker image layer on top of the container's original image:

```
Layer 1: base image (ubuntu:24.04, node:22, etc.)  <- cached everywhere
Layer 2: checkpoint (memory state, ~300KB-1MB)      <- only this transfers
```

Container config (image, cmd, env, network mode) is preserved in image labels so the container is recreated identically on the remote.

### Cloud providers

Machinen uses a pluggable provider interface for cloud server management. The default provider is Hetzner (`src/providers/hetzner.mjs`). A provider implements:

- `checkAuth()` — verify CLI is installed and authenticated
- `ensureSSHKey()` — upload local SSH public key, return key ID
- `getServer(name)` — return `{ id, ip }` or `null`
- `createServer({ name, type, image, location, sshKeyId, userData })` — return `{ id, ip }`
- `deleteServer(idOrName)` — destroy a server

To add a new provider, create `src/providers/<name>.mjs` exporting an object with these methods.

## Commands

| Command               | Description                                             |
| --------------------- | ------------------------------------------------------- |
| `up [options]`        | Start local devcontainer with sleep/wake cloud handoff  |
| `freeze <container>`  | Checkpoint, package as image layer, push to registry    |
| `restore <container>` | Provision server, pull image, restore container         |
| `watch [name]`        | Background sync daemon (checkpoint + push every 5 min)  |
| `open [name]`         | Open shell in local or remote container                 |
| `status [name]`       | Show sync state and recent registry images              |
| `logs [container]`    | Tail remote container logs, or list all active machines |
| `destroy [name]`      | Tear down a remote server (no args = destroy all)       |

### `up` options

| Flag            | Default             | Description               |
| --------------- | ------------------- | ------------------------- |
| `--file <path>` | auto-detected       | Path to devcontainer.json |
| `--name <name>` | from directory name | Container name            |

## Environment Variables

| Variable                     | Required for | Description                                                                        |
| ---------------------------- | ------------ | ---------------------------------------------------------------------------------- |
| `HCLOUD_TOKEN`               | optional     | Hetzner API token (alternative to `hcloud context create`)                         |
| `MACHINEN_REGISTRY`          | optional     | Container registry URL (defaults to `ghcr.io/<your-github-username>` via `gh` CLI) |
| `MACHINEN_REGISTRY_USER`     | optional     | Registry username (defaults to GitHub username via `gh` CLI)                       |
| `MACHINEN_REGISTRY_PASSWORD` | optional     | Registry password (defaults to `gh auth token`)                                    |

## Prerequisites

- **macOS or Linux** with Docker installed
- `gh` CLI authenticated (`gh auth login`)
- Cloud provider CLI installed and authenticated (default: `brew install hcloud && hcloud context create machinen`)
- Same CPU architecture on source and destination (ARM64 to ARM64)

`@devcontainers/cli` is included as a dependency — no global install needed.

CRIU and Docker experimental mode are handled automatically inside `machinen-dind`. No host-level CRIU or OrbStack needed.

## Testing

```bash
pnpm test
```

## Known Limitations

- **CPU architecture must match** between source and destination (ARM64 to ARM64)
- **Open TCP sockets break** unless using a mesh network like Tailscale
- **Bind mounts can't be checkpointed** — they need to be re-attached on restore
- **Kernel version parity** — large kernel version gaps may cause restore failures
- **CRIU on OrbStack** is not persisted across restarts — re-run preflight if OrbStack restarts
- **Sleep timing** — power assertion delays sleep but macOS may force sleep after ~2 minutes
