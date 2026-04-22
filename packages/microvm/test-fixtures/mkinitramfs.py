#!/usr/bin/env python3
"""Build an initramfs cpio archive for the microvm boot test.

Newc cpio format, built byte-for-byte so we can include device nodes
that macOS's native cpio tooling can't produce.

Modes:
  minimal                       — tiny cpio with our hand-written /init
                                  + /dev/console.
  --rootfs <dir>                — wrap an already-extracted Alpine-style
                                  rootfs, then overlay our /init and
                                  ensure /dev/console exists.
  --workspace <dir> --out PATH  — emit a cpio containing only the files
                                  under <dir>, rooted at /workspace. Meant
                                  to be concatenated after the base
                                  initramfs.cpio so the kernel's multi-cpio
                                  unpacker drops the workspace into tmpfs
                                  at /workspace. No trailer — the kernel
                                  ignores everything after the trailer in
                                  the base archive; we write one trailer
                                  at the END of the concatenated stream.
"""
import fnmatch, os, shutil, stat, struct, subprocess, sys, tempfile, time
from pathlib import Path

HERE = Path(__file__).parent
OUT = HERE / "initramfs.cpio"
INIT = HERE / "init"

def newc(name, mode, uid=0, gid=0, nlink=1, mtime=0,
         rmajor=0, rminor=0, data=b""):
    """Emit one newc cpio entry."""
    name_b = name.encode() + b"\x00"
    hdr = b"070701"
    # Fields: ino, mode, uid, gid, nlink, mtime, filesize, devmajor,
    # devminor, rdevmajor, rdevminor, namesize, check.
    fields = [0, mode, uid, gid, nlink, mtime, len(data),
              0, 0, rmajor, rminor, len(name_b), 0]
    hdr += b"".join(f"{v:08x}".encode() for v in fields)
    out = hdr + name_b
    while len(out) % 4: out += b"\x00"
    out += data
    while len(out) % 4: out += b"\x00"
    return out

def load_excludes(path: Path) -> list[str]:
    """One pattern per line. Blank lines and '#' comments ignored.

    Patterns are rootfs-relative paths matched with fnmatch against
    each entry's rootfs-relative path during the walk. A match prunes
    the entry (and, if a directory, its subtree).
    """
    out = []
    for raw in path.read_text().splitlines():
        line = raw.split("#", 1)[0].strip()
        if line:
            out.append(line.lstrip("/"))
    return out


def entries_from_rootfs(root: Path, excludes: list[str] | None = None):
    """Yield cpio bytes for every file/dir/symlink under `root`.

    Walks manually (no os.walk/fwalk) because those follow symlinks
    to directories, which clobbers the /bin → /usr/bin style layout
    on modern Debian. Here a symlink — whether it points at a file
    or a directory — is always emitted as a symlink.

    `excludes` are fnmatch patterns matched against each entry's
    rootfs-relative path. A match prunes the entry and (for
    directories) its subtree.
    """
    root = str(root)
    ex = excludes or []
    skipped = {"files": 0, "bytes": 0}

    def excluded(rel: str) -> bool:
        for pat in ex:
            if fnmatch.fnmatchcase(rel, pat):
                return True
        return False

    def walk(rel):
        full = os.path.join(root, rel) if rel else root
        try:
            entries = sorted(os.listdir(full))
        except (OSError, FileNotFoundError):
            return
        for name in entries:
            child_rel = os.path.join(rel, name) if rel else name
            child_full = os.path.join(full, name)
            if excluded(child_rel):
                try:
                    st = os.lstat(child_full)
                    if stat.S_ISREG(st.st_mode):
                        skipped["files"] += 1
                        skipped["bytes"] += st.st_size
                except FileNotFoundError:
                    pass
                continue
            try:
                st = os.lstat(child_full)
            except FileNotFoundError:
                continue
            m = st.st_mode
            if stat.S_ISLNK(m):
                target = os.readlink(child_full).encode()
                yield newc(child_rel, 0o120000 | (m & 0o7777), data=target)
            elif stat.S_ISDIR(m):
                yield newc(child_rel, 0o40000 | (m & 0o7777))
                yield from walk(child_rel)
            elif stat.S_ISREG(m):
                with open(child_full, "rb") as fh:
                    data = fh.read()
                yield newc(child_rel, 0o100000 | (m & 0o7777), data=data)
            # skip other kinds (device/fifo/socket) — we add device
            # nodes we need by hand below.

    yield newc(".", 0o40755)
    yield from walk("")
    if ex:
        print(
            f"  excluded {skipped['files']} file(s), "
            f"{skipped['bytes'] / 1024 / 1024:.1f} MB at top level "
            f"(nested prunes not counted)",
            file=sys.stderr,
        )

