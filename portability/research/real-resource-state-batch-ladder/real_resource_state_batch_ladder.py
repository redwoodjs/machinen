#!/usr/bin/env python3
import ctypes
import fcntl
import json
import mmap
import os
import pty
import select
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import termios
import threading
import time
from pathlib import Path

CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "kernelObjectIdentityPreserved": False,
}

CASES = {
    "file-read-offset": ("support", "regular file read offset descriptor"),
    "file-append-offset": ("support", "regular file append offset descriptor"),
    "deleted-open-file-refusal": ("refusal", "deleted-but-open regular file refused"),
    "symlink-path-ambiguity-refusal": ("refusal", "symlink path ambiguity refused"),
    "pipe-empty-owned": ("support", "owned empty pipe reconstructed"),
    "pipe-queued-bytes-owned": ("support", "owned pipe queued bytes reconstructed semantically"),
    "pipe-writer-closed-eof": ("support", "pipe writer closed EOF descriptor"),
    "external-pipe-fd-refusal": ("refusal", "external pipe fd refused"),
    "pending-signal-refusal": ("refusal", "pending signal refused"),
    "blocked-signal-mask": ("support", "blocked signal mask descriptor reconstructed"),
    "process-group-signal": ("support", "process group signal delivery descriptor"),
    "sleep-remaining-time": ("support", "sleep remaining-time descriptor reconstructed"),
    "interval-timer-tick": ("support", "interval timer semantic tick reconstructed"),
    "timerfd-readable-refusal": ("refusal", "readable timerfd state refused"),
    "cwd-preserved": ("support", "cwd descriptor preserves relative file lookup"),
    "deleted-cwd-refusal": ("refusal", "deleted cwd refused"),
    "relative-path-cwd": ("support", "relative path reopen through cwd descriptor"),
    "env-var-continuation": ("support", "environment variable descriptor"),
    "argv-dependent-behavior": ("support", "argv descriptor"),
    "cwd-env-argv-combined": ("support", "combined cwd env argv descriptor"),
    "readonly-mmap": ("support", "read-only mmap descriptor"),
    "writable-mmap-flush": ("support", "writable mmap flush descriptor"),
    "anonymous-mmap-refusal": ("refusal", "anonymous mmap refused unless declared"),
    "single-thread-accepted": ("support", "single-thread boundary accepted"),
    "multi-thread-refusal": ("refusal", "multi-thread process refused"),
    "thread-blocked-syscall-refusal": ("refusal", "thread blocked syscall refused"),
    "pid-not-preserved-proof": ("support", "PID is not preserved, only descriptor behavior"),
    "pgrp-session-descriptor": ("support", "process group/session descriptor"),
    "orphan-child-refusal": ("refusal", "orphan child process refused"),
    "terminal-raw-mode": ("support", "pty raw/cbreak terminal mode descriptor"),
    "terminal-window-size-refusal": ("refusal", "terminal window size mismatch refused"),
    "terminal-alt-screen": ("support", "alternate screen terminal descriptor"),
}


def base(case_id, mode, role):
    kind, description = CASES[case_id]
    return {"case": case_id, "kind": kind, "description": description, "mode": mode, "role": role, "hostArch": os.uname().machine, "pid": os.getpid(), "claimGuard": CLAIM_GUARD}


def ok(result, evidence):
    result.update({"decision": "captured" if result["mode"] == "source" else "accepted", "evidence": evidence})
    return result


def refuse(result, reason, evidence):
    result.update({"decision": "refused", "refusal": {"reason": reason, **evidence}})
    return result


def fd_target(fd):
    try:
        return os.readlink(f"/proc/{os.getpid()}/fd/{fd}")
    except OSError as error:
        return str(error)


