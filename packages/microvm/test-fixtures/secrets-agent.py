#!/usr/bin/env python3
"""Guest-side secrets agent (#48 M3).

Binds AF_VSOCK on port 1975. Accepts one connection, reads
`KEY=VALUE\n` lines until EOF, writes them to /etc/machinen.env
with mode 0600, prints a marker, and exits.

The goal is to keep long-lived credentials (ANTHROPIC_API_KEY and
friends) OUT of the initramfs + any snapshot. The host pushes them
in per-boot over the already-present vsock bridge.
"""
import os
import socket
import stat
import sys

PORT = 1975
ENV_PATH = "/etc/machinen.env"


def main():
    srv = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    srv.bind((socket.VMADDR_CID_ANY, PORT))
    srv.listen(1)
    print(f"secrets-agent: listening on vsock port {PORT}", flush=True)

    conn, peer = srv.accept()
    print(f"secrets-agent: accepted {peer}", flush=True)

    raw = b""
    try:
        while True:
            chunk = conn.recv(4096)
            if not chunk:
                break
            raw += chunk
    finally:
        conn.close()
        srv.close()

    entries = []
    for line in raw.decode("ascii", errors="replace").splitlines():
        line = line.strip()
        if not line or "=" not in line:
            continue
        key, _, val = line.partition("=")
        key = key.strip()
        val = val.strip()
        if not key.isidentifier():
            print(f"secrets-agent: skip non-identifier key {key!r}", flush=True)
            continue
        entries.append(f"{key}={val}")

    os.makedirs(os.path.dirname(ENV_PATH), exist_ok=True)
    # Write via fd + fchmod so the file never exists world-readable even
    # for a moment. Overwrite if already there.
    fd = os.open(ENV_PATH, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    try:
        with os.fdopen(fd, "w") as f:
            for e in entries:
                f.write(e + "\n")
        os.chmod(ENV_PATH, stat.S_IRUSR | stat.S_IWUSR)
    except Exception:
        try:
            os.close(fd)
        except Exception:
            pass
        raise

    print(
        f"secrets-agent: wrote {len(entries)} entries to {ENV_PATH}",
        flush=True,
    )


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"secrets-agent: fatal {e!r}", flush=True)
        sys.exit(1)
