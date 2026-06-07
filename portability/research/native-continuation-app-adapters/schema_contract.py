#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

REQUIRED_CLAIM_GUARD_FALSE = [
    "arbitraryProcessRestoreClaimed",
    "rawVmReplayUsed",
    "sourceIsaEmulationUsed",
    "metadataOnlySuccess",
    "rawHeapStackRegisterRestore",
]


def require(condition, message, errors):
    if not condition:
        errors.append(message)


def validate_claim_guard(obj, errors):
    guard = obj.get("claimGuard")
    require(isinstance(guard, dict), "claimGuard must be an object", errors)
    if not isinstance(guard, dict):
        return
    for key in REQUIRED_CLAIM_GUARD_FALSE:
        require(guard.get(key) is False, f"claimGuard.{key} must be false", errors)


def validate_descriptor(obj):
    errors = []
    require(obj.get("kind") == "machinen.research.native-continuation.capture-descriptor", "descriptor kind mismatch", errors)
    require(obj.get("version") == 1, "descriptor version must be 1", errors)
    require(isinstance(obj.get("shapeId"), str) and obj.get("shapeId"), "shapeId is required", errors)
    require(obj.get("architectureNeutral") is True, "architectureNeutral must be true", errors)
    cpu = obj.get("cpu", {})
    mem = obj.get("memory", {})
    materializer = obj.get("materializer", {})
    require(cpu.get("targetNativeReconstruction") is True, "cpu.targetNativeReconstruction must be true", errors)
    require(cpu.get("sourceIsaEmulationRequired") is False, "cpu.sourceIsaEmulationRequired must be false", errors)
    for key in ("rawHeapCaptured", "rawStackCaptured", "rawRegistersCaptured", "rawHeapStackRegistersCaptured"):
        require(mem.get(key) is False, f"memory.{key} must be false", errors)
    require(materializer.get("rawProcessMemoryMaterialization") is False, "materializer.rawProcessMemoryMaterialization must be false", errors)
    if "sourceIsaEmulationRequired" in materializer:
        require(materializer.get("sourceIsaEmulationRequired") is False, "materializer.sourceIsaEmulationRequired must be false", errors)
    if "kernelSocketIdentityPreserved" in materializer:
        require(materializer.get("kernelSocketIdentityPreserved") is False, "materializer.kernelSocketIdentityPreserved must be false", errors)
    return errors


def validate_classifier_result(obj):
    errors = []
    require(obj.get("kind") == "machinen.research.native-continuation-classifier.result", "classifier kind mismatch", errors)
    require(obj.get("version") == 1, "classifier version must be 1", errors)
    require(obj.get("decision") in {"accepted", "refused"}, "classifier decision must be accepted/refused", errors)
    require(isinstance(obj.get("shapeId"), str), "classifier shapeId is required", errors)
    validate_claim_guard(obj, errors)
    if obj.get("decision") == "accepted":
        desc = obj.get("descriptor")
        require(isinstance(desc, dict), "accepted classifier result must include descriptor", errors)
        if isinstance(desc, dict):
            errors.extend(validate_descriptor(desc))
    else:
        require("descriptor" not in obj or obj.get("descriptor") is None, "refused classifier result must not include descriptor", errors)
    return errors


def validate_capture(obj):
    errors = []
    require(obj.get("decision") in {"accepted", "refused"}, "capture decision must be accepted/refused", errors)
    validate_claim_guard(obj, errors)
    if obj.get("decision") == "accepted":
        desc = obj.get("descriptor")
        require(isinstance(desc, dict), "accepted capture must include descriptor", errors)
        if isinstance(desc, dict):
            errors.extend(validate_descriptor(desc))
    else:
        require(obj.get("descriptor") is None, "refused capture must emit no descriptor", errors)
    return errors


def validate_materialization(obj):
    errors = []
    require(obj.get("decision") in {"accepted", "refused", "failed"}, "materialization decision must be accepted/refused/failed", errors)
    if obj.get("decision") == "accepted":
        require(obj.get("inputDescriptorUnchanged") is True, "accepted materialization must preserve input descriptor", errors)
        desc = obj.get("descriptor")
        require(isinstance(desc, dict), "accepted materialization must include descriptor", errors)
        if isinstance(desc, dict):
            errors.extend(validate_descriptor(desc))
    return errors


def validate_app_adapter_result(obj):
    errors = []
    require(obj.get("kind") == "machinen.research.native-continuation.app-adapter-result", "app adapter kind mismatch", errors)
    require(obj.get("version") == 1, "app adapter version must be 1", errors)
    require(obj.get("decision") in {"accepted", "refused"}, "app adapter decision must be accepted/refused", errors)
    validate_claim_guard(obj, errors)
    if obj.get("decision") == "refused":
        require(obj.get("descriptor") is None, "refused app adapter result must emit no descriptor", errors)
    return errors


VALIDATORS = {
    "descriptor": validate_descriptor,
    "classifier-result": validate_classifier_result,
    "capture": validate_capture,
    "materialization": validate_materialization,
    "app-adapter-result": validate_app_adapter_result,
}


def main():
    parser = argparse.ArgumentParser(description="Validate native continuation research JSON contracts")
    parser.add_argument("schema", choices=VALIDATORS)
    parser.add_argument("json_file")
    args = parser.parse_args()
    obj = json.loads(Path(args.json_file).read_text(encoding="utf-8"))
    errors = VALIDATORS[args.schema](obj)
    if errors:
        print(json.dumps({"status": "failed", "errors": errors}, indent=2))
        return 1
    print(json.dumps({"status": "passed", "schema": args.schema, "json": args.json_file}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
