#!/usr/bin/env python3
import argparse
import importlib.util
import json
import sys
from pathlib import Path

CLAIM_GUARD = {
    "arbitraryProcessRestoreClaimed": False,
    "rawVmReplayUsed": False,
    "sourceIsaEmulationUsed": False,
    "metadataOnlySuccess": False,
    "rawHeapStackRegisterRestore": False,
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


def load_classifier():
    return load_module("native_continuation_classifier", Path(__file__).resolve().parent / "classify.py")


def load_materializer():
    return load_module("native_continuation_materializer", Path(__file__).resolve().parent / "materializer.py")


def write_json(path, data):
    text = json.dumps(data, indent=2) + "\n"
    if path:
        Path(path).write_text(text, encoding="utf-8")
    else:
        print(text, end="")


def classify_cmd(args):
    classifier = load_classifier()
    result = classifier.classify_pid(args.pid, paused_vm=args.paused_vm)
    result["interface"] = "machinen.research.native-continuation-cli.classify"
    write_json(args.out, result)
    return 0 if result["decision"] == "accepted" or args.allow_refused else 1


def capture_cmd(args):
    classifier = load_classifier()
    classified = classifier.classify_pid(args.pid, paused_vm=args.paused_vm)
    capture = {
        "kind": "machinen.research.native-continuation-cli.capture",
        "version": 1,
        "decision": classified["decision"],
        "shapeId": classified["shapeId"],
        "reason": classified["reason"],
        "claimGuard": CLAIM_GUARD,
        "descriptor": classified.get("descriptor"),
        "classifierResult": classified,
        "descriptorSource": "native-continuation-classifier/classify.py",
    }
    write_json(args.out, capture)
    return 0 if capture["decision"] == "accepted" or args.allow_refused else 1


def materialize_cmd(args):
    materializer = load_materializer()
    raw = json.loads(Path(args.descriptor).read_text(encoding="utf-8"))
    descriptor = raw.get("descriptor") if raw.get("descriptor") else raw
    if not descriptor or descriptor.get("kind") != "machinen.research.native-continuation.capture-descriptor":
        result = {"kind": "machinen.research.native-continuation-cli.materialize", "version": 1, "decision": "refused", "reason": "missing-valid-descriptor", "claimGuard": CLAIM_GUARD}
        write_json(args.out, result)
        return 1
    case_id = args.case or SHAPE_TO_MATERIALIZER_CASE.get(descriptor.get("shapeId"))
    if not case_id:
        result = {"kind": "machinen.research.native-continuation-cli.materialize", "version": 1, "decision": "refused", "reason": "no-materializer-for-shape", "shapeId": descriptor.get("shapeId"), "claimGuard": CLAIM_GUARD}
        write_json(args.out, result)
        return 1
    result = materializer.run_case(case_id, "target", "target", args.descriptor)
    result["interface"] = "machinen.research.native-continuation-cli.materialize"
    result["inputDescriptorUnchanged"] = result.get("descriptor") == descriptor
    write_json(args.out, result)
    return 0 if result["decision"] == "accepted" and result["inputDescriptorUnchanged"] else 1


def main():
    parser = argparse.ArgumentParser(description="Experimental native continuation classifier/capture/materializer CLI.")
    sub = parser.add_subparsers(dest="command", required=True)

    classify = sub.add_parser("classify")
    classify.add_argument("--pid", type=int, required=True)
    classify.add_argument("--paused-vm", action="store_true")
    classify.add_argument("--allow-refused", action="store_true")
    classify.add_argument("--out")
    classify.set_defaults(func=classify_cmd)

    capture = sub.add_parser("capture")
    capture.add_argument("--pid", type=int, required=True)
    capture.add_argument("--paused-vm", action="store_true")
    capture.add_argument("--allow-refused", action="store_true")
    capture.add_argument("--out", required=True)
    capture.set_defaults(func=capture_cmd)

    materialize = sub.add_parser("materialize")
    materialize.add_argument("--descriptor", required=True)
    materialize.add_argument("--case")
    materialize.add_argument("--out", required=True)
    materialize.set_defaults(func=materialize_cmd)

    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
