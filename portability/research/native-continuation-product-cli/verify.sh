#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
RETAINED_DIR="$SCRIPT_DIR/retained"
mkdir -p "$RETAINED_DIR"
rm -f "$RETAINED_DIR"/*.json
GENERIC_SOURCE="$SCRIPT_DIR/../native-continuation-cli/retained/same-pty-read-empty-queue-source.json"
APP_SOURCE="$SCRIPT_DIR/../real-node-postgres-continuation-ladder/retained/same-postgres-idle-listener-source.json"
if [[ ! -f "$GENERIC_SOURCE" ]]; then
  echo "missing generic retained descriptor: $GENERIC_SOURCE" >&2
  exit 1
fi
if [[ ! -f "$APP_SOURCE" ]]; then
  echo "missing app retained descriptor: $APP_SOURCE" >&2
  exit 1
fi
python3 "$SCRIPT_DIR/machinen_native.py" native materialize --descriptor "$GENERIC_SOURCE" --out "$RETAINED_DIR/generic-materialize.json"
python3 "$SCRIPT_DIR/machinen_native.py" native materialize --descriptor "$APP_SOURCE" --out "$RETAINED_DIR/app-materialize.json"
printf '{"kind":"not-a-descriptor"}\n' > "$RETAINED_DIR/invalid-descriptor.json"
if python3 "$SCRIPT_DIR/machinen_native.py" native materialize --descriptor "$RETAINED_DIR/invalid-descriptor.json" --out "$RETAINED_DIR/invalid-materialize.json"; then
  echo "invalid descriptor unexpectedly materialized" >&2
  exit 1
fi
python3 - <<'PY' "$RETAINED_DIR"
import json, sys
from pathlib import Path
retained = Path(sys.argv[1])
rows = []
for name in ["generic-materialize", "app-materialize"]:
    data = json.loads((retained / f"{name}.json").read_text())
    rows.append({"case": name, "decision": data.get("decision"), "schema": data.get("schemaValidation", {}).get("status"), "inputDescriptorUnchanged": data.get("inputDescriptorUnchanged")})
invalid = json.loads((retained / "invalid-materialize.json").read_text())
rows.append({"case": "invalid-materialize", "decision": invalid.get("decision"), "reason": invalid.get("reason"), "schema": invalid.get("schemaValidation", {}).get("status")})
status = "passed" if rows[0]["decision"] == "accepted" and rows[0]["schema"] == "passed" and rows[0]["inputDescriptorUnchanged"] is True and rows[1]["decision"] == "accepted" and rows[1]["schema"] == "passed" and rows[1]["inputDescriptorUnchanged"] is True and rows[2]["decision"] == "refused" else "failed"
report = {"kind": "machinen.experimental.native.product-shaped-cli.report", "version": 1, "status": status, "rows": rows}
(retained / "report.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report, indent=2))
raise SystemExit(0 if status == "passed" else 1)
PY
for json in "$RETAINED_DIR"/*.json; do python3 -m json.tool "$json" >/dev/null; done
echo "Product-shaped native CLI verification completed"
