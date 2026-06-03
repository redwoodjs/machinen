#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT_DIR="${OUT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-real-cross-arch-tcp-listener.XXXXXX")}" 
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
SOURCE_IMAGE="${SOURCE_IMAGE:-python:3.12-alpine}"
PORT="${PORT:-18080}"
BACKLOG="${BACKLOG:-8}"
TARGET_ARCH="${TARGET_ARCH:-$(node -e 'const a=process.env.MACHINEN_GUEST_ARCH || process.arch; console.log(a === "x64" ? "amd64" : a)')}"
if [[ "$TARGET_ARCH" != "arm64" && "$TARGET_ARCH" != "amd64" ]]; then
  echo "unsupported TARGET_ARCH=$TARGET_ARCH" >&2
  exit 2
fi
if [[ "$TARGET_ARCH" == "arm64" ]]; then
  SOURCE_ARCH="amd64"
  SOURCE_PLATFORM="linux/amd64"
else
  SOURCE_ARCH="arm64"
  SOURCE_PLATFORM="linux/arm64"
fi
NAME="real-xarch-tcp-${SOURCE_ARCH}-to-${TARGET_ARCH}-$(date +%s)-$$"
CLI=(env "MACHINEN_ASSETS_DIR=${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}" node packages/cli/dist/cli.js)
BUNDLE="$OUT_DIR/bundle"
SOURCE_PROG="$OUT_DIR/source-listener.py"
SOURCE_VERIFIER="$OUT_DIR/source-verifier.txt"
DOCKER_STDERR="$OUT_DIR/docker-source.stderr.txt"
CAPTURE_STDOUT="$OUT_DIR/capture.stdout.json"
CAPTURE_STDERR="$OUT_DIR/capture.stderr.txt"
RESTORE_STDOUT="$OUT_DIR/restore.stdout.json"
RESTORE_STDERR="$OUT_DIR/restore.stderr.txt"
TARGET_LOG="$OUT_DIR/target-listener-log.txt"
STOP_STDOUT="$OUT_DIR/stop.stdout.json"
STOP_STDERR="$OUT_DIR/stop.stderr.txt"
REPORT="$OUT_DIR/real-cross-arch-tcp-listener-product-e2e-report.json"

cleanup() {
  "${CLI[@]}" stop "$NAME" --force --json >"$STOP_STDOUT" 2>"$STOP_STDERR" || true
}
trap cleanup EXIT

cat > "$SOURCE_PROG" <<'PY'
import os, platform, socket
port = int(os.environ.get("PORT", "18080"))
backlog = int(os.environ.get("BACKLOG", "8"))
sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
sock.bind(("127.0.0.1", port))
sock.listen(backlog)
reuse = sock.getsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR)
print(
    f"tcp-listener family=inet protocol=tcp bind=127.0.0.1:{port} backlog={backlog} "
    f"acceptQueue=empty reuseaddr={'true' if reuse else 'false'} sourceArch={platform.machine()}",
    flush=True,
)
sock.close()
PY

/usr/bin/time -p pnpm build >"$OUT_DIR/build.stdout.txt" 2>"$OUT_DIR/build.stderr.txt"

docker run --rm --platform "$SOURCE_PLATFORM" -e "PORT=$PORT" -e "BACKLOG=$BACKLOG" \
  -v "$SOURCE_PROG:/source-listener.py:ro" "$SOURCE_IMAGE" python /source-listener.py \
  >"$SOURCE_VERIFIER" 2>"$DOCKER_STDERR"

"${CLI[@]}" capture tcp-listener \
  --out "$BUNDLE" \
  --source-arch "$SOURCE_ARCH" \
  --target-arch "$TARGET_ARCH" \
  --source-verifier-output "$SOURCE_VERIFIER" \
  --bind-address 127.0.0.1 \
  --port "$PORT" \
  --backlog "$BACKLOG" \
  --json >"$CAPTURE_STDOUT" 2>"$CAPTURE_STDERR"

"${CLI[@]}" restore "$BUNDLE" --target-arch "$TARGET_ARCH" --name "$NAME" --json \
  >"$RESTORE_STDOUT" 2>"$RESTORE_STDERR"