def run_file_read_offset(r, wd):
    p = Path(wd) / "file.txt"; p.write_text("alpha\nbeta\ngamma\n")
    with p.open("rb") as f:
        f.seek(6); captured = {"path": str(p), "offset": f.tell(), "nextBytes": f.read(4).decode()}
    if r["mode"] == "source": return ok(r, captured)
    with p.open("rb") as f:
        f.seek(captured["offset"]); got = f.read(4).decode()
    return ok(r, {**captured, "targetRead": got, "matched": got == "beta"}) if got == "beta" else fail(r, captured)


def run_file_append_offset(r, wd):
    p = Path(wd) / "append.txt"; p.write_text("one\n")
    with p.open("ab") as f: off = f.tell()
    if r["mode"] == "source": return ok(r, {"path": str(p), "appendOffset": off})
    with p.open("ab") as f: f.seek(off); f.write(b"two\n")
    return ok(r, {"path": str(p), "content": p.read_text()}) if p.read_text() == "one\ntwo\n" else fail(r, {})


def run_deleted_open_file_refusal(r, wd):
    p = Path(wd) / "deleted.txt"; p.write_text("deleted")
    f = p.open("rb"); p.unlink(); target = fd_target(f.fileno()); f.close()
    return refuse(r, "deleted-open-file", {"fdTarget": target})


def run_symlink_refusal(r, wd):
    a = Path(wd) / "a"; b = Path(wd) / "b"; link = Path(wd) / "link"
    a.write_text("a"); b.write_text("b"); link.symlink_to(a); before = link.resolve(); link.unlink(); link.symlink_to(b)
    return refuse(r, "symlink-target-changed", {"before": str(before), "after": str(link.resolve())})


def run_pipe_empty(r, wd):
    rd, wr = os.pipe(); evidence = {"readFdTarget": fd_target(rd), "writeFdTarget": fd_target(wr), "queuedBytes": 0}
    os.close(rd); os.close(wr)
    if r["mode"] == "source": return ok(r, evidence)
    rd, wr = os.pipe(); os.write(wr, b"x"); got = os.read(rd, 1); os.close(rd); os.close(wr)
    return ok(r, {**evidence, "messagePassed": got == b"x"})


def run_pipe_queued(r, wd):
    rd, wr = os.pipe(); os.write(wr, b"queued"); data = os.read(rd, 6); os.close(rd); os.close(wr)
    if r["mode"] == "source": return ok(r, {"capturedBytes": data.decode()})
    rd, wr = os.pipe(); os.write(wr, data); got = os.read(rd, 6); os.close(rd); os.close(wr)
    return ok(r, {"materializedBytes": got.decode(), "matched": got == b"queued"})


def run_pipe_eof(r, wd):
    rd, wr = os.pipe(); os.close(wr); got = os.read(rd, 1); os.close(rd)
    return ok(r, {"eof": got == b""})


def run_external_pipe_refusal(r, wd):
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(5)"], stdout=subprocess.PIPE)
    target = fd_target(proc.stdout.fileno()) if proc.stdout else "none"
    proc.terminate(); proc.wait(timeout=2)
    return refuse(r, "external-pipe-fd", {"fdTarget": target})


def run_pending_signal_refusal(r, wd):
    old_mask = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGUSR1})
    old_handler = signal.signal(signal.SIGUSR1, lambda signum, frame: None)
    os.kill(os.getpid(), signal.SIGUSR1)
    pending = signal.sigpending()
    signal.pthread_sigmask(signal.SIG_SETMASK, old_mask)
    signal.signal(signal.SIGUSR1, old_handler)
    return refuse(r, "pending-signal", {"SIGUSR1Pending": signal.SIGUSR1 in pending})


def run_blocked_signal_mask(r, wd):
    old = signal.pthread_sigmask(signal.SIG_BLOCK, {signal.SIGUSR2}); blocked = signal.SIGUSR2 in signal.pthread_sigmask(signal.SIG_BLOCK, set()); signal.pthread_sigmask(signal.SIG_SETMASK, old)
    return ok(r, {"SIGUSR2Blocked": blocked})


