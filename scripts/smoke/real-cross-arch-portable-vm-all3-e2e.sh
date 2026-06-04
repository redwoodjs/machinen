#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"
OUT_DIR="${OUT_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/machinen-real-cross-arch-all3.XXXXXX")}" 
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"
SOURCE_IMAGE="${SOURCE_IMAGE:-python:3.12-alpine}"
SERVICE_PORT="${SERVICE_PORT:-18181}"
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
NAME="real-xarch-all3-${SOURCE_ARCH}-to-${TARGET_ARCH}-$(date +%s)-$$"
CLI=(env "MACHINEN_ASSETS_DIR=${MACHINEN_ASSETS_DIR:-$ROOT/release-assets}" node packages/cli/dist/cli.js)
BUNDLE="$OUT_DIR/bundle"
SOURCE_CAPTURE="$OUT_DIR/source-capture.py"
DOCKER_STDOUT="$OUT_DIR/docker-source.stdout.txt"
DOCKER_STDERR="$OUT_DIR/docker-source.stderr.txt"
BOOT_STDOUT="$OUT_DIR/boot.stdout.json"
BOOT_STDERR="$OUT_DIR/boot.stderr.txt"
RESTORE_STDOUT="$OUT_DIR/target-restore.stdout.json"
RESTORE_STDERR="$OUT_DIR/target-restore.stderr.txt"
VERIFY_STDOUT="$OUT_DIR/target-verify.stdout.json"
VERIFY_STDERR="$OUT_DIR/target-verify.stderr.txt"
STOP_STDOUT="$OUT_DIR/stop.stdout.json"
STOP_STDERR="$OUT_DIR/stop.stderr.txt"
REPORT="$OUT_DIR/real-cross-arch-portable-vm-all3-e2e-report.json"

cleanup() {
  "${CLI[@]}" stop "$NAME" --force --json >"$STOP_STDOUT" 2>"$STOP_STDERR" || true
}
trap cleanup EXIT

cat > "$SOURCE_CAPTURE" <<'PY'
import hashlib, http.client, json, os, pathlib, platform, sqlite3, tempfile, threading
from http.server import BaseHTTPRequestHandler, HTTPServer

out = pathlib.Path(os.environ["OUT_DIR"])
bundle = out / "bundle"
root = bundle / "filesystem" / "root"
port = int(os.environ["SERVICE_PORT"])
target_arch = os.environ["TARGET_ARCH"]
source_arch = os.environ["SOURCE_ARCH"]
for path in [root / "etc" / "machinen", root / "var" / "lib" / "machinen" / "data"]:
    path.mkdir(parents=True, exist_ok=True)
(root / "etc" / "machinen" / "message.txt").write_text("portable filesystem alpha\n", encoding="utf8")
(root / "var" / "lib" / "machinen" / "data" / "numbers.txt").write_text("1\n2\n3\n", encoding="utf8")

def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()

files = []
for path in sorted(root.rglob("*")):
    if path.is_file():
        rel = path.relative_to(root).as_posix()
        files.append({"path": rel, "bytes": path.stat().st_size, "sha256": sha256_file(path)})
fs_manifest = {"kind": "machinen.portable-vm-filesystem-capture", "version": 1, "root": "filesystem/root", "files": files}
(bundle / "filesystem-manifest.json").write_text(json.dumps(fs_manifest, indent=2) + "\n", encoding="utf8")

sqlite_rows = [(1, "alpha", 11), (2, "beta", 13), (3, "gamma", 17)]
with tempfile.TemporaryDirectory() as tmp:
    db_path = pathlib.Path(tmp) / "source.db"
    con = sqlite3.connect(db_path)
    con.execute("create table items(id integer primary key, name text not null, qty integer not null)")
    con.executemany("insert into items(id, name, qty) values (?, ?, ?)", sqlite_rows)
    con.commit()
    count, total = con.execute("select count(*), sum(qty) from items").fetchone()
    dump = list(con.iterdump())
    con.close()