DEFAULT_EXCLUDES = {
    ".git",
    "node_modules",
    ".zig-cache",
    "target",             # Rust
    "dist",               # built artifacts
    "build",              # CMake / autotools
    "__pycache__",
    ".venv", "venv",
    ".DS_Store",
    ".next", ".nuxt",     # framework caches
    ".cache",
    ".turbo",
    ".pnpm-store",
}


def workspace_cpio(src: Path, mountpoint: str = "workspace", excludes=None):
    """Yield cpio bytes for everything under `src`, rooted at `/<mountpoint>`.

    This is appended to the base initramfs.cpio; the Linux kernel's
    initramfs unpacker merges multiple concatenated cpio archives into
    the same rootfs tmpfs. We emit NO trailer here — the caller writes
    one trailer at the end of the whole stream.

    `excludes` is a set of directory/file names to skip (matched by
    basename at every level). Defaults to DEFAULT_EXCLUDES, which is
    the usual "don't ship my 700 MB node_modules into a tmpfs" list.
    """
    ex = set(DEFAULT_EXCLUDES) if excludes is None else set(excludes)
    yield newc(mountpoint, 0o40755)
    root = str(src)

    total_bytes = 0

    def walk(rel):
        nonlocal total_bytes
        full = os.path.join(root, rel) if rel else root
        try:
            entries = sorted(os.listdir(full))
        except (OSError, FileNotFoundError):
            return
        for name in entries:
            if name in ex:
                continue
            child_rel = os.path.join(rel, name) if rel else name
            child_full = os.path.join(full, name)
            arc_name = f"{mountpoint}/{child_rel}"
            try:
                st = os.lstat(child_full)
            except FileNotFoundError:
                continue
            m = st.st_mode
            if stat.S_ISLNK(m):
                target = os.readlink(child_full).encode()
                yield newc(arc_name, 0o120000 | (m & 0o7777), data=target)
            elif stat.S_ISDIR(m):
                yield newc(arc_name, 0o40000 | (m & 0o7777))
                yield from walk(child_rel)
            elif stat.S_ISREG(m):
                with open(child_full, "rb") as fh:
                    data = fh.read()
                total_bytes += len(data)
                yield newc(arc_name, 0o100000 | (m & 0o7777), data=data)

    yield from walk("")
    # Reveal the size so the try.sh caller can sanity-check.
    print(f"  workspace files: {total_bytes} bytes", file=sys.stderr)


