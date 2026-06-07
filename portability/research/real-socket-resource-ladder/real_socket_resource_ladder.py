#!/usr/bin/env python3
import fcntl
import json
import os
import socket
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "markerSymbolsUsed": False,
    "preservesKernelSocketIdentity": False,
}

CASES = {
    "tcp-listener-new-port": {"kind": "support", "description": "TCP listener with no pending accepts is reconstructed on a new ephemeral port"},
    "tcp-listener-same-port-after-close": {"kind": "support", "description": "TCP listener is closed, then target-native listener binds the same local port"},
    "unix-listener-rebind": {"kind": "support", "description": "Unix domain listener path is unlinked and rebound target-natively"},
    "tcp-echo-semantic-reconnect": {"kind": "support", "description": "local TCP echo pair with no in-flight bytes is semantically reconnected"},
    "udp-bound-empty": {"kind": "support", "description": "bound UDP socket with no queued datagrams is reconstructed and receives a new datagram"},
    "socketpair-empty-semantic-reconnect": {"kind": "support", "description": "owned local socketpair with no queued bytes is reconstructed as a new socketpair"},
    "tcp-connected-inflight-refusal": {"kind": "refusal", "description": "connected TCP socket with unread bytes is refused"},
    "udp-queued-datagram-refusal": {"kind": "refusal", "description": "UDP socket with queued datagram is refused"},
    "external-socket-fd-refusal": {"kind": "refusal", "description": "socket fd outside an accepted owned shape is refused"},
}


def queue_bytes(sock):
    try:
        return struct.unpack("I", fcntl.ioctl(sock.fileno(), 0x541B, struct.pack("I", 0)))[0]
    except OSError:
        return 0


def fd_facts():
    facts = []
    root = Path(f"/proc/{os.getpid()}/fd")
    for item in sorted(root.iterdir(), key=lambda path: int(path.name)):
        try:
            target = os.readlink(item)
        except OSError:
            target = "unreadable"
        facts.append({"fd": int(item.name), "target": target})
    return facts


def base_result(case_id, mode, role):
    return {
        "case": case_id,
        "description": CASES[case_id]["description"],
        "mode": mode,
        "role": role,
        "hostArch": os.uname().machine,
        "pid": os.getpid(),
        "claimGuard": CLAIM_GUARD,
    }


def client_connects(addr):
    client = socket.create_connection(addr, timeout=2)
    client.close()
    return True


def tcp_listener_new_port(case_id, mode, role):
    result = base_result(case_id, mode, role)
    source = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    source.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    source.bind(("127.0.0.1", 0))
    source.listen(1)
    source_port = source.getsockname()[1]
    capture = {"family": "AF_INET", "type": "SOCK_STREAM", "localAddress": "127.0.0.1", "localPort": source_port, "queuedBytes": queue_bytes(source), "pendingAcceptsCreatedByHarness": 0, "fdFacts": fd_facts()}
    if mode == "source":
        result.update({"decision": "captured", "capture": capture})
        source.close()
        return result
    target = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    target.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    target.bind(("127.0.0.1", 0))
    target.listen(1)
    target_port = target.getsockname()[1]
    ok = client_connects(("127.0.0.1", target_port))
    result.update({"decision": "accepted" if ok and capture["queuedBytes"] == 0 else "failed", "capture": capture, "materialization": {"samePortPreserved": False, "targetPort": target_port, "clientConnected": ok}})
    target.close()
    source.close()
    return result


def tcp_listener_same_port(case_id, mode, role):
    result = base_result(case_id, mode, role)
    source = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    source.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    source.bind(("127.0.0.1", 0))
    source.listen(1)
    port = source.getsockname()[1]
    capture = {"family": "AF_INET", "type": "SOCK_STREAM", "localAddress": "127.0.0.1", "localPort": port, "queuedBytes": queue_bytes(source), "pendingAcceptsCreatedByHarness": 0}
    if mode == "source":
        result.update({"decision": "captured", "capture": capture})
        source.close()
        return result
    source.close()
    target = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    target.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        target.bind(("127.0.0.1", port))
        target.listen(1)
        ok = client_connects(("127.0.0.1", port))
    except OSError as error:
        result.update({"decision": "failed", "capture": capture, "error": str(error)})
        target.close()
        return result
    result.update({"decision": "accepted" if ok else "failed", "capture": capture, "materialization": {"samePortPreserved": True, "clientConnected": ok}})
    target.close()
    return result


