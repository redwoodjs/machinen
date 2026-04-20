#!/usr/bin/env python3
"""Tiny guest-side TIOCSWINSZ agent (#51 M1.5 follow-up).

Binds AF_VSOCK on port 1974 (guests have this once
`vmw_vsock_virtio_transport` is loaded), accepts one client at a
time, reads `cols rows\n` lines, and shoves the new size into every
tty we can find — specifically /dev/console, /dev/ttyAMA0, and any
/proc/<pid>/fd/0 that's a tty owned by a shell-ish process.

On each successful ioctl we print `applied: <cols> <rows> -> <path>`
to stdout so the smoke harness can grep it back out of the guest
console log.
"""
import fcntl
import os
import socket
import struct
import sys
import time

TIOCSWINSZ = 0x5414  # same on arm64 Linux
PORT = 1974


def set_winsize(fd, cols, rows):
    # struct winsize { unsigned short ws_row, ws_col, ws_xpixel, ws_ypixel; }
    fcntl.ioctl(fd, TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def apply(cols, rows):
    """Apply the new size to every tty we can touch; return the paths we hit."""
    applied = []
    # /dev/console is the kernel's main console — typically our ttyAMA0 alias.
    for path in ("/dev/console", "/dev/ttyAMA0", "/dev/tty0"):
        try:
            fd = os.open(path, os.O_RDWR | os.O_NOCTTY)
        except OSError:
            continue
        try:
            set_winsize(fd, cols, rows)
            applied.append(path)
        except OSError as e:
            print(f"winsize-agent: ioctl {path} failed: {e!r}", flush=True)
        finally:
            os.close(fd)

    # Also push to fd 0/1/2 of every running process whose controlling
    # terminal is a tty. This catches long-lived shells that opened a
    # tty at boot and never reopen it — otherwise they keep showing
    # the old size from their TIOCGWINSZ at startup.
    try:
        for pid in os.listdir("/proc"):
            if not pid.isdigit():
                continue
            for fd_idx in ("0", "1", "2"):
                link = f"/proc/{pid}/fd/{fd_idx}"
                try:
                    target = os.readlink(link)
                except OSError:
                    continue
                if not target.startswith("/dev/"):
                    continue
                try:
                    fd = os.open(link, os.O_RDWR | os.O_NOCTTY)
                except OSError:
                    continue
                try:
                    set_winsize(fd, cols, rows)
                    applied.append(f"{link}->{target}")
                except OSError:
                    pass
                finally:
                    os.close(fd)
    except OSError:
        pass

    return applied


def main():
    # Wait briefly for the virtio-vsock transport to publish — the
    # kernel emits an event on /dev/vsock after bind.
    for attempt in range(10):
        try:
            srv = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
            srv.bind((socket.VMADDR_CID_ANY, PORT))
            break
        except OSError as e:
            print(f"winsize-agent: bind retry ({attempt+1}): {e!r}", flush=True)
            time.sleep(0.5)
    else:
        print("winsize-agent: could not bind AF_VSOCK, giving up", flush=True)
        sys.exit(1)
    srv.listen(1)
    print(f"winsize-agent: listening on vsock port {PORT}", flush=True)

    while True:
        try:
            conn, peer = srv.accept()
        except OSError as e:
            print(f"winsize-agent: accept failed: {e!r}", flush=True)
            time.sleep(0.2)
            continue
        print(f"winsize-agent: accepted {peer}", flush=True)
        try:
            buf = b""
            while True:
                chunk = conn.recv(128)
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    try:
                        cols_s, rows_s = line.decode("ascii").split()
                        cols, rows = int(cols_s), int(rows_s)
                    except ValueError:
                        print(f"winsize-agent: bad line {line!r}", flush=True)
                        continue
                    applied = apply(cols, rows)
                    for path in applied:
                        print(f"applied: {cols} {rows} -> {path}", flush=True)
                    if not applied:
                        print(f"applied: {cols} {rows} -> (no ttys)", flush=True)
                    # Echo back so the peer can wait for an ack.
                    try:
                        conn.sendall(f"ok {cols} {rows}\n".encode("ascii"))
                    except OSError:
                        pass
        except OSError as e:
            print(f"winsize-agent: conn error: {e!r}", flush=True)
        finally:
            conn.close()
            print("winsize-agent: conn closed", flush=True)


if __name__ == "__main__":
    main()
