#!/usr/bin/env python3
import fcntl
import json
import os
import pty
import signal
import subprocess
import sys
import termios
import time
from pathlib import Path

CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "rawHeapStackRegisterRestore": False,
}

SUPPORT_CASES = {
    "pty-read-empty-queue": {"shapeId": "shape-controlled-pty-read-empty-queue"},
    "pipe-empty-blocked-endpoint": {"shapeId": "shape-pipe-empty-blocked-endpoint"},
    "socket-listener-empty": {"shapeId": "shape-socket-listener-empty-accept-queue"},
    "socket-local-connected-empty": {"shapeId": "shape-socket-connected-local-empty-queues"},
    "threads-all-parked": {"shapeId": "shape-threads-all-parked-known-waits"},
    "paused-vm-pty-read-empty-queue": {"shapeId": "shape-controlled-pty-read-empty-queue", "pausedVm": True},
}

REFUSAL_CASES = {
    "refuse-nonempty-pty-queue": {"shapeIds": {"refuse-nonempty-pty-queue", "refuse-unclassified-process-shape"}},
    "refuse-socket-queued-bytes": {"shapeIds": {"refuse-socket-queued-or-inflight-bytes"}},
    "refuse-active-thread": {"shapeIds": {"refuse-active-or-unclassified-thread"}},
}


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def run_cmd(args, timeout=10):
    result = subprocess.run(args, capture_output=True, timeout=timeout, check=False)
    return {"args": args, "returncode": result.returncode, "stdout": result.stdout.decode(errors="replace"), "stderr": result.stderr.decode(errors="replace")}


def kill_process(proc):
    if proc.poll() is not None:
        return
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
    except OSError:
        proc.terminate()
    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            proc.kill()
        proc.wait(timeout=1)


def spawn_pty(argv):
    master, slave = pty.openpty()
    def preexec():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, preexec_fn=preexec, close_fds=True)
    os.close(slave)
    return proc, master


