# Remote IP targeting

## Problem

`--remote` is a boolean flag that always provisions a Hetzner VM. You can't
point machinen at a machine you already have (e.g. a VM on your Proxmox
server at `192.168.0.201`).

## Solution

Let `--remote` optionally accept an IP address:

```bash
# Hetzner (unchanged — provisions a new VM)
machinen restore mycontainer --remote

# Target a specific machine (skips provisioning entirely)
machinen restore mycontainer --remote 192.168.0.201
```

When `--remote` has an IP, skip `provisionServer()` — no provider calls, no
cloud-init wait. Just SSH in and do the work.

Works for all `--remote` commands:

```bash
machinen restore mycontainer --remote 192.168.0.201
machinen open mycontainer --remote 192.168.0.201
machinen destroy mycontainer --remote 192.168.0.201
```

### Prerequisites

The target machine must be set up once with Docker 28, patched CRIU, and
correct cgroup config:

```bash
machinen setup-script | ssh root@192.168.0.201 bash
```

### Code changes

1. **`packages/cli/src/machinen.ts`**: Change `--remote` from boolean to
   optional string (IP). Pass the IP through to operations.

2. **`packages/sdk/src/operations.ts`**: In `migrate()`, when an IP is
   provided, skip `provisionServer()` and use the IP directly.

3. **`packages/cli/src/machinen.ts`**: Add `setup-script` command that
   prints the cloud-init script to stdout.

### What doesn't change

Everything about checkpointing, registry push/pull, and remote restore.
Those only need an IP and SSH — they don't care where the machine came from.
