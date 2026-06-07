#!/usr/bin/env python3
import json
import os
from pathlib import Path

import app_adapters
import schema_contract


def observation(kind):
    base = {
        "pid": 123,
        "hostArch": os.uname().machine,
        "observationConsistency": "synthetic-unit",
        "processTree": {"ppid": 1, "pgrp": 123, "session": 123},
        "tasks": [{"tid": 123, "state": "S", "wchan": "ep_poll", "syscall": {"pollLikeWait": True, "readLikeWait": False, "number": None, "wchan": "ep_poll"}}],
        "syscall": {"pollLikeWait": True, "readLikeWait": False, "number": None, "wchan": "ep_poll"},
        "fds": [],
    }
    if kind == "listener":
        base["fds"] = [{"fd": 6, "kind": "socket", "target": "socket:[1]", "socket": {"state": "LISTEN", "txQueue": 0, "rxQueue": 0}}]
    if kind == "connected":
        base["fds"] = [{"fd": 9, "kind": "socket", "target": "socket:[2]", "socket": {"state": "ESTABLISHED", "txQueue": 0, "rxQueue": 0}}]
    if kind == "queued":
        base["fds"] = [{"fd": 9, "kind": "socket", "target": "socket:[3]", "socket": {"state": "ESTABLISHED", "txQueue": 0, "rxQueue": 10}}]
    if kind == "pty":
        base["fds"] = [{"fd": 0, "kind": "pty", "target": "/dev/pts/1", "queueBytes": 0}]
        base["syscall"] = {"pollLikeWait": False, "readLikeWait": True, "number": "0", "wchan": "wait_woken"}
    if kind == "runnable":
        base["tasks"] = [{"tid": 123, "state": "R", "wchan": "0", "syscall": {"pollLikeWait": False, "readLikeWait": False, "number": "running", "wchan": "0"}}]
    return base


def generic(obs, decision="refused", shape="refuse-unclassified-process-shape"):
    return {"kind": "machinen.research.native-continuation-classifier.result", "version": 1, "decision": decision, "shapeId": shape, "reason": "synthetic", "claimGuard": app_adapters.CLAIM_GUARD, "observation": obs}


def main():
    retained = Path(__file__).resolve().parent / "retained"
    retained.mkdir(exist_ok=True)
    rows = []
    cases = [
        ("node-http-idle-listener", observation("listener"), "accepted"),
        ("node-http-keepalive-idle", observation("connected"), "accepted"),
        ("node-repl-prompt", observation("pty"), "accepted"),
        ("postgres-idle-listener", observation("listener"), "accepted"),
        ("postgres-idle-client-backend", observation("connected"), "accepted"),
        ("redis-idle-listener", observation("listener"), "accepted"),
        ("redis-idle-client", observation("connected"), "accepted"),
        ("node-streaming-response-inflight", observation("queued"), "refused"),
        ("node-active-worker", observation("runnable"), "refused"),
        ("postgres-active-transaction", observation("connected"), "refused"),
        ("postgres-lock-wait", observation("connected"), "refused"),
        ("redis-queued-command", observation("queued"), "refused"),
    ]
    for case_id, obs, expected in cases:
        evidence = {}
        if case_id == "postgres-active-transaction":
            evidence["transactionState"] = "idle-in-transaction"
        if case_id == "postgres-lock-wait":
            evidence["lockWait"] = True
        result = app_adapters.classify_application(case_id, generic(obs), evidence=evidence)
        descriptor = app_adapters.descriptor_for_application(result)
        errors = schema_contract.validate_app_adapter_result(result)
        if descriptor:
            errors += schema_contract.validate_descriptor(descriptor)
        status = "passed" if result["decision"] == expected and not errors and ((expected == "accepted") == bool(descriptor)) else "failed"
        rows.append({"case": case_id, "expected": expected, "decision": result["decision"], "descriptorEmitted": bool(descriptor), "errors": errors, "status": status})
    report = {"kind": "machinen.research.native-continuation.app-adapters.report", "version": 1, "status": "passed" if all(r["status"] == "passed" for r in rows) else "failed", "rows": rows}
    (retained / "report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))
    return 0 if report["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