def main():
    args = sys.argv[1:]
    # --workspace <dir> --out <path> [--exclude NAME]... [--max-mb N]
    if args and args[0] == "--workspace":
        src = Path(args[1]).resolve()
        out = None
        extra_ex = set()
        max_mb = 500  # sensible default: initramfs lives in tmpfs
        i = 2
        while i < len(args):
            if args[i] == "--out":
                out = Path(args[i + 1]).resolve()
                i += 2
            elif args[i] == "--exclude":
                extra_ex.add(args[i + 1])
                i += 2
            elif args[i] == "--max-mb":
                max_mb = int(args[i + 1])
                i += 2
            else:
                print(f"unknown flag: {args[i]}", file=sys.stderr)
                sys.exit(2)
        if out is None:
            print("--workspace requires --out <path>", file=sys.stderr)
            sys.exit(2)
        if not src.is_dir():
            print(f"--workspace: {src} is not a directory", file=sys.stderr)
            sys.exit(2)
        print(f"packing workspace: {src} -> {out}", file=sys.stderr)
        excludes = DEFAULT_EXCLUDES | extra_ex
        parts = list(workspace_cpio(src, excludes=excludes))
        # Size cap — the workspace lands in tmpfs and 4 GB of guest
        # RAM also has to hold the base rootfs + kernel. Fail loudly
        # rather than OOM the guest silently.
        total = sum(len(p) for p in parts)
        cap = max_mb * 1024 * 1024
        if total > cap:
            print(
                f"workspace is {total / 1024 / 1024:.0f} MB "
                f"(cap {max_mb} MB). Try --exclude <dir> for each big subdir, "
                f"or --max-mb <N> to raise the cap.",
                file=sys.stderr,
            )
            sys.exit(3)
        parts.append(newc("TRAILER!!!", 0))
        out.write_bytes(b"".join(parts))
        print(f"wrote {out} ({out.stat().st_size} bytes)", file=sys.stderr)
        return

    # Optional --out <path> override. Applies to --rootfs and minimal
    # modes; --workspace has its own --out handling above.
    out_override = None
    if "--out" in args:
        i = args.index("--out")
        out_override = Path(args[i + 1]).resolve()
        del args[i:i + 2]

    # Optional bundle config injected at /machinen-config.json. Bundle
    # mode (below) sets this; --rootfs callers can pass --config <path>
    # explicitly if they want the same behavior.
    config_bytes = None
    if "--config" in args:
        i = args.index("--config")
        config_bytes = Path(args[i + 1]).resolve().read_bytes()
        del args[i:i + 2]

    # Optional exclude list for --rootfs/--bundle modes. Patterns are
    # fnmatch-style against each entry's rootfs-relative path.
    excludes = []
    if "--exclude-from" in args:
        i = args.index("--exclude-from")
        excludes = load_excludes(Path(args[i + 1]).resolve())
        del args[i:i + 2]

    # Optional base rootfs tarball. When combined with --bundle, extract
    # the tarball into a temp dir, overlay the bundle's rootfs/ on top,
    # and pack the merged tree. Matches the overlay model in
    # .docs/learnings/microvm/rootfs-contract.md — bundles ship diffs,
    # not standalone rootfses.
    base_tarball = None
    if "--base" in args:
        i = args.index("--base")
        base_tarball = Path(args[i + 1]).resolve()
        del args[i:i + 2]
        if not base_tarball.is_file():
            print(f"--base: {base_tarball} is not a regular file", file=sys.stderr)
            sys.exit(2)

    merge_tmp = None
    bundle_mode = False

    if args and args[0] == "--bundle":
        bundle_mode = True
        # Bundle layout: <dir>/rootfs + <dir>/machinen-config.json.
        bundle = Path(args[1]).resolve()
        rootfs_dir = bundle / "rootfs"
        cfg_path = bundle / "machinen-config.json"
        if not rootfs_dir.is_dir():
            print(f"--bundle: missing {rootfs_dir}", file=sys.stderr)
            sys.exit(2)
        if not cfg_path.is_file():
            print(f"--bundle: missing {cfg_path}", file=sys.stderr)
            sys.exit(2)

        if base_tarball is not None:
            merge_tmp = Path(tempfile.mkdtemp(prefix="machinen-mkinitramfs-"))
            print(f"extracting base: {base_tarball} -> {merge_tmp}")
            subprocess.run(
                ["tar", "-xzf", str(base_tarball), "-C", str(merge_tmp)],
                check=True,
            )
            print(f"overlaying bundle/rootfs: {rootfs_dir} -> {merge_tmp}")
            shutil.copytree(
                rootfs_dir, merge_tmp,
                dirs_exist_ok=True, symlinks=True,
            )
            pack_src = merge_tmp
        else:
            pack_src = rootfs_dir

        print(f"packing bundle: {bundle}")
        try:
            parts = list(entries_from_rootfs(pack_src, excludes=excludes))
        finally:
            if merge_tmp is not None:
                shutil.rmtree(merge_tmp, ignore_errors=True)
        config_bytes = cfg_path.read_bytes()
    elif args and args[0] == "--rootfs":
        root = Path(args[1]).resolve()
        print(f"packing rootfs: {root}")
        parts = list(entries_from_rootfs(root, excludes=excludes))
    else:
        # Minimal mode: just our init.
        init_bytes = INIT.read_bytes()
        parts = [
            newc(".", 0o40755),
            newc("dev", 0o40755),
            newc("init", 0o100755, data=init_bytes),
        ]
    # Legacy --rootfs callers (try.sh, smoke.sh, handoff.sh) pass a
    # rootfs tree that doesn't carry its own /init, so we slap our
    # pre-compiled test-fixtures/init on top. --bundle mode gets /init
    # from the base rootfs tarball (built by build-base-assets.sh) and
    # overriding it here would shadow build-time updates — don't.
    if not bundle_mode and INIT.exists():
        init_bytes = INIT.read_bytes()
        parts.append(newc("init", 0o100755, data=init_bytes))
    if config_bytes is not None:
        parts.append(newc("machinen-config.json", 0o100644, data=config_bytes))
    # Bake the host's current epoch so /init can set the guest clock.
    # Without this the guest boots at 1970-01-01 and TLS + apt Release
    # date validation break.
    parts.append(newc("etc", 0o40755))
    parts.append(newc(
        "etc/machinen-boot-epoch",
        0o100644,
        data=str(int(time.time())).encode(),
    ))
    parts.append(newc("dev", 0o40755))
    parts.append(newc("dev/console", 0o20600, rmajor=5, rminor=1))
    # Force /tmp to the canonical sticky-world-writable (1777). The base
    # tarball ships /tmp that way but macOS tar strips the sticky bit
    # when extracting as non-root, so apt (which drops privs to _apt for
    # downloads) fails with "Couldn't create temporary file".
    parts.append(newc("tmp", 0o41777))
    # Trailer.
    parts.append(newc("TRAILER!!!", 0))

    dst = out_override if out_override is not None else OUT
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(b"".join(parts))
    print(f"wrote {dst} ({dst.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