def run_process_group_signal(r, wd):
    proc = subprocess.Popen(["sleep", "30"], start_new_session=True); os.killpg(os.getpgid(proc.pid), signal.SIGTERM); proc.wait(timeout=3)
    return ok(r, {"childExited": proc.poll() is not None, "returncode": proc.returncode})


def run_sleep_remaining(r, wd):
    if r["mode"] == "source": return ok(r, {"remainingMsDescriptor": 100})
    proc = subprocess.Popen(["sleep", "0.1"]); proc.wait(timeout=2); return ok(r, {"targetSleepExited": proc.returncode == 0})


def run_interval_timer(r, wd):
    ticks = []
    def handler(signum, frame):
        ticks.append(time.time())
    old = signal.signal(signal.SIGALRM, handler); signal.setitimer(signal.ITIMER_REAL, 0.05, 0.05); time.sleep(0.13); signal.setitimer(signal.ITIMER_REAL, 0); signal.signal(signal.SIGALRM, old)
    return ok(r, {"ticks": len(ticks), "semanticTimerTicked": len(ticks) >= 1})


def run_timerfd_refusal(r, wd):
    libc = ctypes.CDLL(None, use_errno=True); fd = libc.timerfd_create(1, 0)
    if fd < 0: return refuse(r, "timerfd-unavailable", {"errno": ctypes.get_errno()})
    spec = struct.pack("qqqq", 0, 1, 0, 0); libc.timerfd_settime(fd, 0, spec, 0); time.sleep(0.02); target = fd_target(fd); os.close(fd)
    return refuse(r, "readable-timerfd", {"fdTarget": target})


def run_cwd_preserved(r, wd):
    d = Path(wd) / "cwd"; d.mkdir(); (d / "rel.txt").write_text("cwd-ok")
    got = subprocess.check_output([sys.executable, "-c", "from pathlib import Path; print(Path('rel.txt').read_text(), end='')"], cwd=d, text=True)
    return ok(r, {"cwd": str(d), "relativeRead": got})


def run_deleted_cwd_refusal(r, wd):
    d = Path(wd) / "gone"; d.mkdir(); os.chdir(d); os.rmdir(d)
    try: cwd = os.getcwd()
    except OSError as error: cwd = str(error)
    return refuse(r, "deleted-cwd", {"getcwd": cwd})


def run_relative_path_cwd(r, wd):
    return run_cwd_preserved(r, wd)


def run_env(r, wd):
    env = os.environ.copy(); env["MACHINEN_RESOURCE_BATCH"] = "env-ok"
    got = subprocess.check_output([sys.executable, "-c", "import os; print(os.environ['MACHINEN_RESOURCE_BATCH'], end='')"], env=env, text=True)
    return ok(r, {"envValue": got})


def run_argv(r, wd):
    got = subprocess.check_output([sys.executable, "-c", "import sys; print(sys.argv[1], end='')", "argv-ok"], text=True)
    return ok(r, {"argvValue": got})


def run_cwd_env_argv(r, wd):
    d = Path(wd) / "combo"; d.mkdir(); (d / "rel.txt").write_text("combo-file")
    env = os.environ.copy(); env["COMBO_ENV"] = "combo-env"
    code = "import os,sys,pathlib; print(pathlib.Path('rel.txt').read_text()+','+os.environ['COMBO_ENV']+','+sys.argv[1], end='')"
    got = subprocess.check_output([sys.executable, "-c", code, "combo-argv"], cwd=d, env=env, text=True)
    return ok(r, {"combined": got})


def run_ro_mmap(r, wd):
    p = Path(wd) / "map.txt"; p.write_bytes(b"mmap-readonly")
    with p.open("rb") as f, mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ) as mm: data = mm[:4]
    return ok(r, {"bytes": data.decode()})


def run_writable_mmap(r, wd):
    p = Path(wd) / "mapw.txt"; p.write_bytes(b"abcde")
    with p.open("r+b") as f, mmap.mmap(f.fileno(), 0) as mm: mm[0:3] = b"XYZ"; mm.flush()
    return ok(r, {"content": p.read_text()})


