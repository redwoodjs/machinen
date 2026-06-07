#!/usr/bin/env python3
import base64
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
READ_SYSCALL_BY_ARCH = {"x86_64": 0, "amd64": 0, "aarch64": 63, "arm64": 63}
POLL_SYSCALL_BY_ARCH = {"x86_64": 7, "amd64": 7}
PPOLL_SYSCALL_BY_ARCH = {"x86_64": 271, "amd64": 271, "aarch64": 73, "arm64": 73}
CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "markerSymbolsUsed": False,
}
CASES = {
    "space-page-down": {"bytes": b" ", "expect": "line-024", "description": "SPACE advances one page"},
    "back-page": {
        "bytes": b"b",
        "expect": "first-page-no-redraw",
        "description": "b from first page is a valid no-op/no-redraw top-of-file state when supported",
    },
    "quit": {"bytes": b"q", "expect": "process-exit", "description": "q exits"},
}


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def parse_stat(stat):
    end = stat.rfind(")")
    return [*stat[: end + 1].split(maxsplit=1), *stat[end + 2 :].split()] if end != -1 else stat.split()


def parse_syscall(raw):
    raw = raw.strip()
    if not raw or raw == "running":
        return {"raw": raw, "parsed": False}
    parts = raw.split()
    try:
        number = int(parts[0], 0)
        args = [int(part, 0) for part in parts[1:7]]
    except ValueError:
        return {"raw": raw, "parsed": False}
    arch = os.uname().machine
    if number == READ_SYSCALL_BY_ARCH.get(arch):
        name = "read"
    elif number == POLL_SYSCALL_BY_ARCH.get(arch):
        name = "poll"
    elif number == PPOLL_SYSCALL_BY_ARCH.get(arch):
        name = "ppoll"
    else:
        name = f"syscall-{number}"
    return {
        "raw": raw,
        "parsed": True,
        "number": number,
        "name": name,
        "args": args,
        "fd": args[0] if args else None,
    }


def proc_state(pid):
    status = read_text(f"/proc/{pid}/status")
    stat = parse_stat(read_text(f"/proc/{pid}/stat"))
    fields = {}
    for line in status.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key] = value.strip()
    return {
        "statusState": fields.get("State", "unknown").split()[0],
        "threads": int(fields["Threads"]) if fields.get("Threads") else None,
        "signalPendingMask": fields.get("SigPnd"),
        "statPgrp": int(stat[4]) if len(stat) > 4 else None,
        "statSession": int(stat[5]) if len(stat) > 5 else None,
        "statTtyNr": int(stat[6]) if len(stat) > 6 else None,
        "syscall": parse_syscall(read_text(f"/proc/{pid}/syscall")),
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
    return next((fact["target"] for fact in fds if fact["fd"] == fd), None)


def queue_bytes(fd):
    return struct.unpack("I", fcntl.ioctl(fd, termios.FIONREAD, struct.pack("I", 0)))[0]


def slave_queue(slave_path):
    try:
        fd = os.open(slave_path, os.O_RDONLY | os.O_NOCTTY | os.O_NONBLOCK)
    except OSError as error:
        return {"available": False, "error": str(error)}
    try:
        return {"available": True, "bytes": queue_bytes(fd)}
    finally:
        os.close(fd)


def foreground_pgrp(fd):
    try:
        return os.tcgetpgrp(fd)
    except OSError as error:
        return {"error": str(error)}


def set_size(fd):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))


def drain(fd, deadline, expected=None):
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
        if expected and expected in "".join(chunks):
            break
    return "".join(chunks)


def input_bytes():
    return ("\n".join(f"line-{index:03d}" for index in range(1, 120)) + "\n").encode()


def more_version(binary):
    result = subprocess.run([binary, "--version"], text=True, capture_output=True, check=False)
    return result.stdout.splitlines()[0] if result.stdout.splitlines() else "unknown"


def launch(workdir):
    binary = shutil.which("more") or "/usr/bin/more"
    input_path = Path(workdir) / "more-input.txt"
    input_path.write_bytes(input_bytes())
    master, slave = os.openpty()
    set_size(slave)
    slave_path = os.ttyname(slave)
    env = os.environ.copy()
    env.update({"TERM": "xterm"})

    def prepare_child():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    proc = subprocess.Popen(
        [binary, str(input_path)],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=workdir,
        env=env,
        preexec_fn=prepare_child,
        close_fds=True,
    )
    os.close(slave)
    before = drain(master, time.time() + 4, "line-023") + drain(master, time.time() + 0.5)
    return binary, input_path, master, slave_path, proc, before


