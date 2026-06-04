import os, platform, socket
port = int(os.environ.get("PORT", "18080"))
backlog = int(os.environ.get("BACKLOG", "8"))
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("127.0.0.1", port))
sock.listen(backlog)
reuse = sock.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR)
print(
    f"tcp-listener family=inet protocol=tcp bind=127.0.0.1:{port} backlog={backlog} "
    f"acceptQueue=empty reuseaddr={'true' if reuse else 'false'} sourceArch={platform.machine()}",
    flush=True,
)
sock.close()
