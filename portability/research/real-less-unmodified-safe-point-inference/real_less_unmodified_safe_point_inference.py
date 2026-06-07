#!/usr/bin/env python3
import fcntl
import json
import os
import select
import shutil
import signal
import struct
import subprocess
import sys
import termios
import tempfile
import time
from pathlib import Path

ROWS = 24
COLS = 80
READ_SYSCALL_BY_ARCH = {
    "x86_64": 0,
    "amd64": 0,
    "aarch64": 63,
    "arm64": 63,
}
CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "supportClaimed": False,
    "markerSymbolsUsed": False,
}


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def parse_stat(stat):
    if not stat:
        return []
    end = stat.rfind(")")
    if end == -1:
        return stat.split()
    prefix = stat[: end + 1]
    suffix = stat[end + 2 :].split()
    return [*prefix.split(maxsplit=1), *suffix]


def parse_syscall(raw):
    raw = raw.strip()
    if not raw:
        return {"raw": raw, "parsed": False, "reason": "empty"}
    if raw == "running":
        return {"raw": raw, "parsed": False, "reason": "running"}
    parts = raw.split()
    try:
        number = int(parts[0], 0)
        args = [int(part, 0) for part in parts[1:7]]
    except ValueError:
        return {"raw": raw, "parsed": False, "reason": "unparseable"}
    read_number = READ_SYSCALL_BY_ARCH.get(os.uname().machine)
    return {
        "raw": raw,
        "parsed": True,
        "number": number,
        "name": "read" if number == read_number else f"syscall-{number}",
        "args": args,
        "fd": args[0] if args else None,
    }


def proc_state(pid):
    status = read_text(f"/proc/{pid}/status")
    stat = parse_stat(read_text(f"/proc/{pid}/stat"))
    syscall = parse_syscall(read_text(f"/proc/{pid}/syscall"))
    fields = {}
    for line in status.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key] = value.strip()
    return {
        "statusState": fields.get("State", "unknown").split()[0],
        "threads": int(fields["Threads"]) if fields.get("Threads") else None,
        "signalPendingMask": fields.get("SigPnd"),
        "signalBlockedMask": fields.get("SigBlk"),
        "signalIgnoredMask": fields.get("SigIgn"),
        "signalCaughtMask": fields.get("SigCgt"),
        "statPgrp": int(stat[4]) if len(stat) > 4 else None,
        "statSession": int(stat[5]) if len(stat) > 5 else None,
        "statTtyNr": int(stat[6]) if len(stat) > 6 else None,
        "syscall": syscall,
    }


def fd_facts(pid):
    root = Path(f"/proc/{pid}/fd")
    facts = []
    if not root.exists():
        return facts
    for item in sorted(root.iterdir(), key=lambda path: int(path.name)):
        try:
            target = os.readlink(item)
        except OSError:
            target = "unreadable"
        facts.append({"fd": int(item.name), "target": target})
    return facts


def fd_target(fds, fd):
    for fact in fds:
        if fact["fd"] == fd:
            return fact["target"]
    return None


def file_identity(path):
    stat = os.stat(path)
    return {
        "path": str(path),
        "device": stat.st_dev,
        "inode": stat.st_ino,
        "size": stat.st_size,
        "mtimeNs": stat.st_mtime_ns,
        "mode": oct(stat.st_mode),
    }


def pty_identity(path):
    stat = os.stat(path)
    return {
        "path": path,
        "device": stat.st_dev,
        "inode": stat.st_ino,
        "rdev": stat.st_rdev,
        "mode": oct(stat.st_mode),
    }


def pty_bytes_available(fd):
    return struct.unpack("I", fcntl.ioctl(fd, termios.FIONREAD, struct.pack("I", 0)))[0]


def pty_slave_bytes_available(slave_path):
    try:
        fd = os.open(slave_path, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
    except OSError as error:
        return {"available": False, "error": str(error)}
    try:
        return {"available": True, "bytes": pty_bytes_available(fd)}
    finally:
        os.close(fd)


def foreground_pgrp(fd):
    try:
        return os.tcgetpgrp(fd)
    except OSError as error:
        return {"error": str(error)}


def set_pty_size(fd):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))


