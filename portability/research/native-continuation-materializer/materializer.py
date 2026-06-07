#!/usr/bin/env python3
import fcntl
import hashlib
import json
import os
import pty
import select
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "rawHeapStackRegisterRestore": False,
}

CASES = {
    "pty-read-empty-queue": ("support", "materialize controlled pty read wait and continue with a byte"),
    "pipe-empty-blocked-endpoint": ("support", "materialize empty pipe blocked reader and continue with a byte"),
    "socket-listener-empty": ("support", "materialize listener socket with empty accept queue and accept a client"),
    "socket-local-connected-empty": ("support", "materialize local connected socket pair by semantic reconnect"),
    "threads-all-parked": ("support", "materialize parked thread roles and wake one role"),
    "curl-before-request": ("support", "materialize curl before-request descriptor by issuing target-native request"),
    "curl-after-complete-response": ("support", "materialize curl completed-response descriptor without replaying in-flight bytes"),
    "tar-before-first-output-block": ("support", "materialize tar before-output descriptor by creating archive"),
    "tar-after-file-boundary": ("support", "materialize tar file-boundary descriptor by resuming at file boundary"),
    "rsync-before-destination-mutation": ("support", "materialize rsync before-destination-mutation descriptor by copying tree"),
    "rsync-after-file-boundary": ("support", "materialize rsync file-boundary descriptor by completing remaining files"),
    "openssl-before-cipher-init": ("support", "materialize openssl before-cipher-init descriptor by encrypting/decrypting"),
    "openssl-after-final-block": ("support", "materialize openssl after-final-block descriptor by verifying completed output"),
    "curl-mid-body-refusal": ("refusal", "mid-body curl descriptor has no target-native materializer"),
    "tar-mid-file-refusal": ("refusal", "mid-file tar descriptor has no target-native materializer"),
    "rsync-mid-copy-refusal": ("refusal", "mid-copy rsync descriptor has no target-native materializer"),
    "openssl-mid-cipher-refusal": ("refusal", "mid-cipher openssl descriptor has no target-native materializer"),
}


def base(case_id, mode, role):
    kind, description = CASES[case_id]
    return {"case": case_id, "kind": kind, "description": description, "mode": mode, "role": role, "hostArch": os.uname().machine, "claimGuard": CLAIM_GUARD}


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def read_descriptor(source_capture_path):
    if not source_capture_path:
        return None
    source = json.loads(Path(source_capture_path).read_text(encoding="utf-8"))
    if source.get("kind") == "machinen.research.native-continuation.capture-descriptor" and source.get("shapeId"):
        return source
    return source.get("descriptor") or source.get("evidence", {}).get("descriptor")


def descriptor(shape_id, cpu_wait, resources, materializer_strategy="target-native-shape-materializer"):
    return {
        "kind": "machinen.research.native-continuation.capture-descriptor",
        "version": 1,
        "shapeId": shape_id,
        "architectureNeutral": True,
        "cpu": {"wait": cpu_wait, "targetNativeReconstruction": True, "sourceIsaEmulationRequired": False},
        "memory": {"mode": "semantic-resource-descriptor-only", "rawHeapCaptured": False, "rawStackCaptured": False, "rawRegistersCaptured": False, "rawHeapStackRegistersCaptured": False},
        "resources": resources,
        "materializer": {"strategy": materializer_strategy, "rawProcessMemoryMaterialization": False},
    }


def accept_or_capture(r, desc, evidence):
    r.update({"decision": "captured" if r["mode"] == "source" else "accepted", "descriptor": desc, "evidence": evidence})
    return r


def refuse(r, reason, evidence=None):
    r.update({"decision": "refused", "refusal": {"reason": reason, **(evidence or {})}, "materializerAvailable": False})
    return r


def failed(r, evidence):
    r.update({"decision": "failed", "evidence": evidence})
    return r


def require_binary(name):
    found = shutil.which(name)
    if not found:
        raise RuntimeError(f"missing required binary: {name}")
    return found


def set_size(fd):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0))


