---
"@machinen/runtime": minor
---

Implement xattr ops in the live-mount FUSE server (#321).

Closes #321.

The mount-server previously returned `ENOSYS` for `SETXATTR` (21),
`GETXATTR` (22), `LISTXATTR` (23), and `REMOVEXATTR` (24). Tools never
crashed but every extended attribute written or read by the guest
inside a live mount silently vanished — `setcap` no-op'd, `rsync -X`
quietly lost data, `getfattr -d` came back empty regardless of what
the host actually stored. This change wires up all four ops end to
end against the host filesystem.

**Strategy.** Per-call shell-out to the platform-native tools, matching
issue #321's "Option A":

- darwin: `xattr -p -s -x` / `xattr -w -s -x` / `xattr -s` / `xattr -d -s`
- linux: `getfattr --only-values` / `setfattr -v 0sBASE64` /
  `getfattr --match=.` / `setfattr -x`

`-s` (darwin) and `--no-dereference` (linux) keep the call on the
symlink itself rather than its target, mirroring the rest of the
mount-server's existing `lstat`-shaped ops. Per-op cost is ~5–20 ms;
acceptable for the workloads the live-mount path was built for
(install-time `setcap`, occasional SELinux relabel, tar extracts with
xattrs). A future native-binding replacement can swap the internals
without changing the wire-side handlers.

**Namespace handling.** Names round-trip verbatim — no Linux
`user.*` / `security.*` / `trusted.*` translation. On a Linux host
the kernel polices the privileged namespaces, so a guest's `setcap`
lands as `EPERM` unless the host is root, which is closer-to-correct
degradation than the previous silent loss. On a darwin host names
aren't gated at all, so every name stores and reads cleanly inside the
mount — only invisible to Linux-specific host tools (`getcap` etc.),
which is the documented trade-off in the issue.

**XATTR_CREATE / XATTR_REPLACE.** The flag bits in `fuse_setxattr_in`
are honoured by a pre-existence check before the write, returning
`EEXIST` / `ENODATA` respectively. There's a TOCTOU race against
direct host-side activity outside the guest's view, but inside the
single mount the FUSE channel serialises every op, so the window only
matters when a third party writes through the host fs directly.

**ENODATA / ERANGE.** Both are added to the mount-server's `ERRNO`
table. macOS's `ENOATTR` (errno 93) is normalised to Linux's `ENODATA`
(61) on the wire so the guest kernel sees the canonical "no such
attribute" code regardless of host.

**Tests** in `mount-server.test.ts` follow the project's FUSE-op rules
in `CLAUDE.md`:

- Happy round-trip: set → probe → fetch → list → remove → re-get
  yields `-ENODATA`.
- Error: `-ENODATA` on get of an unset attribute; `-ERANGE` when the
  caller's fetch buffer is smaller than the value.
- `:ro` gate: `SETXATTR` and `REMOVEXATTR` return `-EROFS` and never
  touch the host; `GETXATTR` and `LISTXATTR` are allowed.
- Wedge guard: every assertion goes through `raceWithDeadline()` so a
  hang becomes a fast, specific test failure.

The four opcodes are removed from `UNIMPLEMENTED_OPS` in the same
file. Tests skip automatically when the host has neither
`getfattr`/`setfattr` (Linux) nor `xattr` (darwin) on `PATH` — a
developer without `attr` installed still gets a green local suite,
CI installs the package.