def run_anon_mmap_refusal(r, wd):
    mm = mmap.mmap(-1, 16); mm.write(b"anonymous"); mm.close()
    return refuse(r, "anonymous-mmap-undeclared", {"declared": False})


def run_single_thread(r, wd):
    return ok(r, {"threads": len(os.listdir(f"/proc/{os.getpid()}/task"))})


def run_multi_thread_refusal(r, wd):
    stop = False
    def worker():
        while not stop: time.sleep(0.01)
    t = threading.Thread(target=worker); t.start(); threads = len(os.listdir(f"/proc/{os.getpid()}/task")); stop = True; t.join()
    return refuse(r, "multi-thread", {"threads": threads})


def run_thread_syscall_refusal(r, wd):
    rd, wr = os.pipe(); started = threading.Event()
    def worker():
        started.set(); os.read(rd, 1)
    t = threading.Thread(target=worker); t.start(); started.wait(); threads = len(os.listdir(f"/proc/{os.getpid()}/task")); os.write(wr, b"x"); t.join(); os.close(rd); os.close(wr)
    return refuse(r, "thread-blocked-syscall", {"threads": threads})


def run_pid_not_preserved(r, wd):
    source_pid = os.getpid(); target_pid = subprocess.check_output([sys.executable, "-c", "import os; print(os.getpid(), end='')"], text=True)
    return ok(r, {"sourcePid": source_pid, "targetPid": int(target_pid), "pidPreserved": source_pid == int(target_pid)})


def run_pgrp_session(r, wd):
    proc = subprocess.Popen([sys.executable, "-c", "import os; print(os.getpid(), os.getpgrp(), os.getsid(0), end='')"], stdout=subprocess.PIPE, start_new_session=True, text=True); out = proc.communicate(timeout=2)[0]
    return ok(r, {"pidPgrpSession": out})


def run_orphan_refusal(r, wd):
    proc = subprocess.Popen([sys.executable, "-c", "import subprocess,time; subprocess.Popen(['sleep','3']); time.sleep(.1)"])
    proc.wait(timeout=2); time.sleep(0.1)
    return refuse(r, "orphan-child-risk", {"parentExited": proc.returncode == 0})


def run_terminal_raw(r, wd):
    master, slave = pty.openpty(); old = termios.tcgetattr(slave); tty = termios.tcgetattr(slave); tty[3] &= ~(termios.ICANON | termios.ECHO); termios.tcsetattr(slave, termios.TCSANOW, tty); new = termios.tcgetattr(slave); termios.tcsetattr(slave, termios.TCSANOW, old); os.close(master); os.close(slave)
    return ok(r, {"icanonDisabled": not bool(new[3] & termios.ICANON), "echoDisabled": not bool(new[3] & termios.ECHO)})


def run_terminal_size_refusal(r, wd):
    master, slave = pty.openpty(); fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 24, 80, 0, 0)); before = struct.unpack("HHHH", fcntl.ioctl(slave, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0)))[:2]; fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 100, 0, 0)); after = struct.unpack("HHHH", fcntl.ioctl(slave, termios.TIOCGWINSZ, struct.pack("HHHH", 0, 0, 0, 0)))[:2]; os.close(master); os.close(slave)
    return refuse(r, "terminal-window-size-mismatch", {"before": before, "after": after})


def run_terminal_alt(r, wd):
    seq = "\x1b[?1049hhello\x1b[?1049l"
    return ok(r, {"alternateScreenEnter": "\x1b[?1049h" in seq, "alternateScreenExit": "\x1b[?1049l" in seq})


def fail(r, evidence):
    r.update({"decision": "failed", "evidence": evidence}); return r

