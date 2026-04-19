#!/usr/bin/env python3
"""Build a minimal initramfs cpio archive for the microvm boot test.

Newc cpio format. Includes:
  /init           (executable)
  /dev/           (directory)
  /dev/console    (char device, major 5 minor 1)

macOS cpio can't produce device files from a filesystem (you'd need
mknod and root), so we build the archive byte-for-byte in Python.
"""
import os, stat, struct, sys
from pathlib import Path

OUT = Path(__file__).parent / "initramfs.cpio"
INIT = Path(__file__).parent / "init"

def newc_entry(name, mode, uid=0, gid=0, nlink=1, mtime=0,
               rmajor=0, rminor=0, filesize=0, data=b""):
    name_b = name.encode() + b"\x00"
    hdr = b"070701"
    # newc header fields, in order: ino, mode, uid, gid, nlink, mtime,
    # filesize, devmajor, devminor, rdevmajor, rdevminor, namesize, check.
    fields = [0, mode, uid, gid, nlink, mtime, filesize,
              0, 0, rmajor, rminor, len(name_b), 0]
    hdr += b"".join(f"{v:08x}".encode() for v in fields)
    out = hdr + name_b
    # Pad to 4-byte boundary after header+name.
    while len(out) % 4: out += b"\x00"
    out += data
    while len(out) % 4: out += b"\x00"
    return out

def main():
    init_bytes = INIT.read_bytes()
    parts = [
        newc_entry(".", 0o40755),
        newc_entry("dev", 0o40755),
        newc_entry("dev/console", 0o20600 | 0, rmajor=5, rminor=1),
        newc_entry("init", 0o100755, filesize=len(init_bytes), data=init_bytes),
        # End marker.
        newc_entry("TRAILER!!!", 0),
    ]
    OUT.write_bytes(b"".join(parts))
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")

if __name__ == "__main__":
    main()
