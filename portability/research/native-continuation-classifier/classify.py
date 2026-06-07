#!/usr/bin/env python3
import argparse
import fcntl
import json
import os
import re
import struct
import termios
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

POLL_SYSCALLS_BY_ARCH = {
    "x86_64": {"7", "232", "270", "271"},
    "amd64": {"7", "232", "270", "271"},
    "aarch64": {"73", "74"},
    "arm64": {"73", "74"},
}

KNOWN_PARKED_WCHANS = {
    "futex_wait_queue",
    "futex_wait_queue_me",
    "hrtimer_nanosleep",
    "do_nanosleep",
    "pipe_read",
    "n_tty_read",
    "unix_stream_read_generic",
    "inet_csk_accept",
    "do_select",
    "do_epoll_wait",
    "ep_poll",
    "poll_schedule_timeout",
}

SOCKET_RE = re.compile(r"^socket:\[(\d+)\]$")
TCP_STATES = {"01": "ESTABLISHED", "0A": "LISTEN"}


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None


def proc_link(path):
    try:
        return os.readlink(path)
    except OSError:
        return None


def read_status(pid):
    raw = read_text(f"/proc/{pid}/status")
    status = {}
    if not raw:
        return status
    for line in raw.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        status[key] = value.strip()
    return status


def read_cmdline(pid):
    try:
        raw = Path(f"/proc/{pid}/cmdline").read_bytes()
    except OSError:
        return []
    return [part.decode(errors="replace") for part in raw.split(b"\0") if part]


def parse_stat(pid):
    raw = read_text(f"/proc/{pid}/stat")
    if not raw:
        return {}
    right = raw.rsplit(")", 1)[-1].strip().split()
    if len(right) < 6:
        return {}
    return {"state": right[0], "ppid": int(right[1]), "pgrp": int(right[2]), "session": int(right[3])}


def fd_target(pid, fd):
    return proc_link(f"/proc/{pid}/fd/{fd}")


def socket_inode(target):
    if target is None:
        return None
    match = SOCKET_RE.match(target)
    return match.group(1) if match else None


def fd_kind(target):
    if target is None:
        return "unknown"
    if socket_inode(target):
        return "socket"
    if target.startswith("pipe:"):
        return "pipe"
    if target.startswith("anon_inode:"):
        return "anon_inode"
    if target == "/dev/ptmx" or "/dev/pts/" in target:
        return "pty"
    return "file"


def queue_bytes_for_proc_fd(pid, fd):
    path = f"/proc/{pid}/fd/{fd}"
    try:
        opened = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    except OSError:
        return None
    try:
        packed = fcntl.ioctl(opened, termios.FIONREAD, struct.pack("I", 0))
        return struct.unpack("I", packed)[0]
    except OSError:
        return None
    finally:
        os.close(opened)


def parse_tcp_table(path, family):
    raw = read_text(path)
    entries = {}
    if not raw:
        return entries
    for line in raw.splitlines()[1:]:
        parts = line.split()
        if len(parts) < 10:
            continue
        tx_hex, rx_hex = parts[4].split(":")
        inode = parts[9]
        local_addr, local_port = parts[1].split(":")
        rem_addr, rem_port = parts[2].split(":")
        entries[inode] = {
            "family": family,
            "state": TCP_STATES.get(parts[3], parts[3]),
            "stateHex": parts[3],
            "txQueue": int(tx_hex, 16),
            "rxQueue": int(rx_hex, 16),
            "localAddressHex": local_addr,
            "localPort": int(local_port, 16),
            "remoteAddressHex": rem_addr,
            "remotePort": int(rem_port, 16),
        }
    return entries


def tcp_socket_index(pid=None):
    base = f"/proc/{pid}/net" if pid is not None and Path(f"/proc/{pid}/net").exists() else "/proc/net"
    index = {}
    index.update(parse_tcp_table(f"{base}/tcp", "tcp4"))
    index.update(parse_tcp_table(f"{base}/tcp6", "tcp6"))
    return index


