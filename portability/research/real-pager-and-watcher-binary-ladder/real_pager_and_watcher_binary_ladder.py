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
PSELECT6_SYSCALL_BY_ARCH = {"x86_64": 270, "amd64": 270, "aarch64": 72, "arm64": 72}
CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "markerSymbolsUsed": False,
}

CASES = {
    "more-space": {"adapter": "more", "action": "key", "bytes": b" ", "expect": "line-024", "description": "more SPACE advances one page"},
    "more-back": {"adapter": "more", "action": "key", "bytes": b"b", "expect": "line-001", "description": "more b redraws/remains at the first page from top-of-file"},
    "more-quit": {"adapter": "more", "action": "key", "bytes": b"q", "expect": "process-exit", "description": "more q exits"},
    "pg-quit": {"adapter": "pg", "action": "key", "bytes": b"q", "expect": "process-exit", "description": "pg q exits when pg is installed"},
    "most-quit": {"adapter": "most", "action": "key", "bytes": b"q", "expect": "process-exit", "description": "most q exits as an alternate pager"},
    "man-quit": {"adapter": "man", "action": "key", "bytes": b"q", "expect": "process-exit", "description": "man wrapper renders through a pager child and q exits"},
    "git-log-space": {"adapter": "git-log", "action": "key", "bytes": b" ", "expect": "commit-050", "description": "git log --paginate renders through a pager child and SPACE advances"},
    "git-log-quit": {"adapter": "git-log", "action": "key", "bytes": b"q", "expect": "process-exit", "description": "git log --paginate pager child exits on q"},
    "tail-f-append": {"adapter": "tail-f", "action": "append", "append": b"continued-001\n", "expect": "continued-001", "description": "tail -f emits an appended line after descriptor materialization"},
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
    elif number == PSELECT6_SYSCALL_BY_ARCH.get(arch):
        name = "pselect6"
    else:
        name = f"syscall-{number}"
    return {"raw": raw, "parsed": True, "number": number, "name": name, "args": args, "fd": args[0] if args else None}


def proc_state(pid):
    status = read_text(f"/proc/{pid}/status")
    stat = parse_stat(read_text(f"/proc/{pid}/stat"))
    fields = {}
    for line in status.splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            fields[key] = value.strip()
    return {
        "pid": pid,
        "comm": stat[1][1:-1] if len(stat) > 1 and stat[1].startswith("(") else None,
        "statusState": fields.get("State", "unknown").split()[0],
        "threads": int(fields["Threads"]) if fields.get("Threads") else None,
        "signalPendingMask": fields.get("SigPnd"),
        "statPpid": int(stat[3]) if len(stat) > 3 else None,
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
    try:
        items = sorted(root.iterdir(), key=lambda path: int(path.name))
    except (OSError, PermissionError):
        return [{"fd": -1, "target": "unreadable"}]
    for item in items:
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
            data = os.read(fd, 8192)
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


def version(binary):
    result = subprocess.run([binary, "--version"], text=True, capture_output=True, check=False)
    lines = result.stdout.splitlines() or result.stderr.splitlines()
    return lines[0] if lines else "unknown"


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


def git(repo, args, env):
    subprocess.run(["git", *args], cwd=repo, env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def distro_binary(package, relative_binary, workdir):
    installed = shutil.which(Path(relative_binary).name)
    if installed:
        return installed, {"method": "installed", "package": package}
    package_dir = Path(workdir) / f"{package}-pkg"
    package_dir.mkdir()
    result = subprocess.run(["apt-get", "download", package], cwd=package_dir, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True, check=False)
    if result.returncode != 0:
        return None, {"method": "apt-download-failed", "package": package, "stderr": result.stderr[-500:]}
    debs = sorted(package_dir.glob("*.deb"))
    if not debs:
        return None, {"method": "apt-download-no-deb", "package": package}
    extract_dir = package_dir / "extract"
    subprocess.run(["dpkg", "-x", str(debs[0]), str(extract_dir)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    binary = extract_dir / relative_binary.lstrip("/")
    if not binary.exists():
        return None, {"method": "apt-extract-missing-binary", "package": package, "binary": str(binary)}
    return str(binary), {"method": "apt-download-extract", "package": package, "deb": debs[0].name}


def prepare_adapter(case, workdir):
    adapter = case["adapter"]
    env = os.environ.copy()
    env.update({"TERM": "xterm"})
    if adapter in ("more", "pg", "most"):
        packageEvidence = {"method": "installed"}
        if adapter == "most":
            binary, packageEvidence = distro_binary("most", "/usr/bin/most", workdir)
            if not binary:
                return {"missing": True, "binary": "/usr/bin/most", "adapter": adapter, "packageEvidence": packageEvidence}
        else:
            binary = shutil.which(adapter) or f"/usr/bin/{adapter}"
            if not Path(binary).exists():
                return {"missing": True, "binary": binary, "adapter": adapter}
        input_path = Path(workdir) / f"{adapter}-input.txt"
        input_path.write_bytes(input_bytes())
        before_expected = "line-022" if adapter == "most" else "line-023"
        return {"adapter": adapter, "binary": binary, "argv": [binary, str(input_path)], "env": env, "beforeExpected": before_expected, "file": str(input_path), "packageEvidence": packageEvidence}
    if adapter == "man":
        binary = shutil.which("man") or "/usr/bin/man"
        pager = shutil.which("more") or "/usr/bin/more"
        if not Path(binary).exists() or not Path(pager).exists():
            return {"missing": True, "binary": binary, "adapter": adapter}
        env.update({"MANPAGER": pager, "PAGER": pager})
        return {"adapter": adapter, "binary": binary, "argv": [binary, "printf"], "env": env, "beforeExpected": "--More--", "file": "man:printf", "pager": pager}
    if adapter == "git-log":
        binary = shutil.which("git") or "/usr/bin/git"
        pager = shutil.which("more") or "/usr/bin/more"
        if not Path(binary).exists() or not Path(pager).exists():
            return {"missing": True, "binary": binary, "adapter": adapter}
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
        env.update({"GIT_PAGER": pager, "PAGER": pager})
        return {"adapter": adapter, "binary": binary, "argv": [binary, "--paginate", "--no-optional-locks", "log", "--oneline", "--decorate=short"], "env": env, "cwd": str(repo), "beforeExpected": "commit-070", "file": str(repo), "pager": pager}
    if adapter == "tail-f":
        binary = shutil.which("tail") or "/usr/bin/tail"
        if not Path(binary).exists():
            return {"missing": True, "binary": binary, "adapter": adapter}
        watched = Path(workdir) / "watched.txt"
        watched.write_text("initial-001\n", encoding="utf-8")
        return {"adapter": adapter, "binary": binary, "argv": [binary, "-f", str(watched)], "env": env, "beforeExpected": "initial-001", "file": str(watched)}
    raise ValueError(f"unknown adapter {adapter}")


def launch(case, workdir):
    config = prepare_adapter(case, workdir)
    if config.get("missing"):
        return config
    master, slave = os.openpty()
    set_size(slave)
    slave_path = os.ttyname(slave)

    def prepare_child():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    proc = subprocess.Popen(
        config["argv"],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=config.get("cwd", workdir),
        env=config["env"],
        preexec_fn=prepare_child,
        close_fds=True,
    )
    os.close(slave)
    before = drain(master, time.time() + 5, config["beforeExpected"]) + drain(master, time.time() + 0.6)
    config.update({"master": master, "slavePath": slave_path, "proc": proc, "before": before})
    return config


def process_descriptor(pid, slave_path):
    fds = fd_facts(pid)
    state = proc_state(pid)
    syscall = state["syscall"]
    stdio = {str(fd): fd_target(fds, fd) for fd in (0, 1, 2)}
    return {
        "pid": pid,
        "state": state,
        "fds": fds,
        "stdioTargets": stdio,
        "syscallFdTarget": fd_target(fds, syscall.get("fd")) if syscall.get("fd") is not None else None,
        "allStdioOnControlledPty": all(target == slave_path for target in stdio.values()),
        "hasSignalfd": any(fact["target"] == "anon_inode:[signalfd]" for fact in fds),
        "hasRegularAdapterFile": any("input.txt" in fact["target"] or "watched.txt" in fact["target"] or "/repo" in fact["target"] for fact in fds),
    }


def is_modeled_wait(process, slave_path, adapter):
    syscall = process["state"]["syscall"]
    if syscall.get("name") == "read" and process["syscallFdTarget"] == slave_path:
        return True
    if syscall.get("name") in ("poll", "ppoll", "pselect6") and any(target == slave_path for target in process["stdioTargets"].values()):
        return True
    if adapter == "tail-f" and syscall.get("name") in ("read", "poll", "ppoll"):
        return True
    return False


def classify(config):
    proc = config["proc"]
    master = config["master"]
    slave_path = config["slavePath"]
    before = config["before"]
    adapter = config["adapter"]
    pty = {
        "slavePath": slave_path,
        "rows": ROWS,
        "cols": COLS,
        "inputQueueBytesOnMaster": queue_bytes(master),
        "inputQueueBytesOnSlave": slave_queue(slave_path),
        "foregroundPgrpFromMaster": foreground_pgrp(master),
    }
    processes = []
    for pid in descendants(proc.pid):
        if Path(f"/proc/{pid}").exists():
            processes.append(process_descriptor(pid, slave_path))
    candidates = [process for process in processes if is_modeled_wait(process, slave_path, adapter)]
    candidate = candidates[0] if candidates else (processes[0] if processes else None)
    before_ok = config["beforeExpected"] in before
    session_ok = bool(candidate) and candidate["state"]["statSession"] == proc.pid and candidate["state"]["statPgrp"] == proc.pid and pty["foregroundPgrpFromMaster"] == proc.pid
    queues_empty = pty["inputQueueBytesOnMaster"] == 0 and pty["inputQueueBytesOnSlave"].get("bytes") == 0
    controlled_pty_io = bool(candidate) and (
        candidate["allStdioOnControlledPty"]
        or candidate["syscallFdTarget"] == slave_path
        or candidate["stdioTargets"].get("1") == slave_path
        or candidate["stdioTargets"].get("2") == slave_path
    )
    checks = {
        "expectedOutputRendered": before_ok,
        "modeledWait": bool(candidate) and is_modeled_wait(candidate, slave_path, adapter),
        "controlledPtyIo": controlled_pty_io,
        "sessionPgrp": session_ok,
        "queuesEmpty": queues_empty,
        "singleThreadCandidate": bool(candidate) and candidate["state"].get("threads") == 1,
        "noPendingSignalCandidate": bool(candidate) and candidate["state"].get("signalPendingMask") == "0000000000000000",
    }
    if adapter in ("more", "pg", "most", "tail-f"):
        checks["regularFilePresent"] = bool(candidate) and any(config["file"] in fact["target"] for fact in candidate["fds"])
    return processes, candidate, pty, checks


def cleanup(config):
    if config.get("missing"):
        return
    proc = config["proc"]
    master = config["master"]
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
    return case["expect"] in after or (case["expect"] == "line-001" and "line-001" in before and "line-024" not in after)


def run_case(case_id, mode, role):
    case = {**CASES[case_id], "id": case_id}
    with tempfile.TemporaryDirectory(prefix="machinen-pager-watcher-ladder-") as workdir:
        config = launch(case, workdir)
        if config.get("missing"):
            return {
                "case": case_id,
                "adapter": case["adapter"],
                "description": case["description"],
                "mode": mode,
                "role": role,
                "hostArch": os.uname().machine,
                "decision": "skipped-not-installed",
                "missingBinary": config["binary"],
                "claimGuard": CLAIM_GUARD,
            }
        try:
            time.sleep(0.25)
            processes, candidate, pty, checks = classify(config)
            binary = config["binary"]
            result = {
                "case": case_id,
                "adapter": case["adapter"],
                "description": case["description"],
                "mode": mode,
                "role": role,
                "hostArch": os.uname().machine,
                "binary": {"path": binary, "versionLine": version(binary), "packageEvidence": config.get("packageEvidence")},
                "processRoot": {"pid": config["proc"].pid, "argv": config["argv"]},
                "processTree": processes,
                "candidateProcess": candidate,
                "pty": pty,
                "candidateChecks": checks,
                "screenAtCandidate": {"containsExpectedOutput": checks["expectedOutputRendered"], "sample": config["before"][-1200:]},
                "inputOrResource": {"expect": case["expect"], "file": config.get("file")},
                "claimGuard": CLAIM_GUARD,
            }
            if case["action"] == "key":
                result["inputOrResource"]["base64"] = base64.b64encode(case["bytes"]).decode()
            if mode in ("same", "target"):
                if case["action"] == "append":
                    Path(config["file"]).write_bytes(Path(config["file"]).read_bytes() + case["append"])
                    after = drain(config["master"], time.time() + 3, case["expect"]) + drain(config["master"], time.time() + 0.4)
                    exited = config["proc"].poll() is not None
                    matched = case["expect"] in after and not exited
                    result["inputOrResource"]["appendBase64"] = base64.b64encode(case["append"]).decode()
                else:
                    os.write(config["master"], case["bytes"])
                    after = drain(config["master"], time.time() + 3, None if case["expect"] == "process-exit" else case["expect"])
                    after += drain(config["master"], time.time() + 0.5)
                    exited = config["proc"].poll() is not None
                    matched = behavior_matches(case, config["before"], after, exited)
                result["behavior"] = {"matchedExpectation": matched, "processExited": exited, "sample": after[-1400:]}
                result["decision"] = "accepted" if all(checks.values()) and matched else "failed"
            else:
                result["decision"] = "captured" if all(checks.values()) else "failed"
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
    cases = args[1:]
    rows = []
    for case_id in cases:
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            if same["decision"] == "skipped-not-installed" or source["decision"] == "skipped-not-installed" or target["decision"] == "skipped-not-installed":
                decision = "skipped-not-installed"
            elif same["decision"] != "accepted":
                decision = "skipped-same-arch-failed"
            else:
                decision = "accepted" if source["decision"] == "captured" and target["decision"] == "accepted" else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
        if same["decision"] == "skipped-not-installed":
            row_status = "skipped-not-installed"
        elif same["decision"] == "accepted" and all(direction["decision"] == "accepted" for direction in directions):
            row_status = "accepted"
        else:
            row_status = "failed"
        rows.append({"case": case_id, "adapter": CASES[case_id]["adapter"], "status": row_status, "sameArch": same["decision"], "directions": directions})
    accepted = [row for row in rows if row["status"] == "accepted"]
    failed = [row for row in rows if row["status"] == "failed"]
    report = {
        "kind": "machinen.research.real-pager-and-watcher-binary-ladder.report",
        "version": 1,
        "status": "all-present-accepted" if not failed else "completed-with-failures",
        "rows": rows,
        "acceptedRows": len(accepted),
        "failedRows": len(failed),
        "skippedRows": len([row for row in rows if row["status"] == "skipped-not-installed"]),
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
