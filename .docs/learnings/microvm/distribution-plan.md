# Distribution plan — how machinen ships the VMM and bases

Companion to `rootfs-contract.md`. That doc says _what_ a user hands to
`spawn()`. This one says _how the bits get onto their machine_.

## Problem

For docs to read `npm i -g @machinen/cli && machinen run ./my-bundle`,
three things need to land on the user's disk:

1. The **VMM binary** — the Zig-built `microvm` executable. Small (~
   few MB), host-arch-specific.
2. A **guest kernel** — arm64 Linux `Image` + `virt.dtb`. ~27 MB.
3. A **base rootfs** — minimal Linux userspace to start from. v0 ships
   `debian` only; `alpine` deferred until there's a real size/perf
   reason to care. ~80 MB stripped, ~300 MB unstripped.

None of these are JavaScript. All are platform- or arch-specific.

## Solution overview

Hybrid, split by asset size and selection semantics:

- **VMM binary → npm, via optional platform deps.** Small enough that
  baking it into the install step is free; users get a working VMM the
  moment `npm install` finishes. Same pattern as esbuild, swc, biome.
- **Kernel + rootfs → GitHub Releases, lazy-fetched on first use.** Too
  big for npm tarballs to be pleasant, and not arch-selected the same
  way (same arm64 guest assets serve both darwin and linux hosts).
  Fetched the first time `machinen run --base debian` needs them;
  cached under `~/.machinen/`.

```
user → npm install -g @machinen/cli
        ↓ (optionalDependencies)
       @machinen/vmm-<arch>-<os>  (small, ships with the install)

user → machinen run --base debian -- /bin/sh
        ↓ (first run only)
       fetch github.com/redwoodjs/machinen/releases/download/vX.Y.Z/*
        ↓
       ~/.machinen/v<X.Y.Z>/bases/debian-arm64/{Image, virt.dtb, rootfs.tar.gz}
        ↓
       spawn VMM
```

## VMM packages (npm)

One per host we support. v0 ships:

- `@machinen/vmm-arm64-darwin` — Apple Silicon, HVF backend.
- `@machinen/vmm-arm64-linux` — Linux ARM64, KVM backend.

`x64-linux` and `x64-darwin` come later; neither is built today
(kernel + KVM path are arm64-only right now).

The naming follows Zig/Rust target-triple ordering (`aarch64-macos`,
`aarch64-apple-darwin`) rather than the esbuild/swc convention. Since
the VMM is a Zig binary this reads more naturally, and while v0 only
ships arm64 the two packages sort together in any alphabetical listing.

```
@machinen/vmm-arm64-darwin/
├── package.json        # { "os": ["darwin"], "cpu": ["arm64"],
│                       #   "main": "./index.mjs" }
├── bin/
│   └── microvm         # Zig binary, ad-hoc codesigned with
│                       # com.apple.security.hypervisor on darwin.
└── index.mjs           # export const binary = path to ./bin/microvm
```

`index.mjs` resolves its own path:

```js
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
export const binary = join(dirname(fileURLToPath(import.meta.url)), "bin", "microvm");
```

`@machinen/cli` lists every VMM variant as `optionalDependencies`; npm
silently skips the ones whose `os`/`cpu` fields don't match, so only
the right binary lands on disk.

## Base assets (GitHub Releases)

Each release tag `vX.Y.Z` publishes a fixed set of guest assets:

- `Image-arm64` — arm64 Linux kernel.
- `virt-arm64.dtb` — device tree blob.
- `rootfs-debian-arm64.tar.gz` — base userspace (includes `/init` +
  vsock agents).
- `*.sha256` alongside each.

Same arm64 guest assets serve both darwin and linux hosts — HVF and
KVM both boot the same Linux/arm64 guest.

### On-disk cache layout

```
~/.machinen/
├── v1.2.3/
│   └── bases/
│       └── debian-arm64/
│           ├── Image
│           ├── virt.dtb
│           ├── rootfs.tar.gz
│           └── rootfs/      # extracted lazily on first use
└── current -> v1.2.3
```

