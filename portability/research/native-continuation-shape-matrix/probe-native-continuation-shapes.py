#!/usr/bin/env python3
import fcntl
import json
import os
import pty
import select
import shutil
import signal
import socket
import struct
import subprocess
import sys
import tempfile
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

READ_SYSCALLS_BY_ARCH = {
    "x86_64": {"0"},
    "amd64": {"0"},
    "aarch64": {"63"},
    "arm64": {"63"},
}


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return None


def fd_link(pid, fd):
    try:
        return os.readlink(f"/proc/{pid}/fd/{fd}")
    except OSError:
        return None


def list_fds(pid):
    out = []
    fd_dir = Path(f"/proc/{pid}/fd")
    try:
        names = sorted(fd_dir.iterdir(), key=lambda p: int(p.name))
    except OSError:
        return out
    for entry in names:
        link = fd_link(pid, entry.name)
        if link is None:
            continue
        if link.startswith("socket:"):
            kind = "socket"
        elif link.startswith("pipe:"):
            kind = "pipe"
        elif "/dev/pts/" in link or link == "/dev/ptmx":
            kind = "pty"
        elif link.startswith("anon_inode:"):
            kind = "anon_inode"
        else:
            kind = "file"
        out.append({"fd": int(entry.name), "target": link, "kind": kind})
    return out


def pty_queue_bytes(fd):
    try:
        packed = fcntl.ioctl(fd, termios.FIONREAD, struct.pack("I", 0))
        return struct.unpack("I", packed)[0]
    except OSError:
        return None


def syscall_observation(pid):
    raw = read_text(f"/proc/{pid}/syscall")
    wchan = read_text(f"/proc/{pid}/wchan")
    state = read_text(f"/proc/{pid}/stat")
    state_code = None
    if state:
        parts = state.split()
        if len(parts) > 2:
            state_code = parts[2]
    syscall_number = raw.split()[0] if raw else None
    arch = os.uname().machine
    read_like = syscall_number in READ_SYSCALLS_BY_ARCH.get(arch, set()) or (wchan and "tty" in wchan and "read" in wchan)
    return {"raw": raw, "wchan": wchan, "state": state_code, "syscallNumber": syscall_number, "readLikeWait": bool(read_like)}


def observe_process(pid, pty_master_fd=None):
    fds = list_fds(pid)
    observation = {
        "pid": pid,
        "alive": Path(f"/proc/{pid}").exists(),
        "fds": fds,
        "fdKinds": sorted({fd["kind"] for fd in fds}),
        "syscall": syscall_observation(pid),
    }
    if pty_master_fd is not None:
        observation["ptyMasterReadableBytes"] = pty_queue_bytes(pty_master_fd)
    return observation


def classify(observation):
    if "socket" in observation["fdKinds"]:
        return {"decision": "refused", "reason": "socket-fd-present"}
    if observation.get("ptyMasterReadableBytes") not in (None, 0):
        return {"decision": "refused", "reason": "pty-output-or-queued-bytes-present"}
    if "pty" in observation["fdKinds"] and observation["syscall"].get("readLikeWait") and observation.get("ptyMasterReadableBytes") == 0:
        return {"decision": "accepted", "reason": "controlled-pty-read-wait-empty-queue"}
    return {"decision": "refused", "reason": "unclassified-or-unsafe-process-shape"}


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


def spawn_pty_reader():
    python = shutil.which("python3")
    if not python:
        raise RuntimeError("python3 missing")
    master, slave = pty.openpty()
    def preexec():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    proc = subprocess.Popen([python, "-c", "import os; os.read(0, 1)"], stdin=slave, stdout=slave, stderr=slave, preexec_fn=preexec, close_fds=True)
    os.close(slave)
    time.sleep(0.4)
    return proc, master


def accepted_pty_read_probe():
    proc, master = spawn_pty_reader()
    try:
        observation = observe_process(proc.pid, master)
        classification = classify(observation)
        ok = classification["decision"] == "accepted"
        return {"name": "accepted-controlled-pty-read-empty-queue", "expected": "accepted", "ok": ok, "classification": classification, "observation": observation}
    finally:
        kill_process(proc)
        os.close(master)


def socket_refusal_probe():
    python = shutil.which("python3")
    if not python:
        raise RuntimeError("python3 missing")
    script = "import socket, time; s=socket.socket(); s.bind(('127.0.0.1',0)); s.listen(1); time.sleep(30)"
    proc = subprocess.Popen([python, "-c", script], stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=os.setsid)
    try:
        time.sleep(0.4)
        observation = observe_process(proc.pid)
        classification = classify(observation)
        ok = classification["decision"] == "refused" and classification["reason"] == "socket-fd-present"
        return {"name": "refuse-process-with-socket-fd", "expected": "refused", "ok": ok, "classification": classification, "observation": observation}
    finally:
        kill_process(proc)


def unclassified_refusal_probe():
    proc = subprocess.Popen(["sleep", "30"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, preexec_fn=os.setsid)
    try:
        time.sleep(0.2)
        observation = observe_process(proc.pid)
        classification = classify(observation)
        ok = classification["decision"] == "refused"
        return {"name": "refuse-unclassified-sleep", "expected": "refused", "ok": ok, "classification": classification, "observation": observation}
    finally:
        kill_process(proc)


def main():
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("retained/probe-report.json")
    out.parent.mkdir(parents=True, exist_ok=True)
    if not Path("/proc/self").exists():
        report = {"kind": "machinen.research.native-continuation-shape-probes.report", "version": 1, "status": "skipped-not-linux-procfs", "hostArch": os.uname().machine, "claimGuard": CLAIM_GUARD, "probes": []}
    else:
        probes = [accepted_pty_read_probe(), socket_refusal_probe(), unclassified_refusal_probe()]
        report = {"kind": "machinen.research.native-continuation-shape-probes.report", "version": 1, "status": "passed" if all(p["ok"] for p in probes) else "failed", "hostArch": os.uname().machine, "claimGuard": CLAIM_GUARD, "probes": probes}
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "hostArch": report["hostArch"], "probes": len(report["probes"])}))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
