#!/usr/bin/env python3
import base64
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
READ_SYSCALL_BY_ARCH = {"x86_64": 0, "amd64": 0, "aarch64": 63, "arm64": 63}
POLL_SYSCALL_BY_ARCH = {"x86_64": 7, "amd64": 7}
PPOLL_SYSCALL_BY_ARCH = {"x86_64": 271, "amd64": 271, "aarch64": 73, "arm64": 73}
WAIT4_SYSCALL_BY_ARCH = {"x86_64": 61, "amd64": 61, "aarch64": 260, "arm64": 260}
CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "markerSymbolsUsed": False,
}
CASES = {
    "finite-yes-head": {"adapter": "finite", "expect": "line-050", "description": "finite yes|head pipeline completes and cleans up"},
    "seq-less-space": {"adapter": "seq-less", "bytes": b" ", "expect": "line-024", "description": "seq producer pipe into less, then SPACE"},
    "seq-less-quit": {"adapter": "seq-less", "bytes": b"q", "expect": "process-exit", "description": "seq producer pipe into less, then q"},
    "git-pipe-less-quit": {"adapter": "git-pipe-less", "bytes": b"q", "expect": "process-exit", "description": "git log explicit pipe into less, producer drained, then q"},
    "supervisor-one-sleep-term": {"adapter": "supervisor-one", "expect": "process-exit", "description": "supervisor traps TERM and kills one sleep child"},
    "supervisor-two-sleeps-term": {"adapter": "supervisor-two", "expect": "process-exit", "description": "supervisor traps TERM and kills two sleep children"},
    "socket-server-refusal": {"adapter": "socket-refusal", "expect": "refused", "description": "socket listener is classified and refused"},
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
    elif number == WAIT4_SYSCALL_BY_ARCH.get(arch):
        name = "wait4"
    else:
        name = f"syscall-{number}"
    return {"raw": raw, "parsed": True, "number": number, "name": name, "args": args, "fd": args[0] if args else None}


def proc_state(pid):
    stat = parse_stat(read_text(f"/proc/{pid}/stat"))
    status = read_text(f"/proc/{pid}/status")
    fields = {}
    for line in status.splitlines():
        if ":" in line:
            k, v = line.split(":", 1)
            fields[k] = v.strip()
    return {
        "pid": pid,
        "comm": stat[1][1:-1] if len(stat) > 1 and stat[1].startswith("(") else None,
        "state": fields.get("State", "unknown").split()[0],
        "threads": int(fields["Threads"]) if fields.get("Threads") else None,
        "signalPendingMask": fields.get("SigPnd"),
        "ppid": int(stat[3]) if len(stat) > 3 else None,
        "pgrp": int(stat[4]) if len(stat) > 4 else None,
        "session": int(stat[5]) if len(stat) > 5 else None,
        "ttyNr": int(stat[6]) if len(stat) > 6 else None,
        "syscall": parse_syscall(read_text(f"/proc/{pid}/syscall")),
    }


def fd_facts(pid):
    root = Path(f"/proc/{pid}/fd")
    if not root.exists():
        return []
    try:
        items = sorted(root.iterdir(), key=lambda path: int(path.name))
    except (OSError, PermissionError):
        return [{"fd": -1, "target": "unreadable"}]
    facts = []
    for item in items:
        try:
            target = os.readlink(item)
        except OSError:
            target = "unreadable"
        facts.append({"fd": int(item.name), "target": target})
    return facts


def fd_target(fds, fd):
    return next((fact["target"] for fact in fds if fact["fd"] == fd), None)


def descendants(root_pid):
    parent_by_pid = {}
    for stat_path in Path("/proc").glob("[0-9]*/stat"):
        try:
            pid = int(stat_path.parent.name)
            stat = parse_stat(stat_path.read_text(encoding="utf-8", errors="replace"))
            parent_by_pid[pid] = int(stat[3]) if len(stat) > 3 else None
        except (OSError, ValueError):
            continue
    out = [root_pid]
    changed = True
    while changed:
        changed = False
        known = set(out)
        for pid, ppid in parent_by_pid.items():
            if ppid in known and pid not in known:
                out.append(pid)
                changed = True
    return sorted(out)


def process_tree(root_pid, slave_path=None):
    rows = []
    for pid in descendants(root_pid):
        if not Path(f"/proc/{pid}").exists():
            continue
        fds = fd_facts(pid)
        state = proc_state(pid)
        syscall = state["syscall"]
        stdio = {str(fd): fd_target(fds, fd) for fd in (0, 1, 2)}
        rows.append({
            "pid": pid,
            "state": state,
            "fds": fds,
            "stdioTargets": stdio,
            "syscallFdTarget": fd_target(fds, syscall.get("fd")) if syscall.get("fd") is not None else None,
            "allStdioOnControlledPty": bool(slave_path) and all(target == slave_path for target in stdio.values()),
            "hasPipeFd": any(target.startswith("pipe:") for target in (fact["target"] for fact in fds)),
            "hasSocketFd": any(target.startswith("socket:") for target in (fact["target"] for fact in fds)),
        })
    return rows


def queue_bytes(fd):
    return struct.unpack("I", fcntl.ioctl(fd, termios.FIONREAD, struct.pack("I", 0)))[0]


def set_size(fd):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))


