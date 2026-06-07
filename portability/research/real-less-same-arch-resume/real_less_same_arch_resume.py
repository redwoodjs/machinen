#!/usr/bin/env python3
import ctypes
import ctypes.util
import json
import os
import select
import signal
import struct
import subprocess
import sys
import termios
import fcntl
import tempfile
import time
from pathlib import Path

ROWS = 24
COLS = 80
MARKER_SYMBOL = "machinen_less_ready_before_input_marker"
GATE_SYMBOL = "machinen_less_ready_before_input_gate"
CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
}

PTRACE_ATTACH = 16
PTRACE_DETACH = 17
PTRACE_GETREGS = 12
PTRACE_PEEKDATA = 2
PTRACE_POKEDATA = 5


class X86_64UserRegs(ctypes.Structure):
    _fields_ = [
        ("r15", ctypes.c_ulonglong),
        ("r14", ctypes.c_ulonglong),
        ("r13", ctypes.c_ulonglong),
        ("r12", ctypes.c_ulonglong),
        ("rbp", ctypes.c_ulonglong),
        ("rbx", ctypes.c_ulonglong),
        ("r11", ctypes.c_ulonglong),
        ("r10", ctypes.c_ulonglong),
        ("r9", ctypes.c_ulonglong),
        ("r8", ctypes.c_ulonglong),
        ("rax", ctypes.c_ulonglong),
        ("rcx", ctypes.c_ulonglong),
        ("rdx", ctypes.c_ulonglong),
        ("rsi", ctypes.c_ulonglong),
        ("rdi", ctypes.c_ulonglong),
        ("orig_rax", ctypes.c_ulonglong),
        ("rip", ctypes.c_ulonglong),
        ("cs", ctypes.c_ulonglong),
        ("eflags", ctypes.c_ulonglong),
        ("rsp", ctypes.c_ulonglong),
        ("ss", ctypes.c_ulonglong),
        ("fs_base", ctypes.c_ulonglong),
        ("gs_base", ctypes.c_ulonglong),
        ("ds", ctypes.c_ulonglong),
        ("es", ctypes.c_ulonglong),
        ("fs", ctypes.c_ulonglong),
        ("gs", ctypes.c_ulonglong),
    ]


def libc():
    path = ctypes.util.find_library("c")
    if path is None:
        raise RuntimeError("libc not found")
    library = ctypes.CDLL(path, use_errno=True)
    library.ptrace.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p]
    library.ptrace.restype = ctypes.c_long
    return library


LIBC = libc()


def ptrace(request, pid, addr=0, data=0):
    ctypes.set_errno(0)
    result = LIBC.ptrace(
        request,
        pid,
        ctypes.c_void_p(addr),
        ctypes.c_void_p(data) if isinstance(data, int) else data,
    )
    errno = ctypes.get_errno()
    if result == -1 and errno != 0:
        raise OSError(errno, os.strerror(errno), f"ptrace request {request}")
    return result


def ptrace_getregs(pid):
    regs = X86_64UserRegs()
    ptrace(PTRACE_GETREGS, pid, 0, ctypes.byref(regs))
    return regs


def ptrace_peek_word(pid, address):
    ctypes.set_errno(0)
    value = LIBC.ptrace(PTRACE_PEEKDATA, pid, ctypes.c_void_p(address), None)
    errno = ctypes.get_errno()
    if value == -1 and errno != 0:
        raise OSError(errno, os.strerror(errno), "ptrace peek")
    return ctypes.c_ulong(value).value


def ptrace_poke_word(pid, address, value):
    ptrace(PTRACE_POKEDATA, pid, address, value)


def regs_to_dict(regs):
    return {field: getattr(regs, field) for field, _ in regs._fields_}