def is_loopback_tcp(entry):
    local = entry.get("localAddressHex")
    remote = entry.get("remoteAddressHex")
    if entry.get("family") == "tcp4":
        return local == "0100007F" and remote == "0100007F"
    if entry.get("family") == "tcp6":
        return local in {"00000000000000000000000001000000", "00000000000000000000000000000001"} and remote in {"00000000000000000000000001000000", "00000000000000000000000000000001"}
    return False


def list_fds(pid):
    fd_dir = Path(f"/proc/{pid}/fd")
    tcp_index = tcp_socket_index(pid)
    try:
        entries = sorted(fd_dir.iterdir(), key=lambda entry: int(entry.name))
    except OSError:
        return []
    fds = []
    for entry in entries:
        target = fd_target(pid, entry.name)
        kind = fd_kind(target)
        inode = socket_inode(target)
        queue_bytes = queue_bytes_for_proc_fd(pid, entry.name) if kind in {"pty", "pipe"} else None
        fd = {"fd": int(entry.name), "target": target, "kind": kind, "queueBytes": queue_bytes}
        if inode:
            fd["socketInode"] = inode
            fd["socket"] = tcp_index.get(inode, {"state": "unclassified", "txQueue": None, "rxQueue": None})
        fds.append(fd)
    return fds


def syscall_observation(pid, arch):
    raw = read_text(f"/proc/{pid}/syscall")
    wchan = (read_text(f"/proc/{pid}/wchan") or "").strip() or None
    number = raw.split()[0] if raw else None
    read_like = number in READ_SYSCALLS_BY_ARCH.get(arch, set()) or bool(wchan and ("read" in wchan or "tty" in wchan or "pipe" in wchan or wchan == "wait_woken"))
    poll_like = number in POLL_SYSCALLS_BY_ARCH.get(arch, set()) or bool(wchan and ("poll" in wchan or "select" in wchan))
    return {"raw": raw.strip() if raw else None, "wchan": wchan, "number": number, "readLikeWait": read_like, "pollLikeWait": poll_like}


def task_observations(pid, arch):
    task_dir = Path(f"/proc/{pid}/task")
    tasks = []
    try:
        entries = sorted(task_dir.iterdir(), key=lambda entry: int(entry.name))
    except OSError:
        return tasks
    for entry in entries:
        tid = int(entry.name)
        stat = parse_stat(tid)
        syscall = syscall_observation(tid, arch)
        tasks.append({"tid": tid, "state": stat.get("state"), "wchan": syscall.get("wchan"), "syscall": syscall})
    return tasks


def observe_pid(pid, paused_vm=False):
    arch = os.uname().machine
    status = read_status(pid)
    fds = list_fds(pid)
    fd_kinds = sorted({fd["kind"] for fd in fds})
    stat = parse_stat(pid)
    return {
        "pid": pid,
        "hostArch": arch,
        "pausedVmObservation": paused_vm,
        "observationConsistency": "paused-vm-atomic" if paused_vm else "live-procfs-best-effort",
        "alive": Path(f"/proc/{pid}").exists(),
        "exe": proc_link(f"/proc/{pid}/exe"),
        "cmdline": read_cmdline(pid),
        "processTree": {"ppid": stat.get("ppid"), "pgrp": stat.get("pgrp"), "session": stat.get("session")},
        "status": {"state": status.get("State"), "threads": int(status.get("Threads", "0")), "tracerPid": int(status.get("TracerPid", "0"))},
        "tasks": task_observations(pid, arch),
        "fds": fds,
        "fdKinds": fd_kinds,
        "syscall": syscall_observation(pid, arch),
    }


def nonzero_queue(fds, kind):
    queued = [fd for fd in fds if fd["kind"] == kind and isinstance(fd.get("queueBytes"), int) and fd["queueBytes"] > 0]
    return queued[0] if queued else None


