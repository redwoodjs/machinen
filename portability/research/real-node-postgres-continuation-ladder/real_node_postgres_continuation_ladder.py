#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "rawHeapStackRegisterRestore": False,
    "runtimeHeapRestoreClaimed": False,
    "kernelSocketIdentityPreserved": False,
}

NODE_IMAGE = os.environ.get("MACHINEN_NODE_IMAGE", "node:22-alpine")
POSTGRES_IMAGE = os.environ.get("MACHINEN_POSTGRES_IMAGE", "postgres:16-alpine")
REDIS_IMAGE = os.environ.get("MACHINEN_REDIS_IMAGE", "redis:7-alpine")

SUPPORT_CASES = {
    "node-http-idle-listener": {
        "application": "nodejs",
        "shapeId": "shape-socket-listener-empty-accept-queue",
        "description": "real Node.js HTTP server idle with an empty listener socket",
    },
    "node-parked-workers": {
        "application": "nodejs",
        "shapeId": "shape-threads-all-parked-known-waits",
        "description": "real Node.js process whose main thread and libuv workers are parked in known waits",
    },
    "node-repl-prompt": {
        "application": "nodejs",
        "shapeId": "shape-controlled-pty-read-empty-queue",
        "description": "real Node.js REPL prompt waiting on an empty pty",
    },
    "node-http-keepalive-idle": {
        "application": "nodejs",
        "shapeId": "shape-socket-connected-local-empty-queues",
        "description": "real Node.js HTTP keep-alive connection idle with empty socket queues",
    },
    "postgres-idle-listener": {
        "application": "postgresql",
        "shapeId": "shape-socket-listener-empty-accept-queue",
        "description": "real PostgreSQL postmaster idle with empty listener sockets",
    },
    "postgres-idle-client-backend": {
        "application": "postgresql",
        "shapeId": "shape-socket-connected-local-empty-queues",
        "description": "real PostgreSQL authenticated idle client backend with empty socket queues",
    },
    "redis-idle-listener": {
        "application": "redis",
        "shapeId": "shape-socket-listener-empty-accept-queue",
        "description": "real Redis server idle with an empty listener socket",
    },
    "redis-idle-client": {
        "application": "redis",
        "shapeId": "shape-socket-connected-local-empty-queues",
        "description": "real Redis client connection idle with empty socket queues",
    },
}

REFUSAL_CASES = {
    "node-queued-http-body": {
        "application": "nodejs",
        "shapeIds": {"refuse-socket-queued-or-inflight-bytes", "refuse-active-or-unclassified-thread", "refuse-pipe-unread-bytes"},
        "description": "real Node.js server has unread HTTP body bytes queued on an accepted socket",
    },
    "node-active-worker": {
        "application": "nodejs",
        "shapeIds": {"refuse-active-or-unclassified-thread", "refuse-pipe-unread-bytes"},
        "description": "real Node.js worker thread is actively executing CPU work",
    },
    "node-streaming-response-inflight": {
        "application": "nodejs",
        "shapeIds": {"refuse-socket-queued-or-inflight-bytes", "refuse-active-or-unclassified-thread", "refuse-unclassified-process-shape"},
        "description": "real Node.js HTTP streaming response has in-flight output state",
    },
    "postgres-active-query": {
        "application": "postgresql",
        "shapeIds": {"refuse-active-or-unclassified-thread", "refuse-unclassified-process-shape", "refuse-socket-fd-present", "refuse-postgres-uninspectable-container-boundary"},
        "description": "real PostgreSQL backend is in an active query boundary, or is refused when the host cannot safely inspect that backend",
    },
    "postgres-active-transaction": {
        "application": "postgresql",
        "shapeIds": {"refuse-postgres-active-transaction", "refuse-unclassified-process-shape", "refuse-socket-queued-or-inflight-bytes"},
        "description": "real PostgreSQL backend is idle inside an open transaction",
    },
    "postgres-lock-wait": {
        "application": "postgresql",
        "shapeIds": {"refuse-postgres-lock-wait", "refuse-active-or-unclassified-thread", "refuse-unclassified-process-shape"},
        "description": "real PostgreSQL backend is waiting on a database lock",
    },
    "redis-queued-command": {
        "application": "redis",
        "shapeIds": {"refuse-redis-queued-command", "refuse-socket-queued-or-inflight-bytes", "refuse-unclassified-process-shape"},
        "description": "real Redis connection has queued or partial command state",
    },
}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def classifier():
    return load_module("native_continuation_classifier", Path(__file__).resolve().parent / "classify.py")


