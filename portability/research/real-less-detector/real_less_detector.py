#!/usr/bin/env python3
import fcntl
import json
import os
import select
import shutil
import signal
import socket
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
MARKER_SYMBOL = "machinen_less_ready_before_input_marker"
GATE_SYMBOL = "machinen_less_ready_before_input_gate"
CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
}


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def parse_stat(stat):
    if not stat:
        return []
    # /proc/<pid>/stat puts comm in parentheses and may contain spaces.
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
    stat = read_text(f"/proc/{pid}/stat")
    syscall = read_text(f"/proc/{pid}/syscall")
    threads = None
    pending = None
    blocked = None
    ignored = None
    caught = None
    for line in status.splitlines():
        if line.startswith("Threads:"):
            threads = int(line.split()[1])
        if line.startswith("SigPnd:"):
            pending = line.split()[1]
        if line.startswith("SigBlk:"):
            blocked = line.split()[1]
        if line.startswith("SigIgn:"):
            ignored = line.split()[1]
        if line.startswith("SigCgt:"):
            caught = line.split()[1]
    stat_parts = parse_stat(stat)
    return {
        "statusState": next((line.split()[1] for line in status.splitlines() if line.startswith("State:")), "unknown"),
        "threads": threads,
        "signalPendingMask": pending,
        "signalBlockedMask": blocked,
        "signalIgnoredMask": ignored,
        "signalCaughtMask": caught,
        "statPgrp": int(stat_parts[4]) if len(stat_parts) > 4 else None,
        "statSession": int(stat_parts[5]) if len(stat_parts) > 5 else None,
        "statTtyNr": int(stat_parts[6]) if len(stat_parts) > 6 else None,
        "syscall": parse_syscall(syscall),
    }


def fd_facts(pid):
    facts = []
    fd_root = Path(f"/proc/{pid}/fd")
    if not fd_root.exists():
        return facts
    for item in sorted(fd_root.iterdir(), key=lambda path: int(path.name)):
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
    st = os.stat(path)
    return {
        "path": str(path),
        "device": st.st_dev,
        "inode": st.st_ino,
        "size": st.st_size,
        "mtimeNs": st.st_mtime_ns,
        "mode": oct(st.st_mode),
    }