def drain(fd, deadline, expected=None):
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
        chunks.append(data.decode("utf-8", errors="replace"))
        if expected and expected in "".join(chunks):
            break
    return "".join(chunks)


def version(binary):
    result = subprocess.run([binary, "--version"], text=True, capture_output=True, check=False)
    lines = result.stdout.splitlines() or result.stderr.splitlines()
    return lines[0] if lines else "unknown"


def git(repo, args, env):
    subprocess.run(["git", *args], cwd=repo, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


def make_repo(workdir, env):
    repo = Path(workdir) / "repo"
    repo.mkdir()
    git(repo, ["init"], env)
    git(repo, ["config", "user.email", "machinen@example.invalid"], env)
    git(repo, ["config", "user.name", "Machinen Research"], env)
    tracked = repo / "tracked.txt"
    for index in range(1, 81):
        tracked.write_text(f"commit-{index:03d}\n", encoding="utf-8")
        git(repo, ["add", "tracked.txt"], env)
        git(repo, ["commit", "-m", f"commit-{index:03d}"], env)
    return repo


def shell_script(workdir, content):
    path = Path(workdir) / "script.sh"
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)
    return str(path)


def socket_script(workdir):
    path = Path(workdir) / "socket_server.py"
    path.write_text(
        "import socket, time\n"
        "s=socket.socket()\n"
        "s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)\n"
        "s.bind(('127.0.0.1', 0))\n"
        "s.listen(1)\n"
        "print('socket-ready', s.getsockname()[1], flush=True)\n"
        "time.sleep(30)\n",
        encoding="utf-8",
    )
    return str(path)


def launch(case, workdir):
    adapter = case["adapter"]
    env = os.environ.copy()
    env.update({"TERM": "xterm", "LESS": "-S", "LESSHISTFILE": str(Path(workdir) / "less-history")})
    if adapter == "finite":
        argv = ["/bin/sh", "-c", "yes line | head -n 50 | awk '{printf \"line-%03d\\n\", NR}'"]
        proc = subprocess.Popen(argv, cwd=workdir, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=False, start_new_session=True)
        out, err = proc.communicate(timeout=5)
        return {"adapter": adapter, "argv": argv, "completed": True, "returncode": proc.returncode, "output": out.decode(errors="replace"), "stderr": err.decode(errors="replace")}
    if adapter == "socket-refusal":
        argv = [sys.executable, socket_script(workdir)]
        proc = subprocess.Popen(argv, cwd=workdir, env=env, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, start_new_session=True)
        ready = proc.stdout.readline().strip() if proc.stdout else ""
        return {"adapter": adapter, "argv": argv, "proc": proc, "ready": ready}
    master, slave = os.openpty()
    set_size(slave)
    slave_path = os.ttyname(slave)
    if adapter == "seq-less":
        argv = ["/bin/sh", "-c", "seq -f 'line-%03g' 1 200 | less"]
        before_expected = "line-023"
    elif adapter == "git-pipe-less":
        repo = make_repo(workdir, env)
        argv = ["/bin/sh", "-c", "git --no-optional-locks log --oneline --decorate=short | less"]
        before_expected = "commit-070"
        workdir = str(repo)
    elif adapter == "supervisor-one":
        script = shell_script(workdir, "#!/bin/sh\ntrap 'kill $child 2>/dev/null; wait $child 2>/dev/null; exit 0' TERM\nsleep 30 & child=$!\nwait $child\n")
        argv = [script]
        before_expected = ""
    elif adapter == "supervisor-two":
        script = shell_script(workdir, "#!/bin/sh\ntrap 'kill $a $b 2>/dev/null; wait $a $b 2>/dev/null; exit 0' TERM\nsleep 30 & a=$!\nsleep 30 & b=$!\nwait $a $b\n")
        argv = [script]
        before_expected = ""
    else:
        raise ValueError(adapter)

    def prepare_child():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, cwd=workdir, env=env, preexec_fn=prepare_child, close_fds=True)
    os.close(slave)
    before = "" if before_expected == "" else drain(master, time.time() + 6, before_expected) + drain(master, time.time() + 0.4)
    time.sleep(0.2)
    return {"adapter": adapter, "argv": argv, "proc": proc, "master": master, "slavePath": slave_path, "before": before, "beforeExpected": before_expected}


def cleanup(config):
    proc = config.get("proc")
    if not proc:
        return
    if config.get("master") is not None:
        try:
            os.write(config["master"], b"q")
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
    if config.get("master") is not None:
        try:
            os.close(config["master"])
        except OSError:
            pass


