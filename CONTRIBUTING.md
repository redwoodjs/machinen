# Contributing

Thanks for hacking on machinen. This doc gets you to the point of running
`machinen` from source against a locally-built VMM + rootfs.

## Prerequisites

Today's dev targets are **arm64 macOS** (HVF), **arm64 Linux** (KVM), and
**x86_64 Linux** (KVM). Intel macOS/HVF is not a supported target.

| Tool   | Version                                           | Install                                                           |
| ------ | ------------------------------------------------- | ----------------------------------------------------------------- |
| Node   | 22+                                               | [nodejs.org](https://nodejs.org) or `fnm`/`nvm`                   |
| pnpm   | see [package.json `packageManager`](package.json) | `corepack enable`                                                 |
| Zig    | 0.16.0                                            | `brew install zig` · [ziglang.org](https://ziglang.org/download/) |
| Docker | any                                               | Docker Desktop / OrbStack / Colima                                |
| dtc    | any                                               | `brew install dtc` · `apt install device-tree-compiler`           |

Clone and install:

```bash
git clone https://github.com/redwoodjs/machinen.git
cd machinen
pnpm install
```

## Build

The TypeScript packages (`@machinen/cli`, `@machinen/runtime`) and the Zig VMM
live in the same repo. Both need to build before you can run.

```bash
# 1. TypeScript packages
pnpm -F @machinen/runtime -F @machinen/cli build

# 2. Zig VMM (host-native — HVF on darwin, KVM on linux)
cd packages/microvm
zig build -Doptimize=ReleaseSafe

# 3. (darwin only) codesign with the hypervisor entitlement
codesign -s - --force --entitlements entitlements.plist zig-out/bin/microvm

# 4. Stage the binary where the matching native package expects it
cd ../..
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) pkg=packages/native-arm64-darwin ;;
  Linux:aarch64|Linux:arm64) pkg=packages/native-arm64-linux ;;
  Linux:x86_64|Linux:amd64) pkg=packages/native-x64-linux ;;
  *) echo "unsupported dev host" >&2; exit 1 ;;
esac
mkdir -p "$pkg/vmm/bin"
cp packages/microvm/zig-out/bin/microvm "$pkg/vmm/bin/machinen-vm"
```

## Run the CLI locally

One loose end normally handled by the release pipeline you need to cover by
hand in dev:

- **Base assets.** The CLI wants a kernel, rootfs tarball, and (for arm64
  guests) a device tree. Ordinarily `machinen boot` fetches the right guest
  architecture from the GitHub Release that matches the CLI's own version. For
  an unreleased dev checkout, build them yourself and point the CLI at them
  with `MACHINEN_ASSETS_DIR`:

  ```bash
  ./scripts/build-base-assets.sh                  # outputs ./release-assets/
  export MACHINEN_ASSETS_DIR=$PWD/release-assets
  ```

  Host architecture picks the guest architecture by default (`arm64` on Apple
  Silicon/arm64 Linux, `amd64` on x86_64 Linux). Override with
  `MACHINEN_GUEST_ARCH=arm64` or `MACHINEN_GUEST_ARCH=amd64` when needed.

Then boot a shell in a throwaway VM:

```bash
alias machinen="node $PWD/packages/cli/dist/cli.js"
machinen boot -- /bin/sh
```

## Tests, lint, format

```bash
npx vitest run                      # unit tests (run from repo root)
pnpm run lint                       # oxlint
pnpm run format:check               # oxfmt
npx agent-ci run --all -q -p        # full local CI (mirrors GH Actions)
```

Before marking work done, follow the validation rules in
[`AGENTS.md`](AGENTS.md). Run Agent CI only for workflow/CI changes or when a
reviewer asks for broad CI validation.

## Making a change

```bash
git checkout -b my-change
# ... hack ...

# For any user-visible change, add a changeset:
pnpm changeset
# → writes .changeset/<name>.md — commit it with the rest of your PR

git commit -am "..."
git push -u origin my-change
gh pr create
```

The [release pipeline](RELEASING.md) opens a "chore: version packages" PR when
your PR merges to `main`. Merging that PR publishes to npm.

## Code conventions

- **Language:** Node ESM + TypeScript. Use `import`, never `require`.
- **Package manager:** pnpm. Don't commit `package-lock.json` / `yarn.lock`.
- **Formatter:** oxfmt. Run `pnpm run format` before pushing.
- **Linter:** oxlint (rules in the root config). No warnings tolerated.
- **Tests:** vitest (TS), `zig build test` (Zig).
- **Design docs:** keep product-facing docs under [`docs/`](docs/) and VMM
  internals under [`packages/microvm/docs/`](packages/microvm/docs/).