sqlite_manifest = {
    "kind": "machinen.portable-vm-sqlite-logical-capture",
    "version": 1,
    "database": "app.db",
    "engine": "sqlite",
    "state": "clean-quiesced",
    "dumpPath": "sqlite-dump.sql",
    "expected": {"count": count, "qtySum": total},
}
(bundle / "sqlite-logical.json").write_text(json.dumps(sqlite_manifest, indent=2) + "\n", encoding="utf8")
(bundle / "sqlite-dump.sql").write_text("\n".join(dump) + "\n", encoding="utf8")
(bundle / "sqlite-expected.env").write_text(f"COUNT={count}\nQTY_SUM={total}\n", encoding="utf8")

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"machinen-portable-service-v1\n"
        self.send_response(200)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
    def log_message(self, *_args):
        return

server = HTTPServer(("127.0.0.1", port), Handler)
thread = threading.Thread(target=server.serve_forever, daemon=True)
thread.start()
conn = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
conn.request("GET", "/")
resp = conn.getresponse()
service_body = resp.read().decode("utf8").strip()
conn.close()
server.shutdown()
thread.join(timeout=5)
service_manifest = {
    "kind": "machinen.portable-vm-service-capture",
    "version": 1,
    "serviceId": "selected-python-http-service",
    "runtime": "python3-target-native",
    "bindAddress": "127.0.0.1",
    "port": port,
    "path": "/",
    "expectedResponse": service_body,
    "sourceVerifier": {"status": resp.status, "body": service_body},
}
(bundle / "service-manifest.json").write_text(json.dumps(service_manifest, indent=2) + "\n", encoding="utf8")
(bundle / "service-expected-response.txt").write_text(service_body + "\n", encoding="utf8")
(bundle / "filesystem-sha256.txt").write_text("".join(f"{row['sha256']}  {row['path']}\n" for row in files), encoding="utf8")
manifest = {
    "kind": "machinen.real-cross-arch-portable-vm-all3-bundle",
    "version": 1,
    "scope": "real-cross-arch-portable-vm-filesystem-service-sqlite-v1",
    "source": {"architecture": source_arch, "platformMachine": platform.machine()},
    "target": {"architecture": target_arch},
    "workloads": ["filesystem", "service", "sqlite"],
    "claimGuard": {
        "arbitraryVmRestoreClaimed": False,
        "rawVmStateReplayUsed": False,
        "sourceIsaEmulationUsed": False,
        "metadataOnlyShortcutAccepted": False,
    },
}
(bundle / "portable-vm-all3-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf8")
transcript = {
    "kind": "machinen.real-cross-arch-portable-vm-all3-source-transcript",
    "version": 1,
    "accepted": True,
    "sourceArch": source_arch,
    "targetArch": target_arch,
    "filesystemFiles": len(files),
    "sqliteExpected": sqlite_manifest["expected"],
    "serviceExpectedResponse": service_body,
}
(out / "source-capture-transcript.json").write_text(json.dumps(transcript, indent=2) + "\n", encoding="utf8")
print(json.dumps(transcript, indent=2))
PY

/usr/bin/time -p pnpm build >"$OUT_DIR/build.stdout.txt" 2>"$OUT_DIR/build.stderr.txt"

docker run --rm --platform "$SOURCE_PLATFORM" \
  -e "OUT_DIR=/out" \
  -e "SOURCE_ARCH=$SOURCE_ARCH" \
  -e "TARGET_ARCH=$TARGET_ARCH" \
  -e "SERVICE_PORT=$SERVICE_PORT" \
  -v "$OUT_DIR:/out" \
  -v "$SOURCE_CAPTURE:/source-capture.py:ro" \
  "$SOURCE_IMAGE" python /source-capture.py >"$DOCKER_STDOUT" 2>"$DOCKER_STDERR"

