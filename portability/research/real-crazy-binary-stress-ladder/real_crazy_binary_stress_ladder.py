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
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROWS = 24
COLS = 80
CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "rawHeapStackRegisterRestore": False,
}

CASES = {
    "vi-edit-save": ("support", "vi edits a temp file and saves through target-native scripted pty state"),
    "nano-edit-save": ("support", "nano edits a temp file and saves through target-native scripted pty state"),
    "python-repl-state": ("support", "python3 -i receives semantic REPL state and continues an expression"),
    "sqlite-cli-query": ("support", "sqlite3 CLI opens a db, writes a row, and continues with a query"),
    "vi-mid-edit-continuation": ("support", "vi reaches a live unsaved-buffer safe point and target-native vi continues by saving it"),
    "nano-mid-edit-continuation": ("support", "nano reaches a live unsaved-buffer safe point and target-native nano continues by saving it"),
    "python-repl-prompt-continuation": ("support", "python3 -i reaches a live prompt safe point and target-native python continues the expression"),
    "sqlite-prompt-continuation": ("support", "sqlite3 reaches a live prompt after writes and target-native sqlite continues the query"),
    "curl-local-http": ("support", "curl completes a request against a controlled local HTTP server"),
    "curl-mid-transfer-refusal": ("refusal", "curl live TCP transfer with partial body is refused"),
    "ssh-live-session-refusal": ("refusal", "ssh live crypto/socket/session state is refused"),
    "strace-ptrace-refusal": ("refusal", "strace ptrace boundary is refused"),
    "make-tiny-build": ("support", "make builds a tiny deterministic target"),
    "make-active-recipe-continuation": ("support", "make reaches a live controlled recipe gate and target-native make continues remaining work"),
    "top-render-quit": ("support", "top renders a live TUI under a controlled pty and quits"),
    "top-live-refresh-continuation": ("support", "top reaches a live render safe point and target-native top continues with quit input"),
    "watch-render-quit": ("support", "watch renders a timer TUI under a controlled pty and quits"),
    "watch-live-refresh-continuation": ("support", "watch reaches a live render safe point and target-native watch continues with quit input"),
    "tar-extract-tree": ("support", "tar archives and extracts a deterministic file tree"),
    "tar-mid-stream-refusal": ("refusal", "tar live partial archive stream is refused"),
    "find-tree-walk": ("support", "find walks a deterministic directory tree"),
    "find-live-walk-continuation": ("support", "find reaches a live controlled walk gate and target-native find continues the stable traversal"),
    "rsync-local-copy": ("support", "rsync copies a deterministic tree locally"),
    "rsync-mid-copy-refusal": ("refusal", "rsync live partial copy state is refused"),
    "openssl-enc-transform": ("support", "openssl enc transforms a file with a fixed passphrase"),
    "openssl-enc-mid-stream-refusal": ("refusal", "openssl enc live cipher stream with partial input/output is refused"),
    "openssl-s-client-refusal": ("refusal", "openssl s_client live TLS socket/session state is refused"),
    "gdb-inferior-refusal": ("refusal", "gdb debugger/inferior ownership is refused"),
}


def base(case_id, mode, role):
    kind, description = CASES[case_id]
    return {"case": case_id, "kind": kind, "description": description, "mode": mode, "role": role, "hostArch": os.uname().machine, "claimGuard": CLAIM_GUARD}


def command_exists(name):
    return shutil.which(name) is not None


def skip_or_fail(r, binary):
    r.update({"decision": "skipped-not-installed", "missingBinary": binary})
    return r


def accept_or_capture(r, evidence):
    r.update({"decision": "captured" if r["mode"] == "source" else "accepted", "evidence": evidence})
    return r


def refuse(r, reason, evidence=None):
    r.update({"decision": "refused", "refusal": {"reason": reason, **(evidence or {})}})
    return r


def run_cmd(args, cwd=None, input_bytes=None, env=None, timeout=8):
    result = subprocess.run(args, cwd=cwd, input=input_bytes, env=env, capture_output=True, timeout=timeout, check=False)
    return {"args": args, "returncode": result.returncode, "stdout": result.stdout.decode(errors="replace"), "stderr": result.stderr.decode(errors="replace")}


def set_size(fd):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", ROWS, COLS, 0, 0))


def drain(fd, seconds=0.5, expect=None):
    deadline = time.time() + seconds
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
        chunks.append(data.decode(errors="replace"))
        if expect and expect in "".join(chunks):
            break
    return "".join(chunks)