def classify(proc, master, slave_path, before):
    fds = fd_facts(proc.pid)
    state = proc_state(proc.pid)
    syscall = state["syscall"]
    stdio = {str(fd): fd_target(fds, fd) for fd in (0, 1, 2)}
    pty = {
        "slavePath": slave_path,
        "rows": ROWS,
        "cols": COLS,
        "inputQueueBytesOnMaster": queue_bytes(master),
        "inputQueueBytesOnSlave": slave_queue(slave_path),
        "foregroundPgrpFromMaster": foreground_pgrp(master),
    }
    process = {
        "pid": proc.pid,
        "state": state,
        "fds": fds,
        "stdioTargets": stdio,
        "syscallFdTarget": fd_target(fds, syscall.get("fd")) if syscall.get("fd") is not None else None,
        "allStdioOnControlledPty": all(target == slave_path for target in stdio.values()),
    }
    has_signalfd = any(fact["target"] == "anon_inode:[signalfd]" for fact in fds)
    input_wait_read = syscall.get("name") == "read" and process["syscallFdTarget"] == slave_path
    input_wait_poll = syscall.get("name") in ("poll", "ppoll") and process["allStdioOnControlledPty"] and has_signalfd
    checks = {
        "firstPage": "line-001" in before and "line-023" in before,
        "modeledInputWait": input_wait_read or input_wait_poll,
        "stdioPty": process["allStdioOnControlledPty"],
        "sessionPgrp": state["statSession"] == proc.pid and state["statPgrp"] == proc.pid and pty["foregroundPgrpFromMaster"] == proc.pid,
        "queuesEmpty": pty["inputQueueBytesOnMaster"] == 0 and pty["inputQueueBytesOnSlave"].get("bytes") == 0,
        "singleThread": state["threads"] == 1,
        "noPendingSignal": state["signalPendingMask"] == "0000000000000000",
        "regularInputFile": any("more-input.txt" in fact["target"] for fact in fds),
    }
    return process, pty, checks


def cleanup(proc, master):
    try:
        os.write(master, b"q")
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
        os.close(master)
    except OSError:
        pass


def behavior_matches(case, before, after, exited):
    if case["expect"] == "process-exit":
        return exited
    if case["expect"] == "first-page-no-redraw":
        first_page_before = "line-001" in before and "line-023" in before
        no_forward_page = "line-024" not in after and "line-050" not in after and "line-119" not in after
        no_contradictory_output = after == "" or "line-001" in after or ":" in after or "\u001b[K" in after
        return first_page_before and no_forward_page and no_contradictory_output and not exited
    return case["expect"] in after


def run_case(case_id, mode, role):
    case = CASES[case_id]
    with tempfile.TemporaryDirectory(prefix="machinen-more-cross-") as workdir:
        binary, input_path, master, slave_path, proc, before = launch(workdir)
        try:
            time.sleep(0.2)
            process, pty, checks = classify(proc, master, slave_path, before)
            result = {
                "case": case_id,
                "description": case["description"],
                "mode": mode,
                "role": role,
                "hostArch": os.uname().machine,
                "more": {"path": binary, "versionLine": more_version(binary)},
                "process": process,
                "pty": pty,
                "candidateChecks": checks,
                "screenAtCandidate": {"containsFirstPage": checks["firstPage"], "sample": before[-1000:]},
                "input": {"base64": base64.b64encode(case["bytes"]).decode(), "expect": case["expect"]},
                "claimGuard": CLAIM_GUARD,
            }
            if mode in ("same", "target"):
                os.write(master, case["bytes"])
                after = drain(master, time.time() + 3, None if case["expect"] == "process-exit" else case["expect"])
                after += drain(master, time.time() + 0.5)
                exited = proc.poll() is not None
                matched = behavior_matches(case, before, after, exited)
                result["behavior"] = {"matchedExpectation": matched, "processExited": exited, "sample": after[-1200:]}
                result["decision"] = "accepted" if all(checks.values()) and matched else "failed"
            else:
                result["decision"] = "captured" if all(checks.values()) else "failed"
            return result
        finally:
            cleanup(proc, master)


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
    cases = args[1:]
    rows = []
    for case_id in cases:
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            if same["decision"] != "accepted":
                decision = "skipped-same-arch-failed"
            else:
                decision = "accepted" if source["decision"] == "captured" and target["decision"] == "accepted" else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
        rows.append({"case": case_id, "sameArch": same["decision"], "directions": directions})
    report = {
        "kind": "machinen.research.real-more-unmodified-key-matrix.report",
        "version": 1,
        "status": "completed-with-failures" if any(row["sameArch"] != "accepted" or any(d["decision"] != "accepted" for d in row["directions"]) for row in rows) else "all-accepted",
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
    if sys.argv[1] == "remote":
        return remote(sys.argv[2:])
    if sys.argv[1] == "combine":
        return combine(sys.argv[2:])
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
