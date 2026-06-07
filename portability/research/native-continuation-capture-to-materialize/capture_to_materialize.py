#!/usr/bin/env python3
import fcntl
import importlib.util
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

CASES = {
    "pty-read-empty-queue": {
        "materializerCase": "pty-read-empty-queue",
        "expectedShapeId": "shape-controlled-pty-read-empty-queue",
        "description": "classifier captures a live controlled pty read descriptor and target materializer continues it",
    },
    "pipe-empty-blocked-endpoint": {
        "materializerCase": "pipe-empty-blocked-endpoint",
        "expectedShapeId": "shape-pipe-empty-blocked-endpoint",
        "description": "classifier captures an empty blocked pipe endpoint descriptor and target materializer continues it",
    },
    "socket-listener-empty": {
        "materializerCase": "socket-listener-empty",
        "expectedShapeId": "shape-socket-listener-empty-accept-queue",
        "description": "classifier captures an empty listener socket descriptor and target materializer accepts a client",
    },
    "socket-local-connected-empty": {
        "materializerCase": "socket-local-connected-empty",
        "expectedShapeId": "shape-socket-connected-local-empty-queues",
        "description": "classifier captures an empty local connected socket descriptor and target materializer semantically reconnects",
    },
    "threads-all-parked": {
        "materializerCase": "threads-all-parked",
        "expectedShapeId": "shape-threads-all-parked-known-waits",
        "description": "classifier captures all-parked thread roles and target materializer wakes target-native roles",
    },
    "paused-vm-pty-read-empty-queue": {
        "materializerCase": "pty-read-empty-queue",
        "expectedShapeId": "shape-controlled-pty-read-empty-queue",
        "description": "classifier captures a pty read descriptor with paused-VM atomic observation marking and target materializer continues it",
        "pausedVm": True,
    },
}

REFUSAL_CASES = {
    "refuse-nonempty-pty-queue": {
        "expectedShapeIds": {"refuse-nonempty-pty-queue", "refuse-unclassified-process-shape"},
        "description": "classifier refuses non-empty pty queue and emits no descriptor",
    },
    "refuse-socket-queued-bytes": {
        "expectedShapeIds": {"refuse-socket-queued-or-inflight-bytes"},
        "description": "classifier refuses queued socket bytes and emits no descriptor",
    },
    "refuse-active-thread": {
        "expectedShapeIds": {"refuse-active-or-unclassified-thread"},
        "description": "classifier refuses active thread and emits no descriptor",
    },
}