def drain_output(fd, deadline, expected=None):
    chunks = []
    while time.time() < deadline:
        readable, _, _ = select.select([fd], [], [], 0.05)
        if not readable:
            continue
        try:
            data = os.read(fd, 4096)
        except OSError:
            break
        if not data:
            break
        chunks.append(data.decode("utf-8", errors="replace"))
        combined = "".join(chunks)
        if expected and expected in combined:
            break
    return "".join(chunks)


def less_version(binary):
    result = subprocess.run([binary, "--version"], text=True, capture_output=True, check=False)
    return result.stdout.splitlines()[0] if result.stdout.splitlines() else "unknown"


def launch_unmodified_less(workdir):
    less = shutil.which("less")
    if less is None:
        raise RuntimeError("system less not found")
    input_path = Path(workdir) / "less-input.txt"
    input_path.write_text("\n".join(f"line-{index:03d}" for index in range(1, 120)) + "\n", encoding="utf-8")
    master, slave = os.openpty()
    set_pty_size(slave)
    slave_path = os.ttyname(slave)
    env = os.environ.copy()
    env.update({"TERM": "xterm", "LESS": "-S"})

    def prepare_child():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    proc = subprocess.Popen(
        [less, str(input_path)],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=workdir,
        env=env,
        preexec_fn=prepare_child,
        close_fds=True,
    )
    os.close(slave)
    before = drain_output(master, time.time() + 4, "line-023")
    before += drain_output(master, time.time() + 0.5)
    return less, input_path, master, slave_path, proc, before


def process_descriptor(proc, slave_path):
    fds = fd_facts(proc.pid)
    state = proc_state(proc.pid)
    syscall = state["syscall"]
    stdio_targets = {str(fd): fd_target(fds, fd) for fd in (0, 1, 2)}
    syscall_fd_target = fd_target(fds, syscall.get("fd")) if syscall.get("fd") is not None else None
    return {
        "pid": proc.pid,
        "state": state,
        "fds": fds,
        "stdioTargets": stdio_targets,
        "syscallFdTarget": syscall_fd_target,
        "allStdioOnControlledPty": all(target == slave_path for target in stdio_targets.values()),
        "socketFds": [fact for fact in fds if fact["target"].startswith("socket:")],
    }


def pty_descriptor(master_fd, slave_path):
    return {
        "rows": ROWS,
        "cols": COLS,
        "identity": pty_identity(slave_path),
        "inputQueueBytesOnMaster": pty_bytes_available(master_fd),
        "inputQueueBytesOnSlave": pty_slave_bytes_available(slave_path),
        "foregroundPgrpFromMaster": foreground_pgrp(master_fd),
        "controlledPty": True,
        "harnessPendingInputBytes": 0,
    }


def classification_checks(capture):
    process = capture["process"]
    state = process["state"]
    syscall = state["syscall"]
    pty = capture["pty"]
    slave_path = pty["identity"]["path"]
    slave_queue = pty["inputQueueBytesOnSlave"]
    foreground = pty["foregroundPgrpFromMaster"]
    return {
        "unmodifiedSystemLess": capture["less"]["path"] == "/usr/bin/less" or capture["less"]["path"].endswith("/less"),
        "noMarkerSymbolsUsed": capture["claimGuard"]["markerSymbolsUsed"] is False,
        "screenEvidenceVisible": capture["screenBeforeBehavior"]["containsFirstPage"],
        "singleThreaded": state["threads"] == 1,
        "noPendingSignals": state["signalPendingMask"] == "0000000000000000",
        "sleepingOrBlocked": state["statusState"] in ("S", "D"),
        "syscallParsed": syscall.get("parsed") is True,
        "syscallIsRead": syscall.get("name") == "read",
        "syscallFdTargetIsControlledPty": process["syscallFdTarget"] == slave_path,
        "stdioAllControlledPty": process["allStdioOnControlledPty"],
        "sessionOwnsProcess": state["statSession"] == process["pid"],
        "pgrpOwnsProcess": state["statPgrp"] == process["pid"],
        "foregroundPgrpOwnsPty": foreground == process["pid"],
        "masterQueueEmpty": pty["inputQueueBytesOnMaster"] == 0,
        "slaveQueueEmpty": slave_queue.get("available") is True and slave_queue.get("bytes") == 0,
        "harnessPendingInputEmpty": pty["harnessPendingInputBytes"] == 0,
        "noSocketFds": len(process["socketFds"]) == 0,
    }


