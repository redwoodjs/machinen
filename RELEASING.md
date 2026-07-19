# Releasing

Machinen uses [Changesets](https://github.com/changesets/changesets) for
versioning and publishing. The public packages are in a `fixed` group
and bump together, so the unscoped `machinen` launcher, `@machinen/cli`,
`@machinen/runtime`, `@machinen/microvm`, `@machinen/mount-server`,
`@machinen/native-arm64-darwin`, `@machinen/native-arm64-linux`, and
`@machinen/native-x64-linux` always share a version. That keeps the launcher,
VMM protocol, and base rootfs from ever drifting.

## Making a Release

### 1. Add a Changeset

When you make a change worth releasing, run:

```sh
pnpm changeset
```

Pick the bump type (`patch` / `minor` / `major`) and write a summary.
This creates a markdown file in `.changeset/` — commit it with your PR.

### 2. Merge to `main`

The [release workflow](.github/workflows/release.yml) runs and opens a
**"chore: version packages"** PR that:

- Bumps the version in every package in the `fixed` group.
- Updates each package's `CHANGELOG.md`.
- Consumes the changeset files.

Multiple changesets accumulate into a single Version PR.

### 3. Publish

Merge the Version PR. The release workflow runs again and:

1. Natively builds the Zig VMM on `macos-15` (arm64),
   `ubuntu-24.04-arm`, and `ubuntu-latest` (amd64 Linux). Ad-hoc
   codesigns the darwin binary with the hypervisor entitlement.
2. Builds the arm64 and amd64 base assets: `Image-arm64`,
   `virt-arm64.dtb`, `rootfs-debian-arm64.tar.gz`, `bzImage-x86_64`,
   `rootfs-debian-amd64.tar.gz`, plus `.img.gz` fast-boot images and
   `.sha256` sidecars.
3. Stages each VMM binary into its native subpackage's `bin/` directory.
4. Publishes every `fixed`-group package to npm.
5. Creates a GitHub Release at the tag and uploads the base assets to it.

The CLI embeds its own version as `RELEASE_TAG` at build time, so
`machinen install` always fetches the matching base assets.

## Setup

The release workflow uses npm Trusted Publishing through GitHub Actions OIDC;
it does not store an `NPM_TOKEN`. Configure the workflow as a trusted publisher
for every public package on npm.

The first publication of the unscoped `machinen` package must be bootstrapped
from an npm user account with 2FA before npm can configure its trusted
publisher. After that, add both project maintainers as package owners and
configure `.github/workflows/release.yml` as its trusted publisher. The
launcher is then released with the scoped packages by Changesets.

## Local Commands

| Command          | Description                                    |
| ---------------- | ---------------------------------------------- |
| `pnpm changeset` | Add a new changeset                            |
| `pnpm version`   | Apply pending changesets locally (for testing) |
| `pnpm release`   | Build all packages and publish to npm          |
| `pnpm -r build`  | Build every package without publishing         |
