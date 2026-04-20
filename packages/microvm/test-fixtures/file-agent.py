#!/usr/bin/env python3
"""Guest-side file push/pull over vsock (#57).

Persistent AF_VSOCK listener on port 1976. Protocol is deliberately
boring: the client sends one ASCII line then a stream.

  client -> "PUSH <abs-path>\\n" then tar bytes until close
  agent  -> reads tar bytes and untars at <abs-path>

  client -> "PULL <abs-path>\\n" then reads
  agent  -> streams a tar of <abs-path> then closes

One transfer per connection. The agent loops forever so you can
push/pull repeatedly during a session.

`tar` is already present in the Debian cloud rootfs, so we shell out
rather than hand-roll tar encode/decode.
"""
import os
import socket
import subprocess
import sys

PORT = 1976


def read_line(sock, limit=4096):
    buf = b""
    while b"\n" not in buf:
        chunk = sock.recv(128)
        if not chunk:
            return None
        buf += chunk
        if len(buf) > limit:
            return None
    line, _, rest = buf.partition(b"\n")
    return line.decode("ascii", errors="replace"), rest


def do_push(sock, path, initial_chunk):
    """Untar whatever the client streams at us into `path`. The client
    sends bytes until it closes its half of the socket; we shovel
    everything into `tar -xf -`."""
    os.makedirs(path, exist_ok=True)
    # -m: don't restore mtimes. The guest clock starts at 1970 until
    # something (boot-epoch, winsize-agent, etc.) nudges it forward,
    # and GNU tar refuses files with mtimes "in the future" by default.
    p = subprocess.Popen(
        ["tar", "-xmf", "-", "-C", path],
        stdin=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    total = 0
    try:
        if initial_chunk:
            p.stdin.write(initial_chunk)
            total += len(initial_chunk)
        while True:
            chunk = sock.recv(65536)
            if not chunk:
                break
            p.stdin.write(chunk)
            total += len(chunk)
    finally:
        p.stdin.close()
        rc = p.wait()
        err = p.stderr.read().decode("ascii", errors="replace") if p.stderr else ""
    if rc == 0:
        print(f"file-agent: PUSH -> {path} OK ({total} bytes)", flush=True)
    else:
        print(f"file-agent: PUSH -> {path} tar failed rc={rc}", flush=True)
    if err:
        print(f"file-agent: PUSH tar stderr: {err!r}", flush=True)


def do_pull(sock, path):
    """Stream a tar of `path` back to the client. Deliberately
    `-C <path> .` so the tar's top-level entries are the contents
    of `path`, not the directory itself — lets the host caller
    untar into a target dir of their choosing."""
    if not os.path.exists(path):
        print(f"file-agent: PULL {path}: does not exist", flush=True)
        return
    p = subprocess.Popen(
        ["tar", "-cf", "-", "-C", path, "."],
        stdout=subprocess.PIPE,
    )
    try:
        while True:
            chunk = p.stdout.read(65536)
            if not chunk:
                break
            sock.sendall(chunk)
    finally:
        p.stdout.close()
        rc = p.wait()
    # Closing our half of the socket signals EOT to the host.
    try:
        sock.shutdown(socket.SHUT_WR)
    except OSError:
        pass
    print(f"file-agent: PULL <- {path} rc={rc}", flush=True)


def main():
    srv = socket.socket(socket.AF_VSOCK, socket.SOCK_STREAM)
    srv.bind((socket.VMADDR_CID_ANY, PORT))
    srv.listen(4)
    print(f"file-agent: listening on vsock port {PORT}", flush=True)

    while True:
        try:
            conn, peer = srv.accept()
        except OSError as e:
            print(f"file-agent: accept error: {e!r}", flush=True)
            continue
        print(f"file-agent: accepted {peer}", flush=True)
        try:
            hdr = read_line(conn)
            if hdr is None:
                print("file-agent: bad header, dropping", flush=True)
                conn.close()
                continue
            line, rest = hdr
            parts = line.split(" ", 1)
            if len(parts) != 2:
                print(f"file-agent: malformed command {line!r}", flush=True)
                conn.close()
                continue
            op, path = parts
            if op == "PUSH":
                do_push(conn, path, rest)
            elif op == "PULL":
                do_pull(conn, path)
            else:
                print(f"file-agent: unknown op {op!r}", flush=True)
        except Exception as e:
            print(f"file-agent: handler error {e!r}", flush=True)
        finally:
            conn.close()


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
