# @machinen/vmm-arm64-darwin

Native arm64 VMM binary for Apple Silicon macOS, shipped as an npm package so
`@machinen/cli` can resolve it via `optionalDependencies`.

Built from the Zig source in [`packages/microvm`](https://github.com/redwoodjs/machinen/tree/main/packages/microvm),
codesigned with the Hypervisor entitlement, ships under `bin/microvm`.

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

## Runtime dependency: libslirp

The VMM dynamically links `libslirp` for its user-mode network backend. Until
it's statically linked, install it via Homebrew:

```bash
brew install libslirp
```

The package's postinstall script probes the usual locations and prints a hint
if it can't find the library.

## Usage

```ts
import { spawn } from "@machinen/runtime";
import { binary } from "@machinen/vmm-arm64-darwin";

const vm = await spawn({ binary, bundle: "./path/to/bundle" });
```

## License

MIT
