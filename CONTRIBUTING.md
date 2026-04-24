# Contributing

Thanks for hacking on machinen. This doc gets you to the point of running
`machinen` from source against a locally-built VMM + rootfs.

## Prerequisites

Today's dev targets are **arm64 macOS** (HVF) and **arm64 Linux** (KVM). x86_64
dev isn't wired up yet.

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

# 4. Stage the binary where @machinen/vmm-arm64-<os> expects it
cd ../..
mkdir -p packages/vmm-arm64-darwin/bin        # or vmm-arm64-linux/bin
cp packages/microvm/zig-out/bin/microvm packages/vmm-arm64-darwin/bin/microvm
```

## Run the CLI locally

One loose end normally handled by the release pipeline you need to cover by
hand in dev:

- **Base assets.** The CLI wants a kernel, device tree, and rootfs tarball.
  Ordinarily `machinen boot` fetches them from the GitHub Release that matches
  the CLI's own version. For an unreleased dev checkout, build them yourself
  and point the CLI at them with `MACHINEN_ASSETS_DIR`:

  ```bash
  ./scripts/build-base-assets.sh                  # outputs ./release-assets/
  export MACHINEN_ASSETS_DIR=$PWD/release-assets
  ```

Then boot a shell in a throwaway VM:

```bash
alias machinen="node $PWD/packages/cli/dist/cli.js"
machinen boot -- /bin/sh
```

**Heads up on the current state:** the released VMM binary (`zig build`, i.e.
`packages/microvm/src/main.zig`) is a scaffold — it prints a banner, detects
HVF/KVM, and exits. The boot-Linux code path exists but is only reachable via
`zig build test` + `packages/microvm/test-fixtures/assets/handoff.sh`. Wiring
`main.zig` up to the real boot code is tracked separately.

## Tests, lint, format

```bash
npx vitest run                      # unit tests (26, run from repo root)
pnpm run lint                       # oxlint
pnpm run format:check               # oxfmt
npx agent-ci run --all -q -p        # full local CI (mirrors GH Actions)
```

Before marking work done, the `/agent-ci` skill (see
[`.agents/skills/agent-ci/SKILL.md`](.agents/skills/agent-ci/SKILL.md)) and
[`CLAUDE.md`](CLAUDE.md) both require `npx vitest run` and `npx agent-ci run
--all -q -p` to pass.

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
- **Design docs:** drop-in notes under [`.docs/learnings/microvm/`](.docs/learnings/microvm/).
  No formal ADRs.
