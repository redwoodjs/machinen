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

On darwin you'll also want `brew install libslirp` (user-mode network backend)
and an ad-hoc codesign so the Hypervisor entitlement takes effect:

```bash
codesign -s - --force --entitlements entitlements.plist zig-out/bin/microvm
```

On linux, install `libslirp0`/`libslirp` via your package manager.

## Run

The VMM expects a kernel, device tree, and initramfs — see
[`.docs/learnings/microvm/rootfs-contract.md`](../../.docs/learnings/microvm/rootfs-contract.md)
for the contract. In practice you drive it through `@machinen/runtime`:

```ts
import { spawn } from "@machinen/runtime";
const vm = await spawn({ binary: "./zig-out/bin/microvm", bundle: "./my-bundle" });
```

## License

MIT