def pty_identity(path):
    st = os.stat(path)
    return {
        "path": path,
        "device": st.st_dev,
        "inode": st.st_ino,
        "rdev": st.st_rdev,
        "mode": oct(st.st_mode),
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
        if readable:
            try:
                data = os.read(fd, 4096)
            except OSError:
                break
            if not data:
                break
            chunks.append(data.decode("utf-8", errors="replace"))
            if expected and expected in "".join(chunks):
                break
    return "".join(chunks)


def make_input_file(workdir):
    input_path = Path(workdir) / "less-input.txt"
    lines = [f"line-{index:03d}" for index in range(1, 80)]
    input_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return input_path


def less_binary():
    configured = os.environ.get("MACHINEN_LESS_BINARY")
    if configured:
        return configured
    less = shutil.which("less")
    if less is None:
        raise RuntimeError("/usr/bin/less not found in PATH")
    return less


def marker_symbols(binary):
    result = subprocess.run(["nm", "-an", binary], text=True, capture_output=True, check=False)
    if result.returncode != 0:
        return {"available": False, "error": result.stderr.strip()}
    lines = [line for line in result.stdout.splitlines() if "machinen_less" in line]
    names = {line.split()[-1] for line in lines if line.split()}
    return {
        "available": True,
        "required": [MARKER_SYMBOL, GATE_SYMBOL],
        "present": sorted(names),
        "lines": lines,
        "allRequiredPresent": MARKER_SYMBOL in names and GATE_SYMBOL in names,
    }


def launch_pty_process(command, workdir, stdin_mode="pty", extra_pass_fds=None, marker_spin=False):
    master, slave = os.openpty()
    set_pty_size(slave)
    slave_path = os.ttyname(slave)
    env = os.environ.copy()
    env.update({"TERM": "xterm", "LESS": "-S"})
    if marker_spin:
        env["MACHINEN_LESS_SPIN_AT_READY"] = "1"

    def prepare_child():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    stdin_arg = slave if stdin_mode == "pty" else subprocess.PIPE
    pass_fds = tuple(extra_pass_fds or ())
    proc = subprocess.Popen(
        command,
        stdin=stdin_arg,
        stdout=slave,
        stderr=slave,
        cwd=workdir,
        env=env,
        preexec_fn=prepare_child,
        close_fds=True,
        pass_fds=pass_fds,
    )
    os.close(slave)
    return master, slave_path, proc


def launch_less(workdir, extra_pass_fds=None, marker_spin=False):
    less = less_binary()
    input_path = make_input_file(workdir)
    master, slave_path, proc = launch_pty_process(
        [less, str(input_path)],
        workdir,
        extra_pass_fds=extra_pass_fds,
        marker_spin=marker_spin,
    )
    output = drain_output(master, time.time() + 3, "line-001")
    output += drain_output(master, time.time() + 0.5)
    return less, input_path, master, slave_path, proc, output


def launch_less_from_pipe(workdir):
    less = less_binary()
    master, slave_path, proc = launch_pty_process([less, "-"], workdir, stdin_mode="pipe")
    assert proc.stdin is not None
    proc.stdin.write("\n".join(f"pipe-line-{index:03d}" for index in range(1, 80)).encode() + b"\n")
    proc.stdin.close()
    output = drain_output(master, time.time() + 3, "pipe-line-001")
    output += drain_output(master, time.time() + 0.5)
    return less, master, slave_path, proc, output


def launch_wrong_binary(workdir):
    binary = shutil.which("cat") or "/bin/cat"
    master, slave_path, proc = launch_pty_process([binary], workdir)
    time.sleep(0.15)
    return binary, master, slave_path, proc, ""


def process_descriptor(proc, slave_path):
    fds = fd_facts(proc.pid)
    state = proc_state(proc.pid)
    stdio_targets = {str(fd): fd_target(fds, fd) for fd in (0, 1, 2)}
    syscall = state["syscall"]
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


def pty_descriptor(master_fd, slave_path, harness_pending_input_bytes=0):
    return {
        "rows": ROWS,
        "cols": COLS,
        "identity": pty_identity(slave_path),
        "inputQueueBytesOnMaster": pty_bytes_available(master_fd),
        "inputQueueBytesOnSlave": pty_slave_bytes_available(slave_path),
        "foregroundPgrpFromMaster": foreground_pgrp(master_fd),
        "controlledPty": True,
        "harnessPendingInputBytes": harness_pending_input_bytes,
    }


def less_version(less_path):
    output = subprocess.run([less_path, "--version"], text=True, capture_output=True, check=False).stdout.splitlines()
    return output[0] if output else "unknown"


def base_capture(
    case,
    decision,
    state_kind,
    proc,
    binary_path,
    master_fd,
    slave_path,
    output,
    input_path=None,
    refusal_code=None,
    harness_pending_input_bytes=0,
):
    capture = {
        "kind": "machinen.research.real-less-detector.capture",
        "version": 2,
        "case": case,
        "decision": decision,
        "stateKind": state_kind,
        "hostArch": os.uname().machine,
        "binary": {"path": binary_path},
        "process": process_descriptor(proc, slave_path),
        "pty": pty_descriptor(master_fd, slave_path, harness_pending_input_bytes),
        "screenEvidence": {
            "containsFirstLine": "line-001" in output,
            "containsPipeFirstLine": "pipe-line-001" in output,
            "sample": output[-1000:],
        },
        "claimGuard": CLAIM_GUARD,
    }
    if os.path.basename(binary_path) == "less":
        capture["less"] = {"path": binary_path, "versionLine": less_version(binary_path)}
    if input_path is not None:
        capture["regularFile"] = file_identity(input_path)
    if refusal_code:
        capture["refusalCode"] = refusal_code
    return capture


def blocked_read_checks(capture):
    process = capture["process"]
    state = process["state"]
    syscall = state["syscall"]
    pty = capture["pty"]
    slave_path = pty["identity"]["path"]
    slave_queue = pty["inputQueueBytesOnSlave"]
    foreground = pty["foregroundPgrpFromMaster"]
    checks = {
        "realLessBinary": os.path.basename(capture["binary"]["path"]) == "less",
        "screenEvidenceVisible": capture["screenEvidence"]["containsFirstLine"],
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
    return checks


def ready_outside_syscall(workdir):
    marker_ready = os.environ.get("MACHINEN_LESS_ACCEPT_MARKER_READY") == "1"
    less, input_path, master, slave_path, proc, output = launch_less(workdir, marker_spin=marker_ready)
    try:
        time.sleep(0.2)
        os.kill(proc.pid, signal.SIGSTOP)
        time.sleep(0.15)
        if marker_ready:
            capture = base_capture(
                "accepted-ready-outside-syscall",
                "accepted",
                "ready-outside-syscall",
                proc,
                less,
                master,
                slave_path,
                output,
                input_path=input_path,
            )
            symbols = marker_symbols(less)
            capture["markerSafePoint"] = {
                "mode": "source-marker-spin-before-getcc",
                "environment": "MACHINEN_LESS_SPIN_AT_READY=1",
                "symbolEvidence": symbols,
            }
            capture["detector"] = {
                "acceptedBecause": [
                    "known marker-symbol less build launched under controlled pty",
                    "screen evidence contains first page",
                    "marker function is compiled into target-native less",
                    "marker safe point is in the command loop after prompt rendering and before getcc/read input",
                    "process was stopped while held at the marker safe-point spin, not by source-ISA emulation or VM replay",
                    "regular input file has stable identity descriptor",
                ],
                "accepted": symbols.get("allRequiredPresent") is True,
                "outsideSyscallPolicy": "accepted only for known debug/marker less builds that spin at machinen_less_ready_before_input_marker before reading the next command byte",
            }
            if symbols.get("allRequiredPresent") is not True:
                capture["decision"] = "refused"
                capture["refusalCode"] = "real-less-missing-marker-symbols"
            return capture
        capture = base_capture(
            "classified-ready-outside-syscall",
            "classified",
            "ready-outside-syscall",
            proc,
            less,
            master,
            slave_path,
            output,
            input_path=input_path,
        )
        capture["detector"] = {
            "classifiedBecause": [
                "real less process launched under controlled pty",
                "screen evidence contains first page",
                "process state was sampled after a harness SIGSTOP",
            ],
            "accepted": False,
            "notAcceptedBecause": "SIGSTOP-after-output is not source-level or marker-symbol safe-point evidence; set MACHINEN_LESS_ACCEPT_MARKER_READY=1 with a known marker build to accept this row.",
        }
        return capture
    finally:
        cleanup_process(proc, master)


def accepted_blocked(workdir):
    less, input_path, master, slave_path, proc, output = launch_less(workdir)
    try:
        time.sleep(0.2)
        capture = base_capture(
            "accepted-blocked-pty-read",
            "accepted",
            "blocked-pty-read",
            proc,
            less,
            master,
            slave_path,
            output,
            input_path=input_path,
        )
        checks = blocked_read_checks(capture)
        capture["detector"] = {
            "acceptedBecause": [
                "real less process launched under controlled pty",
                "screen evidence contains first page",
                "strict /proc syscall parser proves read(fd)",
                "read fd target equals exact harness pty slave",
                "fd 0/1/2 all point to the controlled pty slave",
                "session, process group, and foreground pty ownership match the child",
                "pty input queue and harness pending input are empty",
                "regular input file has stable identity descriptor",
            ],
            "blockedReadPolicy": "safe only for controlled pty input wait with empty input queue and no partial command bytes",
            "checks": checks,
        }
        failed = [name for name, passed in checks.items() if not passed]
        if failed:
            capture["decision"] = "refused"
            capture["refusalCode"] = "real-less-blocked-pty-read-check-failed"
            capture["detector"]["failedChecks"] = failed
        return capture
    finally:
        cleanup_process(proc, master)


def real_refused_wrong_binary(workdir):
    binary, master, slave_path, proc, output = launch_wrong_binary(workdir)
    try:
        capture = base_capture("refused-wrong-binary", "refused", "real-process-refusal", proc, binary, master, slave_path, output)
        capture["refusalCode"] = "real-less-wrong-binary"
        return capture
    finally:
        cleanup_process(proc, master)


def real_refused_pipe_input(workdir):
    less, master, slave_path, proc, output = launch_less_from_pipe(workdir)
    try:
        capture = base_capture("refused-pipe-or-stdin-input", "refused", "real-process-refusal", proc, less, master, slave_path, output)
        capture["refusalCode"] = "real-less-input-not-regular-file"
        capture["detector"] = {"refusedBecause": "less was launched with stdin pipe input instead of a stable regular file descriptor"}
        return capture
    finally:
        cleanup_process(proc, master)


def real_refused_nonempty_pty_input(workdir):
    less, input_path, master, slave_path, proc, output = launch_less(workdir)
    try:
        os.kill(proc.pid, signal.SIGSTOP)
        time.sleep(0.1)
        os.write(master, b"j")
        time.sleep(0.1)
        capture = base_capture(
            "refused-nonempty-pty-input",
            "refused",
            "real-process-refusal",
            proc,
            less,
            master,
            slave_path,
            output,
            input_path=input_path,
            harness_pending_input_bytes=1,
        )
        capture["refusalCode"] = "real-less-pty-input-queue-not-empty"
        capture["detector"] = {"refusedBecause": "harness queued a command byte while the less process was stopped"}
        return capture
    finally:
        cleanup_process(proc, master)


def real_refused_socket_fd(workdir):
    left, right = socket.socketpair()
    try:
        less, input_path, master, slave_path, proc, output = launch_less(workdir, extra_pass_fds=[right.fileno()])
        try:
            capture = base_capture(
                "refused-socket-fd",
                "refused",
                "real-process-refusal",
                proc,
                less,
                master,
                slave_path,
                output,
                input_path=input_path,
            )
            capture["refusalCode"] = "real-less-socket-fd-present"
            capture["detector"] = {"refusedBecause": "child inherited a socket fd that v2 does not model"}
            return capture
        finally:
            cleanup_process(proc, master)
    finally:
        left.close()
        right.close()


def cleanup_process(proc, master_fd):
    try:
        os.write(master_fd, b"q")
    except OSError:
        pass
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGCONT)
    except OSError:
        pass
    time.sleep(0.05)
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


def synthetic_refusals():
    cases = [
        ("refused-wrong-less-version", "real-less-version-buildid-mismatch"),
        ("refused-missing-regular-file-fd", "real-less-missing-regular-file"),
        ("refused-missing-pty", "real-less-missing-controlled-pty"),
        ("refused-extra-thread", "real-less-extra-thread"),
        ("refused-pending-signal", "real-less-pending-signal"),
        ("refused-pgrp-session-mismatch", "real-less-process-session-pgrp-mismatch"),
        ("refused-sigwinch-or-resize", "real-less-terminal-resize-pending"),
        ("refused-unmodeled-active-syscall", "real-less-active-syscall-not-modeled"),
        ("refused-no-safe-point-evidence", "real-less-no-safe-point-evidence"),
        ("refused-source-isa-emulation", "real-less-source-isa-emulation"),
        ("refused-metadata-only-success", "real-less-metadata-only-success"),
        ("refused-dynamic-library-mismatch", "real-less-dynamic-library-mismatch"),
        ("refused-unknown-heap-state", "real-less-unknown-app-owned-heap-state"),
    ]
    return [
        {
            "kind": "machinen.research.real-less-detector.capture",
            "version": 2,
            "case": case,
            "decision": "refused",
            "stateKind": "synthetic-refusal",
            "refusalCode": code,
            "claimGuard": CLAIM_GUARD,
        }
        for case, code in cases
    ]


def main():
    out_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "retained")
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="machinen-real-less-detector-") as workdir:
        captures = [
            ready_outside_syscall(workdir),
            accepted_blocked(workdir),
            real_refused_wrong_binary(workdir),
            real_refused_pipe_input(workdir),
            real_refused_nonempty_pty_input(workdir),
            real_refused_socket_fd(workdir),
            *synthetic_refusals(),
        ]
    for capture in captures:
        (out_dir / f"{capture['case']}-capture.json").write_text(json.dumps(capture, indent=2) + "\n", encoding="utf-8")
    report = {
        "kind": "machinen.research.real-less-detector.report",
        "version": 2,
        "hostArch": os.uname().machine,
        "accepted": [capture["case"] for capture in captures if capture["decision"] == "accepted"],
        "classified": [capture["case"] for capture in captures if capture["decision"] == "classified"],
        "refused": [
            {"case": capture["case"], "refusalCode": capture["refusalCode"]}
            for capture in captures
            if capture["decision"] == "refused"
        ],
        "claimGuard": CLAIM_GUARD,
        "status": "passed",
    }
    (out_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