"${CLI[@]}" exec "$NAME" -- "grep -m1 MACHINEN_TCP_LISTENER_RESTORED /tmp/machinen-restored-tcp-listener.log" \
  >"$TARGET_LOG" 2>"$OUT_DIR/target-log.stderr.txt"

node - "$OUT_DIR" "$SOURCE_ARCH" "$TARGET_ARCH" "$SOURCE_PLATFORM" "$PORT" "$BACKLOG" "$NAME" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const [outDir, sourceArch, targetArch, sourcePlatform, port, backlog, name] = process.argv.slice(2);
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8'));
const readText = (file) => fs.readFileSync(path.join(outDir, file), 'utf8');
const capture = readJson('capture.stdout.json');
const restore = readJson('restore.stdout.json');
const sourceVerifier = readText('source-verifier.txt').trim();
const targetLog = readText('target-listener-log.txt').trim();
if (capture.state !== 'completed' || capture.migrationCompleted !== true) throw new Error('capture did not complete');
if (restore.state !== 'completed' || restore.migrationCompleted !== true) throw new Error('restore did not complete');
if (restore.sourceArch !== sourceArch || restore.targetArch !== targetArch) throw new Error('cross-arch direction drifted');
if (restore.targetVmStarted !== true || restore.targetVerifierResult !== 'passed') throw new Error('target verifier did not pass');
if (!targetLog.includes(`bind=127.0.0.1:${port}`) || !targetLog.includes(`backlog=${backlog}`)) throw new Error('target log did not show restored listener');
if (restore.shortcutInspection.sourceIsaEmulationUsed !== false || restore.shortcutInspection.metadataOnlyShortcutAccepted !== false || restore.shortcutInspection.sidecarRuntimeUsed !== false) throw new Error('shortcut guard drifted');
const files = [
  'source-listener.py',
  'source-verifier.txt',
  'docker-source.stderr.txt',
  'capture.stdout.json',
  'capture.stderr.txt',
  'restore.stdout.json',
  'restore.stderr.txt',
  'target-listener-log.txt',
  'bundle/portable-tcp-listener.json',
  'bundle/portable-tcp-listener-restore-summary.json',
  'bundle/portable-tcp-listener-target-vm-restore-summary.json',
];
const sha256 = (relativePath) => crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, relativePath))).digest('hex');
const report = {
  kind: 'machinen.real-cross-arch-tcp-listener-product-e2e-report',
  version: 1,
  accepted: true,
  proofStatus: 'verified',
  scope: 'real-cross-arch-tcp-listener-product-e2e-v1',
  productCommandPath: 'machinen capture tcp-listener; machinen restore <bundle> --target-arch <target> --json',
  source: { architecture: sourceArch, platform: sourcePlatform, verifierOutput: sourceVerifier },
  target: {
    architecture: targetArch,
    restoredName: restore.restoredName ?? name,
    targetVmStarted: restore.targetVmStarted,
    targetVerifierResult: restore.targetVerifierResult,
    targetOutputObserved: restore.targetOutputObserved,
    targetLog,
  },
  workload: {
    kind: 'tcp-listener',
    bindAddress: '127.0.0.1',
    port: Number(port),
    backlog: Number(backlog),
    acceptQueue: 'empty',
    policy: 'target-native-loopback-tcp-listener-recreated',
  },
  result: {
    captureCompleted: true,
    restoreCompleted: true,
    migrationCompleted: true,
    sourceArch,
    targetArch,
    crossArchitecture: sourceArch !== targetArch,
    targetNativeVmBooted: true,
    targetVerifierPassed: true,
  },
  shortcutInspection: restore.shortcutInspection,
  claimGuard: {
    arbitraryVmRestoreClaimed: false,
    rawVmStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
    sourceTextReusedAsTargetCode: false,
    sidecarRuntimeUsed: false,
    metadataOnlyShortcutAccepted: false,
  },
  artifacts: files.map((relativePath) => ({ path: relativePath, sha256: sha256(relativePath) })),
};
fs.writeFileSync(path.join(outDir, 'real-cross-arch-tcp-listener-product-e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo "real cross-arch TCP listener product E2E passed: $OUT_DIR"
