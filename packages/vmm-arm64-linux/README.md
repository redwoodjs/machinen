# @machinen/vmm-arm64-linux

Native arm64 VMM binary for Linux, shipped as an npm package so `@machinen/cli`
can resolve it via `optionalDependencies`.

Built from the Zig source in [`packages/microvm`](https://github.com/redwoodjs/machinen/tree/main/packages/microvm);
ships under `bin/microvm`. Uses KVM for hardware virtualization (host must have
`/dev/kvm` accessible).

## Install

Usually you don't install this directly — `@machinen/cli` pulls it in:

```bash
npm i -g @machinen/cli
```

If you're embedding `@machinen/runtime` without the CLI:

```bash
npm i @machinen/vmm-arm64-linux
```

The package's `os`/`cpu` gates will refuse installation on anything other than
`linux` + `arm64`.

## Runtime dependency: libslirp

The VMM dynamically links `libslirp` for its user-mode network backend. Until
it's statically linked, install it through your package manager:

- Debian/Ubuntu: `apt install libslirp0`
- Fedora/RHEL: `dnf install libslirp`
- Alpine: `apk add libslirp`

The package's postinstall script probes the usual locations and prints a hint
if it can't find the library.

## Usage

```ts
import { spawn } from "@machinen/runtime";
import { binary } from "@machinen/vmm-arm64-linux";

const vm = await spawn({ binary, bundle: "./my-bundle" });
```

## License

MIT