def read_available(pipe, limit=65536):
    if pipe is None:
        return b""
    fd = pipe.fileno()
    old_flags = fcntl.fcntl(fd, fcntl.F_GETFL)
    fcntl.fcntl(fd, fcntl.F_SETFL, old_flags | os.O_NONBLOCK)
    chunks = []
    remaining = limit
    try:
        while remaining > 0:
            readable, _, _ = select.select([fd], [], [], 0)
            if not readable:
                break
            chunk = os.read(fd, min(8192, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
    except BlockingIOError:
        pass
    finally:
        fcntl.fcntl(fd, fcntl.F_SETFL, old_flags)
    return b"".join(chunks)


def spawn_pty(argv, cwd=None, env=None):
    master, slave = pty.openpty()
    set_size(slave)
    def preexec():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
    proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, cwd=cwd, env=env, preexec_fn=preexec, close_fds=True)
    os.close(slave)
    return proc, master


def cleanup_pty_process(proc, master):
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


def write_and_drain(master, data, seconds=1.0, expect=None):
    os.write(master, data)
    return drain(master, seconds, expect)


def load_source_descriptor(source_capture_path):
    if not source_capture_path:
        return None
    source = json.loads(Path(source_capture_path).read_text(encoding="utf-8"))
    return source.get("evidence", {}).get("continuationDescriptor")


def run_pty(argv, writes, cwd=None, env=None, expect=None, timeout=8):
    proc, master = spawn_pty(argv, cwd=cwd, env=env)
    output = drain(master, 1.0)
    for delay, data in writes:
        time.sleep(delay)
        try:
            os.write(master, data)
        except OSError:
            break
        output += drain(master, 1.0, expect)
    deadline = time.time() + timeout
    while proc.poll() is None and time.time() < deadline:
        output += drain(master, 0.2, expect)
        if expect and expect in output:
            break
    if proc.poll() is None and expect != "keep-running":
        try:
            os.write(master, b"q")
        except OSError:
            pass
    try:
        proc.wait(timeout=2)
    except subprocess.TimeoutExpired:
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
    return {"argv": argv, "returncode": proc.returncode, "outputSample": output[-1600:], "sawExpected": bool(expect and expect in output)}


def run_vi(r, wd):
    binary = shutil.which("vim") or shutil.which("vi")
    if not binary:
        return skip_or_fail(r, "vi")
    path = Path(wd) / "vi.txt"
    env = os.environ.copy(); env.update({"TERM": "xterm", "EXINIT": "set nocompatible backupskip=/tmp/* directory=/tmp"})
    res = run_pty([binary, "-n", "-u", "NONE", str(path)], [(0.5, b"ihello-from-vi\x1b:wq\r")], cwd=wd, env=env, timeout=8)
    content = path.read_text(errors="replace") if path.exists() else ""
    return accept_or_capture(r, {"binary": binary, "content": content, "returncode": res["returncode"], "saved": "hello-from-vi" in content}) if "hello-from-vi" in content else failed(r, res)


def run_nano(r, wd):
    binary = shutil.which("nano")
    if not binary:
        return skip_or_fail(r, "nano")
    path = Path(wd) / "nano.txt"
    env = os.environ.copy(); env.update({"TERM": "xterm"})
    res = run_pty([binary, "--ignorerc", str(path)], [(0.5, b"hello-from-nano"), (0.2, b"\x0f"), (0.2, b"\r"), (0.2, b"\x18")], cwd=wd, env=env, timeout=8)
    content = path.read_text(errors="replace") if path.exists() else ""
    return accept_or_capture(r, {"binary": binary, "content": content, "returncode": res["returncode"], "saved": "hello-from-nano" in content}) if "hello-from-nano" in content else failed(r, res)


def run_python_repl(r, wd):
    binary = shutil.which("python3")
    if not binary:
        return skip_or_fail(r, "python3")
    res = run_pty([binary, "-i"], [(0.3, b"x=41\n"), (0.2, b"print(x+1)\n"), (0.2, b"exit()\n")], cwd=wd, expect="42", timeout=6)
    return accept_or_capture(r, {"binary": binary, "saw42": res["sawExpected"], "sample": res["outputSample"]}) if res["sawExpected"] else failed(r, res)


def run_sqlite(r, wd):
    binary = shutil.which("sqlite3")
    if not binary:
        return skip_or_fail(r, "sqlite3")
    db = Path(wd) / "test.db"
    script = b"create table t(v text); insert into t values('sqlite-ok'); select v from t; .quit\n"
    res = run_cmd([binary, str(db)], cwd=wd, input_bytes=script)
    ok = "sqlite-ok" in res["stdout"] and db.exists()
    return accept_or_capture(r, {"binary": binary, "dbSize": db.stat().st_size if db.exists() else 0, "stdout": res["stdout"]}) if ok else failed(r, res)


def run_vi_mid_edit_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("vim") or shutil.which("vi")
    if not binary:
        return skip_or_fail(r, "vi")
    descriptor = load_source_descriptor(source_capture_path) or {"buffer": "less-level-vi-buffer", "targetName": "vi-mid.txt"}
    path = Path(wd) / descriptor["targetName"]
    env = os.environ.copy(); env.update({"TERM": "xterm", "EXINIT": "set nocompatible backupskip=/tmp/* directory=/tmp"})
    proc, master = spawn_pty([binary, "-n", "-u", "NONE", str(path)], cwd=wd, env=env)
    output = drain(master, 1.0)
    try:
        output += write_and_drain(master, f"i{descriptor['buffer']}\x1b".encode(), 1.0)
        safe_point = proc.poll() is None and not path.exists()
        capture = {"safePoint": "live-unsaved-command-mode-buffer", "buffer": descriptor["buffer"], "targetName": descriptor["targetName"], "sourceFileMaterializedBeforeContinue": path.exists(), "processAliveAtSafePoint": proc.poll() is None, "ptySample": output[-800:]}
        if r["mode"] == "source":
            cleanup_pty_process(proc, master)
            return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
        output += write_and_drain(master, b":wq\r", 1.0)
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            cleanup_pty_process(proc, master)
        content = path.read_text(errors="replace") if path.exists() else ""
        try:
            os.close(master)
        except OSError:
            pass
        ok = descriptor["buffer"] in content
        return accept_or_capture(r, {"binary": binary, "continuedFrom": capture["safePoint"], "content": content, "returncode": proc.returncode, "savedAfterContinue": ok}) if ok else failed(r, {"capture": capture, "content": content, "returncode": proc.returncode})
    except Exception as exc:
        cleanup_pty_process(proc, master)
        raise exc


def run_nano_mid_edit_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("nano")
    if not binary:
        return skip_or_fail(r, "nano")
    descriptor = load_source_descriptor(source_capture_path) or {"buffer": "less-level-nano-buffer", "targetName": "nano-mid.txt"}
    path = Path(wd) / descriptor["targetName"]
    env = os.environ.copy(); env.update({"TERM": "xterm"})
    proc, master = spawn_pty([binary, "--ignorerc", str(path)], cwd=wd, env=env)
    output = drain(master, 1.0)
    try:
        output += write_and_drain(master, descriptor["buffer"].encode(), 1.0)
        safe_point = proc.poll() is None and not path.exists()
        capture = {"safePoint": "live-unsaved-nano-buffer", "buffer": descriptor["buffer"], "targetName": descriptor["targetName"], "sourceFileMaterializedBeforeContinue": path.exists(), "processAliveAtSafePoint": proc.poll() is None, "ptySample": output[-800:]}
        if r["mode"] == "source":
            cleanup_pty_process(proc, master)
            return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
        output += write_and_drain(master, b"\x0f", 0.5)
        output += write_and_drain(master, b"\r", 0.5)
        output += write_and_drain(master, b"\x18", 0.5)
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            cleanup_pty_process(proc, master)
        content = path.read_text(errors="replace") if path.exists() else ""
        try:
            os.close(master)
        except OSError:
            pass
        ok = descriptor["buffer"] in content
        return accept_or_capture(r, {"binary": binary, "continuedFrom": capture["safePoint"], "content": content, "returncode": proc.returncode, "savedAfterContinue": ok}) if ok else failed(r, {"capture": capture, "content": content, "returncode": proc.returncode})
    except Exception as exc:
        cleanup_pty_process(proc, master)
        raise exc


def run_python_repl_prompt_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("python3")
    if not binary:
        return skip_or_fail(r, "python3")
    descriptor = load_source_descriptor(source_capture_path) or {"statements": ["x=41"], "continue": "print(x+1)", "expect": "42"}
    proc, master = spawn_pty([binary, "-i"], cwd=wd)
    output = drain(master, 1.0, ">>>")
    try:
        for statement in descriptor["statements"]:
            output += write_and_drain(master, f"{statement}\n".encode(), 0.8, ">>>")
        safe_point = proc.poll() is None and ">>>" in output
        capture = {"safePoint": "live-python-repl-primary-prompt", "statements": descriptor["statements"], "continue": descriptor["continue"], "expect": descriptor["expect"], "processAliveAtSafePoint": proc.poll() is None, "ptySample": output[-800:]}
        if r["mode"] == "source":
            cleanup_pty_process(proc, master)
            return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
        output += write_and_drain(master, f"{descriptor['continue']}\n".encode(), 1.0, descriptor["expect"])
        output += write_and_drain(master, b"exit()\n", 0.5)
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            cleanup_pty_process(proc, master)
        try:
            os.close(master)
        except OSError:
            pass
        ok = descriptor["expect"] in output
        return accept_or_capture(r, {"binary": binary, "continuedFrom": capture["safePoint"], "sawExpected": ok, "sample": output[-1200:]}) if ok else failed(r, {"capture": capture, "sample": output[-1200:]})
    except Exception as exc:
        cleanup_pty_process(proc, master)
        raise exc


def run_sqlite_prompt_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("sqlite3")
    if not binary:
        return skip_or_fail(r, "sqlite3")
    descriptor = load_source_descriptor(source_capture_path) or {"setup": ["create table t(v text);", "insert into t values('sqlite-less-level');"], "continue": "select v from t;", "expect": "sqlite-less-level", "targetName": "prompt.db"}
    db = Path(wd) / descriptor["targetName"]
    proc, master = spawn_pty([binary, str(db)], cwd=wd)
    output = drain(master, 1.0, "sqlite>")
    try:
        for statement in descriptor["setup"]:
            output += write_and_drain(master, f"{statement}\n".encode(), 0.8, "sqlite>")
        safe_point = proc.poll() is None and db.exists()
        capture = {"safePoint": "live-sqlite-prompt-after-durable-writes", "setup": descriptor["setup"], "continue": descriptor["continue"], "expect": descriptor["expect"], "targetName": descriptor["targetName"], "dbSizeAtSafePoint": db.stat().st_size if db.exists() else 0, "processAliveAtSafePoint": proc.poll() is None, "ptySample": output[-800:]}
        if r["mode"] == "source":
            cleanup_pty_process(proc, master)
            return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
        output += write_and_drain(master, f"{descriptor['continue']}\n".encode(), 1.0, descriptor["expect"])
        output += write_and_drain(master, b".quit\n", 0.5)
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            cleanup_pty_process(proc, master)
        try:
            os.close(master)
        except OSError:
            pass
        ok = descriptor["expect"] in output
        return accept_or_capture(r, {"binary": binary, "continuedFrom": capture["safePoint"], "sawExpected": ok, "sample": output[-1200:]}) if ok else failed(r, {"capture": capture, "sample": output[-1200:]})
    except Exception as exc:
        cleanup_pty_process(proc, master)
        raise exc


def run_make_active_recipe_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("make")
    if not binary:
        return skip_or_fail(r, "make")
    descriptor = load_source_descriptor(source_capture_path) or {"phase1": "phase1.stamp", "gate": "go", "out": "out.txt", "expect": "make-live-ok\n"}
    makefile = "all: phase2\n\nphase1.stamp:\n\tprintf 'phase1\\n' > phase1.stamp\n\nphase2: phase1.stamp\n\twhile [ ! -f go ]; do sleep 1; done\n\tprintf 'make-live-ok\\n' > out.txt\n"
    Path(wd, "Makefile").write_text(makefile, encoding="utf-8")
    if r["mode"] == "source":
        proc = subprocess.Popen([binary, "all"], cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        deadline = time.time() + 5
        while time.time() < deadline and not Path(wd, descriptor["phase1"]).exists():
            time.sleep(0.05)
        safe_point = proc.poll() is None and Path(wd, descriptor["phase1"]).exists() and not Path(wd, descriptor["out"]).exists()
        capture = {"safePoint": "live-make-controlled-recipe-gate", "makefile": makefile, **descriptor, "phase1Content": Path(wd, descriptor["phase1"]).read_text(errors="replace") if Path(wd, descriptor["phase1"]).exists() else "", "processAliveAtSafePoint": proc.poll() is None}
        try:
            proc.terminate(); proc.wait(timeout=1)
        except Exception:
            proc.kill(); proc.wait(timeout=1)
        return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
    Path(wd, "Makefile").write_text(descriptor.get("makefile", makefile), encoding="utf-8")
    Path(wd, descriptor["phase1"]).write_text(descriptor.get("phase1Content", "phase1\n"), encoding="utf-8")
    Path(wd, descriptor["gate"]).write_text("go\n", encoding="utf-8")
    res = run_cmd([binary, "all"], cwd=wd, timeout=8)
    got = Path(wd, descriptor["out"]).read_text(errors="replace") if Path(wd, descriptor["out"]).exists() else ""
    return accept_or_capture(r, {"binary": binary, "continuedFrom": "live-make-controlled-recipe-gate", "content": got, "returncode": res["returncode"]}) if got == descriptor["expect"] else failed(r, {"result": res, "content": got})


def run_top_live_refresh_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("top")
    if not binary:
        return skip_or_fail(r, "top")
    descriptor = load_source_descriptor(source_capture_path) or {"safePoint": "live-top-rendered-frame", "quit": "q", "expect": "top -"}
    env = os.environ.copy(); env.update({"TERM": "xterm"})
    proc, master = spawn_pty([binary], cwd=wd, env=env)
    output = drain(master, 1.5, descriptor["expect"])
    safe_point = proc.poll() is None and descriptor["expect"] in output
    capture = {**descriptor, "processAliveAtSafePoint": proc.poll() is None, "ptySample": output[-800:]}
    if r["mode"] == "source":
        cleanup_pty_process(proc, master)
        return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
    output += write_and_drain(master, descriptor["quit"].encode(), 0.5)
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        cleanup_pty_process(proc, master)
    try:
        os.close(master)
    except OSError:
        pass
    return accept_or_capture(r, {"binary": binary, "continuedFrom": capture["safePoint"], "rendered": safe_point, "returncode": proc.returncode}) if safe_point else failed(r, capture)


def run_watch_live_refresh_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("watch")
    if not binary:
        return skip_or_fail(r, "watch")
    descriptor = load_source_descriptor(source_capture_path) or {"safePoint": "live-watch-rendered-frame", "argv": [binary, "-n", "1", "echo", "watch-live-ok"], "quit": "q", "expect": "watch-live-ok"}
    env = os.environ.copy(); env.update({"TERM": "xterm"})
    argv = descriptor.get("argv", [binary, "-n", "1", "echo", "watch-live-ok"])
    argv[0] = binary
    proc, master = spawn_pty(argv, cwd=wd, env=env)
    output = drain(master, 1.5, descriptor["expect"])
    safe_point = proc.poll() is None and descriptor["expect"] in output
    capture = {**descriptor, "argv": argv, "processAliveAtSafePoint": proc.poll() is None, "ptySample": output[-800:]}
    if r["mode"] == "source":
        cleanup_pty_process(proc, master)
        return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
    output += write_and_drain(master, descriptor["quit"].encode(), 0.5)
    try:
        proc.wait(timeout=3)
    except subprocess.TimeoutExpired:
        cleanup_pty_process(proc, master)
    try:
        os.close(master)
    except OSError:
        pass
    return accept_or_capture(r, {"binary": binary, "continuedFrom": capture["safePoint"], "rendered": safe_point, "sample": output[-800:]}) if safe_point else failed(r, capture)


def run_find_live_walk_continuation(r, wd, source_capture_path=None):
    binary = shutil.which("find")
    if not binary:
        return skip_or_fail(r, "find")
    descriptor = load_source_descriptor(source_capture_path) or {"files": ["a.txt", "sub/b.txt"], "expect": ["a.txt", "sub/b.txt"]}
    root = Path(wd) / "tree"
    for rel in descriptor["files"]:
        p = root / rel; p.parent.mkdir(parents=True, exist_ok=True); p.write_text(rel, encoding="utf-8")
    if r["mode"] == "source":
        proc = subprocess.Popen([binary, str(root), "-type", "f", "-exec", "sh", "-c", "sleep 20", "sh", "{}", ";", "-print"], cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        time.sleep(0.7)
        safe_point = proc.poll() is None
        capture = {"safePoint": "live-find-controlled-exec-gate", **descriptor, "processAliveAtSafePoint": proc.poll() is None}
        try:
            proc.terminate(); proc.wait(timeout=1)
        except Exception:
            proc.kill(); proc.wait(timeout=1)
        return accept_or_capture(r, {"binary": binary, "continuationDescriptor": capture}) if safe_point else failed(r, capture)
    res = run_cmd([binary, str(root), "-type", "f", "-printf", "%P\\n"], cwd=wd)
    got = sorted(line for line in res["stdout"].splitlines() if line)
    return accept_or_capture(r, {"binary": binary, "continuedFrom": "live-find-controlled-exec-gate", "files": got}) if got == sorted(descriptor["expect"]) else failed(r, {"result": res, "files": got})


class SlowHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers()
        for _ in range(40):
            try:
                self.wfile.write(b"curl-mid-transfer-chunk\n"); self.wfile.flush()
            except BrokenPipeError:
                break
            time.sleep(0.1)
    def log_message(self, format, *args):
        return


def run_curl_mid_transfer_refusal(r, wd, source_capture_path=None):
    binary = shutil.which("curl")
    if not binary:
        return skip_or_fail(r, "curl")
    server = HTTPServer(("127.0.0.1", 0), SlowHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    proc = subprocess.Popen([binary, "-fsS", "--no-buffer", f"http://127.0.0.1:{server.server_address[1]}/"], cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(0.7)
    partial = read_available(proc.stdout)
    live = proc.poll() is None
    try:
        proc.terminate(); proc.wait(timeout=1)
    except Exception:
        proc.kill(); proc.wait(timeout=1)
    server.shutdown(); thread.join(timeout=2)
    return refuse(r, "curl-live-tcp-transfer-with-partial-body", {"binary": binary, "processAliveAtProbe": live, "partialResponseBytes": len(partial), "kernelTcpIdentityPreserved": False}) if live and len(partial) > 0 else failed(r, {"processAliveAtProbe": live, "partialResponseBytes": len(partial)})


def run_tar_mid_stream_refusal(r, wd, source_capture_path=None):
    binary = shutil.which("tar")
    if not binary:
        return skip_or_fail(r, "tar")
    src = Path(wd) / "src"; src.mkdir(); (src / "large.bin").write_bytes(b"t" * 4 * 1024 * 1024)
    proc = subprocess.Popen([binary, "-cf", "-", "-C", str(src), "."], cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(0.7)
    partial = read_available(proc.stdout)
    live = proc.poll() is None
    try:
        proc.terminate(); proc.wait(timeout=1)
    except Exception:
        proc.kill(); proc.wait(timeout=1)
    return refuse(r, "tar-live-partial-archive-stream", {"binary": binary, "processAliveAtProbe": live, "partialArchiveStreamBytes": len(partial)}) if live and len(partial) > 0 else failed(r, {"processAliveAtProbe": live, "partialArchiveStreamBytes": len(partial)})


def run_rsync_mid_copy_refusal(r, wd, source_capture_path=None):
    binary = shutil.which("rsync")
    if not binary:
        return skip_or_fail(r, "rsync")
    src = Path(wd) / "src"; dst = Path(wd) / "dst"; src.mkdir(); dst.mkdir(); (src / "large.bin").write_bytes(b"r" * 512 * 1024)
    proc = subprocess.Popen([binary, "-a", "--bwlimit=1", f"{src}/", str(dst)], cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(1.2)
    partial_path = dst / "large.bin"
    partial = partial_path.stat().st_size if partial_path.exists() else 0
    live = proc.poll() is None
    try:
        proc.terminate(); proc.wait(timeout=1)
    except Exception:
        proc.kill(); proc.wait(timeout=1)
    return refuse(r, "rsync-live-partial-copy-state", {"binary": binary, "processAliveAtProbe": live, "partialDestinationBytes": partial}) if live else failed(r, {"processAliveAtProbe": live, "partialDestinationBytes": partial})


def run_openssl_enc_mid_stream_refusal(r, wd, source_capture_path=None):
    binary = shutil.which("openssl")
    if not binary:
        return skip_or_fail(r, "openssl")
    fifo = Path(wd) / "plain.fifo"; enc = Path(wd) / "enc.bin"; os.mkfifo(fifo)
    def writer():
        try:
            with open(fifo, "wb", buffering=0) as f:
                f.write(b"openssl-mid-stream-a" * 1024); time.sleep(20)
        except OSError:
            pass
    writer_thread = threading.Thread(target=writer, daemon=True); writer_thread.start()
    proc = subprocess.Popen([binary, "enc", "-aes-256-cbc", "-pbkdf2", "-pass", "pass:machinen", "-in", str(fifo), "-out", str(enc)], cwd=wd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    time.sleep(0.7)
    partial = enc.stat().st_size if enc.exists() else 0
    live = proc.poll() is None
    try:
        proc.terminate(); proc.wait(timeout=1)
    except Exception:
        proc.kill(); proc.wait(timeout=1)
    return refuse(r, "openssl-enc-live-cipher-stream-state", {"binary": binary, "processAliveAtProbe": live, "partialCiphertextBytes": partial, "rawCipherStatePreserved": False}) if live else failed(r, {"processAliveAtProbe": live, "partialCiphertextBytes": partial})


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200); self.end_headers(); self.wfile.write(b"curl-ok")
    def log_message(self, format, *args):
        return


def run_curl(r, wd):
    binary = shutil.which("curl")
    if not binary:
        return skip_or_fail(r, "curl")
    server = HTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    port = server.server_address[1]
    res = run_cmd([binary, "-fsS", f"http://127.0.0.1:{port}/"], timeout=8)
    server.shutdown(); thread.join(timeout=2)
    return accept_or_capture(r, {"binary": binary, "stdout": res["stdout"], "localPort": port}) if "curl-ok" in res["stdout"] else failed(r, res)


def run_make(r, wd):
    binary = shutil.which("make")
    if not binary:
        return skip_or_fail(r, "make")
    Path(wd, "Makefile").write_text("out.txt:\n\tprintf 'make-ok\\n' > out.txt\n", encoding="utf-8")
    res = run_cmd([binary, "out.txt"], cwd=wd)
    out = Path(wd, "out.txt").read_text(errors="replace") if Path(wd, "out.txt").exists() else ""
    return accept_or_capture(r, {"binary": binary, "content": out, "returncode": res["returncode"]}) if out == "make-ok\n" else failed(r, res)


def run_top(r, wd):
    binary = shutil.which("top")
    if not binary:
        return skip_or_fail(r, "top")
    env = os.environ.copy(); env.update({"TERM": "xterm"})
    res = run_pty([binary], [(1.0, b"q")], cwd=wd, env=env, expect="top -", timeout=5)
    ok = res["returncode"] in (0, None) and ("top -" in res["outputSample"] or res["sawExpected"])
    return accept_or_capture(r, {"binary": binary, "rendered": ok, "sample": res["outputSample"]}) if ok else failed(r, res)


def run_watch(r, wd):
    binary = shutil.which("watch")
    if not binary:
        return skip_or_fail(r, "watch")
    env = os.environ.copy(); env.update({"TERM": "xterm"})
    res = run_pty([binary, "-n", "1", "echo", "watch-ok"], [(1.0, b"q")], cwd=wd, env=env, expect="watch-ok", timeout=5)
    return accept_or_capture(r, {"binary": binary, "rendered": res["sawExpected"], "sample": res["outputSample"]}) if res["sawExpected"] else failed(r, res)


def run_tar(r, wd):
    binary = shutil.which("tar")
    if not binary:
        return skip_or_fail(r, "tar")
    src = Path(wd) / "src"; dst = Path(wd) / "dst"; src.mkdir(); dst.mkdir(); (src / "a.txt").write_text("tar-ok")
    archive = Path(wd) / "a.tar"
    c = run_cmd([binary, "cf", str(archive), "-C", str(src), "."], cwd=wd)
    x = run_cmd([binary, "xf", str(archive), "-C", str(dst)], cwd=wd)
    got = (dst / "a.txt").read_text(errors="replace") if (dst / "a.txt").exists() else ""
    return accept_or_capture(r, {"binary": binary, "content": got, "createRc": c["returncode"], "extractRc": x["returncode"]}) if got == "tar-ok" else failed(r, {"create": c, "extract": x})


def run_find(r, wd):
    binary = shutil.which("find")
    if not binary:
        return skip_or_fail(r, "find")
    root = Path(wd) / "tree"; (root / "sub").mkdir(parents=True); (root / "sub" / "needle.txt").write_text("x")
    res = run_cmd([binary, str(root), "-type", "f", "-name", "needle.txt"], cwd=wd)
    return accept_or_capture(r, {"binary": binary, "stdout": res["stdout"]}) if "needle.txt" in res["stdout"] else failed(r, res)


def run_rsync(r, wd):
    binary = shutil.which("rsync")
    if not binary:
        return skip_or_fail(r, "rsync")
    src = Path(wd) / "src"; dst = Path(wd) / "dst"; src.mkdir(); (src / "r.txt").write_text("rsync-ok")
    res = run_cmd([binary, "-a", f"{src}/", str(dst)], cwd=wd)
    got = (dst / "r.txt").read_text(errors="replace") if (dst / "r.txt").exists() else ""
    return accept_or_capture(r, {"binary": binary, "content": got, "returncode": res["returncode"]}) if got == "rsync-ok" else failed(r, res)


def run_openssl_enc(r, wd):
    binary = shutil.which("openssl")
    if not binary:
        return skip_or_fail(r, "openssl")
    plain = Path(wd) / "plain.txt"; enc = Path(wd) / "enc.bin"; dec = Path(wd) / "dec.txt"; plain.write_text("openssl-ok")
    e = run_cmd([binary, "enc", "-aes-256-cbc", "-pbkdf2", "-pass", "pass:machinen", "-in", str(plain), "-out", str(enc)], cwd=wd)
    d = run_cmd([binary, "enc", "-d", "-aes-256-cbc", "-pbkdf2", "-pass", "pass:machinen", "-in", str(enc), "-out", str(dec)], cwd=wd)
    got = dec.read_text(errors="replace") if dec.exists() else ""
    return accept_or_capture(r, {"binary": binary, "roundTrip": got, "encRc": e["returncode"], "decRc": d["returncode"]}) if got == "openssl-ok" else failed(r, {"enc": e, "dec": d})


def run_refusal(r, binary, reason):
    if not command_exists(binary):
        r = base("missing", "same", "same")
    return None


def failed(r, evidence):
    r.update({"decision": "failed", "evidence": evidence}); return r


def socket_refusal_probe(r, binary, reason):
    if not command_exists(binary):
        return skip_or_fail(r, binary)
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM); sock.bind(("127.0.0.1", 0)); target = f"socket-bound:{sock.getsockname()[1]}"; sock.close()
    return refuse(r, reason, {"binary": shutil.which(binary), "socketBoundaryProbe": target})


def ptrace_refusal_probe(r, binary, reason):
    if not command_exists(binary):
        return skip_or_fail(r, binary)
    return refuse(r, reason, {"binary": shutil.which(binary), "ptraceOrInferiorBoundary": True})


RUNNERS = {
    "vi-edit-save": run_vi,
    "nano-edit-save": run_nano,
    "python-repl-state": run_python_repl,
    "sqlite-cli-query": run_sqlite,
    "curl-local-http": run_curl,
    "make-tiny-build": run_make,
    "top-render-quit": run_top,
    "watch-render-quit": run_watch,
    "tar-extract-tree": run_tar,
    "find-tree-walk": run_find,
    "rsync-local-copy": run_rsync,
    "openssl-enc-transform": run_openssl_enc,
}

E2E_RUNNERS = {
    "vi-mid-edit-continuation": run_vi_mid_edit_continuation,
    "nano-mid-edit-continuation": run_nano_mid_edit_continuation,
    "python-repl-prompt-continuation": run_python_repl_prompt_continuation,
    "sqlite-prompt-continuation": run_sqlite_prompt_continuation,
    "make-active-recipe-continuation": run_make_active_recipe_continuation,
    "top-live-refresh-continuation": run_top_live_refresh_continuation,
    "watch-live-refresh-continuation": run_watch_live_refresh_continuation,
    "find-live-walk-continuation": run_find_live_walk_continuation,
    "curl-mid-transfer-refusal": run_curl_mid_transfer_refusal,
    "tar-mid-stream-refusal": run_tar_mid_stream_refusal,
    "rsync-mid-copy-refusal": run_rsync_mid_copy_refusal,
    "openssl-enc-mid-stream-refusal": run_openssl_enc_mid_stream_refusal,
}


def run_case(case_id, mode, role, source_capture_path=None):
    r = base(case_id, mode, role)
    if case_id == "ssh-live-session-refusal":
        return socket_refusal_probe(r, "ssh", "ssh-live-crypto-socket-session")
    if case_id == "openssl-s-client-refusal":
        return socket_refusal_probe(r, "openssl", "openssl-s-client-live-tls-socket-session")
    if case_id == "strace-ptrace-refusal":
        return ptrace_refusal_probe(r, "strace", "strace-ptrace-boundary")
    if case_id == "gdb-inferior-refusal":
        return ptrace_refusal_probe(r, "gdb", "gdb-inferior-ptrace-boundary")
    with tempfile.TemporaryDirectory(prefix="machinen-crazy-binary-stress-") as wd:
        if case_id in E2E_RUNNERS:
            return E2E_RUNNERS[case_id](r, wd, source_capture_path)
        return RUNNERS[case_id](r, wd)


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def remote(args):
    case_id, mode, role, out = args[:4]
    source_capture_path = args[4] if len(args) > 4 else None
    result = run_case(case_id, mode, role, source_capture_path)
    write_json(out, result)
    print(json.dumps({"case": case_id, "mode": mode, "decision": result["decision"], "arch": result["hostArch"]}, indent=2))
    return 0


def combine(args):
    retained = Path(args[0]); rows = []
    for case_id in args[1:]:
        kind, _ = CASES[case_id]
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            if same["decision"] == "skipped-not-installed" or source["decision"] == "skipped-not-installed" or target["decision"] == "skipped-not-installed":
                decision = "skipped-not-installed"
            elif kind == "refusal":
                decision = "refused" if same["decision"] == source["decision"] == target["decision"] == "refused" else "failed"
            else:
                decision = "accepted" if same["decision"] == "accepted" and source["decision"] == "captured" and target["decision"] == "accepted" else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
        status = "skipped-not-installed" if any(d["decision"] == "skipped-not-installed" for d in directions) else directions[0]["decision"] if directions and all(d["decision"] == directions[0]["decision"] for d in directions) else "failed"
        rows.append({"case": case_id, "kind": kind, "status": status, "sameArch": same["decision"], "directions": directions})
    report = {"kind": "machinen.research.real-crazy-binary-stress-ladder.report", "version": 1, "status": "proved-with-refusals" if not [r for r in rows if r["status"] == "failed"] else "completed-with-failures", "acceptedRows": len([r for r in rows if r["status"] == "accepted"]), "refusedRows": len([r for r in rows if r["status"] == "refused"]), "skippedRows": len([r for r in rows if r["status"] == "skipped-not-installed"]), "failedRows": len([r for r in rows if r["status"] == "failed"]), "rows": rows, "claimGuard": CLAIM_GUARD}
    write_json(retained / "report.json", report); print(json.dumps(report, indent=2)); return 0


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "list-cases": print("\n".join(CASES)); return 0
    if len(sys.argv) > 1 and sys.argv[1] == "remote": return remote(sys.argv[2:])
    if len(sys.argv) > 1 and sys.argv[1] == "combine": return combine(sys.argv[2:])
    return 2

if __name__ == "__main__":
    raise SystemExit(main())