- Versioned directory so multiple CLI versions coexist on one machine.
- `current` symlink updated by the CLI when it successfully pulls a
  new version.
- Rootfs tarball stays so re-extraction is cheap; the extracted tree
  next to it is what `spawn()` copies from.

### Download mechanics

- `fetch()` from `https://github.com/redwoodjs/machinen/releases/download/<tag>/<asset>`.
- Verify SHA-256 against the `.sha256` sibling fetched from the same
  release.
- Atomic rename into `~/.machinen/<tag>/` (download to a tmp file,
  rename on success, clean up on failure).
- Parallel downloads — independent assets.

Failure modes:

- No network at first run → clear error naming the release URL and
  suggesting `machinen install` on a machine with connectivity, then
  copying `~/.machinen/` over.
- Partial download → SHA check fails, retry once, then bail.
- GitHub rate-limit on unauthenticated requests (60/hr) → respect
  `GITHUB_TOKEN` env var if set, otherwise fine for end users.

## CLI surface

```
machinen run <bundle-dir>                 # explicit bundle, implicit base
machinen run -- /bin/sh                   # base-only, inline cmd
machinen run --env FOO=bar -- node /srv/app.js

machinen install                          # pre-fetch current-tag base assets
machinen install --version v1.2.3         # pin a specific release
```

The base is implicit — debian is the only one v0 ships, and we don't
make users type that. When alpine (or any other base) lands, `--base`
reappears as an opt-out from the default, not a required flag.

`machinen run` calls `ensureBaseAssets(currentVersion)` internally,
which is the same code `machinen install` exposes. First invocation
downloads + caches; subsequent runs are instant.

No flags for `--kernel` / `--vmm` / `--base-tarball` in v0 — env vars
cover the edge cases without cluttering the help text.

## Runtime resolution

`@machinen/runtime`'s `spawn()`:

```ts
export interface SpawnOptions {
  /** Path to VMM binary. If omitted, falls back through the chain below. */
  binary?: string;

  /** Bundle directory (rootfs/ + machinen-config.json). */
  bundle?: string;

  /**
   * Instead of supplying bundle, supply a base distro and the runtime
   * materializes a minimal bundle (extracted rootfs + a generated
   * machinen-config.json from cmd/env/cwd).
   */
  /** Reserved for future distros; defaults to "debian". */
  base?: "debian";
  cmd?: string[];
  env?: Record<string, string>;
  cwd?: string;
}
```

Resolution order for `binary`:

1. `opts.binary` if given.
2. `process.env.MACHINEN_VMM` if set (dev override → `zig-out/bin/microvm`).
3. `require.resolve("@machinen/vmm-<arch>-<os>")` → its
   exported `binary` path.
4. Throw with a clear message naming the expected package and
   suggesting the install command.

Resolution for `base`:

1. `~/.machinen/current/bases/<distro>-<arch>/rootfs/` — extracted tree.
2. If missing, extract from `rootfs.tar.gz` next to it.
3. If that's missing, trigger the asset fetch (and require network).

The existing `MACHINEN_KERNEL` / `MACHINEN_DTB` env-var overrides the
VMM reads stay valid; the runtime auto-populates them from the base
cache when `base` is used.

## Version pinning

The CLI's `package.json` version is the source of truth. Each CLI
version is hard-pinned to the matching release tag — building CLI
`1.2.3` bakes in `const RELEASE_TAG = "v1.2.3"`. That way `npm install
-g @machinen/cli@1.2.3` → always gets the matching `v1.2.3` base
assets, no drift.

VMM packages share the same version, bumped together, so the VMM a
user has from npm and the kernel + rootfs they download from GitHub
are always a matched set. This dodges the "vsock agent protocol
drifted between VMM and rootfs" class of bug.

## Release mechanics

One GitHub Actions workflow per tag push:

