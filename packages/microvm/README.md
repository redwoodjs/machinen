# @machinen/microvm

Zig source for the native arm64 microVM that powers
[machinen](https://github.com/redwoodjs/machinen).

- **darwin** (Apple Silicon) — uses HVF (`Hypervisor.framework`)
- **linux** (arm64) — uses KVM

The pre-built binaries ship as [`@machinen/vmm-arm64-darwin`](../vmm-arm64-darwin)
and [`@machinen/vmm-arm64-linux`](../vmm-arm64-linux). This package is the
source if you want to build the VMM yourself.

## Build

Requires [Zig 0.16.0](https://ziglang.org/download/).

```bash
zig build -Doptimize=ReleaseSafe
# → zig-out/bin/microvm
```

On darwin, ad-hoc codesign so the Hypervisor entitlement takes effect:

```bash
codesign -s - --force --entitlements entitlements.plist zig-out/bin/microvm
```

### Networking (optional)

The VMM talks to [gvproxy](https://github.com/containers/gvisor-tap-vsock)
over a Unix socket for virtio-net — no kernel entitlements, no
privileged daemon. If `MACHINEN_NET_SOCKET` is set, the VMM dials that
socket; otherwise networking is disabled and the rest of the VMM runs
as usual.

```bash
# install gvproxy (ships with podman on macOS/Linux, or grab a
# release binary from the gvisor-tap-vsock project)
gvproxy -listen-qemu unix:///tmp/gv.sock &
MACHINEN_NET_SOCKET=/tmp/gv.sock zig-out/bin/microvm …
```

Guest-side defaults: `eth0=192.168.127.2/24`, gateway+DNS
`192.168.127.1` — applied by `/sbin/machinen-netup` in the baked
rootfs.

## Run

The VMM expects a kernel, device tree, and initramfs — see
[`.docs/learnings/microvm/rootfs-contract.md`](../../.docs/learnings/microvm/rootfs-contract.md)
for the contract. In practice you drive it through `@machinen/runtime`:

```ts
import { spawn } from "@machinen/runtime";
const vm = await spawn({ binary: "./zig-out/bin/microvm", bundle: "./path/to/bundle" });
```

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
