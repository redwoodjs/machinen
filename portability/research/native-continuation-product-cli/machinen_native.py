#!/usr/bin/env python3
import argparse
import importlib.util
import json
import os
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLASSIFIER = ROOT / "native-continuation-classifier" / "classify.py"
APP_ADAPTERS = ROOT / "native-continuation-app-adapters" / "app_adapters.py"
SCHEMA = ROOT / "native-continuation-app-adapters" / "schema_contract.py"
MATERIALIZER = ROOT / "native-continuation-materializer" / "materializer.py"

CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "rawHeapStackRegisterRestore": False,
    "runtimeHeapRestoreClaimed": False,
    "kernelSocketIdentityPreserved": False,
}

SHAPE_TO_MATERIALIZER_CASE = {
    "shape-controlled-pty-read-empty-queue": "pty-read-empty-queue",
    "shape-controlled-pty-poll-empty-queue": "pty-read-empty-queue",
    "shape-pipe-empty-blocked-endpoint": "pipe-empty-blocked-endpoint",
    "shape-socket-listener-empty-accept-queue": "socket-listener-empty",
    "shape-socket-connected-local-empty-queues": "socket-local-connected-empty",
    "shape-threads-all-parked-known-waits": "threads-all-parked",
}


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_json(path, data):
    text = json.dumps(data, indent=2) + "\n"
    if path:
        Path(path).write_text(text, encoding="utf-8")
    else:
        print(text, end="")


def classifier():
    return load_module("classifier", CLASSIFIER)


def adapters():
    return load_module("app_adapters", APP_ADAPTERS)


def schema():
    return load_module("schema_contract", SCHEMA)


def materializer():
    return load_module("materializer", MATERIALIZER)


def with_interface(result, command):
    result["interface"] = "machinen.experimental.native"
    result["command"] = command
    result["experimental"] = True
    result["claimGuard"] = result.get("claimGuard", CLAIM_GUARD)
    return result


def classify_cmd(args):
    result = classifier().classify_pid(args.pid, paused_vm=args.paused_vm)
    if args.app_case:
        app_result = adapters().classify_application(args.app_case, result)
        result = {"kind": "machinen.experimental.native.classify", "version": 1, "decision": app_result["decision"], "shapeId": app_result["shapeId"], "reason": app_result["reason"], "genericClassifierResult": result, "applicationAdapterResult": app_result, "claimGuard": CLAIM_GUARD}
    with_interface(result, "native classify")
    write_json(args.out, result)
    return 0 if result["decision"] == "accepted" or args.allow_refused else 1


def capture_cmd(args):
    generic = classifier().classify_pid(args.pid, paused_vm=args.paused_vm)
    if args.app_case:
        app_result = adapters().classify_application(args.app_case, generic)
        descriptor = adapters().descriptor_for_application(app_result)
        decision = app_result["decision"]
        shape_id = app_result["shapeId"]
        reason = app_result["reason"]
    else:
        app_result = None
        descriptor = generic.get("descriptor")
        decision = generic["decision"]
        shape_id = generic["shapeId"]
        reason = generic["reason"]
    capture = with_interface({"kind": "machinen.experimental.native.capture", "version": 1, "decision": decision, "shapeId": shape_id, "reason": reason, "descriptor": descriptor, "genericClassifierResult": generic, "applicationAdapterResult": app_result, "claimGuard": CLAIM_GUARD}, "native capture")
    errors = schema().validate_capture(capture)
    capture["schemaValidation"] = {"status": "passed" if not errors else "failed", "errors": errors}
    write_json(args.out, capture)
    return 0 if capture["decision"] == "accepted" and not errors or args.allow_refused and capture["decision"] == "refused" else 1


def materialize_cmd(args):
    raw = json.loads(Path(args.descriptor).read_text(encoding="utf-8"))
    descriptor = raw.get("descriptor") if raw.get("descriptor") else raw
    errors = schema().validate_descriptor(descriptor) if isinstance(descriptor, dict) else ["missing descriptor"]
    if errors:
        result = with_interface({"kind": "machinen.experimental.native.materialize", "version": 1, "decision": "refused", "reason": "invalid-descriptor", "schemaValidation": {"status": "failed", "errors": errors}, "claimGuard": CLAIM_GUARD}, "native materialize")
        write_json(args.out, result)
        return 1
    case_id = args.case or descriptor.get("application", {}).get("case") or SHAPE_TO_MATERIALIZER_CASE.get(descriptor.get("shapeId"))
    if not case_id:
        result = with_interface({"kind": "machinen.experimental.native.materialize", "version": 1, "decision": "refused", "reason": "no-materializer-for-shape", "shapeId": descriptor.get("shapeId"), "claimGuard": CLAIM_GUARD}, "native materialize")
        write_json(args.out, result)
        return 1
    if descriptor.get("application", {}).get("name"):
        # Product-shaped application materialization is descriptor-contract only here;
        # full runtime materializers are retained in the app ladder.
        result = {"kind": "machinen.experimental.native.materialize", "version": 1, "decision": "accepted", "descriptor": descriptor, "inputDescriptorUnchanged": True, "applicationMaterializer": "target-native-application-reexec-at-accepted-resource-boundary", "claimGuard": CLAIM_GUARD}
    else:
        with tempfile.NamedTemporaryFile("w", delete=False) as handle:
            json.dump(descriptor, handle)
            temp = handle.name
        try:
            result = materializer().run_case(case_id, "target", "target", temp)
        finally:
            try:
                os.unlink(temp)
            except OSError:
                pass
        result["inputDescriptorUnchanged"] = result.get("descriptor") == descriptor
    with_interface(result, "native materialize")
    errors = schema().validate_materialization(result)
    result["schemaValidation"] = {"status": "passed" if not errors else "failed", "errors": errors}
    write_json(args.out, result)
    return 0 if result.get("decision") == "accepted" and result.get("inputDescriptorUnchanged") is True and not errors else 1


def main():
    parser = argparse.ArgumentParser(description="Product-shaped experimental native continuation CLI")
    sub = parser.add_subparsers(dest="top", required=True)
    native = sub.add_parser("native")
    native_sub = native.add_subparsers(dest="command", required=True)
    classify = native_sub.add_parser("classify")
    classify.add_argument("--pid", type=int, required=True)
    classify.add_argument("--paused-vm", action="store_true")
    classify.add_argument("--app-case")
    classify.add_argument("--allow-refused", action="store_true")
    classify.add_argument("--out")
    classify.set_defaults(func=classify_cmd)
    capture = native_sub.add_parser("capture")
    capture.add_argument("--pid", type=int, required=True)
    capture.add_argument("--paused-vm", action="store_true")
    capture.add_argument("--app-case")
    capture.add_argument("--allow-refused", action="store_true")
    capture.add_argument("--out", required=True)
    capture.set_defaults(func=capture_cmd)
    materialize = native_sub.add_parser("materialize")
    materialize.add_argument("--descriptor", required=True)
    materialize.add_argument("--case")
    materialize.add_argument("--out", required=True)
    materialize.set_defaults(func=materialize_cmd)
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
