# Server Provisioning

Servers are provisioned on-demand using cloud-init with Ubuntu 24.04 and the
stock kernel. Cloud-init installs Docker, CRIU, Node.js, and the devcontainer
CLI.

## Provisioning Flow

```
provisionServer()
  │
  ├─ Check for existing server (reuse if found)
  ├─ Create cax11 (arm64) with ubuntu-24.04
  ├─ Cloud-init installs:
  │   ├─ Docker (with experimental mode for checkpoints)
  │   ├─ CRIU (built from source)
  │   ├─ crit (CRIU Image Tool, for checkpoint editing)
  │   ├─ Node.js 22 + devcontainer CLI
  │   └─ Build dependencies
  ├─ Poll for /root/.machinen-ready
  └─ Return server IP
```

## Timing

A fresh server takes ~2-3 minutes to be ready (cloud-init). Existing servers
are reused instantly.

## Mount Patching

CRIU checkpoints taken locally contain OrbStack-specific mount types (`mac`,
`orbstack`, `virtiofs`) that don't exist on a standard Linux server. At restore
time, `crit` is used to decode the checkpoint's `mountpoints-*.img`, strip
these entries, and re-encode. Workspace files are extracted separately at freeze
time and re-mounted as regular bind mounts on the remote.

See [kernel-matching.md](kernel-matching.md) for details on kernel
compatibility.