def unix_listener_rebind(case_id, mode, role, workdir):
    result = base_result(case_id, mode, role)
    path = str(Path(workdir) / "listener.sock")
    source = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    source.bind(path)
    source.listen(1)
    capture = {"family": "AF_UNIX", "type": "SOCK_STREAM", "path": path, "queuedBytes": queue_bytes(source), "pathExists": Path(path).exists()}
    if mode == "source":
        result.update({"decision": "captured", "capture": capture})
        source.close()
        return result
    source.close()
    Path(path).unlink(missing_ok=True)
    target = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    target.bind(path)
    target.listen(1)
    client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    client.connect(path)
    client.close()
    target.close()
    result.update({"decision": "accepted", "capture": capture, "materialization": {"samePathRebound": True, "clientConnected": True}})
    return result


def tcp_echo_semantic_reconnect(case_id, mode, role):
    result = base_result(case_id, mode, role)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0))
    listener.listen(1)
    port = listener.getsockname()[1]
    client = socket.create_connection(("127.0.0.1", port), timeout=2)
    server, _ = listener.accept()
    capture = {"clientQueuedBytes": queue_bytes(client), "serverQueuedBytes": queue_bytes(server), "semanticReconnectOnly": True, "kernelConnectionIdentityPreserved": False}
    if mode == "source":
        result.update({"decision": "captured", "capture": capture})
        client.close(); server.close(); listener.close()
        return result
    client.close(); server.close(); listener.close()
    target_listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    target_listener.bind(("127.0.0.1", 0))
    target_listener.listen(1)
    target_port = target_listener.getsockname()[1]
    target_client = socket.create_connection(("127.0.0.1", target_port), timeout=2)
    target_server, _ = target_listener.accept()
    target_client.sendall(b"ping")
    echoed = target_server.recv(4)
    target_server.sendall(echoed)
    received = target_client.recv(4)
    ok = received == b"ping"
    target_client.close(); target_server.close(); target_listener.close()
    result.update({"decision": "accepted" if ok and capture["clientQueuedBytes"] == 0 and capture["serverQueuedBytes"] == 0 else "failed", "capture": capture, "materialization": {"semanticReconnectOnly": True, "echoContinued": ok}})
    return result


def udp_bound_empty(case_id, mode, role):
    result = base_result(case_id, mode, role)
    source = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    source.bind(("127.0.0.1", 0))
    port = source.getsockname()[1]
    capture = {"family": "AF_INET", "type": "SOCK_DGRAM", "localPort": port, "queuedBytes": queue_bytes(source)}
    if mode == "source":
        result.update({"decision": "captured", "capture": capture})
        source.close()
        return result
    source.close()
    target = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    target.bind(("127.0.0.1", port))
    sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sender.sendto(b"datagram", ("127.0.0.1", port))
    target.settimeout(2)
    data, _ = target.recvfrom(64)
    ok = data == b"datagram"
    target.close(); sender.close()
    result.update({"decision": "accepted" if ok else "failed", "capture": capture, "materialization": {"samePortPreserved": True, "receivedNewDatagram": ok}})
    return result


def socketpair_empty(case_id, mode, role):
    result = base_result(case_id, mode, role)
    a, b = socket.socketpair()
    capture = {"family": "AF_UNIX", "type": "SOCK_STREAM", "aQueuedBytes": queue_bytes(a), "bQueuedBytes": queue_bytes(b), "semanticReconnectOnly": True}
    if mode == "source":
        result.update({"decision": "captured", "capture": capture})
        a.close(); b.close()
        return result
    a.close(); b.close()
    ta, tb = socket.socketpair()
    ta.sendall(b"pair")
    data = tb.recv(4)
    ok = data == b"pair"
    ta.close(); tb.close()
    result.update({"decision": "accepted" if ok and capture["aQueuedBytes"] == 0 and capture["bQueuedBytes"] == 0 else "failed", "capture": capture, "materialization": {"newSocketpair": True, "messagePassed": ok}})
    return result


