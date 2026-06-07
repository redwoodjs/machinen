#!/usr/bin/env python3
import json
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

APP_CASES = {
    "node-http-idle-listener": {"application": "nodejs", "kind": "support", "shapeId": "shape-socket-listener-empty-accept-queue", "safePoint": "idle HTTP listener with empty accept/socket queues"},
    "node-parked-workers": {"application": "nodejs", "kind": "support", "shapeId": "shape-threads-all-parked-known-waits", "safePoint": "main thread and libuv workers parked in known waits"},
    "node-repl-prompt": {"application": "nodejs", "kind": "support", "shapeId": "shape-controlled-pty-read-empty-queue", "safePoint": "Node.js REPL prompt waiting for input on an empty pty"},
    "node-http-keepalive-idle": {"application": "nodejs", "kind": "support", "shapeId": "shape-socket-connected-local-empty-queues", "safePoint": "HTTP keep-alive connection idle with empty queues"},
    "postgres-idle-listener": {"application": "postgresql", "kind": "support", "shapeId": "shape-socket-listener-empty-accept-queue", "safePoint": "postmaster idle listener with empty accept/socket queues"},
    "postgres-idle-client-backend": {"application": "postgresql", "kind": "support", "shapeId": "shape-socket-connected-local-empty-queues", "safePoint": "authenticated idle client backend with empty socket queues and no active transaction"},
    "redis-idle-listener": {"application": "redis", "kind": "support", "shapeId": "shape-socket-listener-empty-accept-queue", "safePoint": "Redis server idle listener with empty accept/socket queues"},
    "redis-idle-client": {"application": "redis", "kind": "support", "shapeId": "shape-socket-connected-local-empty-queues", "safePoint": "Redis connected client idle with empty socket queues"},
    "node-queued-http-body": {"application": "nodejs", "kind": "refusal", "shapeIds": {"refuse-socket-queued-or-inflight-bytes", "refuse-pipe-unread-bytes", "refuse-active-or-unclassified-thread"}, "safePoint": "queued/in-flight HTTP body bytes"},
    "node-active-worker": {"application": "nodejs", "kind": "refusal", "shapeIds": {"refuse-active-or-unclassified-thread", "refuse-pipe-unread-bytes"}, "safePoint": "runnable worker thread"},
    "node-streaming-response-inflight": {"application": "nodejs", "kind": "refusal", "shapeIds": {"refuse-socket-queued-or-inflight-bytes", "refuse-active-or-unclassified-thread", "refuse-unclassified-process-shape"}, "safePoint": "streaming HTTP response in flight"},
    "postgres-active-query": {"application": "postgresql", "kind": "refusal", "shapeIds": {"refuse-active-or-unclassified-thread", "refuse-unclassified-process-shape", "refuse-socket-fd-present"}, "safePoint": "active PostgreSQL query"},
    "postgres-active-transaction": {"application": "postgresql", "kind": "refusal", "shapeIds": {"refuse-postgres-active-transaction", "refuse-socket-queued-or-inflight-bytes", "refuse-unclassified-process-shape"}, "safePoint": "backend is idle in an open transaction"},
    "postgres-lock-wait": {"application": "postgresql", "kind": "refusal", "shapeIds": {"refuse-postgres-lock-wait", "refuse-active-or-unclassified-thread", "refuse-unclassified-process-shape"}, "safePoint": "backend is waiting on a database lock"},
    "redis-queued-command": {"application": "redis", "kind": "refusal", "shapeIds": {"refuse-socket-queued-or-inflight-bytes", "refuse-redis-queued-command", "refuse-unclassified-process-shape"}, "safePoint": "queued or partial Redis command bytes"},
}


def sockets(observation):
    return [fd for fd in observation.get("fds", []) if fd.get("kind") == "socket"]


def socket_entries(observation):
    return [fd.get("socket", {}) for fd in sockets(observation)]


def has_queued_socket(observation):
    return any(entry.get("txQueue") not in (0, None) or entry.get("rxQueue") not in (0, None) for entry in socket_entries(observation))


def has_runnable_task(observation):
    return any(task.get("state") == "R" for task in observation.get("tasks", []))


def has_listener_socket(observation):
    return any(entry.get("state") == "LISTEN" for entry in socket_entries(observation))


def all_listener_or_local_internal(observation):
    allowed = {"LISTEN", "unclassified"}
    entries = socket_entries(observation)
    return bool(entries) and any(entry.get("state") == "LISTEN" for entry in entries) and all(entry.get("state") in allowed for entry in entries)


def all_loopback_established_empty(observation):
    entries = socket_entries(observation)
    return bool(entries) and all(entry.get("state") == "ESTABLISHED" and entry.get("txQueue") in (0, None) and entry.get("rxQueue") in (0, None) for entry in entries)


def has_empty_pty(observation):
    ptys = [fd for fd in observation.get("fds", []) if fd.get("kind") == "pty"]
    return bool(ptys) and all(fd.get("queueBytes") in (0, None) for fd in ptys)


def app_text(observation):
    return " ".join(observation.get("cmdline", [])).lower()