def pipe_queues_known_empty(fds):
    pipes = [fd for fd in fds if fd["kind"] == "pipe"]
    return bool(pipes) and all(fd.get("queueBytes") in (0, None) for fd in pipes)


def pty_queues_known_empty(fds):
    ptys = [fd for fd in fds if fd["kind"] == "pty"]
    return bool(ptys) and all(fd.get("queueBytes") in (0, None) for fd in ptys)


def socket_classification(fds):
    sockets = [fd for fd in fds if fd["kind"] == "socket"]
    if not sockets:
        return None
    entries = [fd.get("socket", {}) for fd in sockets]
    if any(entry.get("txQueue") not in (0, None) or entry.get("rxQueue") not in (0, None) for entry in entries):
        return "refused", "refuse-socket-queued-or-inflight-bytes", "socket has queued/in-flight bytes"
    if all(entry.get("state") == "LISTEN" for entry in entries):
        return "accepted", "shape-socket-listener-empty-accept-queue", "listener socket has no queued accepts or bytes"
    if all(entry.get("state") == "ESTABLISHED" and is_loopback_tcp(entry) for entry in entries):
        return "accepted", "shape-socket-connected-local-empty-queues", "loopback connected sockets have empty queues and can use semantic reconnect"
    return "refused", "refuse-socket-fd-present", "socket fd requires a narrower accepted socket shape"


def all_threads_parked(observation):
    tasks = observation["tasks"]
    if len(tasks) <= 1:
        return False
    for task in tasks:
        state = task.get("state")
        wchan = task.get("wchan") or ""
        if state == "R":
            return False
        if not any(marker in wchan for marker in KNOWN_PARKED_WCHANS):
            return False
    return True


def classify_observation(observation):
    if not observation["alive"]:
        return "refused", "refuse-process-not-alive", "process is not alive"
    if observation["status"]["tracerPid"]:
        return "refused", "refuse-ptrace-owned-process", "process already has a tracer/inferior owner"
    pty_queued = nonzero_queue(observation["fds"], "pty")
    if pty_queued:
        return "refused", "refuse-nonempty-pty-queue", f"pty fd {pty_queued['fd']} has queued bytes"
    pipe_queued = nonzero_queue(observation["fds"], "pipe")
    if pipe_queued:
        return "refused", "refuse-pipe-unread-bytes", f"pipe fd {pipe_queued['fd']} has unread bytes"
    if any(task.get("state") == "R" for task in observation["tasks"]):
        return "refused", "refuse-active-or-unclassified-thread", "at least one live thread is runnable or not in a known wait"
    socket_result = socket_classification(observation["fds"])
    if socket_result:
        return socket_result
    if observation["status"]["threads"] > 1:
        if all_threads_parked(observation):
            return "accepted", "shape-threads-all-parked-known-waits", "all live threads are parked in known wait states"
        return "refused", "refuse-active-or-unclassified-thread", "at least one live thread is runnable or not in a known wait"
    has_pty = "pty" in observation["fdKinds"]
    if has_pty and pty_queues_known_empty(observation["fds"]) and observation["syscall"]["readLikeWait"]:
        return "accepted", "shape-controlled-pty-read-empty-queue", "single process blocked in pty read with no queued pty bytes"
    if has_pty and pty_queues_known_empty(observation["fds"]) and observation["syscall"]["pollLikeWait"]:
        return "accepted", "shape-controlled-pty-poll-empty-queue", "single process blocked in pty poll with no queued pty bytes"
    if pipe_queues_known_empty(observation["fds"]) and (observation["syscall"]["readLikeWait"] or observation["syscall"]["pollLikeWait"]):
        return "accepted", "shape-pipe-empty-blocked-endpoint", "pipe endpoint is blocked with no unread bytes"
    return "refused", "refuse-unclassified-process-shape", "no accepted CPU/memory/resource shape matched"


