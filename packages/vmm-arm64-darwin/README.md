# @machinen/vmm-arm64-darwin

Native arm64 VMM binary for Apple Silicon macOS, shipped as an npm package so
`@machinen/cli` can resolve it via `optionalDependencies`.

Built from the Zig source in [`packages/microvm`](https://github.com/redwoodjs/machinen/tree/main/packages/microvm),
codesigned with the Hypervisor entitlement, ships under `bin/microvm`.

The package also ships a sibling `bin/gvproxy` — the
[gvisor-tap-vsock](https://github.com/containers/gvisor-tap-vsock) daemon that
provides the user-mode network backend. `@machinen/runtime` auto-spawns it
when present.

## Install

Usually you don't install this directly — `@machinen/cli` pulls it in:

```bash
npm i -g @machinen/cli
```

If you're embedding `@machinen/runtime` without the CLI:

```bash
npm i @machinen/vmm-arm64-darwin
```

The package's `os`/`cpu` gates will refuse installation on anything other than
`darwin` + `arm64`.

## Usage

```ts
import { spawn } from "@machinen/runtime";
import { binary } from "@machinen/vmm-arm64-darwin";

const vm = await boot({ binary, image: "./rootfs-debian-arm64.tar.gz", cmd: ["/bin/sh"] });
```

## License

[FSL-1.1-MIT](../../LICENSE) — converts to MIT two years after each release.