def classify_application(case_id, generic_result, evidence=None):
    if case_id not in APP_CASES:
        raise KeyError(case_id)
    case = APP_CASES[case_id]
    observation = generic_result.get("observation", {})
    text = app_text(observation)
    evidence = evidence or {}
    if case["application"] == "postgresql" and (evidence.get("transactionState") == "idle-in-transaction" or "idle in transaction" in text):
        return refused(case_id, "refuse-postgres-active-transaction", "PostgreSQL backend is idle in an open transaction", observation, evidence)
    if case["application"] == "postgresql" and (evidence.get("lockWait") or "lock" in text and "wait" in text):
        return refused(case_id, "refuse-postgres-lock-wait", "PostgreSQL backend is waiting on a database lock", observation, evidence)
    if case["application"] == "redis" and evidence.get("queuedCommand"):
        return refused(case_id, "refuse-redis-queued-command", "Redis has a queued or partial command boundary", observation, evidence)
    if has_queued_socket(observation):
        return refused(case_id, "refuse-socket-queued-or-inflight-bytes", "application socket has queued/in-flight bytes", observation, evidence)
    if has_runnable_task(observation):
        return refused(case_id, "refuse-active-or-unclassified-thread", "application has a runnable thread/backend", observation, evidence)
    if case_id in {"node-http-idle-listener", "postgres-idle-listener", "redis-idle-listener"} and all_listener_or_local_internal(observation):
        return accepted(case_id, case["shapeId"], "application listener sockets are empty", observation, evidence)
    if case_id in {"node-http-keepalive-idle", "postgres-idle-client-backend", "redis-idle-client"} and all_loopback_established_empty(observation):
        return accepted(case_id, case["shapeId"], "application connected socket queues are empty", observation, evidence)
    if case_id == "node-parked-workers" and len(observation.get("tasks", [])) > 1 and not has_runnable_task(observation):
        return accepted(case_id, case["shapeId"], "Node.js main thread and workers are parked", observation, evidence)
    if case_id == "node-repl-prompt" and has_empty_pty(observation):
        syscall = observation.get("syscall", {})
        if syscall.get("readLikeWait") or syscall.get("pollLikeWait") or "node" in text:
            return accepted(case_id, case["shapeId"], "Node.js REPL prompt has an empty pty input queue", observation, evidence)
    if case["kind"] == "refusal":
        generic_shape = generic_result.get("shapeId", "refuse-unclassified-process-shape")
        if generic_shape in case.get("shapeIds", set()):
            return refused(case_id, generic_shape, generic_result.get("reason", "generic classifier refused the application shape"), observation, evidence)
    return refused(case_id, generic_result.get("shapeId", "refuse-unclassified-process-shape"), generic_result.get("reason", "application shape did not match accepted boundary"), observation, evidence)


def accepted(case_id, shape_id, reason, observation, evidence):
    return {"kind": "machinen.research.native-continuation.app-adapter-result", "version": 1, "decision": "accepted", "case": case_id, "application": APP_CASES[case_id]["application"], "shapeId": shape_id, "reason": reason, "observation": observation, "evidence": evidence, "claimGuard": CLAIM_GUARD}


def refused(case_id, shape_id, reason, observation, evidence):
    return {"kind": "machinen.research.native-continuation.app-adapter-result", "version": 1, "decision": "refused", "case": case_id, "application": APP_CASES[case_id]["application"], "shapeId": shape_id, "reason": reason, "observation": observation, "evidence": evidence, "descriptor": None, "claimGuard": CLAIM_GUARD}


def descriptor_for_application(app_result):
    if app_result.get("decision") != "accepted":
        return None
    case_id = app_result["case"]
    case = APP_CASES[case_id]
    observation = app_result["observation"]
    shape_id = app_result["shapeId"]
    wait_by_shape = {
        "shape-socket-listener-empty-accept-queue": "socket-accept-wait-or-idle-listener",
        "shape-socket-connected-local-empty-queues": "socket-local-connected-empty-queues",
        "shape-threads-all-parked-known-waits": "multi-thread-parked-waits",
        "shape-controlled-pty-read-empty-queue": "pty-read-or-poll",
    }
    desc = {
        "kind": "machinen.research.native-continuation.capture-descriptor",
        "version": 1,
        "shapeId": shape_id,
        "architectureNeutral": True,
        "observationConsistency": observation.get("observationConsistency", "live-procfs-best-effort"),
        "cpu": {"wait": wait_by_shape.get(shape_id, "application-safe-point"), "sourceArch": observation.get("hostArch"), "sourceSyscallNumber": observation.get("syscall", {}).get("number"), "sourceWchan": observation.get("syscall", {}).get("wchan"), "targetNativeReconstruction": True, "sourceIsaEmulationRequired": False},
        "memory": {"mode": "semantic-resource-descriptor-only", "rawHeapCaptured": False, "rawStackCaptured": False, "rawRegistersCaptured": False, "rawHeapStackRegistersCaptured": False, "threadStacksCaptured": False, "runtimeHeapCaptured": False, "runtimeHeapRestored": False},
        "resources": {"process": observation.get("processTree", {}), "fds": observation.get("fds", []), "sockets": {"fds": sockets(observation), "kernelSocketIdentityPreserved": False}, "threads": {"tasks": observation.get("tasks", []), "threadStacksCaptured": False}, "runtimeInternalPipes": {"treatedAsExternalContinuationResources": False}},
        "application": {"name": case["application"], "case": case_id, "safePoint": case["safePoint"], "runtimeHeapCaptured": False, "runtimeHeapRestored": False, "databaseMemoryCaptured": False, "databaseMemoryRestored": False},
        "materializer": {"strategy": "target-native-application-reexec-at-accepted-resource-boundary", "rawProcessMemoryMaterialization": False, "sourceIsaEmulationRequired": False, "kernelSocketIdentityPreserved": False},
    }
    return json.loads(json.dumps(desc))


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