def load_classifier():
    script = Path(__file__).resolve().parent / "classify.py"
    spec = importlib.util.spec_from_file_location("native_continuation_classifier", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def base(case_id, mode, role, description, kind="support"):
    return {"case": case_id, "kind": kind, "description": description, "mode": mode, "role": role, "hostArch": os.uname().machine, "claimGuard": CLAIM_GUARD}


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
        handles.append(("pty", master))
        return proc, handles
    if case_id == "pipe-empty-blocked-endpoint":
        return spawn_python("import os; r,w=os.pipe(); os.read(r,1)"), handles
    if case_id == "socket-listener-empty":
        return spawn_python("import socket, time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(1); time.sleep(30)"), handles
    if case_id == "socket-local-connected-empty":
        script = """
import socket, time
listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1)
client=socket.socket(); client.connect(listener.getsockname())
server,_=listener.accept(); listener.close()
time.sleep(30)
"""
        return spawn_python(script), handles
    if case_id == "threads-all-parked":
        script = """
import threading, time
threading.Thread(target=time.sleep,args=(30,),daemon=True).start()
threading.Thread(target=time.sleep,args=(30,),daemon=True).start()
time.sleep(30)
"""
        return spawn_python(script), handles
    if case_id == "refuse-nonempty-pty-queue":
        proc, master = spawn_pty(["python3", "-c", "import time; time.sleep(30)"])
        os.write(master, b"queued-input\n")
        handles.append(("pty", master))
        return proc, handles
    if case_id == "refuse-socket-queued-bytes":
        script = """
import socket, time
listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1)
client=socket.socket(); client.connect(listener.getsockname())
server,_=listener.accept(); listener.close(); client.send(b'queued-socket-bytes')
time.sleep(30)
"""
        return spawn_python(script), handles
    if case_id == "refuse-active-thread":
        script = """
import threading, time
def burn():
    x=0
    while True:
        x=(x+1)%1000003
threading.Thread(target=burn,daemon=True).start()
time.sleep(30)
"""
        return spawn_python(script), handles
    raise KeyError(case_id)


def close_handles(handles):
    for kind, handle in handles:
        if kind == "pty":
            try:
                os.close(handle)
            except OSError:
                pass


def descriptor_is_safe(descriptor):
    memory = descriptor.get("memory", {})
    materializer = descriptor.get("materializer", {})
    return descriptor.get("architectureNeutral") is True and memory.get("rawHeapStackRegistersCaptured") is False and memory.get("rawHeapCaptured") is False and memory.get("rawStackCaptured") is False and memory.get("rawRegistersCaptured") is False and materializer.get("rawProcessMemoryMaterialization") is False


def capture_support(case_id, out):
    case = CASES[case_id]
    result = base(case_id, "source", "source", case["description"])
    classifier = load_classifier()
    proc, handles = spawn_fixture(case_id)
    try:
        time.sleep(0.6)
        classified = classifier.classify_pid(proc.pid, paused_vm=case.get("pausedVm", False))
        descriptor = classified.get("descriptor")
        ok = classified["decision"] == "accepted" and classified["shapeId"] == case["expectedShapeId"] and descriptor and descriptor_is_safe(descriptor)
        result.update({
            "decision": "captured" if ok else "failed",
            "classifierResult": classified,
            "descriptor": descriptor,
            "descriptorSource": "native-continuation-classifier/classify.py",
            "materializerCase": case["materializerCase"],
            "descriptorUnchangedForTarget": True,
        })
        write_json(out, result)
        print(json.dumps({"case": case_id, "decision": result["decision"], "shapeId": classified.get("shapeId"), "arch": result["hostArch"]}, indent=2))
        return 0 if ok else 1
    finally:
        kill_process(proc)
        close_handles(handles)


def capture_refusal(case_id, out):
    case = REFUSAL_CASES[case_id]
    result = base(case_id, "source", "source", case["description"], kind="refusal")
    classifier = load_classifier()
    proc, handles = spawn_fixture(case_id)
    try:
        time.sleep(0.6)
        classified = classifier.classify_pid(proc.pid)
        ok = classified["decision"] == "refused" and classified["shapeId"] in case["expectedShapeIds"] and "descriptor" not in classified
        result.update({"decision": "refused" if ok else "failed", "classifierResult": classified, "descriptor": None, "materializerAvailable": False})
        write_json(out, result)
        print(json.dumps({"case": case_id, "decision": result["decision"], "shapeId": classified.get("shapeId"), "arch": result["hostArch"]}, indent=2))
        return 0 if ok else 1
    finally:
        kill_process(proc)
        close_handles(handles)


def combine(args):
    retained = Path(args[0])
    rows = []
    for case_id in CASES:
        same_source = json.loads((retained / f"same-{case_id}-source.json").read_text())
        same_target = json.loads((retained / f"same-{case_id}-target.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            descriptor_unchanged = target.get("descriptor") == source.get("descriptor")
            decision = "accepted" if source["decision"] == "captured" and target["decision"] == "accepted" and descriptor_unchanged else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"], "descriptorUnchanged": descriptor_unchanged})
        same_descriptor_unchanged = same_target.get("descriptor") == same_source.get("descriptor")
        status = "accepted" if same_source["decision"] == "captured" and same_target["decision"] == "accepted" and same_descriptor_unchanged and all(d["decision"] == "accepted" for d in directions) else "failed"
        rows.append({"case": case_id, "kind": "support", "status": status, "sameArch": "accepted" if same_source["decision"] == "captured" and same_target["decision"] == "accepted" and same_descriptor_unchanged else "failed", "sameArchDescriptorUnchanged": same_descriptor_unchanged, "directions": directions})
    for case_id in REFUSAL_CASES:
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            decision = "refused" if source["decision"] == "refused" and source.get("descriptor") is None else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": None})
        status = "refused" if same["decision"] == "refused" and all(d["decision"] == "refused" for d in directions) else "failed"
        rows.append({"case": case_id, "kind": "refusal", "status": status, "sameArch": same["decision"], "directions": directions})
    report = {"kind": "machinen.research.native-continuation-capture-to-materialize.report", "version": 1, "status": "proved-with-refusals" if not [r for r in rows if r["status"] == "failed"] else "completed-with-failures", "acceptedRows": len([r for r in rows if r["status"] == "accepted"]), "refusedRows": len([r for r in rows if r["status"] == "refused"]), "failedRows": len([r for r in rows if r["status"] == "failed"]), "rows": rows, "claimGuard": CLAIM_GUARD}
    write_json(retained / "report.json", report)
    print(json.dumps(report, indent=2))
    return 0 if report["failedRows"] == 0 else 1


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "list-support-cases":
        print("\n".join(CASES)); return 0
    if len(sys.argv) == 2 and sys.argv[1] == "list-refusal-cases":
        print("\n".join(REFUSAL_CASES)); return 0
    if len(sys.argv) > 1 and sys.argv[1] == "capture-support":
        return capture_support(sys.argv[2], sys.argv[3])
    if len(sys.argv) > 1 and sys.argv[1] == "capture-refusal":
        return capture_refusal(sys.argv[2], sys.argv[3])
    if len(sys.argv) > 1 and sys.argv[1] == "combine":
        return combine(sys.argv[2:])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