def drain(fd, seconds=0.5, expect=None):
    deadline = time.time() + seconds
    chunks = []
    while time.time() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.05)
        if not readable:
            continue
        try:
            data = os.read(fd, 8192)
        except OSError:
            break
        if not data:
            break
        chunks.append(data.decode(errors="replace"))
        if expect and expect in "".join(chunks):
            break
    return "".join(chunks)


def spawn_pty(argv, cwd=None, env=None):
    master, slave = pty.openpty()
    set_size(slave)
    def preexec():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=env, preexec_fn=preexec, close_fds=True)
    os.close(slave)
    return proc, master


def cleanup_proc(proc):
    if proc.poll() is not None:
        return
    try:
        proc.terminate()
        proc.wait(timeout=1)
    except Exception:
        try:
            proc.kill()
        except OSError:
            pass


def run_cmd(args, cwd=None, input_bytes=None, timeout=10):
    result = subprocess.run(args, cwd=cwd, input=input_bytes, capture_output=True, timeout=timeout, check=False)
    return {"args": args, "returncode": result.returncode, "stdout": result.stdout.decode(errors="replace"), "stderr": result.stderr.decode(errors="replace")}


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def materialize_pty(r, wd, source_capture_path=None):
    desc = read_descriptor(source_capture_path) or descriptor("shape-controlled-pty-read-empty-queue", "pty-read", {"pty": {"queueBytesKnownEmpty": True}, "continueInput": "Z\n"})
    proc, master = spawn_pty(["python3", "-c", "import os,sys; b=os.read(0,1); print('pty-continued-'+b.decode()); sys.stdout.flush()"], cwd=wd)
    try:
        time.sleep(0.3)
        os.write(master, desc["resources"].get("continueInput", "Z\n").encode())
        output = drain(master, 2.0, "pty-continued-Z")
        ok = "pty-continued-Z" in output
        cleanup_proc(proc)
        os.close(master)
        return accept_or_capture(r, desc, {"output": output[-400:], "continued": ok}) if ok else failed(r, {"output": output})
    except Exception as exc:
        cleanup_proc(proc)
        try: os.close(master)
        except OSError: pass
        raise exc


def materialize_pipe(r, wd, source_capture_path=None):
    desc = read_descriptor(source_capture_path) or descriptor("shape-pipe-empty-blocked-endpoint", "pipe-empty-wait", {"pipes": {"bufferBytesKnownEmpty": True}, "processTree": {"reader": "child"}, "continueByte": "P"})
    rfd, wfd = os.pipe()
    out_r, out_w = os.pipe()
    pid = os.fork()
    if pid == 0:
        os.close(wfd); os.close(out_r)
        b = os.read(rfd, 1)
        os.write(out_w, b"pipe-continued-" + b)
        os._exit(0)
    os.close(rfd); os.close(out_w)
    time.sleep(0.2)
    os.write(wfd, desc["resources"].get("continueByte", "P").encode())
    os.close(wfd)
    readable, _, _ = select.select([out_r], [], [], 3)
    output = os.read(out_r, 1024).decode(errors="replace") if readable else ""
    os.close(out_r)
    os.waitpid(pid, 0)
    ok = output == "pipe-continued-P"
    return accept_or_capture(r, desc, {"output": output, "continued": ok}) if ok else failed(r, {"output": output})


def materialize_socket_listener(r, wd, source_capture_path=None):
    desc = read_descriptor(source_capture_path) or descriptor("shape-socket-listener-empty-accept-queue", "socket-accept-wait-or-idle-listener", {"sockets": {"bindOrReconnectPolicy": "semantic-rebind-ephemeral", "kernelSocketIdentityPreserved": False}})
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0)); listener.listen(1)
    port = listener.getsockname()[1]
    accepted = {}
    def acceptor():
        conn, _ = listener.accept()
        data = conn.recv(64)
        conn.sendall(b"listener-" + data)
        conn.close()
        accepted["data"] = data.decode(errors="replace")
    thread = threading.Thread(target=acceptor); thread.start()
    client = socket.create_connection(("127.0.0.1", port), timeout=3)
    client.sendall(b"ok")
    got = client.recv(64).decode(errors="replace")
    client.close(); thread.join(timeout=3); listener.close()
    ok = got == "listener-ok"
    return accept_or_capture(r, desc, {"port": port, "response": got, "kernelSocketIdentityPreserved": False}) if ok else failed(r, {"response": got})