def descriptor_for_accepted_shape(shape_id, observation):
    waits = {
        "shape-controlled-pty-read-empty-queue": "pty-read",
        "shape-controlled-pty-poll-empty-queue": "pty-poll",
        "shape-pipe-empty-blocked-endpoint": "pipe-empty-wait",
        "shape-socket-listener-empty-accept-queue": "socket-accept-wait-or-idle-listener",
        "shape-socket-connected-local-empty-queues": "socket-local-connected-empty-queues",
        "shape-threads-all-parked-known-waits": "multi-thread-parked-waits",
    }
    if shape_id not in waits:
        return None
    pty_fds = [fd for fd in observation["fds"] if fd["kind"] == "pty"]
    pipe_fds = [fd for fd in observation["fds"] if fd["kind"] == "pipe"]
    socket_fds = [fd for fd in observation["fds"] if fd["kind"] == "socket"]
    return {
        "kind": "machinen.research.native-continuation.capture-descriptor",
        "version": 1,
        "shapeId": shape_id,
        "architectureNeutral": True,
        "observationConsistency": observation["observationConsistency"],
        "cpu": {"wait": waits[shape_id], "sourceArch": observation["hostArch"], "sourceSyscallNumber": observation["syscall"]["number"], "sourceWchan": observation["syscall"]["wchan"], "targetNativeReconstruction": True, "sourceIsaEmulationRequired": False},
        "memory": {"mode": "semantic-resource-descriptor-only", "rawHeapCaptured": False, "rawStackCaptured": False, "rawRegistersCaptured": False, "rawHeapStackRegistersCaptured": False, "threadStacksCaptured": False},
        "resources": {
            "process": {"threads": observation["status"]["threads"], "tracerPid": observation["status"]["tracerPid"], **observation["processTree"]},
            "fds": observation["fds"],
            "pty": {"fdCount": len(pty_fds), "queueBytesKnownEmpty": all(fd.get("queueBytes") in (0, None) for fd in pty_fds), "fds": pty_fds},
            "pipes": {"fdCount": len(pipe_fds), "bufferBytesKnownEmpty": all(fd.get("queueBytes") in (0, None) for fd in pipe_fds), "endpoints": pipe_fds, "processTreeCaptured": True},
            "sockets": {"fdCount": len(socket_fds), "fds": socket_fds, "bindOrReconnectPolicy": "semantic-rebind-or-reconnect-not-kernel-identity" if socket_fds else None, "kernelSocketIdentityPreserved": False},
            "threads": {"tasks": observation["tasks"], "roles": "parked-wait-descriptors", "threadStacksCaptured": False},
        },
        "materializer": {"strategy": "target-native-reexec-or-shape-adapter", "requires": ["single accepted shape", "empty accepted queues", "no ptrace owner", "target-native resources"], "rawProcessMemoryMaterialization": False},
    }


def classify_pid(pid, paused_vm=False):
    observation = observe_pid(pid, paused_vm=paused_vm)
    decision, shape_id, reason = classify_observation(observation)
    result = {"kind": "machinen.research.native-continuation-classifier.result", "version": 1, "decision": decision, "shapeId": shape_id, "reason": reason, "claimGuard": CLAIM_GUARD, "observation": observation}
    descriptor = descriptor_for_accepted_shape(shape_id, observation) if decision == "accepted" else None
    if descriptor is not None:
        result["descriptor"] = descriptor
    return result


def main():
    parser = argparse.ArgumentParser(description="Classify a live native process by CPU/memory/resource continuation shape.")
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--paused-vm", action="store_true", help="mark the observation as coming from an atomically paused VM/process boundary")
    args = parser.parse_args()
    if not Path("/proc/self").exists():
        raise SystemExit("/proc is required")
    print(json.dumps(classify_pid(args.pid, paused_vm=args.paused_vm), indent=2))


if __name__ == "__main__":
    main()