1. **VMM matrix.** For each `(arch, os)`:
   - `zig build -Doptimize=ReleaseSafe -Dtarget=<zig-target>`
   - On darwin: `codesign -s - --force --entitlements entitlements.plist`.
   - `npm publish @machinen/vmm-<arch>-<os>`.

2. **Base asset matrix.** For each guest `arch`:
   - Extract the Debian cloud kernel → `Image-<arch>`.
   - Compile `virt.dts` → `virt-<arch>.dtb`.
   - Build the rootfs tarball from `node:lts-slim` export, inject
     `/init` + vsock agents → `rootfs-debian-<arch>.tar.gz`.
   - `shasum -a 256` alongside each.
   - Upload to the release.

3. **CLI publish.** `npm publish @machinen/cli` with the matching
   version (picks up VMM packages via `optionalDependencies`, knows
   the release tag for base fetches).

## libslirp: dynamic for v0 (will be removed)

The VMM links libslirp dynamically — on darwin from `/opt/homebrew/lib`,
on linux from the system loader path. v0 ships that way and documents
the prereq:

- darwin: `brew install libslirp`
- linux: `apt install libslirp0` (or distro equivalent)

A `postinstall` script in each `@machinen/vmm-arm64-*` package probes
for the shared library and prints a friendly install hint if missing,
so the failure mode is `npm install` → hint → one `brew install` →
done, not a cryptic dlopen error on first `machinen run`.

**This is temporary.** The long-term answer is static-linking libslirp
into the Zig binary — build from source in the release pipeline with
`-Dglib=disabled`, link a single `libslirp.a`, zero system deps. We
switch to that once the onboarding friction from the dynamic prereq
actually bites, or when someone wants to use machinen on a host with
no easy libslirp package (nix-less linux, no-homebrew mac, etc.).
Deliberately not a v0 blocker; revisit when it's cheaper than the
step in the docs.

## Dev-mode fallback

Inside the monorepo, contributors want `machinen run` to use the
locally built `zig-out/bin/microvm` and local `test-fixtures/`, not
published artifacts.

- `MACHINEN_VMM=packages/microvm/zig-out/bin/microvm` — env var wins
  over `require.resolve`. Dev shell rc sets it.
- `MACHINEN_KERNEL` / `MACHINEN_DTB` — same pattern for kernel assets.
- `MACHINEN_BASE_DIR=packages/microvm/test-fixtures/rootfs-debian` —
  points base resolution at a pre-extracted tree in the repo.

All three documented in `CLAUDE.md` for contributors.

## What this explicitly is not

- **Not a Docker image.** VMM on npm, everything else a GitHub
  release asset. No OCI anywhere.
- **Not per-user entitlement signing.** macOS hypervisor entitlement
  is satisfied by ad-hoc signing at build time; no Apple Developer ID
  required.
- **Not a postinstall-downloader for the VMM.** The VMM ships inside
  the platform-specific npm tarball — works offline after install.
- **Not kernel/rootfs on npm.** Too big for pleasant tarballs, and
  lazy-download gives a better offline story (first run needs
  network; after that nothing does).

## Open questions

- **Rootfs size.** Debian base is 300 MB raw; with `/usr/share/doc`,
  `/usr/share/locale`, dev headers stripped, ~80 MB. Target the
  stripped version; if still too heavy for first-run download, zstd
  over gzip saves another ~30%.
- **Windows.** Not on the map. If/when, it's a WSL2 passthrough story,
  not a fourth `@machinen/vmm-<arch>-win32`.
- **Snapshot distribution.** `rootfs-contract.md` already says
  snapshots travel via scp/S3/releases — same channel as base assets,
  just user-generated. Nothing conflicts.
- **Caching in CI.** Every CI job starting cold pays the one-time base
  download. `actions/cache` on `~/.machinen/` keyed on CLI version
  handles it; document the snippet.
- **Update prompting.** Should `machinen` warn when a newer release
  exists? Probably no — pinning to the CLI's installed version is a
  feature. `npm update -g @machinen/cli` is the one-liner.