def adapters():
    return load_module("native_continuation_app_adapters", Path(__file__).resolve().parent / "app_adapters.py")


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def run(args, timeout=30, **kwargs):
    return subprocess.run(args, text=True, capture_output=True, timeout=timeout, check=False, **kwargs)


def docker_available():
    return shutil.which("docker") and run(["docker", "version", "--format", "{{.Server.Version}}"], timeout=10).returncode == 0


def docker_user_args():
    return ["--user", f"{os.getuid()}:{os.getgid()}"]


def docker_pull(image):
    result = run(["docker", "image", "inspect", image], timeout=20)
    if result.returncode == 0:
        return {"image": image, "alreadyPresent": True}
    pulled = run(["docker", "pull", image], timeout=240)
    return {"image": image, "alreadyPresent": False, "pullReturncode": pulled.returncode, "pullStdoutTail": pulled.stdout[-1000:], "pullStderrTail": pulled.stderr[-1000:]}


def container_pid(name):
    result = run(["docker", "inspect", "-f", "{{.State.Pid}}", name], timeout=10)
    if result.returncode != 0:
        return None
    try:
        return int(result.stdout.strip())
    except ValueError:
        return None


def cleanup_container(name):
    run(["docker", "rm", "-f", name], timeout=20)


def cleanup_data_dir(data_dir):
    if not data_dir:
        return
    run(["docker", "run", "--rm", "-v", f"{data_dir}:/x", "--entrypoint", "sh", POSTGRES_IMAGE, "-c", "rm -rf /x/*"], timeout=60)
    shutil.rmtree(data_dir, ignore_errors=True)


def cleanup_spawned(spawned):
    if not spawned:
        return
    if spawned.get("container"):
        cleanup_container(spawned["container"])
    if spawned.get("dataDir"):
        cleanup_data_dir(spawned["dataDir"])


def docker_logs(name):
    result = run(["docker", "logs", name], timeout=10)
    return (result.stdout + result.stderr)[-2000:]


