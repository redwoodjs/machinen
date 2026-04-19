#!/usr/bin/env python3
"""Build an initramfs cpio archive for the microvm boot test.

Newc cpio format, built byte-for-byte so we can include device nodes
that macOS's native cpio tooling can't produce.

Modes:
  minimal           — tiny cpio with our hand-written /init + /dev/console.
  --rootfs <dir>    — wrap an already-extracted Alpine-style rootfs, then
                      overlay our /init and ensure /dev/console exists.
"""
import os, stat, struct, sys
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

def entries_from_rootfs(root: Path):
    """Yield cpio bytes for every file/dir/symlink under `root`."""
    # root itself as "."
    yield newc(".", 0o40755)
    for dirpath, dirnames, filenames, dirfd in os.fwalk(root):
        rel_dir = os.path.relpath(dirpath, root)
        # dirs
        for d in sorted(dirnames):
            full = os.path.join(dirpath, d)
            rel = os.path.join(rel_dir, d) if rel_dir != "." else d
            st = os.lstat(full)
            yield newc(rel, 0o40000 | (st.st_mode & 0o7777))
        # files + symlinks
        for f in sorted(filenames):
            full = os.path.join(dirpath, f)
            rel = os.path.join(rel_dir, f) if rel_dir != "." else f
            try:
                st = os.lstat(full)
            except FileNotFoundError:
                continue
            m = st.st_mode
            if stat.S_ISLNK(m):
                target = os.readlink(full).encode()
                yield newc(rel, 0o120000 | (m & 0o7777), data=target)
            elif stat.S_ISREG(m):
                with open(full, "rb") as fh:
                    data = fh.read()
                yield newc(rel, 0o100000 | (m & 0o7777), data=data)
            # skip other kinds (device/fifo/socket) — we'll add the
            # device nodes we need by hand below.

def main():
    args = sys.argv[1:]
    if args and args[0] == "--rootfs":
        root = Path(args[1]).resolve()
        print(f"packing rootfs: {root}")
        parts = list(entries_from_rootfs(root))
    else:
        # Minimal mode: just our init.
        init_bytes = INIT.read_bytes()
        parts = [
            newc(".", 0o40755),
            newc("dev", 0o40755),
            newc("init", 0o100755, data=init_bytes),
        ]
    # Always ensure /init is our compiled one and /dev/console exists.
    if INIT.exists():
        init_bytes = INIT.read_bytes()
        parts.append(newc("init", 0o100755, data=init_bytes))
    parts.append(newc("dev", 0o40755))
    parts.append(newc("dev/console", 0o20600, rmajor=5, rminor=1))
    # Trailer.
    parts.append(newc("TRAILER!!!", 0))

    OUT.write_bytes(b"".join(parts))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
