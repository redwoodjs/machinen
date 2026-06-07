#!/usr/bin/env python3
import ctypes
import ctypes.util
import fcntl
import hashlib
import json
import os
import select
import signal
import struct
import subprocess
import sys
import tempfile
import termios
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

PTRACE_TRACEME = 0
PTRACE_PEEKDATA = 2
PTRACE_POKEDATA = 5
PTRACE_CONT = 7
PTRACE_GETREGS = 12
PTRACE_ATTACH = 16
PTRACE_DETACH = 17
PTRACE_GETREGSET = 0x4204
NT_PRSTATUS = 1


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


class Aarch64UserRegs(ctypes.Structure):
    _fields_ = [
        ("regs", ctypes.c_ulonglong * 31),
        ("sp", ctypes.c_ulonglong),
        ("pc", ctypes.c_ulonglong),
        ("pstate", ctypes.c_ulonglong),
    ]


class Iovec(ctypes.Structure):
    _fields_ = [("iov_base", ctypes.c_void_p), ("iov_len", ctypes.c_size_t)]


def load_libc():
    path = ctypes.util.find_library("c")
    if path is None:
        raise RuntimeError("libc not found")
    library = ctypes.CDLL(path, use_errno=True)
    library.ptrace.argtypes = [ctypes.c_ulong, ctypes.c_ulong, ctypes.c_void_p, ctypes.c_void_p]
    library.ptrace.restype = ctypes.c_long
    return library


LIBC = load_libc()


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


def ptrace_peek_word(pid, address):
    ctypes.set_errno(0)
    value = LIBC.ptrace(PTRACE_PEEKDATA, pid, ctypes.c_void_p(address), None)
    errno = ctypes.get_errno()
    if value == -1 and errno != 0:
        raise OSError(errno, os.strerror(errno), "ptrace peek")
    return ctypes.c_ulong(value).value


def ptrace_poke_word(pid, address, value):
    ptrace(PTRACE_POKEDATA, pid, address, value)


def get_registers(pid):
    machine = os.uname().machine
    if machine == "x86_64":
        regs = X86_64UserRegs()
        ptrace(PTRACE_GETREGS, pid, 0, ctypes.byref(regs))
        values = {field: getattr(regs, field) for field, _ in regs._fields_}
        return {"arch": machine, "pc": regs.rip, "sp": regs.rsp, "values": values}
    if machine in ("aarch64", "arm64"):
        regs = Aarch64UserRegs()
        iov = Iovec(ctypes.cast(ctypes.pointer(regs), ctypes.c_void_p), ctypes.sizeof(regs))
        ptrace(PTRACE_GETREGSET, pid, NT_PRSTATUS, ctypes.byref(iov))
        values = {f"x{index}": regs.regs[index] for index in range(31)}
        values.update({"sp": regs.sp, "pc": regs.pc, "pstate": regs.pstate})
        return {"arch": machine, "pc": regs.pc, "sp": regs.sp, "values": values}
    raise RuntimeError(f"unsupported ptrace register architecture: {machine}")


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


def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()


def file_sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    candidates = [entry for entry in maps if entry["path"] and os.path.realpath(entry["path"]) == real_binary]
    if not candidates:
        raise RuntimeError(f"binary mapping not found: {binary_path}")
    return min(entry["start"] - entry["offset"] for entry in candidates)


def symbol_table(binary):
    symbols = []
    for line in run(["nm", "-an", binary]).splitlines():
        parts = line.split()
        if len(parts) < 3:
            continue
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
    return text_values[0] if text_values else value + 256


def build_id(binary):
    line = next((line.strip() for line in run(["readelf", "-n", binary]).splitlines() if "Build ID:" in line), None)
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
        "sha256": file_sha256(path),
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


def input_bytes():
    return ("\n".join(f"line-{index:03d}" for index in range(1, 120)) + "\n").encode()


def trace_me():
    ctypes.set_errno(0)
    result = LIBC.ptrace(PTRACE_TRACEME, 0, None, None)
    errno = ctypes.get_errno()
    if result == -1 and errno != 0:
        raise OSError(errno, os.strerror(errno), "ptrace TRACEME")


def continue_initial_trace_stops(proc):
    stops = []
    _, first_status = os.waitpid(proc.pid, 0)
    stops.append(wait_status_descriptor(first_status))
    ptrace(PTRACE_CONT, proc.pid, 0, 0)
    deadline = time.time() + 2
    while time.time() < deadline:
        pid, status = os.waitpid(proc.pid, os.WNOHANG)
        if pid == 0:
            time.sleep(0.05)
            continue
        stops.append(wait_status_descriptor(status))
        if os.WIFEXITED(status) or os.WIFSIGNALED(status):
            break
        ptrace(PTRACE_CONT, proc.pid, 0, 0)
    return stops