def spawn_python(script):
    return subprocess.Popen(["python3", "-c", script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=os.setsid)


def spawn_fixture(case_id):
    handles = []
    if case_id in {"pty-read-empty-queue", "paused-vm-pty-read-empty-queue"}:
        proc, master = spawn_pty(["python3", "-c", "import os; os.read(0, 1)"])
        handles.append(master)
        return proc, handles
    if case_id == "pipe-empty-blocked-endpoint":
        return spawn_python("import os; r,w=os.pipe(); os.read(r,1)"), handles
    if case_id == "socket-listener-empty":
        return spawn_python("import socket, time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(1); time.sleep(30)"), handles
    if case_id == "socket-local-connected-empty":
        return spawn_python("""
import socket, time
listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1)
client=socket.socket(); client.connect(listener.getsockname())
server,_=listener.accept(); listener.close()
time.sleep(30)
"""), handles
    if case_id == "threads-all-parked":
        return spawn_python("""
import threading, time
threading.Thread(target=time.sleep,args=(30,),daemon=True).start()
threading.Thread(target=time.sleep,args=(30,),daemon=True).start()
time.sleep(30)
"""), handles
    if case_id == "refuse-nonempty-pty-queue":
        proc, master = spawn_pty(["python3", "-c", "import time; time.sleep(30)"])
        os.write(master, b"queued-input\n")
        handles.append(master)
        return proc, handles
    if case_id == "refuse-socket-queued-bytes":
        return spawn_python("""
import socket, time
listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1)
client=socket.socket(); client.connect(listener.getsockname())
server,_=listener.accept(); listener.close(); client.send(b'queued-socket-bytes')
time.sleep(30)
"""), handles
    if case_id == "refuse-active-thread":
        return spawn_python("""
import threading, time
def burn():
    x=0
    while True:
        x=(x+1)%1000003
threading.Thread(target=burn,daemon=True).start()
time.sleep(30)
"""), handles
    raise KeyError(case_id)


def close_handles(handles):
    for handle in handles:
        try:
            os.close(handle)
        except OSError:
            pass


def base(case_id, mode, kind):
    return {"kind": "machinen.research.native-continuation-cli.proof-row", "version": 1, "case": case_id, "rowKind": kind, "mode": mode, "hostArch": os.uname().machine, "claimGuard": CLAIM_GUARD}


def capture_support(case_id, out):
    case = SUPPORT_CASES[case_id]
    proc, handles = spawn_fixture(case_id)
    try:
        cmd = None
        capture = None
        ok = False
        descriptor = None
        for _ in range(20):
            time.sleep(0.2)
            args = ["python3", "continuation_cli.py", "capture", "--pid", str(proc.pid), "--out", out]
            if case.get("pausedVm"):
                args.insert(-2, "--paused-vm")
            cmd = run_cmd(args)
            capture = json.loads(Path(out).read_text()) if Path(out).exists() else None
            descriptor = capture.get("descriptor") if capture else None
            ok = cmd["returncode"] == 0 and capture and capture["decision"] == "accepted" and capture["shapeId"] == case["shapeId"] and descriptor and descriptor.get("architectureNeutral") is True and descriptor.get("memory", {}).get("rawHeapStackRegistersCaptured") is False
            if ok:
                break
        row = base(case_id, "source", "support")
        row.update({"decision": "captured" if ok else "failed", "command": cmd, "capture": capture, "descriptor": descriptor})
        write_json(out, row)
        print(json.dumps({"case": case_id, "decision": row["decision"], "shapeId": capture.get("shapeId") if capture else None, "arch": row["hostArch"]}, indent=2))
        return 0 if ok else 1
    finally:
        kill_process(proc); close_handles(handles)


def materialize_support(case_id, descriptor_path, out):
    cmd = run_cmd(["python3", "continuation_cli.py", "materialize", "--descriptor", descriptor_path, "--out", out], timeout=20)
    materialized = json.loads(Path(out).read_text()) if Path(out).exists() else None
    source = json.loads(Path(descriptor_path).read_text())
    source_descriptor = source.get("descriptor")
    ok = cmd["returncode"] == 0 and materialized and materialized["decision"] == "accepted" and materialized.get("inputDescriptorUnchanged") is True and materialized.get("descriptor") == source_descriptor
    row = base(case_id, "target", "support")
    row.update({"decision": "accepted" if ok else "failed", "command": cmd, "materialized": materialized, "descriptor": materialized.get("descriptor") if materialized else None})
    write_json(out, row)
    print(json.dumps({"case": case_id, "decision": row["decision"], "arch": row["hostArch"]}, indent=2))
    return 0 if ok else 1


def capture_refusal(case_id, out):
    case = REFUSAL_CASES[case_id]
    proc, handles = spawn_fixture(case_id)
    try:
        cmd = None
        capture = None
        ok = False
        for _ in range(20):
            time.sleep(0.2)
            cmd = run_cmd(["python3", "continuation_cli.py", "capture", "--pid", str(proc.pid), "--allow-refused", "--out", out])
            capture = json.loads(Path(out).read_text()) if Path(out).exists() else None
            ok = cmd["returncode"] == 0 and capture and capture["decision"] == "refused" and capture["shapeId"] in case["shapeIds"] and capture.get("descriptor") is None
            if ok:
                break
        row = base(case_id, "source", "refusal")
        row.update({"decision": "refused" if ok else "failed", "command": cmd, "capture": capture, "descriptor": None})
        write_json(out, row)
        print(json.dumps({"case": case_id, "decision": row["decision"], "shapeId": capture.get("shapeId") if capture else None, "arch": row["hostArch"]}, indent=2))
        return 0 if ok else 1
    finally:
        kill_process(proc); close_handles(handles)


def combine(args):
    retained = Path(args[0])
    rows = []
    for case_id in SUPPORT_CASES:
        same_source = json.loads((retained / f"same-{case_id}-source.json").read_text())
        same_target = json.loads((retained / f"same-{case_id}-target.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            unchanged = target.get("descriptor") == source.get("descriptor")
            decision = "accepted" if source["decision"] == "captured" and target["decision"] == "accepted" and unchanged else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"], "descriptorUnchanged": unchanged})
        same_unchanged = same_target.get("descriptor") == same_source.get("descriptor")
        status = "accepted" if same_source["decision"] == "captured" and same_target["decision"] == "accepted" and same_unchanged and all(d["decision"] == "accepted" for d in directions) else "failed"
        rows.append({"case": case_id, "kind": "support", "status": status, "sameArch": "accepted" if same_unchanged else "failed", "sameArchDescriptorUnchanged": same_unchanged, "directions": directions})
    for case_id in REFUSAL_CASES:
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            decision = "refused" if source["decision"] == "refused" and source.get("descriptor") is None else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": None})
        status = "refused" if same["decision"] == "refused" and same.get("descriptor") is None and all(d["decision"] == "refused" for d in directions) else "failed"
        rows.append({"case": case_id, "kind": "refusal", "status": status, "sameArch": same["decision"], "directions": directions})
    report = {"kind": "machinen.research.native-continuation-cli.report", "version": 1, "status": "proved-with-refusals" if not [r for r in rows if r["status"] == "failed"] else "completed-with-failures", "acceptedRows": len([r for r in rows if r["status"] == "accepted"]), "refusedRows": len([r for r in rows if r["status"] == "refused"]), "failedRows": len([r for r in rows if r["status"] == "failed"]), "rows": rows, "claimGuard": CLAIM_GUARD}
    write_json(retained / "report.json", report)
    print(json.dumps(report, indent=2))
    return 0 if report["failedRows"] == 0 else 1


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "list-support-cases":
        print("\n".join(SUPPORT_CASES)); return 0
    if len(sys.argv) == 2 and sys.argv[1] == "list-refusal-cases":
        print("\n".join(REFUSAL_CASES)); return 0
    if len(sys.argv) > 1 and sys.argv[1] == "capture-support":
        return capture_support(sys.argv[2], sys.argv[3])
    if len(sys.argv) > 1 and sys.argv[1] == "materialize-support":
        return materialize_support(sys.argv[2], sys.argv[3], sys.argv[4])
    if len(sys.argv) > 1 and sys.argv[1] == "capture-refusal":
        return capture_refusal(sys.argv[2], sys.argv[3])
    if len(sys.argv) > 1 and sys.argv[1] == "combine":
        return combine(sys.argv[2:])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
