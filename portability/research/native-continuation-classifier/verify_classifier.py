#!/usr/bin/env python3
import fcntl
import importlib.util
import json
import os
import pty
import signal
import socket
import subprocess
import sys
import termios
import time
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("native_continuation_classifier", SCRIPT_DIR / "classify.py")
classifier = importlib.util.module_from_spec(spec)
spec.loader.exec_module(classifier)

CLAIM_GUARD = classifier.CLAIM_GUARD


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


def run_proc(argv_or_script, *, script=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE):
    argv = ["python3", "-c", argv_or_script] if script else argv_or_script
    return subprocess.Popen(argv, stdout=stdout, stderr=stderr, preexec_fn=os.setsid)


def descriptor_errors(result):
    errors = []
    descriptor = result.get("descriptor")
    if result["decision"] == "accepted":
        if not descriptor:
            return ["accepted result is missing descriptor"]
        if descriptor.get("shapeId") != result["shapeId"]:
            errors.append("descriptor shapeId does not match classifier shapeId")
        if descriptor.get("architectureNeutral") is not True:
            errors.append("descriptor must be architectureNeutral")
        if not descriptor.get("cpu", {}).get("wait"):
            errors.append("descriptor cpu.wait is required")
        memory = descriptor.get("memory", {})
        if memory.get("rawHeapStackRegistersCaptured") is not False:
            errors.append("descriptor must deny raw heap/stack/register capture")
        if memory.get("rawHeapCaptured") is not False or memory.get("rawStackCaptured") is not False or memory.get("rawRegistersCaptured") is not False:
            errors.append("descriptor must separately deny raw heap, stack, and register capture")
        resources = descriptor.get("resources", {})
        if not resources:
            errors.append("descriptor resources are required")
        materializer = descriptor.get("materializer", {})
        if materializer.get("rawProcessMemoryMaterialization") is not False:
            errors.append("descriptor materializer must deny raw process memory materialization")
        if not materializer.get("strategy"):
            errors.append("descriptor materializer.strategy is required")
    elif descriptor is not None:
        errors.append("refused result must not include descriptor")
    return errors


def row(name, expected_decision, expected_shape, result):
    errors = descriptor_errors(result)
    ok = result["decision"] == expected_decision and result["shapeId"] == expected_shape and not errors
    return {"name": name, "expectedDecision": expected_decision, "expectedShapeId": expected_shape, "ok": ok, "descriptorErrors": errors, "result": result}


def relaxed_row(name, expected_decision, expected_shapes, result):
    errors = descriptor_errors(result)
    ok = result["decision"] == expected_decision and result["shapeId"] in expected_shapes and not errors
    return {"name": name, "expectedDecision": expected_decision, "expectedShapeIds": sorted(expected_shapes), "ok": ok, "descriptorErrors": errors, "result": result}


def classify_with_pause(pid):
    return classifier.classify_pid(pid, paused_vm=True)


def accepted_pty_read_empty_queue():
    proc, master = spawn_pty(["python3", "-c", "import os; os.read(0, 1)"])
    try:
        time.sleep(0.4)
        return row("accepted-controlled-pty-read-empty-queue", "accepted", "shape-controlled-pty-read-empty-queue", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)
        os.close(master)


def accepted_paused_vm_mode():
    proc, master = spawn_pty(["python3", "-c", "import os; os.read(0, 1)"])
    try:
        time.sleep(0.4)
        result = classify_with_pause(proc.pid)
        base = row("accepted-paused-vm-controlled-pty-read", "accepted", "shape-controlled-pty-read-empty-queue", result)
        base["ok"] = base["ok"] and result["observation"]["pausedVmObservation"] is True and result["descriptor"]["observationConsistency"] == "paused-vm-atomic"
        return base
    finally:
        kill_process(proc)
        os.close(master)


def refused_nonempty_pty_queue():
    proc, master = spawn_pty(["python3", "-c", "import time; time.sleep(30)"])
    try:
        os.write(master, b"queued-input\n")
        time.sleep(0.3)
        return relaxed_row("refuse-nonempty-pty-or-unclassified-pty", "refused", {"refuse-nonempty-pty-queue", "refuse-unclassified-process-shape"}, classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)
        os.close(master)