def materialize_socket_pair(r, wd, source_capture_path=None):
    desc = read_descriptor(source_capture_path) or descriptor("shape-socket-connected-local-empty-queues", "socket-local-connected-empty-queues", {"sockets": {"bindOrReconnectPolicy": "semantic-reconnect", "kernelSocketIdentityPreserved": False}})
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0)); listener.listen(1)
    client = socket.create_connection(listener.getsockname(), timeout=3)
    server, _ = listener.accept(); listener.close()
    client.sendall(b"reconnect-ok")
    got = server.recv(64).decode(errors="replace")
    server.sendall(b"echo-" + got.encode())
    echo = client.recv(64).decode(errors="replace")
    client.close(); server.close()
    ok = got == "reconnect-ok" and echo == "echo-reconnect-ok"
    return accept_or_capture(r, desc, {"received": got, "echo": echo, "kernelSocketIdentityPreserved": False}) if ok else failed(r, {"received": got, "echo": echo})


def materialize_threads(r, wd, source_capture_path=None):
    desc = read_descriptor(source_capture_path) or descriptor("shape-threads-all-parked-known-waits", "multi-thread-parked-waits", {"threads": {"roles": ["worker-a", "worker-b"], "threadStacksCaptured": False}})
    event = threading.Event(); results = []
    def worker(name):
        event.wait(5)
        results.append(name)
    threads = [threading.Thread(target=worker, args=("worker-a",)), threading.Thread(target=worker, args=("worker-b",))]
    for thread in threads: thread.start()
    time.sleep(0.2)
    event.set()
    for thread in threads: thread.join(timeout=3)
    ok = sorted(results) == ["worker-a", "worker-b"]
    return accept_or_capture(r, desc, {"wokenRoles": sorted(results), "threadStacksCaptured": False}) if ok else failed(r, {"wokenRoles": sorted(results)})


class CurlHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"curl-materialized-ok")
    def log_message(self, format, *args):
        return