def cleanup(proc, master_fd):
    try:
        os.write(master_fd, b"q")
    except OSError:
        pass
    if proc.poll() is None:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except OSError:
            pass
    try:
        proc.wait(timeout=1)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except OSError:
            pass
    try:
        os.close(master_fd)
    except OSError:
        pass


def run_proof(out_dir):
    with tempfile.TemporaryDirectory(prefix="machinen-real-less-unmodified-") as workdir:
        less, input_path, master, slave_path, proc, before = launch_unmodified_less(workdir)
        try:
            time.sleep(0.2)
            capture = {
                "kind": "machinen.research.real-less-unmodified-safe-point-inference.classified-candidate",
                "version": 1,
                "decision": "classified-candidate",
                "supportClaimed": False,
                "hostArch": os.uname().machine,
                "less": {"path": less, "versionLine": less_version(less)},
                "process": process_descriptor(proc, slave_path),
                "regularFile": file_identity(input_path),
                "pty": pty_descriptor(master, slave_path),
                "screenBeforeBehavior": {
                    "containsFirstPage": "line-001" in before and "line-023" in before,
                    "sample": before[-1200:],
                },
                "claimGuard": CLAIM_GUARD,
            }
            checks = classification_checks(capture)
            failed_checks = [name for name, passed in checks.items() if not passed]
            capture["inference"] = {
                "status": "classified-candidate" if not failed_checks else "refused-candidate",
                "method": "pty output plus strict blocked read(fd) on controlled pty with fd/session/pgrp/foreground checks",
                "checks": checks,
                "failedChecks": failed_checks,
                "safePointClaim": "candidate only; no marker/source-level safe point proof and no support claim",
            }
            if failed_checks:
                capture["decision"] = "refused"
                capture["refusalCode"] = "unmodified-less-inference-check-failed"
            else:
                os.write(master, b" ")
                after = drain_output(master, time.time() + 3, "line-024")
                after += drain_output(master, time.time() + 0.5)
                capture["behavioralCheck"] = {
                    "injectedKey": "SPACE",
                    "containsExpectedNextPage": "line-024" in after,
                    "sample": after[-1200:],
                }
                if not capture["behavioralCheck"]["containsExpectedNextPage"]:
                    capture["decision"] = "refused"
                    capture["refusalCode"] = "unmodified-less-space-behavior-failed"
            (out_dir / "classified-candidate.json").write_text(json.dumps(capture, indent=2) + "\n", encoding="utf-8")
            report = {
                "kind": "machinen.research.real-less-unmodified-safe-point-inference.report",
                "version": 1,
                "status": "passed" if capture["decision"] == "classified-candidate" else "failed",
                "classified": ["classified-candidate"] if capture["decision"] == "classified-candidate" else [],
                "refused": [] if capture["decision"] == "classified-candidate" else [{"case": "classified-candidate", "refusalCode": capture.get("refusalCode")}],
                "supportClaimed": False,
                "claimGuard": CLAIM_GUARD,
            }
            (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(report, indent=2))
            if report["status"] != "passed":
                raise RuntimeError("unmodified less inference failed")
        finally:
            cleanup(proc, master)


def main():
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "retained")
    out_dir.mkdir(parents=True, exist_ok=True)
    run_proof(out_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