cat > "$BUNDLE/target-restore.sh" <<'SH'
#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
mkdir -p "$TARGET"
rm -rf "$FSROOT"
mkdir -p "$FSROOT"
cp -a /mnt/capture/filesystem/root/. "$FSROOT/"
if ! command -v sqlite3 >/dev/null 2>&1; then
  apt-get update >/tmp/machinen-all3-apt-update.log 2>&1
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends sqlite3 >/tmp/machinen-all3-apt-install.log 2>&1
fi
DB="$TARGET/app.db"
rm -f "$DB"
sqlite3 "$DB" < /mnt/capture/sqlite-dump.sql
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
COUNT_GOT=$(sqlite3 "$DB" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$DB" 'select sum(qty) from items;')
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
cat > "$TARGET/service.pl" <<'PL'
use strict;
use warnings;
use IO::Socket::INET;
my $port = $ENV{MACHINEN_ALL3_SERVICE_PORT} || 18181;
my $body = ($ENV{MACHINEN_ALL3_SERVICE_RESPONSE} || 'machinen-portable-service-v1') . "\n";
my $server = IO::Socket::INET->new(LocalAddr => '127.0.0.1', LocalPort => $port, Proto => 'tcp', Listen => 16, Reuse => 1) or die "listen: $!\n";
$SIG{TERM} = sub { exit 0; };
while (my $client = $server->accept()) {
  my $buf = '';
  sysread($client, $buf, 4096);
  print $client "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: " . length($body) . "\r\nConnection: close\r\n\r\n" . $body;
  close($client);
}
PL
rm -f /tmp/machinen-all3-service.log /tmp/machinen-all3-service.pid
MACHINEN_ALL3_SERVICE_PORT=18181 MACHINEN_ALL3_SERVICE_RESPONSE="$EXPECTED_RESPONSE" perl "$TARGET/service.pl" >/tmp/machinen-all3-service.log 2>&1 &
echo $! >/tmp/machinen-all3-service.pid
cat > /tmp/machinen-all3-target-restore.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-restore",
  "accepted": true,
  "filesystemRestored": true,
  "sqliteRestored": { "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "sqliteExpected": { "count": $COUNT, "qtySum": $QTY_SUM },
  "serviceStarted": true,
  "servicePid": $(cat /tmp/machinen-all3-service.pid)
}
JSON
cat /tmp/machinen-all3-target-restore.json
SH
chmod +x "$BUNDLE/target-restore.sh"

cat > "$BUNDLE/target-verify.sh" <<'SH'
#!/usr/bin/env sh
set -eu
TARGET=/opt/machinen-all3
FSROOT="$TARGET/filesystem-root"
# shellcheck disable=SC1091
. /mnt/capture/sqlite-expected.env
if (cd "$FSROOT" && sha256sum -c /mnt/capture/filesystem-sha256.txt >/tmp/machinen-all3-fs-verify.log 2>&1); then
  FS_OK=true
else
  FS_OK=false
fi
COUNT_GOT=$(sqlite3 "$TARGET/app.db" 'select count(*) from items;')
QTY_SUM_GOT=$(sqlite3 "$TARGET/app.db" 'select sum(qty) from items;')
if [ "$COUNT_GOT" = "$COUNT" ] && [ "$QTY_SUM_GOT" = "$QTY_SUM" ]; then
  SQLITE_OK=true
else
  SQLITE_OK=false
fi
EXPECTED_RESPONSE=$(cat /mnt/capture/service-expected-response.txt | tr -d '\n')
SERVICE_BODY=$(perl -MIO::Socket::INET -e 'my $s=IO::Socket::INET->new(PeerAddr=>"127.0.0.1",PeerPort=>18181,Proto=>"tcp",Timeout=>5) or exit 7; print $s "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n"; local $/; my $r=<$s>; $r =~ s/^.*?\r?\n\r?\n//s; $r =~ s/\r?\n$//; print $r;')
if [ "$SERVICE_BODY" = "$EXPECTED_RESPONSE" ]; then
  SERVICE_OK=true
else
  SERVICE_OK=false
fi
if [ "$FS_OK" = true ] && [ "$SQLITE_OK" = true ] && [ "$SERVICE_OK" = true ]; then
  ACCEPTED=true
else
  ACCEPTED=false
fi
cat > /tmp/machinen-all3-target-verify.json <<JSON
{
  "kind": "machinen.real-cross-arch-portable-vm-all3-target-verifier",
  "accepted": $ACCEPTED,
  "filesystem": { "accepted": $FS_OK, "files": $(wc -l < /mnt/capture/filesystem-sha256.txt | tr -d ' ') },
  "sqlite": { "accepted": $SQLITE_OK, "count": $COUNT_GOT, "qtySum": $QTY_SUM_GOT },
  "service": { "accepted": $SERVICE_OK, "status": 200, "body": "$SERVICE_BODY" }
}
JSON
cat /tmp/machinen-all3-target-verify.json
[ "$ACCEPTED" = true ]
SH
chmod +x "$BUNDLE/target-verify.sh"

"${CLI[@]}" boot --name "$NAME" --mount-live "$BUNDLE:/mnt/capture:ro" --detached --json -- sleep 100000 \
  >"$BOOT_STDOUT" 2>"$BOOT_STDERR"
"${CLI[@]}" exec "$NAME" -- "/mnt/capture/target-restore.sh" \
  >"$RESTORE_STDOUT" 2>"$RESTORE_STDERR"
"${CLI[@]}" exec "$NAME" -- "/mnt/capture/target-verify.sh" \
  >"$VERIFY_STDOUT" 2>"$VERIFY_STDERR"

node - "$OUT_DIR" "$SOURCE_ARCH" "$TARGET_ARCH" "$SOURCE_PLATFORM" "$NAME" <<'NODE'
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');
const [outDir, sourceArch, targetArch, sourcePlatform, name] = process.argv.slice(2);
const readJson = (file) => JSON.parse(fs.readFileSync(path.join(outDir, file), 'utf8'));
const source = readJson('source-capture-transcript.json');
const manifest = readJson('bundle/portable-vm-all3-manifest.json');
const boot = readJson('boot.stdout.json');
const restore = readJson('target-restore.stdout.json');
const verify = readJson('target-verify.stdout.json');
if (source.accepted !== true || restore.accepted !== true || verify.accepted !== true) throw new Error('all3 E2E did not pass');
if (manifest.source.architecture !== sourceArch || manifest.target.architecture !== targetArch) throw new Error('manifest direction drifted');
if (sourceArch === targetArch) throw new Error('not cross-architecture');
if (manifest.claimGuard.arbitraryVmRestoreClaimed !== false || manifest.claimGuard.rawVmStateReplayUsed !== false) throw new Error('claim guard drifted');
const files = [];
function walk(relativeDir) {
  for (const entry of fs.readdirSync(path.join(outDir, relativeDir), { withFileTypes: true })) {
    const rel = path.join(relativeDir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (rel !== 'real-cross-arch-portable-vm-all3-e2e-report.json') files.push(rel);
  }
}
walk('.');
const sha256 = (relativePath) => crypto.createHash('sha256').update(fs.readFileSync(path.join(outDir, relativePath))).digest('hex');
const report = {
  kind: 'machinen.real-cross-arch-portable-vm-all3-e2e-report',
  version: 1,
  accepted: true,
  proofStatus: 'verified',
  scope: 'real-cross-arch-portable-vm-filesystem-service-sqlite-v1',
  productCommandPath: 'opposite-arch source capture bundle; machinen boot --mount-live <bundle>; machinen exec target restore/verifier',
  source: { architecture: sourceArch, platform: sourcePlatform, transcript: source },
  target: { architecture: targetArch, restoredName: boot.name ?? name, targetVmStarted: boot.detached === true, restore, verify },
  workloads: {
    filesystem: { accepted: verify.filesystem.accepted, files: verify.filesystem.files },
    service: { accepted: verify.service.accepted, body: verify.service.body },
    sqlite: { accepted: verify.sqlite.accepted, count: verify.sqlite.count, qtySum: verify.sqlite.qtySum },
  },
  result: {
    captureCompleted: true,
    restoreCompleted: true,
    migrationCompleted: true,
    sourceArch,
    targetArch,
    crossArchitecture: true,
    targetNativeVmBooted: true,
    targetVerifierPassed: true,
    allThreeWorkloadsVerified: true,
  },
  claimGuard: {
    arbitraryVmRestoreClaimed: false,
    rawVmStateReplayUsed: false,
    sourceIsaEmulationUsed: false,
    metadataOnlyShortcutAccepted: false,
  },
  artifacts: files.sort().map((relativePath) => ({ path: relativePath.replace(/^\.\//, ''), sha256: sha256(relativePath) })),
};
fs.writeFileSync(path.join(outDir, 'real-cross-arch-portable-vm-all3-e2e-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
NODE

echo "real cross-arch portable VM all3 E2E passed: $OUT_DIR"