def launch_marker_less(binary, workdir, traced=True):
    data = input_bytes()
    input_path = Path(workdir) / "less-input.txt"
    input_path.write_bytes(data)
    master, slave = os.openpty()
    set_pty_size(slave)
    slave_path = os.ttyname(slave)
    env = os.environ.copy()
    env.update({"TERM": "xterm", "LESS": "-S", "MACHINEN_LESS_SPIN_AT_READY": "1"})

    def prepare_child():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)
        if traced:
            trace_me()

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
    initial_trace_stops = continue_initial_trace_stops(proc) if traced else []
    before = drain_output(master, time.time() + 4, "line-023")
    before += drain_output(master, time.time() + 0.5)
    return proc, master, slave_path, input_path, before, initial_trace_stops


def wait_status_descriptor(status):
    return {
        "raw": status,
        "stopped": os.WIFSTOPPED(status),
        "stopSignal": os.WSTOPSIG(status) if os.WIFSTOPPED(status) else None,
    }


def marker_capture(proc, binary, already_traced=True):
    if already_traced:
        os.kill(proc.pid, signal.SIGSTOP)
    else:
        ptrace(PTRACE_ATTACH, proc.pid)
    _, status = os.waitpid(proc.pid, 0)
    registers = get_registers(proc.pid)
    maps = parse_maps(proc.pid)
    symbols = symbol_table(binary)
    base = executable_base(maps, binary)
    marker_value = symbol_value(symbols, MARKER_SYMBOL)
    gate_value = symbol_value(symbols, GATE_SYMBOL)
    marker_start = base + marker_value
    marker_end = base + next_text_symbol_value(symbols, marker_value)
    gate_address = base + gate_value
    pc = registers["pc"]
    return {
        "ptraceStop": {"request": "PTRACE_ATTACH", "waitStatus": wait_status_descriptor(status)},
        "registers": registers,
        "maps": maps,
        "baseAddress": base,
        "symbols": {
            "marker": {"name": MARKER_SYMBOL, "linkAddress": marker_value, "runtimeStart": marker_start, "runtimeEnd": marker_end},
            "gate": {"name": GATE_SYMBOL, "linkAddress": gate_value, "runtimeAddress": gate_address},
            "pcInMarkerRange": marker_start <= pc < marker_end,
        },
    }


def set_marker_gate(pid, gate_address):
    word_size = ctypes.sizeof(ctypes.c_long)
    aligned = gate_address & ~(word_size - 1)
    shift = gate_address - aligned
    word = ptrace_peek_word(pid, aligned)
    mask = 0xFFFFFFFF << (shift * 8)
    new_word = (word & ~mask) | (1 << (shift * 8))
    ptrace_poke_word(pid, aligned, new_word)
    return {"alignedAddress": aligned, "oldWord": word, "newWord": new_word, "writtenGateValue": 1}


def maps_summary(maps, binary):
    return [entry for entry in maps if binary in entry["path"] or "libc" in entry["path"] or "ld-linux" in entry["path"] or "ld-musl" in entry["path"]]


def known_less_build_evidence(path):
    build_path = Path(path)
    if not build_path.exists():
        return {"available": False, "path": str(build_path)}
    return {"available": True, "path": str(build_path), "report": json.loads(build_path.read_text(encoding="utf-8"))}


def cleanup(proc, master_fd, attached=False):
    if attached:
        try:
            ptrace(PTRACE_DETACH, proc.pid, 0, 0)
        except OSError:
            pass
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


def capture_common(mode, role, binary, build_report_path):
    with tempfile.TemporaryDirectory(prefix="machinen-real-less-cross-arch-") as workdir:
        proc, master, slave_path, input_path, before, initial_trace_stops = launch_marker_less(binary, workdir)
        attached = False
        detached = False
        try:
            capture = marker_capture(proc, binary, already_traced=True)
            attached = True
            result = {
                "role": role,
                "hostArch": os.uname().machine,
                "knownLessBuild": known_less_build_evidence(build_report_path),
                "binary": {"path": binary, "versionLine": run([binary, "--version"]).splitlines()[0], "buildId": build_id(binary)},
                "process": {
                    "pid": proc.pid,
                    "initialTraceStops": initial_trace_stops,
                    "ptraceStop": capture["ptraceStop"],
                    "registers": capture["registers"],
                    "pc": capture["registers"]["pc"],
                    "sp": capture["registers"]["sp"],
                    "fds": fd_facts(proc.pid),
                },
                "symbols": capture["symbols"],
                "mapsSummary": maps_summary(capture["maps"], binary),
                "regularFile": file_identity(input_path),
                "pty": {
                    "slavePath": slave_path,
                    "rows": ROWS,
                    "cols": COLS,
                    "inputQueueBytesAtMarker": pty_bytes_available(master),
                },
                "pageDescriptor": {
                    "inputSha256": sha256_bytes(input_bytes()),
                    "expectedFirstPageStart": "line-001",
                    "expectedFirstPageEnd": "line-023",
                    "expectedAfterSpaceStart": "line-024",
                },
                "screenAtMarker": {"containsFirstPage": "line-001" in before and "line-023" in before, "sample": before[-1200:]},
                "claimGuard": CLAIM_GUARD,
            }
            if mode == "continue":
                gate_write = set_marker_gate(proc.pid, capture["symbols"]["gate"]["runtimeAddress"])
                ptrace(PTRACE_DETACH, proc.pid, 0, 0)
                detached = True
                attached = False
                time.sleep(0.1)
                os.write(master, b" ")
                after = drain_output(master, time.time() + 3, "line-024")
                after += drain_output(master, time.time() + 0.5)
                result["materialization"] = {
                    "method": "target-native marker less driven to same descriptor-defined page",
                    "sameFileContent": True,
                    "sameRowsCols": True,
                    "sameInitialPageExpectation": result["screenAtMarker"]["containsFirstPage"],
                    "sourceRegisterWrites": False,
                    "sourceHeapWrites": False,
                    "sourceStackWrites": False,
                }
                result["resume"] = {"gateWrite": gate_write, "detach": "PTRACE_DETACH", "injectedKey": "SPACE"}
                result["screenAfterResume"] = {"containsExpectedNextPage": "line-024" in after, "sample": after[-1200:]}
                result["decision"] = (
                    "accepted"
                    if result["symbols"]["pcInMarkerRange"]
                    and result["screenAtMarker"]["containsFirstPage"]
                    and result["screenAfterResume"]["containsExpectedNextPage"]
                    else "failed"
                )
            else:
                result["decision"] = "captured" if result["symbols"]["pcInMarkerRange"] and result["screenAtMarker"]["containsFirstPage"] else "failed"
                ptrace(PTRACE_DETACH, proc.pid, 0, 0)
                detached = True
                attached = False
            return result
        finally:
            cleanup(proc, master, attached and not detached)


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def remote_mode(args):
    if len(args) != 5:
        print("usage: remote <capture|continue> <role> <less-binary> <known-less-build-json> <output-json>", file=sys.stderr)
        return 2
    mode, role, binary, build_report_path, output = args
    if mode not in ("capture", "continue"):
        raise RuntimeError(f"unknown remote mode: {mode}")
    result = capture_common(mode, role, binary, build_report_path)
    write_json(output, result)
    print(json.dumps({"status": result["decision"], "role": role, "arch": result["hostArch"]}, indent=2))
    if result["decision"] == "failed":
        return 1
    return 0