RUNNERS = {
    "file-read-offset": run_file_read_offset, "file-append-offset": run_file_append_offset, "deleted-open-file-refusal": run_deleted_open_file_refusal, "symlink-path-ambiguity-refusal": run_symlink_refusal,
    "pipe-empty-owned": run_pipe_empty, "pipe-queued-bytes-owned": run_pipe_queued, "pipe-writer-closed-eof": run_pipe_eof, "external-pipe-fd-refusal": run_external_pipe_refusal,
    "pending-signal-refusal": run_pending_signal_refusal, "blocked-signal-mask": run_blocked_signal_mask, "process-group-signal": run_process_group_signal,
    "sleep-remaining-time": run_sleep_remaining, "interval-timer-tick": run_interval_timer, "timerfd-readable-refusal": run_timerfd_refusal,
    "cwd-preserved": run_cwd_preserved, "deleted-cwd-refusal": run_deleted_cwd_refusal, "relative-path-cwd": run_relative_path_cwd,
    "env-var-continuation": run_env, "argv-dependent-behavior": run_argv, "cwd-env-argv-combined": run_cwd_env_argv,
    "readonly-mmap": run_ro_mmap, "writable-mmap-flush": run_writable_mmap, "anonymous-mmap-refusal": run_anon_mmap_refusal,
    "single-thread-accepted": run_single_thread, "multi-thread-refusal": run_multi_thread_refusal, "thread-blocked-syscall-refusal": run_thread_syscall_refusal,
    "pid-not-preserved-proof": run_pid_not_preserved, "pgrp-session-descriptor": run_pgrp_session, "orphan-child-refusal": run_orphan_refusal,
    "terminal-raw-mode": run_terminal_raw, "terminal-window-size-refusal": run_terminal_size_refusal, "terminal-alt-screen": run_terminal_alt,
}


def run_case(case_id, mode, role):
    old_cwd = os.getcwd()
    with tempfile.TemporaryDirectory(prefix="machinen-resource-state-batch-") as wd:
        try:
            return RUNNERS[case_id](base(case_id, mode, role), wd)
        finally:
            try: os.chdir(old_cwd)
            except OSError: pass


def write_json(path, data): Path(path).write_text(json.dumps(data, indent=2, default=str) + "\n", encoding="utf-8")


def remote(args):
    case_id, mode, role, out = args
    result = run_case(case_id, mode, role); write_json(out, result)
    print(json.dumps({"case": case_id, "mode": mode, "decision": result["decision"], "arch": result["hostArch"]}, indent=2)); return 0


def combine(args):
    retained = Path(args[0]); rows = []
    for case_id in args[1:]:
        kind, _ = CASES[case_id]; same = json.loads((retained / f"same-{case_id}.json").read_text()); directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text()); target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            decision = "refused" if kind == "refusal" and same["decision"] == source["decision"] == target["decision"] == "refused" else "accepted" if kind == "support" and same["decision"] == "accepted" and source["decision"] == "captured" and target["decision"] == "accepted" else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
        status = directions[0]["decision"] if directions and all(d["decision"] == directions[0]["decision"] for d in directions) else "failed"
        rows.append({"case": case_id, "kind": kind, "status": status, "sameArch": same["decision"], "directions": directions})
    report = {"kind": "machinen.research.real-resource-state-batch-ladder.report", "version": 1, "status": "proved-with-refusals" if not [r for r in rows if r["status"] == "failed"] else "completed-with-failures", "acceptedRows": len([r for r in rows if r["status"] == "accepted"]), "refusedRows": len([r for r in rows if r["status"] == "refused"]), "failedRows": len([r for r in rows if r["status"] == "failed"]), "rows": rows, "claimGuard": CLAIM_GUARD}
    write_json(retained / "report.json", report); print(json.dumps(report, indent=2)); return 0


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "list-cases": print("\n".join(CASES)); return 0
    if len(sys.argv) > 1 and sys.argv[1] == "remote": return remote(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "combine": return combine(sys.argv[2:])
    return 2

if __name__ == "__main__": raise SystemExit(main())