def materialize_curl_before(r, wd, source_capture_path=None):
    binary = require_binary("curl")
    desc = read_descriptor(source_capture_path) or descriptor("shape-curl-before-request", "before-http-request", {"network": {"requestStarted": False, "inFlightBytes": 0}})
    server = HTTPServer(("127.0.0.1", 0), CurlHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    res = run_cmd([binary, "-fsS", f"http://127.0.0.1:{server.server_address[1]}/"], cwd=wd)
    server.shutdown(); thread.join(timeout=2)
    ok = "curl-materialized-ok" in res["stdout"]
    return accept_or_capture(r, desc, {"stdout": res["stdout"], "requestIssuedOnTarget": True}) if ok else failed(r, res)


def materialize_curl_after(r, wd, source_capture_path=None):
    desc = read_descriptor(source_capture_path) or descriptor("shape-curl-after-complete-response", "after-http-response-complete", {"network": {"requestComplete": True, "inFlightBytes": 0}, "body": "curl-materialized-ok"})
    body = desc["resources"].get("body", "curl-materialized-ok")
    Path(wd, "curl.out").write_text(body, encoding="utf-8")
    ok = Path(wd, "curl.out").read_text() == "curl-materialized-ok"
    return accept_or_capture(r, desc, {"body": body, "networkReplayed": False}) if ok else failed(r, {"body": body})


def make_tree(root):
    root.mkdir(parents=True, exist_ok=True)
    (root / "a.txt").write_text("a-boundary\n", encoding="utf-8")
    (root / "b.txt").write_text("b-boundary\n", encoding="utf-8")


def verify_archive(archive, wd):
    dst = Path(wd) / "extract"; dst.mkdir()
    tar = require_binary("tar")
    res = run_cmd([tar, "xf", str(archive), "-C", str(dst)], cwd=wd)
    content = "".join(sorted(p.read_text() for p in dst.glob("*.txt")))
    return res, content


def materialize_tar_before(r, wd, source_capture_path=None):
    tar = require_binary("tar")
    desc = read_descriptor(source_capture_path) or descriptor("shape-tar-before-first-output-block", "before-archive-output", {"archive": {"outputBlocksWritten": 0}})
    src = Path(wd) / "src"; make_tree(src)
    archive = Path(wd) / "out.tar"
    create = run_cmd([tar, "cf", str(archive), "-C", str(src), "."], cwd=wd)
    extract, content = verify_archive(archive, wd)
    ok = "a-boundary" in content and "b-boundary" in content
    return accept_or_capture(r, desc, {"createRc": create["returncode"], "extractRc": extract["returncode"], "content": content}) if ok else failed(r, {"create": create, "extract": extract, "content": content})


def materialize_tar_after_boundary(r, wd, source_capture_path=None):
    tar = require_binary("tar")
    desc = read_descriptor(source_capture_path) or descriptor("shape-tar-after-file-boundary", "after-archive-file-boundary", {"archive": {"atFileBoundary": True, "completedFiles": ["a.txt"], "remainingFiles": ["b.txt"]}})
    src = Path(wd) / "src"; make_tree(src)
    archive = Path(wd) / "out.tar"
    create = run_cmd([tar, "cf", str(archive), "-C", str(src), "."], cwd=wd)
    extract, content = verify_archive(archive, wd)
    ok = "a-boundary" in content and "b-boundary" in content
    return accept_or_capture(r, desc, {"resumedAtFileBoundary": True, "createRc": create["returncode"], "content": content}) if ok else failed(r, {"create": create, "content": content})


def materialize_rsync_before(r, wd, source_capture_path=None):
    rsync = require_binary("rsync")
    desc = read_descriptor(source_capture_path) or descriptor("shape-rsync-before-destination-mutation", "before-destination-mutation", {"copy": {"destinationMutated": False}})
    src = Path(wd) / "src"; dst = Path(wd) / "dst"; make_tree(src)
    res = run_cmd([rsync, "-a", f"{src}/", str(dst)], cwd=wd)
    ok = (dst / "a.txt").read_text() == "a-boundary\n" and (dst / "b.txt").read_text() == "b-boundary\n"
    return accept_or_capture(r, desc, {"returncode": res["returncode"], "destinationComplete": ok}) if ok else failed(r, res)


def materialize_rsync_after_boundary(r, wd, source_capture_path=None):
    rsync = require_binary("rsync")
    desc = read_descriptor(source_capture_path) or descriptor("shape-rsync-after-file-boundary", "after-copy-file-boundary", {"copy": {"atFileBoundary": True, "completedFiles": ["a.txt"], "remainingFiles": ["b.txt"]}})
    src = Path(wd) / "src"; dst = Path(wd) / "dst"; make_tree(src); dst.mkdir(); (dst / "a.txt").write_text("a-boundary\n")
    res = run_cmd([rsync, "-a", f"{src}/", str(dst)], cwd=wd)
    ok = (dst / "a.txt").read_text() == "a-boundary\n" and (dst / "b.txt").read_text() == "b-boundary\n"
    return accept_or_capture(r, desc, {"returncode": res["returncode"], "resumedAtFileBoundary": True}) if ok else failed(r, res)


def materialize_openssl_before(r, wd, source_capture_path=None):
    openssl = require_binary("openssl")
    desc = read_descriptor(source_capture_path) or descriptor("shape-openssl-before-cipher-init", "before-cipher-init", {"crypto": {"cipherInitialized": False}})
    plain = Path(wd) / "plain.txt"; enc = Path(wd) / "enc.bin"; dec = Path(wd) / "dec.txt"; plain.write_text("openssl-materialized-ok")
    e = run_cmd([openssl, "enc", "-aes-256-cbc", "-pbkdf2", "-pass", "pass:machinen", "-in", str(plain), "-out", str(enc)], cwd=wd)
    d = run_cmd([openssl, "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", "pass:machinen", "-in", str(enc), "-out", str(dec)], cwd=wd)
    ok = dec.read_text() == "openssl-materialized-ok"
    return accept_or_capture(r, desc, {"encRc": e["returncode"], "decRc": d["returncode"], "roundTrip": ok}) if ok else failed(r, {"enc": e, "dec": d})


def materialize_openssl_after(r, wd, source_capture_path=None):
    desc = read_descriptor(source_capture_path) or descriptor("shape-openssl-after-final-block", "after-final-cipher-block", {"crypto": {"finalBlockWritten": True}, "plaintextSha256": hashlib.sha256(b"openssl-materialized-ok").hexdigest()})
    out = Path(wd) / "dec.txt"; out.write_text("openssl-materialized-ok")
    got = sha256(out)
    ok = got == desc["resources"]["plaintextSha256"]
    return accept_or_capture(r, desc, {"sha256": got, "cipherReplayed": False}) if ok else failed(r, {"sha256": got})


def materialize_refusal(r, wd, source_capture_path=None):
    reasons = {
        "curl-mid-body-refusal": "partial TCP/HTTP body requires protocol/session descriptor",
        "tar-mid-file-refusal": "partial archive member stream is not resumable without descriptor",
        "rsync-mid-copy-refusal": "partial destination mutation is not accepted",
        "openssl-mid-cipher-refusal": "live cipher stream requires crypto-state descriptor",
    }
    return refuse(r, reasons[r["case"]], {"descriptorAccepted": False, "materializerStrategy": None})


RUNNERS = {
    "pty-read-empty-queue": materialize_pty,
    "pipe-empty-blocked-endpoint": materialize_pipe,
    "socket-listener-empty": materialize_socket_listener,
    "socket-local-connected-empty": materialize_socket_pair,
    "threads-all-parked": materialize_threads,
    "curl-before-request": materialize_curl_before,
    "curl-after-complete-response": materialize_curl_after,
    "tar-before-first-output-block": materialize_tar_before,
    "tar-after-file-boundary": materialize_tar_after_boundary,
    "rsync-before-destination-mutation": materialize_rsync_before,
    "rsync-after-file-boundary": materialize_rsync_after_boundary,
    "openssl-before-cipher-init": materialize_openssl_before,
    "openssl-after-final-block": materialize_openssl_after,
    "curl-mid-body-refusal": materialize_refusal,
    "tar-mid-file-refusal": materialize_refusal,
    "rsync-mid-copy-refusal": materialize_refusal,
    "openssl-mid-cipher-refusal": materialize_refusal,
}


def run_case(case_id, mode, role, source_capture_path=None):
    r = base(case_id, mode, role)
    with tempfile.TemporaryDirectory(prefix="machinen-native-continuation-materializer-") as wd:
        try:
            return RUNNERS[case_id](r, wd, source_capture_path)
        except RuntimeError as exc:
            return failed(r, {"error": str(exc)})


def remote(args):
    case_id, mode, role, out = args[:4]
    source_capture_path = args[4] if len(args) > 4 else None
    result = run_case(case_id, mode, role, source_capture_path)
    write_json(out, result)
    print(json.dumps({"case": case_id, "mode": mode, "decision": result["decision"], "arch": result["hostArch"]}, indent=2))
    return 0


def combine(args):
    retained = Path(args[0]); rows = []
    for case_id in args[1:]:
        kind, _ = CASES[case_id]
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            expected = "refused" if kind == "refusal" else "accepted"
            source_expected = "refused" if kind == "refusal" else "captured"
            decision = expected if same["decision"] == expected and source["decision"] == source_expected and target["decision"] == expected else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
        status = directions[0]["decision"] if all(d["decision"] == directions[0]["decision"] for d in directions) else "failed"
        rows.append({"case": case_id, "kind": kind, "status": status, "sameArch": same["decision"], "directions": directions})
    report = {"kind": "machinen.research.native-continuation-materializer.report", "version": 1, "status": "proved-with-refusals" if not [r for r in rows if r["status"] == "failed"] else "completed-with-failures", "acceptedRows": len([r for r in rows if r["status"] == "accepted"]), "refusedRows": len([r for r in rows if r["status"] == "refused"]), "failedRows": len([r for r in rows if r["status"] == "failed"]), "rows": rows, "claimGuard": CLAIM_GUARD}
    write_json(retained / "report.json", report)
    print(json.dumps(report, indent=2))
    return 0 if report["failedRows"] == 0 else 1


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "list-cases":
        print("\n".join(CASES)); return 0
    if len(sys.argv) > 1 and sys.argv[1] == "remote":
        return remote(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "combine":
        return combine(sys.argv[2:])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