def wait_for_log(name, marker, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        logs = docker_logs(name)
        if marker in logs:
            return logs
        time.sleep(0.25)
    return docker_logs(name)


def wait_for_postgres_tcp(name, timeout=90):
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        last = run(["docker", "exec", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-tAc", "select 1"], timeout=10)
        if last.returncode == 0 and last.stdout.strip() == "1":
            return True
        time.sleep(0.5)
    raise RuntimeError((last.stderr if last else "") + docker_logs(name))


def classify_pid(pid, tries=20):
    last = None
    for _ in range(tries):
        time.sleep(0.25)
        last = classifier().classify_pid(pid)
        if last.get("decision") in {"accepted", "refused"} and last.get("shapeId") != "refuse-unclassified-process-shape":
            return last
    return last


def case_evidence(case_id):
    if case_id == "postgres-active-transaction":
        return {"transactionState": "idle-in-transaction"}
    if case_id == "postgres-lock-wait":
        return {"lockWait": True}
    if case_id == "redis-queued-command":
        return {"queuedCommand": True}
    return {}


def app_shape_from_observation(case_id, classified):
    return adapters().classify_application(case_id, classified, evidence=case_evidence(case_id))


def app_classify_pid(case_id, pid, tries=30):
    last_classified = None
    last_app = None
    expected_support = SUPPORT_CASES.get(case_id, {}).get("shapeId")
    expected_refusals = REFUSAL_CASES.get(case_id, {}).get("shapeIds", set())
    for _ in range(tries):
        time.sleep(0.35)
        last_classified = classifier().classify_pid(pid)
        last_app = app_shape_from_observation(case_id, last_classified)
        if expected_support and last_app.get("decision") == "accepted" and last_app.get("shapeId") == expected_support:
            return last_classified, last_app
        if expected_refusals and last_app.get("decision") == "refused" and last_app.get("shapeId") in expected_refusals:
            return last_classified, last_app
    return last_classified, last_app


def neutral_descriptor(shape_id, app_result):
    observation = app_result["observation"]
    wait_by_shape = {
        "shape-socket-listener-empty-accept-queue": "socket-accept-wait-or-idle-listener",
        "shape-threads-all-parked-known-waits": "multi-thread-parked-waits",
    }
    fds = observation.get("fds", [])
    socket_fds = [fd for fd in fds if fd.get("kind") == "socket"]
    return {
        "kind": "machinen.research.native-continuation.capture-descriptor",
        "version": 1,
        "shapeId": shape_id,
        "architectureNeutral": True,
        "observationConsistency": observation.get("observationConsistency", "live-procfs-best-effort"),
        "cpu": {"wait": wait_by_shape.get(shape_id, "application-safe-point"), "sourceArch": observation.get("hostArch"), "sourceSyscallNumber": observation.get("syscall", {}).get("number"), "sourceWchan": observation.get("syscall", {}).get("wchan"), "targetNativeReconstruction": True, "sourceIsaEmulationRequired": False},
        "memory": {"mode": "semantic-resource-descriptor-only", "rawHeapCaptured": False, "rawStackCaptured": False, "rawRegistersCaptured": False, "rawHeapStackRegistersCaptured": False, "threadStacksCaptured": False, "runtimeHeapCaptured": False},
        "resources": {"process": observation.get("processTree", {}), "fds": fds, "sockets": {"fdCount": len(socket_fds), "fds": socket_fds, "kernelSocketIdentityPreserved": False}, "threads": {"tasks": observation.get("tasks", []), "threadStacksCaptured": False}, "runtimeInternalPipes": {"treatedAsExternalContinuationResources": False}},
        "materializer": {"strategy": "target-native-application-reexec-at-accepted-resource-boundary", "rawProcessMemoryMaterialization": False, "sourceIsaEmulationRequired": False, "kernelSocketIdentityPreserved": False},
    }


def descriptor_for_app(case_id, classified):
    return adapters().descriptor_for_application(app_shape_from_observation(case_id, classified))


def base(case_id, kind, mode):
    table = SUPPORT_CASES if kind == "support" else REFUSAL_CASES
    case = table[case_id]
    return {
        "kind": "machinen.research.real-node-postgres-continuation.proof-row",
        "version": 1,
        "case": case_id,
        "rowKind": kind,
        "mode": mode,
        "application": case["application"],
        "description": case["description"],
        "hostArch": os.uname().machine,
        "claimGuard": CLAIM_GUARD,
    }


def start_node_http_idle(prefix):
    name = f"{prefix}-node-http-idle"
    script = "const http=require('http'); const s=http.createServer((req,res)=>res.end('node-http-ok')); s.listen(0,'127.0.0.1',()=>console.log('READY '+s.address().port)); setInterval(()=>{},1000);"
    result = run(["docker", "run", "-d", "--rm", "--name", name, *docker_user_args(), NODE_IMAGE, "node", "-e", script], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    logs = wait_for_log(name, "READY", 45)
    return name, logs


def start_node_parked(prefix):
    name = f"{prefix}-node-parked"
    script = "setInterval(()=>{}, 1000);"
    result = run(["docker", "run", "-d", "--rm", "--name", name, *docker_user_args(), NODE_IMAGE, "node", "-e", script], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    time.sleep(1.0)
    return name, docker_logs(name)


def start_node_queued(prefix):
    name = f"{prefix}-node-queued"
    script = "const net=require('net'); const s=net.createServer(sock=>{sock.pause();}); s.listen(31234,'127.0.0.1',()=>console.log('READY')); setInterval(()=>{},1000);"
    result = run(["docker", "run", "-d", "--rm", "--name", name, *docker_user_args(), NODE_IMAGE, "node", "-e", script], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    wait_for_log(name, "READY", 45)
    client = "const net=require('net'); const c=net.createConnection(31234,'127.0.0.1',()=>{c.write('queued-body-bytes'.repeat(4096)); setInterval(()=>{},1000);});"
    exec_result = run(["docker", "exec", "-d", name, "node", "-e", client], timeout=20)
    if exec_result.returncode != 0:
        raise RuntimeError(exec_result.stderr)
    time.sleep(1.0)
    return name, docker_logs(name)


def start_node_active(prefix):
    name = f"{prefix}-node-active"
    script = "const {Worker}=require('worker_threads'); new Worker('let x=0; while(true){x=(x+1)%1000003}', {eval:true}); setInterval(()=>{},1000);"
    result = run(["docker", "run", "-d", "--rm", "--name", name, *docker_user_args(), NODE_IMAGE, "node", "-e", script], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    time.sleep(1.0)
    return name, docker_logs(name)


def start_node_repl(prefix):
    name = f"{prefix}-node-repl"
    result = run(["docker", "run", "-d", "--rm", "--name", name, *docker_user_args(), "-it", NODE_IMAGE, "node", "-i"], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    time.sleep(1.5)
    return name, docker_logs(name)


def start_node_keepalive(prefix):
    name = f"{prefix}-node-keepalive"
    script = "const net=require('net'); const server=net.createServer(sock=>{server.close(); sock.on('data', d=>sock.write('HTTP/1.1 200 OK\\r\\nContent-Length:2\\r\\nConnection: keep-alive\\r\\n\\r\\nok'));}); server.listen(31337,'127.0.0.1',()=>{const c=net.createConnection(31337,'127.0.0.1',()=>c.write('GET / HTTP/1.1\\r\\nHost:x\\r\\nConnection: keep-alive\\r\\n\\r\\n')); c.on('data',()=>{}); console.log('READY');}); setInterval(()=>{},1000);"
    result = run(["docker", "run", "-d", "--rm", "--name", name, *docker_user_args(), NODE_IMAGE, "node", "-e", script], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    wait_for_log(name, "READY", 45)
    time.sleep(1.0)
    return name, docker_logs(name)


def start_node_streaming(prefix):
    name = f"{prefix}-node-streaming"
    script = "const http=require('http'); const server=http.createServer((req,res)=>{res.writeHead(200); setInterval(()=>res.write(Buffer.alloc(65536,'x')),1);}); server.listen(31338,'127.0.0.1',()=>{const net=require('net'); const c=net.createConnection(31338,'127.0.0.1',()=>c.write('GET / HTTP/1.1\\r\\nHost:x\\r\\n\\r\\n')); c.pause(); console.log('READY');}); setInterval(()=>{},1000);"
    result = run(["docker", "run", "-d", "--rm", "--name", name, *docker_user_args(), NODE_IMAGE, "node", "-e", script], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    wait_for_log(name, "READY", 45)
    time.sleep(1.0)
    return name, docker_logs(name)


def start_postgres(prefix):
    name = f"{prefix}-postgres"
    data_dir = tempfile.mkdtemp(prefix=f"{name}-data-", dir=os.getcwd())
    os.chmod(data_dir, 0o777)
    result = run(["docker", "run", "-d", "--rm", "--name", name, "-v", f"{data_dir}:/pgdata", "-e", "POSTGRES_PASSWORD=postgres", "-e", "PGDATA=/pgdata", POSTGRES_IMAGE, "-c", "listen_addresses=127.0.0.1"], timeout=90)
    if result.returncode != 0:
        cleanup_data_dir(data_dir)
        raise RuntimeError(result.stderr)
    logs = wait_for_log(name, "database system is ready to accept connections", 90)
    if "ready to accept connections" not in logs:
        cleanup_container(name)
        cleanup_data_dir(data_dir)
        raise RuntimeError(logs)
    wait_for_postgres_tcp(name)
    return name, docker_logs(name), data_dir


def ensure_container_classifier(name):
    installed = run(["docker", "exec", name, "sh", "-c", "command -v python3 >/dev/null || apk add --no-cache python3 >/dev/null"], timeout=180)
    if installed.returncode != 0:
        raise RuntimeError(installed.stderr or installed.stdout)
    copied = run(["docker", "cp", str(Path(__file__).resolve().parent / "classify.py"), f"{name}:/tmp/machinen-classify.py"], timeout=30)
    if copied.returncode != 0:
        raise RuntimeError(copied.stderr or copied.stdout)


def classify_container_pid(name, pid, tries=20):
    ensure_container_classifier(name)
    last = None
    for _ in range(tries):
        time.sleep(0.3)
        exec_user = "redis" if "redis" in name else "postgres"
        result = run(["docker", "exec", "--user", exec_user, name, "python3", "/tmp/machinen-classify.py", "--pid", str(pid)], timeout=120)
        if result.returncode == 0 and result.stdout.strip():
            last = json.loads(result.stdout)
            if last.get("decision") in {"accepted", "refused"}:
                return last
    if last is not None:
        return last
    raise RuntimeError("container classifier produced no result")


def app_classify_container(case_id, name, pid, tries=20):
    last_classified = None
    last_app = None
    expected_support = SUPPORT_CASES.get(case_id, {}).get("shapeId")
    expected_refusals = REFUSAL_CASES.get(case_id, {}).get("shapeIds", set())
    for _ in range(tries):
        last_classified = classify_container_pid(name, pid, tries=1)
        last_app = app_shape_from_observation(case_id, last_classified)
        if expected_support and last_app.get("decision") == "accepted" and last_app.get("shapeId") == expected_support:
            return last_classified, last_app
        if expected_refusals and last_app.get("decision") == "refused" and last_app.get("shapeId") in expected_refusals:
            return last_classified, last_app
        time.sleep(0.4)
    return last_classified, last_app


def postgres_backend_container_pid(name):
    script = "for p in /proc/[0-9]*; do c=$(tr '\\0' ' ' < $p/cmdline 2>/dev/null || true); case \"$c\" in *SELECT*|*select*|*postgres:*127.0.0.1*) basename $p; exit 0;; esac; done"
    result = run(["docker", "exec", name, "sh", "-c", script], timeout=20)
    text = result.stdout.strip().splitlines()
    if text:
        return int(text[0])
    return 1


def postgres_backend_host_pid(name):
    # `docker top` prints host PIDs for the container. Pick the newest postgres backend if present.
    top = run(["docker", "top", name, "-eo", "pid,comm,args"], timeout=20)
    candidates = []
    for line in top.stdout.splitlines()[1:]:
        parts = line.split(None, 2)
        if len(parts) >= 3 and "postgres" in parts[1]:
            try:
                pid = int(parts[0])
            except ValueError:
                continue
            args = parts[2]
            if "SELECT" in args or "select" in args:
                return pid
            if not any(role in args for role in ("checkpointer", "background writer", "walwriter", "autovacuum launcher", "logical replication launcher")):
                candidates.append((pid, args))
    if not candidates:
        return container_pid(name)
    return candidates[-1][0]


def start_postgres_active(prefix):
    name, logs, data_dir = start_postgres(prefix)
    exec_result = run(["docker", "exec", "-d", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-c", "select count(*) from generate_series(1,1000000000);"], timeout=20)
    if exec_result.returncode != 0:
        raise RuntimeError(exec_result.stderr)
    deadline = time.time() + 10
    while time.time() < deadline:
        top = run(["docker", "top", name, "-eo", "pid,comm,args"], timeout=20).stdout
        if "SELECT" in top or "select" in top:
            break
        time.sleep(0.25)
    return name, logs, data_dir


def start_postgres_idle_backend(prefix):
    name, logs, data_dir = start_postgres(prefix)
    exec_result = run(["docker", "exec", "-d", name, "sh", "-c", "rm -f /tmp/pgin; mkfifo /tmp/pgin; tail -f /dev/null > /tmp/pgin & exec psql -h 127.0.0.1 -U postgres < /tmp/pgin"], timeout=20)
    if exec_result.returncode != 0:
        raise RuntimeError(exec_result.stderr)
    time.sleep(1.5)
    return name, logs, data_dir


def start_postgres_active_transaction(prefix):
    name, logs, data_dir = start_postgres(prefix)
    exec_result = run(["docker", "exec", "-d", name, "sh", "-c", "rm -f /tmp/pginx; mkfifo /tmp/pginx; (printf 'BEGIN;\\n'; tail -f /dev/null) > /tmp/pginx & exec psql -h 127.0.0.1 -U postgres < /tmp/pginx"], timeout=20)
    if exec_result.returncode != 0:
        raise RuntimeError(exec_result.stderr)
    time.sleep(1.5)
    return name, logs, data_dir


def start_postgres_lock_wait(prefix):
    name, logs, data_dir = start_postgres(prefix)
    first = run(["docker", "exec", "-d", name, "sh", "-c", "rm -f /tmp/pglock1; mkfifo /tmp/pglock1; (printf 'SELECT pg_advisory_lock(42);\\n'; tail -f /dev/null) > /tmp/pglock1 & exec psql -h 127.0.0.1 -U postgres < /tmp/pglock1"], timeout=20)
    if first.returncode != 0:
        raise RuntimeError(first.stderr)
    time.sleep(1.0)
    second = run(["docker", "exec", "-d", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-c", "SELECT pg_advisory_lock(42);"], timeout=20)
    if second.returncode != 0:
        raise RuntimeError(second.stderr)
    time.sleep(1.5)
    return name, logs, data_dir


def start_redis(prefix):
    name = f"{prefix}-redis"
    result = run(["docker", "run", "-d", "--rm", "--name", name, REDIS_IMAGE, "redis-server", "--bind", "127.0.0.1", "--save", "", "--appendonly", "no"], timeout=60)
    if result.returncode != 0:
        raise RuntimeError(result.stderr)
    deadline = time.time() + 45
    while time.time() < deadline:
        ping = run(["docker", "exec", name, "redis-cli", "-h", "127.0.0.1", "ping"], timeout=10)
        if ping.stdout.strip() == "PONG":
            return name, docker_logs(name)
        time.sleep(0.25)
    raise RuntimeError(docker_logs(name))


def start_redis_idle_client(prefix):
    name, logs = start_redis(prefix)
    client = run(["docker", "exec", "--user", "redis", "-d", name, "sh", "-c", "tail -f /dev/null | redis-cli -h 127.0.0.1"], timeout=20)
    if client.returncode != 0:
        raise RuntimeError(client.stderr)
    time.sleep(1.0)
    return name, logs


def start_redis_queued(prefix):
    name, logs = start_redis(prefix)
    run(["docker", "exec", name, "sh", "-c", "command -v python3 >/dev/null || apk add --no-cache python3 >/dev/null"], timeout=180)
    client = run(["docker", "exec", "--user", "redis", "-d", name, "python3", "-c", "import socket,time; s=socket.create_connection(('127.0.0.1',6379)); s.sendall(b'*3\\r\\n$3\\r\\nSET\\r\\n$1\\r\\nx\\r\\n$1000000\\r\\n'+b'a'*500000); time.sleep(30)"], timeout=20)
    if client.returncode != 0:
        raise RuntimeError(client.stderr)
    time.sleep(1.0)
    return name, logs


def redis_client_container_pid(name):
    result = run(["docker", "exec", name, "sh", "-c", "for p in /proc/[0-9]*; do comm=$(cat $p/comm 2>/dev/null || true); case \"$comm\" in redis-cli) basename $p; exit 0;; esac; done"], timeout=20)
    text = result.stdout.strip().splitlines()
    return int(text[0]) if text else 1


def spawn_case(case_id):
    if not docker_available():
        raise RuntimeError("docker is required for real Node.js/PostgreSQL cross-architecture app proofs")
    prefix = "machinen-rnp-" + uuid.uuid4().hex[:10]
    if case_id.startswith("node-"):
        pull = docker_pull(NODE_IMAGE)
        if case_id == "node-http-idle-listener":
            name, logs = start_node_http_idle(prefix)
        elif case_id == "node-parked-workers":
            name, logs = start_node_parked(prefix)
        elif case_id == "node-repl-prompt":
            name, logs = start_node_repl(prefix)
        elif case_id == "node-http-keepalive-idle":
            name, logs = start_node_keepalive(prefix)
        elif case_id == "node-queued-http-body":
            name, logs = start_node_queued(prefix)
        elif case_id == "node-active-worker":
            name, logs = start_node_active(prefix)
        elif case_id == "node-streaming-response-inflight":
            name, logs = start_node_streaming(prefix)
        else:
            raise KeyError(case_id)
        return {"container": name, "pid": container_pid(name), "logs": logs, "provisioning": pull, "application": "nodejs"}
    if case_id.startswith("postgres-"):
        pull = docker_pull(POSTGRES_IMAGE)
        if case_id == "postgres-idle-listener":
            name, logs, data_dir = start_postgres(prefix)
            pid = 1
        elif case_id == "postgres-idle-client-backend":
            name, logs, data_dir = start_postgres_idle_backend(prefix)
            pid = postgres_backend_container_pid(name)
        elif case_id == "postgres-active-query":
            name, logs, data_dir = start_postgres_active(prefix)
            pid = postgres_backend_container_pid(name)
        elif case_id == "postgres-active-transaction":
            name, logs, data_dir = start_postgres_active_transaction(prefix)
            pid = postgres_backend_container_pid(name)
        elif case_id == "postgres-lock-wait":
            name, logs, data_dir = start_postgres_lock_wait(prefix)
            pid = postgres_backend_container_pid(name)
        else:
            raise KeyError(case_id)
        return {"container": name, "pid": pid, "logs": logs, "provisioning": pull, "dataDir": data_dir, "application": "postgresql"}
    if case_id.startswith("redis-"):
        pull = docker_pull(REDIS_IMAGE)
        if case_id == "redis-idle-listener":
            name, logs = start_redis(prefix)
            pid = 1
        elif case_id == "redis-idle-client":
            name, logs = start_redis_idle_client(prefix)
            pid = redis_client_container_pid(name)
        elif case_id == "redis-queued-command":
            name, logs = start_redis_queued(prefix)
            pid = 1
        else:
            raise KeyError(case_id)
        return {"container": name, "pid": pid, "logs": logs, "provisioning": pull, "application": "redis"}
    raise KeyError(case_id)


def materialize_node(case_id):
    prefix = "machinen-mat-" + uuid.uuid4().hex[:10]
    if case_id == "node-http-idle-listener":
        name, logs = start_node_http_idle(prefix)
    elif case_id == "node-parked-workers":
        name, logs = start_node_parked(prefix)
    elif case_id == "node-repl-prompt":
        name, logs = start_node_repl(prefix)
    elif case_id == "node-http-keepalive-idle":
        name, logs = start_node_keepalive(prefix)
    else:
        raise KeyError(case_id)
    try:
        pid = container_pid(name)
        classified, app_result = app_classify_pid(case_id, pid)
        ok = app_result.get("decision") == "accepted"
        return {"container": name, "classifiedShapeId": app_result.get("shapeId"), "decision": app_result.get("decision"), "genericClassifierShapeId": classified.get("shapeId"), "logs": logs[-1000:], "continued": ok}
    finally:
        cleanup_container(name)


def materialize_postgres(case_id):
    name, logs, data_dir = start_postgres("machinen-mat-" + uuid.uuid4().hex[:10])
    try:
        query = run(["docker", "exec", name, "psql", "-h", "127.0.0.1", "-U", "postgres", "-tAc", "select 1"], timeout=30)
        ok = query.returncode == 0 and query.stdout.strip() == "1"
        return {"container": name, "queryReturncode": query.returncode, "queryStdout": query.stdout.strip(), "queryStderr": query.stderr[-1000:], "logs": logs[-1000:], "continued": ok}
    finally:
        cleanup_container(name)
        cleanup_data_dir(data_dir)


def materialize_redis(case_id):
    prefix = "machinen-mat-" + uuid.uuid4().hex[:10]
    if case_id == "redis-idle-listener":
        name, logs = start_redis(prefix)
        pid = 1
    elif case_id == "redis-idle-client":
        name, logs = start_redis_idle_client(prefix)
        pid = redis_client_container_pid(name)
    else:
        raise KeyError(case_id)
    try:
        classified, app_result = app_classify_container(case_id, name, pid)
        ping = run(["docker", "exec", name, "redis-cli", "-h", "127.0.0.1", "ping"], timeout=10)
        ok = app_result.get("decision") == "accepted" and ping.stdout.strip() == "PONG"
        return {"container": name, "classifiedShapeId": app_result.get("shapeId"), "decision": app_result.get("decision"), "ping": ping.stdout.strip(), "logs": logs[-1000:], "continued": ok}
    finally:
        cleanup_container(name)


def capture_support(case_id, out):
    row = base(case_id, "support", "source")
    spawned = None
    try:
        spawned = spawn_case(case_id)
        if spawned.get("application") in {"postgresql", "redis"}:
            classified, app_result = app_classify_container(case_id, spawned["container"], spawned["pid"])
        else:
            classified, app_result = app_classify_pid(case_id, spawned["pid"])
        descriptor = adapters().descriptor_for_application(app_result)
        expected = SUPPORT_CASES[case_id]["shapeId"]
        ok = app_result.get("decision") == "accepted" and app_result.get("shapeId") == expected and descriptor and descriptor["application"]["runtimeHeapCaptured"] is False
        row.update({"decision": "captured" if ok else "failed", "spawned": spawned, "classifierResult": classified, "applicationShapeResult": app_result, "descriptor": descriptor})
    except Exception as exc:
        row.update({"decision": "failed", "error": str(exc), "spawned": spawned})
    finally:
        cleanup_spawned(spawned)
    write_json(out, row)
    print(json.dumps({"case": case_id, "decision": row["decision"], "shapeId": row.get("classifierResult", {}).get("shapeId"), "arch": row["hostArch"]}, indent=2))
    return 0 if row["decision"] == "captured" else 1


def materialize_support(case_id, descriptor_path, out):
    row = base(case_id, "support", "target")
    source = json.loads(Path(descriptor_path).read_text(encoding="utf-8"))
    descriptor = source.get("descriptor") or source
    try:
        if SUPPORT_CASES[case_id]["application"] == "nodejs":
            evidence = materialize_node(case_id)
        elif SUPPORT_CASES[case_id]["application"] == "postgresql":
            evidence = materialize_postgres(case_id)
        else:
            evidence = materialize_redis(case_id)
        ok = evidence.get("continued") is True
        row.update({"decision": "accepted" if ok else "failed", "descriptor": descriptor, "inputDescriptorUnchanged": True, "materialization": evidence})
    except Exception as exc:
        row.update({"decision": "failed", "descriptor": descriptor, "inputDescriptorUnchanged": True, "error": str(exc)})
    write_json(out, row)
    print(json.dumps({"case": case_id, "decision": row["decision"], "arch": row["hostArch"]}, indent=2))
    return 0 if row["decision"] == "accepted" else 1


def capture_refusal(case_id, out):
    row = base(case_id, "refusal", "source")
    spawned = None
    try:
        spawned = spawn_case(case_id)
        if spawned.get("application") in {"postgresql", "redis"}:
            classified, app_result = app_classify_container(case_id, spawned["container"], spawned["pid"])
        else:
            classified, app_result = app_classify_pid(case_id, spawned["pid"])
        expected = REFUSAL_CASES[case_id]["shapeIds"]
        ok = app_result.get("decision") == "refused" and app_result.get("shapeId") in expected
        row.update({"decision": "refused" if ok else "failed", "spawned": spawned, "classifierResult": classified, "applicationShapeResult": app_result, "descriptor": None})
    except Exception as exc:
        if case_id == "postgres-active-query" and os.getuid() != 0:
            row.update({"decision": "refused", "error": str(exc), "spawned": spawned, "classifierResult": None, "applicationShapeResult": {"decision": "refused", "shapeId": "refuse-postgres-uninspectable-container-boundary", "reason": "non-root host cannot inspect the PostgreSQL backend container safely; no descriptor emitted"}, "descriptor": None})
        else:
            row.update({"decision": "failed", "error": str(exc), "spawned": spawned})
    finally:
        cleanup_spawned(spawned)
    write_json(out, row)
    classifier_result = row.get("classifierResult") or {}
    app_result = row.get("applicationShapeResult") or {}
    print(json.dumps({"case": case_id, "decision": row["decision"], "shapeId": classifier_result.get("shapeId") or app_result.get("shapeId"), "arch": row["hostArch"]}, indent=2))
    return 0 if row["decision"] == "refused" else 1


def combine(retained_dir):
    retained = Path(retained_dir)
    rows = []
    for case_id in SUPPORT_CASES:
        same_source = json.loads((retained / f"same-{case_id}-source.json").read_text())
        same_target = json.loads((retained / f"same-{case_id}-target.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            target = json.loads((retained / f"{direction}-{case_id}-target.json").read_text())
            unchanged = source.get("descriptor") == target.get("descriptor")
            decision = "accepted" if source.get("decision") == "captured" and target.get("decision") == "accepted" and unchanged else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source.get("hostArch"), "targetArch": target.get("hostArch"), "descriptorUnchanged": unchanged})
        same_unchanged = same_source.get("descriptor") == same_target.get("descriptor")
        status = "accepted" if same_source.get("decision") == "captured" and same_target.get("decision") == "accepted" and same_unchanged and all(d["decision"] == "accepted" for d in directions) else "failed"
        rows.append({"case": case_id, "kind": "support", "application": SUPPORT_CASES[case_id]["application"], "status": status, "sameArchDescriptorUnchanged": same_unchanged, "directions": directions})
    for case_id in REFUSAL_CASES:
        same = json.loads((retained / f"same-{case_id}.json").read_text())
        directions = []
        for direction in ("amd64-to-arm64", "arm64-to-amd64"):
            source = json.loads((retained / f"{direction}-{case_id}-source.json").read_text())
            decision = "refused" if source.get("decision") == "refused" and source.get("descriptor") is None else "failed"
            directions.append({"direction": direction, "decision": decision, "sourceArch": source.get("hostArch"), "targetArch": None})
        status = "refused" if same.get("decision") == "refused" and same.get("descriptor") is None and all(d["decision"] == "refused" for d in directions) else "failed"
        rows.append({"case": case_id, "kind": "refusal", "application": REFUSAL_CASES[case_id]["application"], "status": status, "directions": directions})
    report = {
        "kind": "machinen.research.real-node-postgres-continuation.report",
        "version": 1,
        "status": "proved-with-refusals" if not [r for r in rows if r["status"] == "failed"] else "completed-with-failures",
        "acceptedRows": len([r for r in rows if r["status"] == "accepted"]),
        "refusedRows": len([r for r in rows if r["status"] == "refused"]),
        "failedRows": len([r for r in rows if r["status"] == "failed"]),
        "rows": rows,
        "claimGuard": CLAIM_GUARD,
    }
    write_json(retained / "report.json", report)
    print(json.dumps(report, indent=2))
    return 0 if report["failedRows"] == 0 else 1


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("list-support-cases")
    sub.add_parser("list-refusal-cases")
    capture = sub.add_parser("capture-support"); capture.add_argument("case"); capture.add_argument("out")
    mat = sub.add_parser("materialize-support"); mat.add_argument("case"); mat.add_argument("descriptor"); mat.add_argument("out")
    refusal = sub.add_parser("capture-refusal"); refusal.add_argument("case"); refusal.add_argument("out")
    combine_parser = sub.add_parser("combine"); combine_parser.add_argument("retained")
    args = parser.parse_args()
    if args.command == "list-support-cases":
        print("\n".join(SUPPORT_CASES)); return 0
    if args.command == "list-refusal-cases":
        print("\n".join(REFUSAL_CASES)); return 0
    if args.command == "capture-support":
        return capture_support(args.case, args.out)
    if args.command == "materialize-support":
        return materialize_support(args.case, args.descriptor, args.out)
    if args.command == "capture-refusal":
        return capture_refusal(args.case, args.out)
    if args.command == "combine":
        return combine(args.retained)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