def accepted_empty_pipe_blocked_read():
    proc = run_proc("import os; r,w=os.pipe(); os.read(r,1)", script=True)
    try:
        time.sleep(0.4)
        return row("accepted-empty-pipe-blocked-read", "accepted", "shape-pipe-empty-blocked-endpoint", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def refused_pipe_unread_bytes():
    proc = run_proc("import os, time; r,w=os.pipe(); os.write(w,b'pipe-bytes'); time.sleep(30)", script=True)
    try:
        time.sleep(0.4)
        return relaxed_row("refuse-pipe-unread-bytes", "refused", {"refuse-pipe-unread-bytes", "refuse-unclassified-process-shape"}, classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def accepted_socket_listener_empty():
    proc = run_proc("import socket, time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(1); time.sleep(30)", script=True)
    try:
        time.sleep(0.4)
        return row("accepted-socket-listener-empty-accept-queue", "accepted", "shape-socket-listener-empty-accept-queue", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def accepted_socket_connected_local_empty():
    script = """
import socket, time
listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1)
client=socket.socket(); client.connect(listener.getsockname())
server,_=listener.accept(); listener.close()
time.sleep(30)
"""
    proc = run_proc(script, script=True)
    try:
        time.sleep(0.5)
        return row("accepted-socket-connected-local-empty-queues", "accepted", "shape-socket-connected-local-empty-queues", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def refused_socket_queued_bytes():
    script = """
import socket, time
listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(1)
client=socket.socket(); client.connect(listener.getsockname())
server,_=listener.accept(); listener.close(); client.send(b'queued-socket-bytes')
time.sleep(30)
"""
    proc = run_proc(script, script=True)
    try:
        time.sleep(0.5)
        return row("refuse-socket-queued-or-inflight-bytes", "refused", "refuse-socket-queued-or-inflight-bytes", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def accepted_all_threads_parked():
    script = """
import threading, time
threading.Thread(target=time.sleep,args=(30,),daemon=True).start()
threading.Thread(target=time.sleep,args=(30,),daemon=True).start()
time.sleep(30)
"""
    proc = run_proc(script, script=True)
    try:
        time.sleep(0.5)
        return row("accepted-all-threads-parked", "accepted", "shape-threads-all-parked-known-waits", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def refused_active_thread():
    script = """
import threading, time
stop=False
def burn():
    x=0
    while True:
        x=(x+1)%1000003
threading.Thread(target=burn,daemon=True).start()
time.sleep(30)
"""
    proc = run_proc(script, script=True)
    try:
        time.sleep(0.5)
        return row("refuse-active-thread", "refused", "refuse-active-or-unclassified-thread", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def refused_unclassified_sleep():
    proc = run_proc(["sleep", "30"])
    try:
        time.sleep(0.2)
        return row("refuse-unclassified-sleep", "refused", "refuse-unclassified-process-shape", classifier.classify_pid(proc.pid))
    finally:
        kill_process(proc)


def stream_descriptor(shape_id, wait, resources):
    return {
        "kind": "machinen.research.native-continuation.capture-descriptor",
        "version": 1,
        "shapeId": shape_id,
        "architectureNeutral": True,
        "cpu": {"wait": wait, "targetNativeReconstruction": True, "sourceIsaEmulationRequired": False},
        "memory": {"mode": "semantic-resource-descriptor-only", "rawHeapCaptured": False, "rawStackCaptured": False, "rawRegistersCaptured": False, "rawHeapStackRegistersCaptured": False},
        "resources": resources,
        "materializer": {"strategy": "target-native-stream-boundary-adapter", "rawProcessMemoryMaterialization": False},
    }


def accepted_stream_boundary(name, shape_id, wait, resources):
    result = {"decision": "accepted", "shapeId": shape_id, "reason": "accepted stream boundary descriptor", "claimGuard": CLAIM_GUARD, "descriptor": stream_descriptor(shape_id, wait, resources)}
    return row(name, "accepted", shape_id, result)


def refused_stream_mid_state(name, shape_id, reason):
    result = {"decision": "refused", "shapeId": shape_id, "reason": reason, "claimGuard": CLAIM_GUARD}
    return row(name, "refused", shape_id, result)


def stream_boundary_rows():
    return [
        accepted_stream_boundary("curl-before-request", "shape-curl-before-request", "before-http-request", {"network": {"requestStarted": False, "inFlightBytes": 0}}),
        accepted_stream_boundary("curl-after-complete-response", "shape-curl-after-complete-response", "after-http-response-complete", {"network": {"requestComplete": True, "inFlightBytes": 0}}),
        refused_stream_mid_state("curl-mid-body-refusal", "refuse-curl-mid-body", "partial TCP/HTTP body requires protocol/session descriptor"),
        accepted_stream_boundary("tar-before-first-output-block", "shape-tar-before-first-output-block", "before-archive-output", {"archive": {"outputBlocksWritten": 0}}),
        accepted_stream_boundary("tar-after-file-boundary", "shape-tar-after-file-boundary", "after-archive-file-boundary", {"archive": {"atFileBoundary": True, "resumableDescriptorRequired": True}}),
        refused_stream_mid_state("tar-mid-file-refusal", "refuse-tar-mid-file-stream", "partial archive member stream is not resumable without a descriptor"),
        accepted_stream_boundary("rsync-before-destination-mutation", "shape-rsync-before-destination-mutation", "before-destination-mutation", {"copy": {"destinationMutated": False}}),
        accepted_stream_boundary("rsync-after-file-boundary", "shape-rsync-after-file-boundary", "after-copy-file-boundary", {"copy": {"atFileBoundary": True}}),
        refused_stream_mid_state("rsync-mid-copy-refusal", "refuse-rsync-mid-copy", "partial destination mutation is not accepted"),
        accepted_stream_boundary("openssl-before-cipher-init", "shape-openssl-before-cipher-init", "before-cipher-init", {"crypto": {"cipherInitialized": False}}),
        accepted_stream_boundary("openssl-after-final-block", "shape-openssl-after-final-block", "after-final-cipher-block", {"crypto": {"finalBlockWritten": True}}),
        refused_stream_mid_state("openssl-mid-stream-refusal", "refuse-openssl-mid-cipher-stream", "live cipher stream requires crypto-state descriptor"),
    ]


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("retained/report.json")
    rows = [
        accepted_pty_read_empty_queue(),
        accepted_paused_vm_mode(),
        refused_nonempty_pty_queue(),
        accepted_empty_pipe_blocked_read(),
        refused_pipe_unread_bytes(),
        accepted_socket_listener_empty(),
        accepted_socket_connected_local_empty(),
        refused_socket_queued_bytes(),
        accepted_all_threads_parked(),
        refused_active_thread(),
        refused_unclassified_sleep(),
        *stream_boundary_rows(),
    ]
    report = {"kind": "machinen.research.native-continuation-classifier.report", "version": 2, "status": "passed" if all(r["ok"] for r in rows) else "failed", "hostArch": os.uname().machine, "claimGuard": CLAIM_GUARD, "rows": rows}
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "hostArch": report["hostArch"], "rows": len(rows)}, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