def run(command, cwd=None):
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(
            f"command failed ({result.returncode}): {' '.join(command)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result.stdout


def read_text(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


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


def parse_maps(pid):
    maps = []
    for line in read_text(f"/proc/{pid}/maps").splitlines():
        parts = line.split(maxsplit=5)
        if len(parts) < 5:
            continue
        start, end = [int(value, 16) for value in parts[0].split("-")]
        maps.append(
            {
                "start": start,
                "end": end,
                "perms": parts[1],
                "offset": int(parts[2], 16),
                "dev": parts[3],
                "inode": parts[4],
                "path": parts[5] if len(parts) == 6 else "",
            }
        )
    return maps


def executable_base(maps, binary_path):
    real_binary = os.path.realpath(binary_path)
    candidates = [entry for entry in maps if os.path.realpath(entry["path"]) == real_binary]
    if not candidates:
        raise RuntimeError(f"binary mapping not found: {binary_path}")
    return min(entry["start"] - entry["offset"] for entry in candidates)


def symbol_table(binary):
    lines = run(["nm", "-an", binary]).splitlines()
    symbols = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 3:
            try:
                value = int(parts[0], 16)
            except ValueError:
                continue
            symbols.append({"value": value, "type": parts[1], "name": parts[2]})
    return symbols


def symbol_value(symbols, name):
    for symbol in symbols:
        if symbol["name"] == name:
            return symbol["value"]
    raise RuntimeError(f"symbol not found: {name}")


def next_text_symbol_value(symbols, value):
    text_values = sorted(symbol["value"] for symbol in symbols if symbol["type"].upper() == "T" and symbol["value"] > value)
    if not text_values:
        return value + 256
    return text_values[0]


def build_id(binary):
    stdout = run(["readelf", "-n", binary])
    line = next((line.strip() for line in stdout.splitlines() if "Build ID:" in line), None)
    return {"available": line is not None, "line": line}


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


def pty_bytes_available(fd):
    return struct.unpack("I", fcntl.ioctl(fd, termios.FIONREAD, struct.pack("I", 0)))[0]


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


def launch_marker_less(binary, workdir):
    input_path = Path(workdir) / "less-input.txt"
    input_path.write_text("\n".join(f"line-{index:03d}" for index in range(1, 120)) + "\n", encoding="utf-8")
    master, slave = os.openpty()
    set_pty_size(slave)
    slave_path = os.ttyname(slave)
    env = os.environ.copy()
    env.update({"TERM": "xterm", "LESS": "-S", "MACHINEN_LESS_SPIN_AT_READY": "1"})

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
    before = drain_output(master, time.time() + 4, "line-023")
    before += drain_output(master, time.time() + 0.5)
    return proc, master, slave_path, input_path, before


def wait_for_marker_pc(proc, binary):
    ptrace(PTRACE_ATTACH, proc.pid)
    _, status = os.waitpid(proc.pid, 0)
    regs = ptrace_getregs(proc.pid)
    maps = parse_maps(proc.pid)
    symbols = symbol_table(binary)
    base = executable_base(maps, binary)
    marker_value = symbol_value(symbols, MARKER_SYMBOL)
    gate_value = symbol_value(symbols, GATE_SYMBOL)
    marker_start = base + marker_value
    marker_end = base + next_text_symbol_value(symbols, marker_value)
    gate_address = base + gate_value
    rip = regs.rip
    in_marker = marker_start <= rip < marker_end
    return {
        "waitStatus": status,
        "registers": regs,
        "maps": maps,
        "symbols": {
            "marker": {"name": MARKER_SYMBOL, "linkAddress": marker_value, "runtimeStart": marker_start, "runtimeEnd": marker_end},
            "gate": {"name": GATE_SYMBOL, "linkAddress": gate_value, "runtimeAddress": gate_address},
            "pcInMarkerRange": in_marker,
        },
        "baseAddress": base,
    }


def set_marker_gate(pid, gate_address):
    aligned = gate_address & ~(ctypes.sizeof(ctypes.c_long) - 1)
    shift = gate_address - aligned
    word = ptrace_peek_word(pid, aligned)
    mask = 0xFFFFFFFF << (shift * 8)
    new_word = (word & ~mask) | (1 << (shift * 8))
    ptrace_poke_word(pid, aligned, new_word)
    return {"alignedAddress": aligned, "oldWord": word, "newWord": new_word, "writtenGateValue": 1}


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


def known_less_build_evidence(retained_dir):
    path = retained_dir / "known-less-build.json"
    if not path.exists():
        return {"available": False, "path": str(path)}
    return {"available": True, "path": str(path), "report": json.loads(path.read_text(encoding="utf-8"))}


def wait_status_descriptor(status):
    return {
        "raw": status,
        "stopped": os.WIFSTOPPED(status),
        "stopSignal": os.WSTOPSIG(status) if os.WIFSTOPPED(status) else None,
    }


def proof(binary, retained_dir):
    if os.uname().machine != "x86_64":
        raise RuntimeError(f"same-arch resume proof currently expects x86_64, got {os.uname().machine}")
    with tempfile.TemporaryDirectory(prefix="machinen-real-less-resume-") as workdir:
        proc, master, slave_path, input_path, before = launch_marker_less(binary, workdir)
        detached = False
        try:
            capture = wait_for_marker_pc(proc, binary)
            regs = capture["registers"]
            gate_write = set_marker_gate(proc.pid, capture["symbols"]["gate"]["runtimeAddress"])
            ptrace(PTRACE_DETACH, proc.pid, 0, 0)
            detached = True
            time.sleep(0.1)
            os.write(master, b" ")
            after = drain_output(master, time.time() + 3, "line-024")
            after += drain_output(master, time.time() + 0.5)
            success = capture["symbols"]["pcInMarkerRange"] and "line-024" in after
            report_capture = {
                "kind": "machinen.research.real-less-same-arch-resume.capture",
                "version": 1,
                "decision": "accepted" if success else "failed",
                "hostArch": os.uname().machine,
                "knownLessBuild": known_less_build_evidence(retained_dir),
                "binary": {
                    "path": binary,
                    "versionLine": run([binary, "--version"]).splitlines()[0],
                    "buildId": build_id(binary),
                },
                "process": {
                    "pid": proc.pid,
                    "ptraceStop": {"request": "PTRACE_ATTACH", "waitStatus": wait_status_descriptor(capture["waitStatus"])},
                    "registers": regs_to_dict(regs),
                    "pc": regs.rip,
                    "sp": regs.rsp,
                    "fds": fd_facts(proc.pid),
                },
                "symbols": capture["symbols"],
                "mapsSummary": [
                    entry for entry in capture["maps"] if binary in entry["path"] or "libc" in entry["path"] or "ld-linux" in entry["path"]
                ],
                "regularFile": file_identity(input_path),
                "pty": {
                    "slavePath": slave_path,
                    "rows": ROWS,
                    "cols": COLS,
                    "inputQueueBytesBeforeResume": pty_bytes_available(master),
                },
                "screenBeforeResume": {"containsFirstPage": "line-001" in before and "line-023" in before, "sample": before[-1200:]},
                "resume": {
                    "gateWrite": gate_write,
                    "detach": "PTRACE_DETACH",
                    "injectedKey": "SPACE",
                },
                "screenAfterResume": {"containsExpectedNextPage": "line-024" in after, "sample": after[-1200:]},
                "successAssertion": "marker PC verified and SPACE advances to expected next page",
                "claimGuard": CLAIM_GUARD,
            }
            (retained_dir / "capture.json").write_text(json.dumps(report_capture, indent=2) + "\n", encoding="utf-8")
            report = {
                "kind": "machinen.research.real-less-same-arch-resume.report",
                "version": 1,
                "status": "passed" if success else "failed",
                "hostArch": os.uname().machine,
                "accepted": ["marker-safe-point-ptrace-resume-space"] if success else [],
                "claimGuard": CLAIM_GUARD,
            }
            (retained_dir / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
            print(json.dumps(report, indent=2))
            if not success:
                raise RuntimeError("same-arch resume proof failed")
        finally:
            if not detached:
                try:
                    ptrace(PTRACE_DETACH, proc.pid, 0, 0)
                except OSError:
                    pass
            cleanup(proc, master)


def main():
    if len(sys.argv) != 3:
        print("usage: real_less_same_arch_resume.py <marker-less-binary> <retained-dir>", file=sys.stderr)
        return 2
    retained_dir = Path(sys.argv[2])
    retained_dir.mkdir(parents=True, exist_ok=True)
    proof(sys.argv[1], retained_dir)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