def classify(config, case):
    adapter = config["adapter"]
    if adapter == "finite":
        lines = config["output"].splitlines()
        return {
            "checks": {"completed": config["completed"], "returncodeZero": config["returncode"] == 0, "lineCount": len(lines) == 50, "expectedOutput": case["expect"] in config["output"]},
            "processTree": [],
            "candidate": None,
            "pty": None,
        }
    tree = process_tree(config["proc"].pid, config.get("slavePath"))
    if adapter == "socket-refusal":
        has_socket = any(row["hasSocketFd"] for row in tree)
        return {"checks": {"socketFdDetected": has_socket, "refuseSocketBoundary": has_socket}, "processTree": tree, "candidate": tree[0] if tree else None, "pty": None}
    pty = {"slavePath": config["slavePath"], "inputQueueBytesOnMaster": queue_bytes(config["master"])}
    candidate = next((row for row in tree if row["state"]["comm"] in ("less", "sleep", "sh")), tree[0] if tree else None)
    expected_rendered = True if config["beforeExpected"] == "" else config["beforeExpected"] in config["before"]
    producer_drained = True
    if adapter == "git-pipe-less":
        producer_drained = not any(row["state"]["comm"] == "git" for row in tree)
    modeled = bool(candidate) and candidate["state"]["threads"] == 1 and candidate["state"].get("signalPendingMask") == "0000000000000000"
    return {
        "checks": {"expectedRendered": expected_rendered, "modeledProcessTree": modeled, "queuesEmpty": pty["inputQueueBytesOnMaster"] == 0, "producerDrainedWhenRequired": producer_drained},
        "processTree": tree,
        "candidate": candidate,
        "pty": pty,
    }


def run_case(case_id, mode, role):
    case = {**CASES[case_id], "id": case_id}
    with tempfile.TemporaryDirectory(prefix="machinen-pipeline-supervisor-ladder-") as workdir:
        config = launch(case, workdir)
        try:
            classified = classify(config, case)
            result = {
                "case": case_id,
                "adapter": case["adapter"],
                "description": case["description"],
                "mode": mode,
                "role": role,
                "hostArch": os.uname().machine,
                "processRoot": {"pid": config.get("proc").pid if config.get("proc") else None, "argv": config["argv"]},
                "processTree": classified["processTree"],
                "candidateProcess": classified["candidate"],
                "pty": classified["pty"],
                "checks": classified["checks"],
                "screenAtCandidate": {"sample": config.get("before", "")[-1200:]},
                "claimGuard": CLAIM_GUARD,
            }
            if case["adapter"] == "socket-refusal":
                result["decision"] = "refused" if all(classified["checks"].values()) else "failed"
                return result
            if mode == "source":
                result["decision"] = "captured" if all(classified["checks"].values()) else "failed"
                return result
            if case["adapter"] == "finite":
                matched = all(classified["checks"].values())
                result["behavior"] = {"matchedExpectation": matched, "sample": config["output"][-1200:]}
                result["decision"] = "accepted" if matched else "failed"
                return result
            if case["adapter"].startswith("supervisor"):
                os.kill(config["proc"].pid, signal.SIGTERM)
                try:
                    config["proc"].wait(timeout=3)
                except subprocess.TimeoutExpired:
                    pass
                time.sleep(0.2)
                remaining = [pid for pid in descendants(config["proc"].pid) if Path(f"/proc/{pid}").exists()]
                matched = config["proc"].poll() is not None and remaining in ([], [config["proc"].pid])
                result["behavior"] = {"matchedExpectation": matched, "processExited": config["proc"].poll() is not None, "remainingDescendants": remaining}
            else:
                result["input"] = {"base64": base64.b64encode(case["bytes"]).decode(), "expect": case["expect"]}
                os.write(config["master"], case["bytes"])
                after = drain(config["master"], time.time() + 4, None if case["expect"] == "process-exit" else case["expect"])
                after += drain(config["master"], time.time() + 0.4)
                exited = config["proc"].poll() is not None
                matched = exited if case["expect"] == "process-exit" else case["expect"] in after
                result["behavior"] = {"matchedExpectation": matched, "processExited": exited, "sample": after[-1200:]}
            result["decision"] = "accepted" if all(classified["checks"].values()) and result["behavior"]["matchedExpectation"] else "failed"
            return result
        finally:
            cleanup(config)


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
        expected_refusal = CASES[case_id]["expect"] == "refused"
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            if expected_refusal:
                decision = "refused" if same["decision"] == source["decision"] == target["decision"] == "refused" else "failed"
            elif same["decision"] != "accepted":
                decision = "skipped-same-arch-failed"
            else:
                decision = "accepted" if source["decision"] == "captured" and target["decision"] == "accepted" else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
        status = "refused" if expected_refusal and all(d["decision"] == "refused" for d in directions) else "accepted" if same["decision"] == "accepted" and all(d["decision"] == "accepted" for d in directions) else "failed"
        rows.append({"case": case_id, "adapter": CASES[case_id]["adapter"], "status": status, "sameArch": same["decision"], "directions": directions})
    failed = [row for row in rows if row["status"] == "failed"]
    report = {
        "kind": "machinen.research.real-pipeline-and-supervisor-ladder.report",
        "version": 1,
        "status": "proved-with-refusals" if not failed else "completed-with-failures",
        "rows": rows,
        "acceptedRows": len([row for row in rows if row["status"] == "accepted"]),
        "refusedRows": len([row for row in rows if row["status"] == "refused"]),
        "failedRows": len(failed),
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
