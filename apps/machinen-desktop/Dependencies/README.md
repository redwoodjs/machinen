# Desktop build dependencies

Machinen Desktop embeds Ghostty's renderer and terminal core. Ghostty is fetched
and compiled during development; its generated XCFramework and source tree are
not committed. A transferable app bundle also includes the active Node.js
runtime for its trusted TypeScript status services.

## Ghostty

- Version: 1.3.1
- Commit: `332b2aefc6e72d363aa93ab6ecfc86eeeeb5ed28`
- Source archive SHA-256: `49db8f7db265f53833e781d6084318b4cfab65f1ea6b6832b8a93df829481165`
- Official macOS image SHA-256: `18cff2b0a6cee90eead9c7d3064e808a252a40baf214aa752c1ecb793b8f5f69`
- Extracted Metal library SHA-256: `6893dea958b8d89b58c0ccefb1bfdb589ba4bb0c6fd1a0d73fe38a1715650918`
- Extracted `xterm-ghostty` SHA-256: `707349400682f7e3d4e29792035847875fa55879672dfae39247b3d23eb58f91`
- Build patch SHA-256: `94882c1c0f3786c6d0736dd582a153c536b6ada0a256fe436117f568b9f4a78d`
- License: MIT; see [`GHOSTTY-LICENSE`](./GHOSTTY-LICENSE)

[`../prepare-ghostty.sh`](../prepare-ghostty.sh) verifies these hashes, applies
the small build-only patch, and creates `GhosttyKit.xcframework`. The patch:

1. adds a static-library build step for Machinen;
2. avoids requiring the iOS SDK for a native macOS-only build;
3. combines Zig archives with `zig ar` so archive members remain readable on
   current macOS releases; and
4. uses the Metal library from Ghostty's official build when Apple's standalone
   Command Line Tools do not include the Metal compiler.

The official Metal library and macOS terminfo entry are the only generated
Ghostty artifacts committed here. Together they are under 60 KiB. Shell
integration is copied from the verified source archive into SwiftPM's generated
resource bundle.

Ghostty 1.3.1 requires Zig 0.15.2. The preparation script uses a matching
Homebrew installation when available, or downloads the checksum-pinned official
compiler. Machinen Session continues to use the repository's Zig 0.16 toolchain.

## Node.js

[`../build-app.sh`](../build-app.sh) compiles `@machinen/desktop-services`, copies
the active architecture's `process.execPath` into `Contents/Helpers`, and places
the Node.js license in the app's resources. Use the repository's [`.nvmrc`](../../../.nvmrc)
when producing a release bundle. Node is kept as a separate signed helper so the
Swift app can supervise it and the service remains replaceable during source
development.