def combine_mode(args):
    if len(args) != 5:
        print("usage: combine <direction> <source-json> <target-json> <output-json> <report-json>", file=sys.stderr)
        return 2
    direction, source_path, target_path, output_path, report_path = args
    source = json.loads(Path(source_path).read_text(encoding="utf-8"))
    target = json.loads(Path(target_path).read_text(encoding="utf-8"))
    success = (
        source["decision"] == "captured"
        and target["decision"] == "accepted"
        and source["pageDescriptor"]["inputSha256"] == target["pageDescriptor"]["inputSha256"]
        and source["pageDescriptor"]["expectedAfterSpaceStart"] == target["pageDescriptor"]["expectedAfterSpaceStart"]
        and source["hostArch"] != target["hostArch"]
    )
    combined = {
        "kind": "machinen.research.real-less-cross-arch-marker-continuation.direction",
        "version": 1,
        "direction": direction,
        "decision": "accepted" if success else "failed",
        "source": source,
        "target": target,
        "materializationSummary": {
            "targetNativeLess": True,
            "sameFileContent": source["pageDescriptor"]["inputSha256"] == target["pageDescriptor"]["inputSha256"],
            "sameRowsCols": source["pty"]["rows"] == target["pty"]["rows"] and source["pty"]["cols"] == target["pty"]["cols"],
            "sameInitialPageExpectation": source["screenAtMarker"]["containsFirstPage"] and target["screenAtMarker"]["containsFirstPage"],
            "sourceRegisterWrites": False,
            "sourceHeapWrites": False,
            "sourceStackWrites": False,
            "sourceIsaEmulationUsed": False,
        },
        "successAssertion": "source and target marker PCs verified; target-native less resumes after SPACE to expected next page",
        "claimGuard": CLAIM_GUARD,
    }
    write_json(output_path, combined)
    existing = {"directions": []}
    report = Path(report_path)
    if report.exists():
        existing = json.loads(report.read_text(encoding="utf-8"))
    directions = [item for item in existing.get("directions", []) if item.get("direction") != direction]
    directions.append({"direction": direction, "decision": combined["decision"], "sourceArch": source["hostArch"], "targetArch": target["hostArch"]})
    final_report = {
        "kind": "machinen.research.real-less-cross-arch-marker-continuation.report",
        "version": 1,
        "status": "passed" if directions and all(item["decision"] == "accepted" for item in directions) else "failed",
        "directions": sorted(directions, key=lambda item: item["direction"]),
        "claimGuard": CLAIM_GUARD,
    }
    write_json(report_path, final_report)
    print(json.dumps({"direction": direction, "decision": combined["decision"]}, indent=2))
    return 0 if success else 1


def main():
    if len(sys.argv) < 2:
        print("usage: real_less_cross_arch_marker_continuation.py <remote|combine> ...", file=sys.stderr)
        return 2
    mode = sys.argv[1]
    if mode == "remote":
        return remote_mode(sys.argv[2:])
    if mode == "combine":
        return combine_mode(sys.argv[2:])
    raise RuntimeError(f"unknown mode: {mode}")


if __name__ == "__main__":
    raise SystemExit(main())