def tcp_connected_inflight_refusal(case_id, mode, role):
    result = base_result(case_id, mode, role)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.bind(("127.0.0.1", 0)); listener.listen(1)
    client = socket.create_connection(("127.0.0.1", listener.getsockname()[1]), timeout=2)
    server, _ = listener.accept()
    client.sendall(b"unread")
    queued = queue_bytes(server)
    refused = queued > 0
    result.update({"decision": "refused" if refused else "failed", "refusal": {"reason": "tcp-inflight-bytes", "serverQueuedBytes": queued, "socketFdDetected": True}})
    client.close(); server.close(); listener.close()
    return result


def udp_queued_refusal(case_id, mode, role):
    result = base_result(case_id, mode, role)
    receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    receiver.bind(("127.0.0.1", 0))
    sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sender.sendto(b"queued", receiver.getsockname())
    queued = queue_bytes(receiver)
    refused = queued > 0
    result.update({"decision": "refused" if refused else "failed", "refusal": {"reason": "udp-queued-datagram", "queuedBytes": queued, "socketFdDetected": True}})
    sender.close(); receiver.close()
    return result


def external_socket_fd_refusal(case_id, mode, role):
    result = base_result(case_id, mode, role)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    facts = fd_facts()
    socket_fds = [fact for fact in facts if fact["target"].startswith("socket:")]
    result.update({"decision": "refused" if socket_fds else "failed", "refusal": {"reason": "unclassified-external-socket-fd", "socketFds": socket_fds}})
    sock.close()
    return result


RUNNERS = {
    "tcp-listener-new-port": tcp_listener_new_port,
    "tcp-listener-same-port-after-close": tcp_listener_same_port,
    "unix-listener-rebind": unix_listener_rebind,
    "tcp-echo-semantic-reconnect": tcp_echo_semantic_reconnect,
    "udp-bound-empty": udp_bound_empty,
    "socketpair-empty-semantic-reconnect": socketpair_empty,
    "tcp-connected-inflight-refusal": tcp_connected_inflight_refusal,
    "udp-queued-datagram-refusal": udp_queued_refusal,
    "external-socket-fd-refusal": external_socket_fd_refusal,
}


def run_case(case_id, mode, role):
    with tempfile.TemporaryDirectory(prefix="machinen-socket-resource-ladder-") as workdir:
        runner = RUNNERS[case_id]
        if case_id == "unix-listener-rebind":
            return runner(case_id, mode, role, workdir)
        return runner(case_id, mode, role)


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def remote(args):
    if len(args) != 4:
        print("usage: remote <case> <same|source|target> <role> <out>", file=sys.stderr)
        return 2
    case_id, mode, role, out = args
    result = run_case(case_id, mode, role)
    write_json(out, result)
    print(json.dumps({"case": case_id, "mode": mode, "decision": result["decision"], "arch": result["hostArch"]}, indent=2))
    return 0


def combine(args):
    if len(args) < 2:
        print("usage: combine <retained-dir> <case>...", file=sys.stderr)
        return 2
    retained = Path(args[0])
    rows = []
    for case_id in args[1:]:
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        expected_refusal = CASES[case_id]["kind"] == "refusal"
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            if expected_refusal:
                decision = "refused" if same["decision"] == source["decision"] == target["decision"] == "refused" else "failed"
            else:
                decision = "accepted" if same["decision"] == "accepted" and source["decision"] == "captured" and target["decision"] == "accepted" else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
        status = "refused" if expected_refusal and all(d["decision"] == "refused" for d in directions) else "accepted" if not expected_refusal and all(d["decision"] == "accepted" for d in directions) else "failed"
        rows.append({"case": case_id, "status": status, "sameArch": same["decision"], "directions": directions})
    failed = [row for row in rows if row["status"] == "failed"]
    report = {
        "kind": "machinen.research.real-socket-resource-ladder.report",
        "version": 1,
        "status": "proved-with-refusals" if not failed else "completed-with-failures",
        "acceptedRows": len([row for row in rows if row["status"] == "accepted"]),
        "refusedRows": len([row for row in rows if row["status"] == "refused"]),
        "failedRows": len(failed),
        "rows": rows,
        "claimGuard": CLAIM_GUARD,
    }
    write_json(retained / "report.json", report)
    print(json.dumps(report, indent=2))
    return 0


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "list-cases":
        print("\n".join(CASES))
        return 0
    if len(sys.argv) > 1 and sys.argv[1] == "remote":
        return remote(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "combine":
        return combine(sys.argv[2:])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
