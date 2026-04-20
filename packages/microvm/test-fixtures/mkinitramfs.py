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
    """Yield cpio bytes for every file/dir/symlink under `root`.

    Walks manually (no os.walk/fwalk) because those follow symlinks
    to directories, which clobbers the /bin → /usr/bin style layout
    on modern Debian. Here a symlink — whether it points at a file
    or a directory — is always emitted as a symlink.
    """
    root = str(root)

    def walk(rel):
        full = os.path.join(root, rel) if rel else root
        try:
            entries = sorted(os.listdir(full))
        except (OSError, FileNotFoundError):
            return
        for name in entries:
            child_rel = os.path.join(rel, name) if rel else name
            child_full = os.path.join(full, name)
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
